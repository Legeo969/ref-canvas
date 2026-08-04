import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ProviderHealth,
  ProviderMetadataInput,
  ProviderMetadataResult,
  ProviderPreviewInput,
  ProviderPreviewResult,
  ProviderProbeInput,
  ProviderProbeResult,
  ProviderThumbnailInput,
  ProviderThumbnailResult,
  ProviderWaveformInput,
  ProviderWaveformResult,
  ProviderConvertInput,
  ProviderConvertResult,
  ResourceProvider,
  ResourceProviderManifest,
} from "../../shared/worker-protocol";
import { packagedFfmpegPath } from "../services/media/ffmpeg-tools";
import { parsePsdHeader } from "../services/media/psd-header";

const execFileAsync = promisify(execFile);

/**
 * 专业图片 provider（阶段 4：PSD/PSB、HEIF/HEIC、JXL、相机 RAW）。
 *
 * - HEIC/HEIF/AVIF：probe 用 libvips（sharp）读 metadata；thumbnail
 *   由 sharp worker 直接处理（libvips 自带 libheif/libde265）。
 * - PSD/PSB：probe 自解析文件头（画布/通道/位深/色彩模式/图层数）；
 *   thumbnail 用 ffmpeg psd 解码器渲染 composite。
 * - JXL / 相机 RAW（CR2/NEF/ARW/DNG…）：无本地解码器（libvips
 *   prebuilt 无 libjxl，无 libraw/dcraw），probe 返回
 *   unsupportedReason 明确降级（验收：不显示虚假支持）。
 */

/** 需要降级的扩展名 → 说明。 */
const UNSUPPORTED_DECODERS: Record<string, string> = {
  jxl: "JPEG XL：本地无 libjxl 解码器",
  jxr: "JPEG XR：本地无解码器",
  cr2: "相机 RAW（CR2）：本地无 libraw 解码器",
  cr3: "相机 RAW（CR3）：本地无 libraw 解码器",
  nef: "相机 RAW（NEF）：本地无 libraw 解码器",
  arw: "相机 RAW（ARW）：本地无 libraw 解码器",
  rw2: "相机 RAW（RW2）：本地无 libraw 解码器",
  orf: "相机 RAW（ORF）：本地无 libraw 解码器",
  pef: "相机 RAW（PEF）：本地无 libraw 解码器",
  raf: "相机 RAW（RAF）：本地无 libraw 解码器",
  srw: "相机 RAW（SRW）：本地无 libraw 解码器",
  dng: "相机 RAW（DNG）：本地无 libraw 解码器",
  raw: "相机 RAW：本地无 libraw 解码器",
};

async function readMagic(filename: string, length = 12): Promise<Buffer | null> {
  try {
    const file = await open(filename, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, 0);
      return bytesRead > 0 ? buffer.subarray(0, bytesRead) : null;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

function isJxl(magic: Buffer | null): boolean {
  if (!magic || magic.length < 4) return false;
  return (
    (magic[0] === 0xff && magic[1] === 0x0a) ||
    magic.subarray(0, 12).equals(
      Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
    )
  );
}

export const IMAGE_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "image-provider",
  version: "1.0.0",
  kinds: ["image"],
  extensions: [
    "heic", "heif", "avif", "jxl", "jxr",
    "psd", "psb",
    "cr2", "cr3", "nef", "arw", "rw2", "orf", "pef", "raf", "srw", "dng", "raw",
  ],
  mimeTypes: [],
  capabilities: ["probe", "metadata", "thumbnail"],
  priority: 25,
  runtime: "node",
};

export class ImageProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = IMAGE_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "libvips + ffmpeg psd decoder available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const extension = input.extension.toLowerCase();
    if (UNSUPPORTED_DECODERS[extension]) {
      const magic = await readMagic(input.path);
      if (extension === "jxl" && magic && !isJxl(magic)) {
        throw new Error("IMAGE_PROBE_FAILED:NOT_JXL");
      }
      return {
        width: null,
        height: null,
        duration: null,
        extra: {
          format: extension,
          unsupportedReason: UNSUPPORTED_DECODERS[extension],
        },
      };
    }
    if (extension === "psd" || extension === "psb") {
      const parsed = await parsePsdHeader(input.path);
      if (!parsed.valid) {
        throw new Error(`IMAGE_PROBE_FAILED:${parsed.error ?? "UNKNOWN"}`);
      }
      return {
        width: parsed.width,
        height: parsed.height,
        duration: null,
        extra: {
          format: parsed.version === 2 ? "psb" : "psd",
          channels: parsed.channels,
          bitDepth: parsed.depth,
          colorMode: parsed.colorMode,
          layerCount: parsed.layerCount,
          hasLayers: parsed.hasLayers,
        },
      };
    }
    // HEIC/HEIF/AVIF：libvips 读 metadata（不解码像素）。
    const metadata = await readSharpMetadata(input.path);
    if (!metadata) {
      throw new Error("IMAGE_PROBE_FAILED:LIBVIPS");
    }
    return {
      width: metadata.width,
      height: metadata.height,
      duration: null,
      extra: {
        format: metadata.format,
        channels: metadata.channels,
        bitDepth: metadata.bitDepth ?? null,
        compression: metadata.compression ?? null,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation ?? null,
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const extension = input.extension.toLowerCase();
    if (UNSUPPORTED_DECODERS[extension]) {
      return {
        fields: {
          format: extension.toUpperCase(),
          note: UNSUPPORTED_DECODERS[extension],
        },
      };
    }
    if (extension === "psd" || extension === "psb") {
      const parsed = await parsePsdHeader(input.path);
      if (!parsed.valid) {
        throw new Error(`IMAGE_METADATA_FAILED:${parsed.error ?? "UNKNOWN"}`);
      }
      return {
        fields: {
          format: parsed.version === 2 ? "PSB" : "PSD",
          width: parsed.width,
          height: parsed.height,
          channels: parsed.channels,
          bitDepth: parsed.depth,
          colorMode: parsed.colorMode,
          layerCount: parsed.layerCount,
          hasLayers: parsed.hasLayers,
        },
      };
    }
    const metadata = await readSharpMetadata(input.path);
    if (!metadata) {
      throw new Error("IMAGE_METADATA_FAILED:LIBVIPS");
    }
    return {
      fields: {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
        bitDepth: metadata.bitDepth ?? null,
        compression: metadata.compression ?? null,
        hasAlpha: metadata.hasAlpha,
      },
    };
  }

  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    const extension = input.extension.toLowerCase();
    if (UNSUPPORTED_DECODERS[extension]) {
      throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
    if (extension === "psd" || extension === "psb") {
      if (!input.outputPath) {
        throw new Error("IMAGE_THUMBNAIL_OUTPUT_MISSING");
      }
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      // ffmpeg psd 解码器渲染 composite（合并图层）。
      await execFileAsync(
        packagedFfmpegPath(),
        [
          "-v", "error",
          "-i", input.path,
          "-vf",
          `scale='min(${input.width},iw)':'min(${input.height},ih)':force_original_aspect_ratio=decrease`,
          "-frames:v", "1",
          "-y",
          input.outputPath,
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 60_000, windowsHide: true },
      );
      return { path: input.outputPath, width: input.width, height: input.height };
    }
    // HEIC/AVIF 走 sharp worker（libvips 原生支持）。
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  waveform(_input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  preview(_input: ProviderPreviewInput): Promise<ProviderPreviewResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  convert(_input: ProviderConvertInput): Promise<ProviderConvertResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  async dispose(): Promise<void> {
    // 无自有资源。
  }
}

/** 用 sharp 读图片 metadata（失败返回 null）。 */
export async function readSharpMetadata(
  filename: string,
): Promise<{
  width: number | null;
  height: number | null;
  format: string | null;
  channels: number | null;
  bitDepth: number | null;
  compression: string | null;
  hasAlpha: boolean;
  orientation: number | null;
} | null> {
  try {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(filename).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
      channels: metadata.channels ?? null,
      bitDepth: metadata.bitsPerSample ?? null,
      compression: metadata.compression ?? null,
      hasAlpha: metadata.hasAlpha ?? false,
      orientation: metadata.orientation ?? null,
    };
  } catch {
    return null;
  }
}
