import { execFile } from "node:child_process";
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
import { parseExrHeader } from "../services/media/exr-header";
import { parseHdrHeader } from "../services/media/hdr-header";
import { packagedFfmpegPath } from "../services/media/ffmpeg-tools";

const execFileAsync = promisify(execFile);

/**
 * HDR provider（计划 §6.2 / §9.2）：EXR 与 Radiance HDR。
 *
 * - probe/metadata：自解析文件头（尺寸、通道、压缩、位深、data/display
 *   window、chromaticities、色彩空间），不解码像素。
 * - thumbnail：libvips（sharp）读取 EXR/HDR 并执行线性 → sRGB 的
 *   display transform（tone map），输出 PNG 缩略图。
 *
 * 已知色彩转换结果（验收 15.1）：线性 0.5 灰的 EXR 应输出约 188/255
 * （0.5^(1/2.2) ≈ 0.730 → 186）；测试用 fixture 验证。
 */

export const HDR_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "hdr-provider",
  version: "1.0.0",
  kinds: ["image"],
  extensions: ["exr", "hdr"],
  mimeTypes: ["image/x-exr", "image/vnd.radiance"],
  capabilities: ["probe", "metadata", "thumbnail"],
  priority: 20,
  runtime: "node",
};

export class HdrProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = HDR_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "sharp + exr/hdr header parsers available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const extra = await this.readHeader(input.path, input.extension);
    if (!extra.valid) {
      throw new Error(`HDR_PROBE_FAILED:${extra.error ?? "UNKNOWN"}`);
    }
    return {
      width: extra.width,
      height: extra.height,
      duration: null,
      extra: {
        format: input.extension.toLowerCase(),
        channels: extra.channels,
        compression: extra.compression,
        bitDepth: extra.bitDepth,
        dataWindow: extra.dataWindow,
        displayWindow: extra.displayWindow,
        chromaticities: extra.chromaticities,
        colorSpace: extra.colorSpace,
        pixelAspectRatio: extra.pixelAspectRatio,
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const extra = await this.readHeader(input.path, input.extension);
    if (!extra.valid) {
      throw new Error(`HDR_METADATA_FAILED:${extra.error ?? "UNKNOWN"}`);
    }
    return {
      fields: {
        format: input.extension.toUpperCase(),
        width: extra.width,
        height: extra.height,
        channels: extra.channels.map((channel) => channel.name).join(", "),
        channelCount: extra.channels.length,
        compression: extra.compression,
        bitDepth: extra.bitDepth,
        dataWindow: extra.dataWindow,
        displayWindow: extra.displayWindow,
        chromaticities: extra.chromaticities,
        colorSpace: extra.colorSpace,
        pixelAspectRatio: extra.pixelAspectRatio,
        lineOrder: extra.lineOrder,
      },
    };
  }

  /**
   * 已知色彩转换结果（验收 15.1）：线性 0.5 灰应输出约 186-197/255
   * （近似 sRGB gamma 编码）；测试用 fixture 验证。
   */
  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    if (!input.outputPath) {
      throw new Error("HDR_THUMBNAIL_OUTPUT_MISSING");
    }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    // EXR/HDR 解码为线性 float（gbrpf32le），gamma 2.2 编码做
    // display transform，再量化 8bit PNG。EXR/HDR 不依赖 sharp
    // 的 libvips loader（prebuilt 不含 EXR）。
    await execFileAsync(
      packagedFfmpegPath(),
      [
        "-v",
        "error",
        "-i",
        input.path,
        "-vf",
        [
          `scale='min(${input.width},iw)':'min(${input.height},ih)':force_original_aspect_ratio=decrease`,
          "format=gbrpf32le",
          "eq=gamma=2.2",
          "format=rgb24",
        ].join(","),
        "-frames:v",
        "1",
        "-y",
        input.outputPath,
      ],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
        windowsHide: true,
      },
    );
    return {
      path: input.outputPath,
      width: input.width,
      height: input.height,
    };
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

  private async readHeader(
    filename: string,
    extension: string,
  ): Promise<{
    valid: boolean;
    error: string | null;
    width: number | null;
    height: number | null;
    channels: Array<{ name: string }>;
    compression: string | null;
    bitDepth: number | null;
    dataWindow: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    displayWindow: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    chromaticities: Record<string, number> | null;
    colorSpace: string | null;
    pixelAspectRatio: number | null;
    lineOrder: string | null;
  }> {
    if (extension.toLowerCase() === "exr") {
      const parsed = await parseExrHeader(filename);
      return {
        valid: parsed.valid,
        error: parsed.error,
        width: parsed.width,
        height: parsed.height,
        channels: parsed.channels.map((channel) => ({ name: channel.name })),
        compression: parsed.compression,
        bitDepth: parsed.bitDepth,
        dataWindow: parsed.dataWindow,
        displayWindow: parsed.displayWindow,
        chromaticities: parsed.chromaticities,
        colorSpace: parsed.colorSpace,
        pixelAspectRatio: parsed.pixelAspectRatio,
        lineOrder: parsed.lineOrder,
      };
    }
    const parsed = await parseHdrHeader(filename);
    return {
      valid: parsed.valid,
      error: parsed.error,
      width: parsed.width,
      height: parsed.height,
      channels: [],
      compression: parsed.format,
      bitDepth: 32,
      dataWindow: null,
      displayWindow: null,
      chromaticities: null,
      colorSpace: parsed.colorSpace,
      pixelAspectRatio: null,
      lineOrder: null,
    };
  }
}
