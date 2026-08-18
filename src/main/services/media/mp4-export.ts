import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { packagedFfmpegPath } from "./ffmpeg-tools";
import { readFfprobeFullMetadata } from "./ffprobe-full";
import { defaultExrLayer } from "./exr-header";
import { prepareExrSequenceForConcat } from "./exr-export-png";

const execFileAsync = promisify(execFile);

export interface Mp4ExportOptions {
  files: string[];
  fps: number;
  codec: "h264" | "h265";
  quality: "medium" | "high" | "best";
  resolution: "original" | "half" | "quarter";
  outputPath: string;
}

export interface VideoToMp4ExportOptions {
  inputPath: string;
  codec: "h264" | "h265";
  quality: "medium" | "high" | "best";
  resolution: "original" | "half" | "quarter";
  outputPath: string;
}

export interface Mp4ExportResult {
  width: number;
  height: number;
  durationSeconds: number;
}

function crfFor(codec: Mp4ExportOptions["codec"], quality: Mp4ExportOptions["quality"]): number {
  if (codec === "h265") {
    return quality === "best" ? 18 : quality === "high" ? 23 : 28;
  }
  return quality === "best" ? 14 : quality === "high" ? 18 : 23;
}

function scaleFor(resolution: Mp4ExportOptions["resolution"]): string | null {
  if (resolution === "original") return null;
  const factor = resolution === "half" ? 0.5 : 0.25;
  return `scale=trunc(iw*${factor}/2)*2:trunc(ih*${factor}/2)*2`;
}

/**
 * 序列 → MP4（阶段 5 §10.1 MP4 presets）。
 *
 * 用 concat demuxer + duration 逐帧合成：帧精确、允许缺帧；
 * EXR 等高位深输入由 ffmpeg 自动转换到 yuv420p。
 */
export async function exportSequenceToMp4(
  options: Mp4ExportOptions,
  signal?: AbortSignal,
): Promise<Mp4ExportResult> {
  if (!options.files.length) throw new Error("MP4_EXPORT_EMPTY");
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mp4-"));
  let exrPngDirectory: string | null = null;
  try {
    // Unreal 多层 EXR 常用 PIZ/DWAA 压缩，ffmpeg 内置解码器解不了。用 OIIO
    // 逐帧解码成临时 PNG 再 concat，避免导出空白 MP4。保持源尺寸（H.264
    // 需要偶数尺寸，源 EXR 通常是偶数；不缩放避免奇数高度）。
    const exrPng = await prepareExrSequenceForConcat(
      options.files, null, signal,
    );
    const frames = exrPng?.files ?? options.files;
    exrPngDirectory = exrPng?.tempDirectory ?? null;
    const listPath = path.join(tempDirectory, "frames.txt");
    const frameDuration = 1 / Math.max(1, options.fps);
    // concat demuxer：每帧显式 duration；缺帧天然跳过（文件列表只含存在的帧）。
    // Windows 反斜杠会被 concat demuxer 当作转义符解析，统一转正斜杠。
    const lines = frames
      .map((file) => `file '${file.replace(/\\/g, "/").replaceAll("'", "'\\''")}'`)
      .join(`\nduration ${frameDuration}\n`);
    await writeFile(listPath, `${lines}\nduration ${frameDuration}\n`, "utf8");
    // 已走 OIIO 预解码（PNG）时不要传 -layer；仅 ffmpeg 直读 EXR 时需要。
    const layer = exrPng ? null : await defaultExrLayer(options.files);

    const args = [
      "-y",
      ...(layer ? ["-layer", layer] : []),
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:v", options.codec === "h265" ? "libx265" : "libx264",
      "-preset", "medium",
      "-crf", String(crfFor(options.codec, options.quality)),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ];
    const scale = scaleFor(options.resolution);
    if (scale) args.push("-vf", scale);
    if (options.codec === "h265") args.push("-tag:v", "hvc1");
    args.push(options.outputPath);

    await execFileAsync(packagedFfmpegPath(), args, {
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      signal,
    });

    // 用 ffprobe 取实际输出尺寸与时长（probe 失败不阻塞导出）。
    let width = 0;
    let height = 0;
    let durationSeconds = 0;
    try {
      const info = await readFfprobeFullMetadata(options.outputPath);
      if (info.valid) {
        const video = info.streams.find(
          (stream) => stream.codecType === "video",
        );
        width = video?.width ?? 0;
        height = video?.height ?? 0;
        durationSeconds = info.duration ?? 0;
      }
    } catch {
      // 忽略：输出文件已生成。
    }
    return { width, height, durationSeconds };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
    if (exrPngDirectory) {
      await rm(exrPngDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * 单视频 → MP4（右键菜单「导出 MP4」）。
 *
 * 与 exportSequenceToMp4 共用同一套预设（codec/quality/resolution），
 * 重新编码视频轨（H.264/H.265 + yuv420p + faststart），音频转 AAC；
 * 适用于 .mov/.mkv/.webm/.avi 等需要交付为 MP4 的场景。
 */
export async function exportVideoToMp4(
  options: VideoToMp4ExportOptions,
  signal?: AbortSignal,
): Promise<Mp4ExportResult> {
  const args = [
    "-y",
    "-i", options.inputPath,
    "-c:v", options.codec === "h265" ? "libx265" : "libx264",
    "-preset", "medium",
    "-crf", String(crfFor(options.codec, options.quality)),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
  ];
  const scale = scaleFor(options.resolution);
  if (scale) args.push("-vf", scale);
  if (options.codec === "h265") args.push("-tag:v", "hvc1");
  args.push(options.outputPath);

  await execFileAsync(packagedFfmpegPath(), args, {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal,
  });

  // 用 ffprobe 取实际输出尺寸与时长（probe 失败不阻塞导出）。
  let width = 0;
  let height = 0;
  let durationSeconds = 0;
  try {
    const info = await readFfprobeFullMetadata(options.outputPath);
    if (info.valid) {
      const video = info.streams.find(
        (stream) => stream.codecType === "video",
      );
      width = video?.width ?? 0;
      height = video?.height ?? 0;
      durationSeconds = info.duration ?? 0;
    }
  } catch {
    // 忽略：输出文件已生成。
  }
  return { width, height, durationSeconds };
}
