import { mkdir } from "node:fs/promises";
import path from "node:path";
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
import {
  readFfprobeFullMetadata,
  type FfprobeFullMetadata,
} from "../services/media/ffprobe-full";
import { extractVideoPoster } from "../services/media/ffmpeg-tools";

/**
 * Video provider（计划 §6.2 / §9.3）。
 *
 * - probe/metadata：ffprobe 完整解析（codec、profile、level、分辨率、
 *   帧率、time base、pixel format、bit depth、primaries/transfer/matrix、
 *   音轨与格式标签）。
 * - thumbnail：ffmpeg 提取 poster 帧（时长中点，避免黑场首帧）为 PNG。
 * - preview：返回本地路径，由调用方签发 refbrowse token（video 标签直接
 *   播放原始文件）；逐帧导航走 media:frame IPC（ffmpeg 精确帧提取），
 *   不依赖 HTML video seek。
 */

export const VIDEO_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "video-provider",
  version: "1.0.0",
  kinds: ["video"],
  extensions: ["mp4", "mov", "mkv", "webm", "avi"],
  mimeTypes: [
    "video/mp4",
    "video/quicktime",
    "video/x-matroska",
    "video/webm",
    "video/x-msvideo",
  ],
  capabilities: ["probe", "metadata", "thumbnail", "preview"],
  priority: 20,
  runtime: "node",
};

function frameRateOf(rate: string | null | undefined): number | null {
  if (!rate) return null;
  const [numerator, denominator] = rate.split("/").map(Number);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function metadataToFields(metadata: FfprobeFullMetadata): Record<string, unknown> {
  const video = metadata.video;
  const audio = metadata.audio;
  return {
    format: metadata.formatName,
    formatLongName: metadata.formatLongName,
    duration: metadata.duration,
    size: metadata.size,
    bitRate: metadata.bitRate,
    codec: video?.codecName,
    codecLongName: video?.codecLongName,
    profile: video?.profile,
    level: video?.level,
    width: video?.width,
    height: video?.height,
    pixelFormat: video?.pixelFormat,
    bitDepth: video?.bitsPerSample,
    frameRate: frameRateOf(video?.avgFrameRate),
    realFrameRate: frameRateOf(video?.realFrameRate),
    timeBase: video?.timeBase,
    colorPrimaries: video?.colorPrimaries,
    colorTransfer: video?.colorTransfer,
    colorSpace: video?.colorSpace,
    colorRange: video?.colorRange,
    sampleAspectRatio: video?.sampleAspectRatio,
    displayAspectRatio: video?.displayAspectRatio,
    rotation: video?.rotation,
    audioCodec: audio?.codecName,
    audioSampleRate: audio?.sampleRate,
    audioChannels: audio?.channels,
    audioChannelLayout: audio?.channelLayout,
    audioBitRate: audio?.bitRate,
    audioTracks: metadata.streams.filter((stream) => stream.codecType === "audio").length,
    subtitleTracks: metadata.streams.filter((stream) => stream.codecType === "subtitle").length,
    streamCount: metadata.streams.length,
  };
}

export class VideoProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = VIDEO_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "ffprobe + ffmpeg available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const metadata = await readFfprobeFullMetadata(input.path);
    if (!metadata.valid) {
      throw new Error(`VIDEO_PROBE_FAILED:${metadata.error ?? "UNKNOWN"}`);
    }
    return {
      width: metadata.video?.width ?? null,
      height: metadata.video?.height ?? null,
      duration: metadata.duration,
      extra: metadataToFields(metadata),
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const metadata = await readFfprobeFullMetadata(input.path);
    if (!metadata.valid) {
      throw new Error(`VIDEO_METADATA_FAILED:${metadata.error ?? "UNKNOWN"}`);
    }
    return {
      fields: metadataToFields(metadata),
    };
  }

  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    if (!input.outputPath) {
      throw new Error("VIDEO_THUMBNAIL_OUTPUT_MISSING");
    }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    const metadata = await readFfprobeFullMetadata(input.path);
    await extractVideoPoster(input.path, input.outputPath, metadata.duration);
    return {
      path: input.outputPath,
      width: input.width,
      height: input.height,
    };
  }

  async preview(input: ProviderPreviewInput): Promise<ProviderPreviewResult> {
    return {
      source: input.path,
      mimeType: mimeTypeForExtension(input.extension),
    };
  }

  waveform(_input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  convert(_input: ProviderConvertInput): Promise<ProviderConvertResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  async dispose(): Promise<void> {
    // 无自有资源。
  }
}

function mimeTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "webm":
      return "video/webm";
    case "avi":
      return "video/x-msvideo";
    default:
      return "application/octet-stream";
  }
}
