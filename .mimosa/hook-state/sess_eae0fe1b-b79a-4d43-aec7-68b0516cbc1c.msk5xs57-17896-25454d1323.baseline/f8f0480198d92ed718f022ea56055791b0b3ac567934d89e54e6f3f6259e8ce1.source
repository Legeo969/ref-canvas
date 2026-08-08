import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

/**
 * ffprobe 完整 metadata（阶段 3 §9.3）。
 *
 * 视频 Inspector 要求：codec、profile、level、resolution、frame rate、
 * duration、time base、pixel format、bit depth、primaries、transfer、
 * matrix 和 audio tracks。音频 Inspector（阶段 4）需要 sample rate、
 * channels、bit depth、bitrate 与 cover art。
 */

const execFileAsync = promisify(execFile);

export function packagedFfprobePath(filename = ffprobeInstaller.path): string {
  return filename.includes("app.asar")
    ? filename.replace("app.asar", "app.asar.unpacked")
    : filename;
}

export interface FfprobeStreamInfo {
  index: number;
  codecType: "video" | "audio" | "subtitle" | "data" | string | null;
  codecName: string | null;
  codecLongName: string | null;
  profile: string | null;
  level: number | null;
  width: number | null;
  height: number | null;
  /** 采样宽高比（如 "16:9"）。 */
  sampleAspectRatio: string | null;
  displayAspectRatio: string | null;
  /** 平均帧率（如 "30/1"）。 */
  avgFrameRate: string | null;
  /** 真实帧率（如 "30000/1001"）。 */
  realFrameRate: string | null;
  duration: number | null;
  timeBase: string | null;
  bitRate: number | null;
  pixelFormat: string | null;
  /** 位深（bits_per_raw_sample 优先，回退 bits_per_sample）。 */
  bitsPerSample: number | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  colorRange: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  rotation: number | null;
  language: string | null;
  tags: Record<string, string>;
}

export interface FfprobeFullMetadata {
  valid: boolean;
  error: string | null;
  filename: string | null;
  formatName: string | null;
  formatLongName: string | null;
  duration: number | null;
  size: number | null;
  bitRate: number | null;
  streams: FfprobeStreamInfo[];
  video: FfprobeStreamInfo | null;
  audio: FfprobeStreamInfo | null;
  formatTags: Record<string, string>;
}

interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  time_base?: string;
  bit_rate?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  bits_per_sample?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_space?: string;
  color_range?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number }>;
}

interface RawFormat {
  filename?: string;
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

interface RawDocument {
  streams?: RawStream[];
  format?: RawFormat;
}

function numberOrNull(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function streamInfo(raw: RawStream, index: number): FfprobeStreamInfo {
  const rotation =
    raw.side_data_list
      ?.map((item) => item.rotation)
      .find((value) => value !== undefined && Number.isFinite(value)) ?? null;
  return {
    index: raw.index ?? index,
    codecType: raw.codec_type ?? null,
    codecName: raw.codec_name ?? null,
    codecLongName: raw.codec_long_name ?? null,
    profile: raw.profile ?? null,
    level: raw.level ?? null,
    width: raw.width ?? null,
    height: raw.height ?? null,
    sampleAspectRatio: raw.sample_aspect_ratio ?? null,
    displayAspectRatio: raw.display_aspect_ratio ?? null,
    avgFrameRate: raw.avg_frame_rate ?? null,
    realFrameRate: raw.r_frame_rate ?? null,
    duration: numberOrNull(raw.duration),
    timeBase: raw.time_base ?? null,
    bitRate: numberOrNull(raw.bit_rate),
    pixelFormat: raw.pix_fmt ?? null,
    bitsPerSample:
      numberOrNull(raw.bits_per_raw_sample) ??
      numberOrNull(raw.bits_per_sample),
    colorPrimaries: raw.color_primaries ?? null,
    colorTransfer: raw.color_transfer ?? null,
    colorSpace: raw.color_space ?? null,
    colorRange: raw.color_range ?? null,
    sampleRate: numberOrNull(raw.sample_rate),
    channels: raw.channels ?? null,
    channelLayout: raw.channel_layout ?? null,
    rotation: rotation ?? null,
    language: raw.tags?.language ?? null,
    tags: raw.tags ?? {},
  };
}

export function parseFfprobeFullJson(output: string): FfprobeFullMetadata {
  const document = JSON.parse(output) as RawDocument;
  const streams = (document.streams ?? []).map(streamInfo);
  const video = streams.find((stream) => stream.codecType === "video") ?? null;
  const audio = streams.find((stream) => stream.codecType === "audio") ?? null;
  const format = document.format ?? {};
  return {
    valid: streams.length > 0 || Boolean(format.format_name),
    error: null,
    filename: format.filename ?? null,
    formatName: format.format_name ?? null,
    formatLongName: format.format_long_name ?? null,
    duration: numberOrNull(format.duration),
    size: numberOrNull(format.size),
    bitRate: numberOrNull(format.bit_rate),
    streams,
    video,
    audio,
    formatTags: format.tags ?? {},
  };
}

/**
 * 运行 ffprobe 并返回完整 metadata。
 * 解析失败（非媒体文件、损坏文件）返回 valid=false，不抛错。
 */
export async function readFfprobeFullMetadata(
  filename: string,
  executable = packagedFfprobePath(),
  signal?: AbortSignal,
): Promise<FfprobeFullMetadata> {
  try {
    const { stdout } = await execFileAsync(
      executable,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filename,
      ],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
        signal,
      },
    );
    const parsed = parseFfprobeFullJson(stdout);
    return parsed.valid ? parsed : { ...parsed, error: "FFPROBE_NO_STREAMS" };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "FFPROBE_FAILED",
      filename,
      formatName: null,
      formatLongName: null,
      duration: null,
      size: null,
      bitRate: null,
      streams: [],
      video: null,
      audio: null,
      formatTags: {},
    };
  }
}
