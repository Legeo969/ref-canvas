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
import { assetKindForExtension } from "../shared/asset-kind";
import type { RefCanvasDatabase } from "./database";
import { fileProtocolResponse } from "./protocol-file-response";
import { previewCacheKey } from "./preview-cache-key";
import type { PreviewCacheIndex } from "./preview-cache-index";
import type { PreviewQueue } from "./preview-queue";
import {
  isValidPreviewToken,
  type PreviewTokenRegistry,
} from "./refbrowse";
import { thumbnailCacheFilename } from "./thumbnail-cache";
import type { ThumbnailWorkerClient } from "./thumbnail-worker-client";

interface ProtocolDependencies {
  getDatabase(): RefCanvasDatabase;
  getPreviewCacheIndex(): PreviewCacheIndex | null;
  getThumbnailCacheDirectory(): string;
  getThumbnailWorker(): ThumbnailWorkerClient | null;
  previewTokens: PreviewTokenRegistry;
  thumbnailQueue: PreviewQueue<Buffer>;
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
): Promise<Buffer> {
  const worker = dependencies.getThumbnailWorker();
  if (imageVariant && worker) {
    const converted = await worker
      .convert(source, cacheFile, signal, size)
      .catch(() => null);
    if (converted) return converted;
  }
  if (signal.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const thumbnail = await nativeImage.createThumbnailFromPath(source, {
    width: size.width,
    height: size.height,
  });
  if (thumbnail.isEmpty()) throw new Error("NO_THUMBNAIL");
  const png = thumbnail.toPNG();
  await writeCacheAtomically(cacheFile, png);
  return png;
}

function registerAssetProtocol(dependencies: ProtocolDependencies): void {
  protocol.handle("refasset", async (request) => {
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
    const asset = dependencies.getDatabase().getAsset(id);
    const source = dependencies.getDatabase().getAssetPath(id);
    if (!asset) return new Response("Not found", { status: 404 });
    if (!source) {
      const label = asset.lifecycle === "purged" ? "SOURCE PURGED" : "SOURCE MISSING";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="100%" height="100%" fill="#191d1e"/><path d="M214 112h52v64h-52z" fill="none" stroke="#68716d" stroke-width="4"/><text x="240" y="208" text-anchor="middle" fill="#939c98" font-family="Segoe UI,sans-serif" font-size="14">${label}</text></svg>`;
      return new Response(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
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
              headers: {
                "Content-Type": "image/png",
                "Access-Control-Allow-Origin": "*",
                "Cross-Origin-Resource-Policy": "cross-origin",
              },
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
          const cacheFilename = thumbnailCacheFilename(asset);
          cacheKey = `asset:${cacheFilename}`;
          cacheFile = path.join(dependencies.getThumbnailCacheDirectory(), cacheFilename);
        }
        failedCacheKey = cacheKey;
        await mkdir(path.dirname(cacheFile), { recursive: true });
        const indexed = dependencies.getPreviewCacheIndex()?.get(cacheKey);
        if (indexed?.status === "failed") {
          return new Response("No thumbnail", { status: 404 });
        }
        const cached = await readFile(cacheFile).catch(() => null);
        if (cached) {
          dependencies.getPreviewCacheIndex()?.recordSuccess(cacheKey, cacheFile, cached.byteLength);
          return new Response(new Uint8Array(cached), {
            headers: {
              "Content-Type": "image/png",
              "Access-Control-Allow-Origin": "*",
              "Cross-Origin-Resource-Policy": "cross-origin",
            },
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
          headers: {
            "Content-Type": "image/png",
            "Access-Control-Allow-Origin": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      } catch {
        if (request.signal.aborted) {
          return new Response("Cancelled", { status: 499 });
        }
        if (failedCacheKey) dependencies.getPreviewCacheIndex()?.recordFailure(failedCacheKey);
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
    return fileProtocolResponse(filename, request, {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });
}

/**
 * 会话级 refbrowse:// 协议：URL 只携带随机 token（绝对路径永不出现在
 * URL 中）。token → 路径为服务端单向映射，路径穿越与符号链接逃逸在此
 * 不构成注入面；仍做 realpath 解析失败即拒绝，且只允许普通文件。
 */
function registerRefBrowseProtocol(dependencies: ProtocolDependencies): void {
  protocol.handle("refbrowse", async (request) => {
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
        const variant = imageVariant
          ? "thumbnail-480x320-png"
          : "thumbnail-shell-480x320-png";
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
          return new Response("No thumbnail", { status: 404 });
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
          );
          dependencies.getPreviewCacheIndex()?.recordSuccess(key, cacheFile, generated.byteLength);
          return generated;
        }, {
          priority: thumbnailPriority(url),
          signal: request.signal,
        });
        return new Response(Uint8Array.from(png), {
          headers: {
            "Content-Type": "image/png",
            "Access-Control-Allow-Origin": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      } catch {
        if (request.signal.aborted) {
          return new Response("Cancelled", { status: 499 });
        }
        try {
          const info = await stat(real);
          const imageVariant = assetKindForExtension(path.extname(real)) === "image";
          dependencies.getPreviewCacheIndex()?.recordFailure(previewCacheKey({
            realPath: real,
            size: info.size,
            mtimeMs: info.mtimeMs,
            variant: imageVariant
              ? "thumbnail-480x320-png"
              : "thumbnail-shell-480x320-png",
          }));
        } catch {
          // File disappeared while the thumbnail was being generated.
        }
        return new Response("No thumbnail", { status: 404 });
      }
    }
    return fileProtocolResponse(real, request, {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });
}

export function registerProtocols(dependencies: ProtocolDependencies): void {
  registerAssetProtocol(dependencies);
  registerRefBrowseProtocol(dependencies);
}
