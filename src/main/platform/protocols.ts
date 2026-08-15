import { nativeImage, protocol } from "electron";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assetKindForExtension } from "../../shared/asset-kind";
import type { FoundSettings } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import { fileProtocolResponse } from "./protocol-file-response";
import { previewCacheKey, type PreviewCacheIdentity } from "./preview-cache-key";
import type { PreviewCacheIndex } from "./preview-cache-index";
import type { PreviewQueue } from "./preview-queue";
import {
  isValidPreviewToken,
  type PreviewTokenRegistry,
} from "./refbrowse";
import { thumbnailCacheFilename } from "./thumbnail-cache";
import type { ThumbnailWorkerClient } from "./thumbnail-worker-client";
import { genericPlaceholderThumbnail } from "./placeholder-thumbnail";
import type { ProviderRegistry } from "./provider-registry";
import { invokeThumbnail } from "./provider-registry";
import {
  evaluateProtocolRequest,
  protocolResponseHeaders,
  type ProtocolOriginPolicyOptions,
} from "./protocol-origin-policy";

interface ProtocolDependencies {
  getDatabase(): RefCanvasDatabase;
  getPreviewCacheIndex(): PreviewCacheIndex | null;
  getThumbnailCacheDirectory(): string;
  getThumbnailWorker(): ThumbnailWorkerClient | null;
  getProviderRegistry(): ProviderRegistry;
  previewTokens: PreviewTokenRegistry;
  thumbnailQueue: PreviewQueue<Buffer>;
  originPolicy: ProtocolOriginPolicyOptions;
}

const TRANSIENT_PREVIEW_FAILURES = [
  /PREVIEW_QUEUE_(?:ABORTED|FULL|CLEARED)/,
  /THUMBNAIL_CACHE_REBUILD/,
  /THUMBNAIL_WORKER_(?:ABORTED|CLOSED|EXITED|UNAVAILABLE|FAILED)/,
  /WORKER_JOB_(?:CANCELLED|TIMEOUT)/,
  /WORKER_(?:CRASHED|RESTART_EXHAUSTED|SUPERVISOR_CLOSED)/,
  /PROVIDER_(?:TIMEOUT|UNAVAILABLE)/,
];

/** Infrastructure failures can recover in the same session and must never become a disk negative-cache entry. */
export function shouldCachePreviewFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !TRANSIENT_PREVIEW_FAILURES.some((pattern) => pattern.test(message));
}

export function recordPreviewFailure(
  index: PreviewCacheIndex | null,
  key: string,
  error: unknown,
): void {
  if (!index) return;
  if (shouldCachePreviewFailure(error)) index.recordFailure(key);
  else index.clearFailure(key);
}

function thumbnailPriority(url: URL): number {
  switch (url.searchParams.get("priority")) {
    case "preview":
      return 0;
    case "visible":
      return 10;
    case "overscan":
      return 20;
    case "prefetch":
      return 30;
    default:
      return 20;
  }
}

function boardProxySize(url: URL): 512 | 1024 | 2048 | null {
  if (url.searchParams.get("variant") !== "board") return null;
  const size = Number(url.searchParams.get("size"));
  return size === 512 || size === 1024 || size === 2048 ? size : null;
}

function directoryThumbnailSize(url: URL): 480 | 960 | 1920 {
  const size = Number(url.searchParams.get("size"));
  return size === 960 || size === 1920 ? size : 480;
}

async function writeCacheAtomically(filename: string, data: Buffer): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, filename).catch(async (error) => {
    await rm(temporary, { force: true });
    throw error;
  });
}

async function generateThumbnail(
  dependencies: ProtocolDependencies,
  source: string,
  cacheFile: string,
  imageVariant: boolean,
  signal: AbortSignal,
  size: { width: number; height: number } = { width: 480, height: 320 },
  channel?: string,
  ocioConfigPath?: string,
  inputColorSpace?: string,
  displayTransform?: "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw",
): Promise<Buffer> {
  const extension = path.extname(source).replace(/^\./, "").toLowerCase();
  const kind = assetKindForExtension(extension);
  // 阶段 3/4：EXR/HDR、视频、PSD/PSB、音频、字体、文本走 provider
  // registry（display transform / poster / composite / 封面或波形样张 /
  // 字体样张 / 文本卡片）；其余图片走 sharp worker。
  const registryFormats =
    extension === "exr" ||
    extension === "hdr" ||
    kind === "video" ||
    kind === "model3d" ||
    extension === "psd" ||
    extension === "psb" ||
    kind === "audio" ||
    extension === "ttf" ||
    extension === "otf" ||
    extension === "woff" ||
    extension === "woff2" ||
    extension === "ttc" ||
    extension === "txt" ||
    extension === "md" ||
    extension === "markdown" ||
    extension === "rtf" ||
    extension === "srt" ||
    extension === "vtt" ||
    extension === "json" ||
    extension === "yaml" ||
    extension === "yml" ||
    extension === "xml" ||
    extension === "csv" ||
    extension === "log" ||
    extension === "ini" ||
    extension === "toml" ||
    extension === "conf" ||
    extension === "html" ||
    extension === "htm" ||
    extension === "css" ||
    extension === "js" ||
    extension === "ts" ||
    extension === "py" ||
    extension === "sh" ||
    extension === "bat" ||
    extension === "ps1";
  if (registryFormats) {
    const registry = dependencies.getProviderRegistry();
    if (registry) {
      const { result } = await invokeThumbnail(registry, {
        path: source,
        kind,
        extension,
        width: size.width,
        height: size.height,
        outputPath: cacheFile,
        channel,
        ocioConfigPath,
        inputColorSpace,
        displayTransform,
        signal,
      });
      return readFile(result.path);
    }
  }
  const worker = dependencies.getThumbnailWorker();
  if (imageVariant && worker) {
    const converted = await worker
      .convert(source, cacheFile, signal, size)
      .catch(() => null);
    if (converted) return converted;
  }
  if (signal.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  // Windows 上没有外壳缩略图的格式（.aep/.zip 等）可能返回空图，也可能
  // 直接抛「Failed to get thumbnail from local thumbnail cache reference」。
  // 两种情况都视为无缩略图：生成并缓存占位卡片，避免每次请求都重试
  // 失败并在控制台刷 404。
  const thumbnail = await nativeImage
    .createThumbnailFromPath(source, {
      width: size.width,
      height: size.height,
    })
    .catch(() => null);
  if (!thumbnail || thumbnail.isEmpty()) {
    const placeholder = await genericPlaceholderThumbnail(extension, size);
    await writeCacheAtomically(cacheFile, placeholder);
    return placeholder;
  }
  const png = thumbnail.toPNG();
  await writeCacheAtomically(cacheFile, png);
  return png;
}

const HDR_DISPLAY_TRANSFORMS = new Set(["linear-srgb", "aces-1.3", "aces-2.0", "raw"] as const);

/**
 * 色彩管理变体管线版本。显示变换/解码实现发生变化时递增（如修复
 * 「选了 ACES 配置不生效」：旧版本生成的变体缓存内容等同基础画面，
 * 而缓存键只看源文件身份、永不失效），让旧的错误变体缓存自然失效
 * 并重新生成；不带色彩管理参数的默认路径不受影响。
 */
const COLOR_MANAGED_VARIANT_VERSION = "v1";

function hdrDisplayTransform(url: URL): "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw" | undefined {
  const value = url.searchParams.get("displayTransform");
  return value && HDR_DISPLAY_TRANSFORMS.has(value as "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw")
    ? value as "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw"
    : undefined;
}

function hdrInputColorSpace(url: URL): string | undefined {
  const value = url.searchParams.get("inputColorSpace")?.trim();
  return value && value.length <= 128 ? value : undefined;
}

export function hdrColorVariant(url: URL): string {
  const transform = hdrDisplayTransform(url);
  const inputColorSpace = hdrInputColorSpace(url);
  const ocioSignature = url.searchParams.get("ocio")?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") ?? "";
  const variant = `${transform ? `-display-${transform}` : ""}${inputColorSpace ? `-input-${inputColorSpace.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}` : ""}${ocioSignature ? `-ocio-${ocioSignature}` : ""}`;
  return variant ? `${variant}-${COLOR_MANAGED_VARIANT_VERSION}` : "";
}

function registerAssetProtocol(dependencies: ProtocolDependencies): void {
  protocol.handle("refasset", async (request) => {
    const access = evaluateProtocolRequest(request, dependencies.originPolicy);
    if (!access.allowed) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    if (url.host !== "asset" && url.host !== "thumbnail") {
      return new Response("Not found", { status: 404 });
    }
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((item) => decodeURIComponent(item));
    const id = segments[0] ?? "";
    if (!z.string().uuid().safeParse(id).success) {
      return new Response("Bad request", { status: 400 });
    }
    const asset = dependencies.getDatabase().getAssetSource(id);
    if (!asset) return new Response("Not found", { status: 404 });
    const source = asset.sourcePath;
    if (!source) {
      const label = asset.lifecycle === "purged" ? "SOURCE PURGED" : "SOURCE MISSING";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="100%" height="100%" fill="#191d1e"/><path d="M214 112h52v64h-52z" fill="none" stroke="#68716d" stroke-width="4"/><text x="240" y="208" text-anchor="middle" fill="#939c98" font-family="Segoe UI,sans-serif" font-size="14">${label}</text></svg>`;
      return new Response(svg, {
        status: 200,
        headers: protocolResponseHeaders(access, "image/svg+xml"),
      });
    }
    if (url.host === "thumbnail") {
      let failedCacheKey: string | null = null;
      try {
        const proxySize = asset.kind === "image" ? boardProxySize(url) : null;
        // A user-chosen thumbnail overrides the generated cache when present.
        if (!proxySize && asset.customThumbnailPath) {
          const custom = await readFile(asset.customThumbnailPath).catch(
            () => null,
          );
          if (custom) {
            return new Response(new Uint8Array(custom), {
              headers: protocolResponseHeaders(access, "image/png"),
            });
          }
        }
        let cacheFile: string;
        let cacheKey: string;
        if (proxySize) {
          const info = await stat(source);
          const identity = previewCacheKey({
            realPath: source,
            size: info.size,
            mtimeMs: info.mtimeMs,
            variant: `board-${proxySize}-png`,
          });
          cacheKey = `board:${identity}`;
          cacheFile = path.join(
            dependencies.getThumbnailCacheDirectory(),
            "board",
            `${identity}.png`,
          );
        } else {
          const channel = url.searchParams.get("channel")?.trim() || null;
          const colorVariant = hdrColorVariant(url);
          const cacheFilename = thumbnailCacheFilename(
            asset,
            channel || colorVariant
              ? `${channel ? `channel:${channel}` : "default"}${colorVariant}`
              : undefined,
          );
          cacheKey = `asset:${cacheFilename}`;
          cacheFile = path.join(dependencies.getThumbnailCacheDirectory(), cacheFilename);
        }
        failedCacheKey = cacheKey;
        await mkdir(path.dirname(cacheFile), { recursive: true });
        const indexed = dependencies.getPreviewCacheIndex()?.get(cacheKey);
        if (indexed?.status === "failed") {
          if (!url.searchParams.has("previewRetry")) {
            return new Response("No thumbnail", { status: 404 });
          }
          dependencies.getPreviewCacheIndex()?.clearFailure(cacheKey);
        }
        const cached = await readFile(cacheFile).catch(() => null);
        if (cached) {
          dependencies.getPreviewCacheIndex()?.recordSuccess(cacheKey, cacheFile, cached.byteLength);
          return new Response(new Uint8Array(cached), {
            headers: protocolResponseHeaders(access, "image/png"),
          });
        }
        const png = await dependencies.thumbnailQueue.enqueue(`asset:${cacheFile}`, async (signal) => {
          const cached = await readFile(cacheFile).catch(() => null);
          if (cached) return cached;
          const generated = await generateThumbnail(
            dependencies,
            source,
            cacheFile,
            asset.kind === "image",
            signal,
            proxySize
              ? { width: proxySize, height: proxySize }
              : undefined,
            url.searchParams.get("channel") ?? undefined,
            dependencies.getDatabase().getSetting<Partial<FoundSettings>>("foundSettings", {}).ocioConfigPath ?? undefined,
            hdrInputColorSpace(url),
            hdrDisplayTransform(url),
          );
          dependencies.getPreviewCacheIndex()?.recordSuccess(
            cacheKey,
            cacheFile,
            generated.byteLength,
          );
          return generated;
        }, {
          priority: thumbnailPriority(url),
          signal: request.signal,
        });
        return new Response(new Uint8Array(png), {
          headers: protocolResponseHeaders(access, "image/png"),
        });
      } catch (error) {
        if (request.signal.aborted) {
          return new Response("Cancelled", { status: 499 });
        }
        if (failedCacheKey) {
          recordPreviewFailure(dependencies.getPreviewCacheIndex(), failedCacheKey, error);
        }
        return new Response("No thumbnail", { status: 404 });
      }
    }
    let filename = source;
    if (segments.length > 1) {
      const relative = segments.slice(1).join(path.sep);
      if (relative !== path.basename(source)) {
        const root = path.resolve(path.dirname(source));
        const candidate = path.resolve(root, relative);
        if (
          candidate !== root &&
          !candidate.startsWith(`${root}${path.sep}`)
        ) {
          return new Response("Forbidden", { status: 403 });
        }
        filename = candidate;
      }
    }
    return fileProtocolResponse(filename, request, protocolResponseHeaders(access));
  });
}

/**
 * 会话级 refbrowse:// 协议：URL 只携带随机 token（绝对路径永不出现在
 * URL 中）。token → 路径为服务端单向映射，路径穿越与符号链接逃逸在此
 * 不构成注入面；仍做 realpath 解析失败即拒绝，且只允许普通文件。
 */
function registerRefBrowseProtocol(dependencies: ProtocolDependencies): void {
  protocol.handle("refbrowse", async (request) => {
    const access = evaluateProtocolRequest(request, dependencies.originPolicy);
    if (!access.allowed) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    if (url.host !== "preview" && url.host !== "thumbnail") {
      return new Response("Not found", { status: 404 });
    }
    let segments: string[];
    try {
      segments = url.pathname
        .split("/")
        .filter(Boolean)
        .map((item) => decodeURIComponent(item));
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const token = segments[0] ?? "";
    if (!isValidPreviewToken(token)) {
      return new Response("Bad request", { status: 400 });
    }
    const resolver = {
      realpath: (filename: string) => realpath(filename).catch(() => null),
      stat: async (filename: string) => {
        const info = await stat(filename).catch(() => null);
        return info ? { isFile: info.isFile() } : null;
      },
    };
    const relativePath =
      url.host === "preview" && segments.length > 1
        ? segments.slice(1).join(path.sep)
        : null;
    const real = relativePath
      ? await dependencies.previewTokens.resolveRelative(token, relativePath, resolver)
      : await dependencies.previewTokens.resolve(token, resolver);
    if (!real) return new Response("Token expired", { status: 404 });
    if (url.host === "thumbnail") {
      try {
        const info = await stat(real);
        const imageVariant = assetKindForExtension(path.extname(real)) === "image";
        const channel = url.searchParams.get("channel")?.toLowerCase() ?? "";
        const colorVariant = hdrColorVariant(url);
        const thumbnailSize = directoryThumbnailSize(url);
        const variant = `${imageVariant
          ? `thumbnail-${thumbnailSize}x${thumbnailSize}-png`
          : `thumbnail-shell-${thumbnailSize}x${thumbnailSize}-png`}${channel ? `-${channel}` : ""}${colorVariant}` as PreviewCacheIdentity["variant"];
        const key = previewCacheKey({
          realPath: real,
          size: info.size,
          mtimeMs: info.mtimeMs,
          variant,
        });
        const cacheDirectory = path.join(
          dependencies.getThumbnailCacheDirectory(),
          "directory",
        );
        const cacheFile = path.join(cacheDirectory, `${key}.png`);
        await mkdir(cacheDirectory, { recursive: true });
        const indexed = dependencies.getPreviewCacheIndex()?.get(key);
        if (indexed?.status === "failed") {
          if (!url.searchParams.has("previewRetry")) {
            return new Response("No thumbnail", { status: 404 });
          }
          dependencies.getPreviewCacheIndex()?.clearFailure(key);
        }
        const png = await dependencies.thumbnailQueue.enqueue(cacheFile, async (signal) => {
          const cached = await readFile(cacheFile).catch(() => null);
          if (cached) {
            dependencies.getPreviewCacheIndex()?.recordSuccess(key, cacheFile, cached.byteLength);
            return cached;
          }
          const generated = await generateThumbnail(
            dependencies,
            real,
            cacheFile,
            imageVariant,
            signal,
            { width: thumbnailSize, height: thumbnailSize },
            url.searchParams.get("channel") ?? undefined,
            dependencies.getDatabase().getSetting<Partial<FoundSettings>>("foundSettings", {}).ocioConfigPath ?? undefined,
            hdrInputColorSpace(url),
            hdrDisplayTransform(url),
          );
          dependencies.getPreviewCacheIndex()?.recordSuccess(key, cacheFile, generated.byteLength);
          return generated;
        }, {
          priority: thumbnailPriority(url),
          signal: request.signal,
        });
        return new Response(Uint8Array.from(png), {
          headers: protocolResponseHeaders(access, "image/png"),
        });
      } catch (error) {
        if (request.signal.aborted) {
          return new Response("Cancelled", { status: 499 });
        }
        try {
          const info = await stat(real);
          const imageVariant = assetKindForExtension(path.extname(real)) === "image";
          const channel = url.searchParams.get("channel")?.toLowerCase() ?? "";
          const colorVariant = hdrColorVariant(url);
          const thumbnailSize = directoryThumbnailSize(url);
          const variant = `${imageVariant
            ? `thumbnail-${thumbnailSize}x${thumbnailSize}-png`
            : `thumbnail-shell-${thumbnailSize}x${thumbnailSize}-png`}${channel ? `-${channel}` : ""}${colorVariant}` as PreviewCacheIdentity["variant"];
          const failedKey = previewCacheKey({
            realPath: real,
            size: info.size,
            mtimeMs: info.mtimeMs,
            variant,
          });
          recordPreviewFailure(dependencies.getPreviewCacheIndex(), failedKey, error);
        } catch {
          // File disappeared while the thumbnail was being generated.
        }
        return new Response("No thumbnail", { status: 404 });
      }
    }
    return fileProtocolResponse(real, request, protocolResponseHeaders(access));
  });
}

export function registerProtocols(dependencies: ProtocolDependencies): void {
  registerAssetProtocol(dependencies);
  registerRefBrowseProtocol(dependencies);
}
