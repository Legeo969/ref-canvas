import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OIIO_RELATIVE_PATH = path.join(
  "assets",
  "native",
  "openimageio",
  "win32-x64",
  "oiiotool.exe",
);

/**
 * Locate the checked-in OpenImageIO sidecar in development and in the
 * app.asar.unpacked release layout. REFCANVAS_OIIOTOOL is intentionally
 * supported for tests and decoder diagnostics only.
 */
export interface OiiotoolRuntimeContext {
  resourcesPath?: string;
  defaultApp?: boolean;
  override?: string;
  cwd?: string;
}

export function packagedOiiotoolCandidates(
  context?: OiiotoolRuntimeContext,
): string[] {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string; defaultApp?: boolean };
  const runtime = context ?? {
    resourcesPath: electronProcess.resourcesPath,
    defaultApp: electronProcess.defaultApp,
    override: process.env.REFCANVAS_OIIOTOOL,
    cwd: process.cwd(),
  };
  const resourcesPath = runtime.resourcesPath;
  const packaged = Boolean(resourcesPath && runtime.defaultApp !== true);
  if (packaged) {
    return [path.join(resourcesPath!, "app.asar.unpacked", OIIO_RELATIVE_PATH)];
  }
  return [
    runtime.override,
    path.resolve(runtime.cwd ?? process.cwd(), OIIO_RELATIVE_PATH),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export async function packagedOiiotoolPath(): Promise<string | null> {
  for (const candidate of packagedOiiotoolCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic application-owned location.
    }
  }
  return null;
}

export function fitPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("EXR_INVALID_DIMENSIONS");
  }
  if (maximumWidth <= 0 || maximumHeight <= 0) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = Math.min(
    1,
    maximumWidth / sourceWidth,
    maximumHeight / sourceHeight,
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export interface OpenImageIoDecodeInput {
  inputPath: string;
  outputPath: string;
  channels: readonly string[];
  sourceWidth: number;
  sourceHeight: number;
  maximumWidth: number;
  maximumHeight: number;
  inputColorSpace?: string;
  displayTransform?: "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw";
  ocioConfigPath?: string;
  signal?: AbortSignal;
  executable?: string;
  subimage?: number;
}

export interface OpenImageIoSubimage {
  index: number;
  name: string;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  tileWidth: number;
  tileHeight: number;
  deep: boolean;
  format: string;
  compression: string | null;
  colorSpace: string | null;
  channels: string[];
}

export function buildOpenImageIoDecodeArgs(
  input: OpenImageIoDecodeInput,
  outputPath: string,
): string[] {
  const dimensions = fitPreviewDimensions(
    input.sourceWidth,
    input.sourceHeight,
    input.maximumWidth,
    input.maximumHeight,
  );
  const displayTransform = input.displayTransform ?? "linear-srgb";
  const sourceColorSpace = input.inputColorSpace || "linear";
  const builtInConfig = displayTransform === "aces-1.3"
    ? "ocio://cg-config-v1.0.0_aces-v1.3_ocio-v2.1"
    : displayTransform === "aces-2.0"
      ? "ocio://default"
      : undefined;
  const colorConfig = input.ocioConfigPath || builtInConfig;
  const colorTransformArgs = displayTransform === "raw"
    ? []
    : !input.ocioConfigPath && displayTransform === "aces-1.3"
      ? [`--ociodisplay:from=${sourceColorSpace}`, "sRGB - Display", "ACES 1.0 - SDR Video"]
      : !input.ocioConfigPath && displayTransform === "aces-2.0"
        ? [`--ociodisplay:from=${sourceColorSpace}`, "sRGB - Display", "ACES 2.0 - SDR 100 nits (Rec.709)"]
        : ["--colorconvert", sourceColorSpace, "sRGB"];
  return [
    ...(colorConfig ? ["--colorconfig", colorConfig] : []),
    input.inputPath,
    "--subimage",
    String(input.subimage ?? 0),
    "--flatten",
    "--ch",
    input.channels.join(","),
    ...colorTransformArgs,
    "--resize",
    `${dimensions.width}x${dimensions.height}`,
    "-d",
    "uint8",
    "-o",
    outputPath,
  ];
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlValue(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1].trim()) : null;
}

function xmlAttribute(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(`<attrib name="${escaped}"[^>]*>([\\s\\S]*?)</attrib>`),
  );
  return match ? decodeXml(match[1].trim()) : null;
}

export function parseOpenImageIoInfoXml(xml: string): OpenImageIoSubimage[] {
  return [...xml.matchAll(/<ImageSpec\b[^>]*>([\s\S]*?)<\/ImageSpec>/g)].map(
    (match, index) => {
      const block = match[1];
      return {
        index,
        name: xmlAttribute(block, "name") ?? "",
        width: Number(xmlValue(block, "width") ?? 0),
        height: Number(xmlValue(block, "height") ?? 0),
        fullWidth: Number(xmlValue(block, "full_width") ?? 0),
        fullHeight: Number(xmlValue(block, "full_height") ?? 0),
        tileWidth: Number(xmlValue(block, "tile_width") ?? 0),
        tileHeight: Number(xmlValue(block, "tile_height") ?? 0),
        deep: xmlValue(block, "deep") === "1",
        format: xmlValue(block, "format") ?? "unknown",
        compression: xmlAttribute(block, "compression"),
        colorSpace:
          xmlAttribute(block, "oiio:ColorSpace") ??
          xmlAttribute(block, "colorSpace"),
        channels: [...block.matchAll(/<channelname>([\s\S]*?)<\/channelname>/g)]
          .map((channel) => decodeXml(channel[1].trim())),
      };
    },
  );
}

export async function probeExrWithOpenImageIo(
  filename: string,
  options: { executable?: string; signal?: AbortSignal } = {},
): Promise<OpenImageIoSubimage[]> {
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const executable = options.executable ?? await packagedOiiotoolPath();
  if (!executable) throw new Error("OPENIMAGEIO_RUNTIME_MISSING");
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      ["-a", "--info:format=xml:verbose=1", filename],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
        signal: options.signal,
      },
      (error, output, stderr) => {
        if (!error) {
          resolve(output);
          return;
        }
        reject(new Error(
          `OPENIMAGEIO_PROBE_FAILED:${stderr.trim() || error.message}`,
          { cause: error },
        ));
      },
    );
  });
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const subimages = parseOpenImageIoInfoXml(stdout);
  if (!subimages.length || subimages.some((part) =>
    part.width <= 0 || part.height <= 0 || !part.channels.length
  )) {
    throw new Error("OPENIMAGEIO_PROBE_INVALID");
  }
  return subimages;
}

/**
 * Decode in an isolated process. OpenImageIO delegates EXR pixels to OpenEXR,
 * including DWAA/DWAB, tiled, multipart and deep storage. --flatten is a no-op
 * for ordinary images and composites deep samples for a display preview.
 */
export async function decodeExrWithOpenImageIo(
  input: OpenImageIoDecodeInput,
): Promise<{ path: string; width: number; height: number }> {
  if (!input.channels.length) throw new Error("EXR_DISPLAY_CHANNELS_MISSING");
  if (input.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const executable = input.executable ?? await packagedOiiotoolPath();
  if (!executable) throw new Error("OPENIMAGEIO_RUNTIME_MISSING");
  const dimensions = fitPreviewDimensions(
    input.sourceWidth,
    input.sourceHeight,
    input.maximumWidth,
    input.maximumHeight,
  );
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporary = path.join(
    path.dirname(input.outputPath),
    `${path.basename(input.outputPath)}.${randomUUID()}.tmp.png`,
  );
  const args = buildOpenImageIoDecodeArgs(input, temporary);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          maxBuffer: 4 * 1024 * 1024,
          timeout: 90_000,
          windowsHide: true,
          signal: input.signal,
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const detail = stderr.trim() || error.message;
          reject(new Error(`OPENIMAGEIO_DECODE_FAILED:${detail}`, { cause: error }));
        },
      );
    });
    if (input.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
    await rename(temporary, input.outputPath);
    return { path: input.outputPath, ...dimensions };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export interface OcioConfigValidation {
  ok: boolean;
  detail: string | null;
}

/**
 * 用一次最小解码校验自定义 OCIO 配置：色彩空间能否解析、引用的 LUT 是否
 * 存在。缺失 LUT 的配置（如 Unreal MRQ 只导出 config.ocio 未带 luts 目录）
 * 只有在真实转换时才会报错——提前校验，让用户在 OCIO 菜单里立刻看到
 * 原因，而不是预览静默失败或整条序列卡在「正在生成 HDR 预览」。
 */
export async function validateOcioConfigWithOpenImageIo(
  configPath: string,
  options: { executable?: string; signal?: AbortSignal } = {},
): Promise<OcioConfigValidation> {
  if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
  const executable = options.executable ?? await packagedOiiotoolPath();
  if (!executable) {
    // 无解码侧车时无法验证，按「未知」放行，交给解码期回退兜底。
    return { ok: true, detail: null };
  }
  const directory = await mkdtemp(path.join(tmpdir(), "refcanvas-ocio-"));
  const inputPath = path.join(directory, "probe.exr");
  const outputPath = path.join(directory, "probe.png");
  const run = (args: string[], timeout = 30_000): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          maxBuffer: 4 * 1024 * 1024,
          timeout,
          windowsHide: true,
          signal: options.signal,
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const detail = stderr.trim() || error.message;
          reject(new Error(detail));
        },
      );
    });
  try {
    await run([
      "--create", "4x4", "3",
      "--chnames", "R,G,B",
      "-d", "half",
      "-o", inputPath,
    ]);
    await run([
      inputPath,
      "--colorconfig", configPath,
      "--colorconvert", "scene_linear", "sRGB",
      "-d", "uint8",
      "-o", outputPath,
    ]);
    return { ok: true, detail: null };
  } catch (error) {
    if (options.signal?.aborted) throw new Error("PREVIEW_QUEUE_ABORTED");
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: detail.length > 400 ? `${detail.slice(0, 400)}…` : detail,
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
