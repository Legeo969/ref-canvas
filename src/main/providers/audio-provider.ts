import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
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
import {
  readFfprobeFullMetadata,
  type FfprobeFullMetadata,
} from "../services/media/ffprobe-full";
import { extractWaveform } from "../services/media/waveform-extract";

const execFileAsync = promisify(execFile);

/**
 * 音频 provider（阶段 4：专业格式 — 音频）。
 *
 * - probe/metadata：ffprobe 完整字段（codec、sample rate、channels、
 *   bit depth、bitrate、duration、format、cover art）。
 * - thumbnail：优先提取内嵌封面（attached pic）；无封面时生成
 *   波形 SVG 样张（再解码一次音频取峰值，一次性成本）。
 * - waveform：流式峰值（media.waveform，8kHz s16le）。
 */

export const AUDIO_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "audio-provider",
  version: "1.0.0",
  kinds: ["audio"],
  extensions: [
    "wav", "wave", "mp3", "flac", "ogg", "oga", "opus", "m4a", "aac",
    "wma", "aiff", "aif", "ape", "tta", "mp2", "ac3", "amr", "caf",
  ],
  mimeTypes: ["audio/*"],
  capabilities: ["probe", "metadata", "thumbnail", "waveform"],
  priority: 20,
  runtime: "node",
};

export class AudioProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = AUDIO_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "ffmpeg/ffprobe audio toolchain available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const info = await this.readInfo(input.path);
    if (!info.valid || !info.audio) {
      throw new Error("AUDIO_PROBE_FAILED:NO_AUDIO_STREAM");
    }
    const stream = info.audio;
    return {
      width: null,
      height: null,
      duration: info.duration,
      extra: {
        format: "audio",
        codec: stream.codecName,
        codecLongName: stream.codecLongName,
        profile: stream.profile,
        sampleRate: stream.sampleRate,
        channels: stream.channels,
        channelLayout: stream.channelLayout,
        bitDepth: stream.bitsPerSample,
        bitRate: stream.bitRate ?? info.bitRate,
        formatName: info.formatName,
        hasCoverArt: Boolean(info.streams.some((item) => item.codecType === "video")),
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const info = await this.readInfo(input.path);
    if (!info.valid || !info.audio) {
      throw new Error("AUDIO_METADATA_FAILED:NO_AUDIO_STREAM");
    }
    const stream = info.audio;
    return {
      fields: {
        format: info.formatName?.toUpperCase() ?? null,
        codec: stream.codecLongName ?? stream.codecName,
        sampleRate: stream.sampleRate,
        channels: stream.channels,
        channelLayout: stream.channelLayout,
        bitDepth: stream.bitsPerSample,
        bitRate: stream.bitRate ?? info.bitRate,
        duration: info.duration,
        title: info.formatTags.title ?? null,
        artist: info.formatTags.artist ?? info.formatTags.album_artist ?? null,
        album: info.formatTags.album ?? null,
        track: info.formatTags.track ?? null,
        coverArt: info.streams.some((item) => item.codecType === "video"),
      },
    };
  }

  /**
   * 缩略图：优先内嵌封面（attached picture）；无封面生成波形 SVG
   * 样张（再解码一次音频，一次性成本）。
   */
  async thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    if (!input.outputPath) {
      throw new Error("AUDIO_THUMBNAIL_OUTPUT_MISSING");
    }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    const info = await this.readInfo(input.path);
    const hasCover = Boolean(
      info.streams.some((item) => item.codecType === "video"),
    );
    if (hasCover) {
      // 提取 attached picture → PNG。
      const extracted = `${input.outputPath}.cover.jpg`;
      try {
        await execFileAsync(
          packagedFfmpegPath(),
          [
            "-v", "error",
            "-i", input.path,
            "-map", "0:v:0",
            "-frames:v", "1",
            "-y",
            extracted,
          ],
          { maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true },
        );
        const sharp = (await import("sharp")).default;
        await sharp(extracted)
          .resize(input.width, input.height, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(input.outputPath);
        await rm(extracted, { force: true });
        return { path: input.outputPath, width: input.width, height: input.height };
      } catch {
        await rm(extracted, { force: true }).catch(() => undefined);
        // 封面提取失败 → 波形样张。
      }
    }
    const waveform = await extractWaveform(input.path);
    const svg = waveformSvg(
      waveform.peaks,
      input.width,
      input.height,
      input.extension,
    );
    const sharp = (await import("sharp")).default;
    await sharp(Buffer.from(svg)).webp({ quality: 85 }).toFile(input.outputPath);
    return { path: input.outputPath, width: input.width, height: input.height };
  }

  async waveform(input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    const data = await extractWaveform(input.path, 2400);
    return {
      peaks: data.peaks,
      secondsPerPoint: data.secondsPerPoint,
      duration: data.durationSeconds ?? 0,
      durationSeconds: data.durationSeconds,
    };
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

  private async readInfo(filename: string): Promise<FfprobeFullMetadata> {
    const info = await readFfprobeFullMetadata(filename);
    return info;
  }
}

/** 波形 SVG 样张：深色底 + 峰值柱状 + 音频徽标。 */
export function waveformSvg(
  peaks: number[],
  width: number,
  height: number,
  extension: string,
): string {
  const barCount = Math.min(peaks.length, 240);
  const barWidth = width / Math.max(1, barCount * 2 - 1);
  const bars: string[] = [];
  const step = Math.max(1, Math.floor(peaks.length / barCount));
  for (let i = 0; i < barCount; i += 1) {
    let peak = 0;
    for (let j = i * step; j < Math.min(peaks.length, (i + 1) * step); j += 1) {
      if (peaks[j] > peak) peak = peaks[j];
    }
    const barHeight = Math.max(2, peak * (height - 64));
    const x = i * barWidth * 2;
    bars.push(
      `<rect x="${x.toFixed(1)}" y="${((height - barHeight) / 2).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="${(barWidth / 2).toFixed(1)}" fill="#7fb8a0"/>`,
    );
  }
  const label = extension.toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#151a18"/>
  <text x="16" y="${height - 18}" font-family="Segoe UI, sans-serif" font-size="13" fill="#8d9a94">${label} · 音频波形</text>
  <text x="16" y="28" font-family="Segoe UI, sans-serif" font-size="15" font-weight="600" fill="#c8d1cc">RefCanvas</text>
  ${bars.join("")}
</svg>`;
}
