import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { packagedFfmpegPath } from "./ffmpeg-tools";
import { readFfprobeFullMetadata } from "./ffprobe-full";

const execFileAsync = promisify(execFile);

export interface Mp4ExportOptions {
  files: string[];
  fps: number;
  /** 最大宽边像素；null = 不缩放。 */
  maxWidth: number | null;
  crf: number;
  outputPath: string;
}

export interface Mp4ExportResult {
  width: number;
  height: number;
  durationSeconds: number;
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
  try {
    const listPath = path.join(tempDirectory, "frames.txt");
    const frameDuration = 1 / Math.max(1, options.fps);
    // concat demuxer：每帧显式 duration；缺帧天然跳过（文件列表只含存在的帧）。
    const lines = options.files
      .map((file) => `file '${file.replaceAll("'", "'\\''")}'`)
      .join(`\nduration ${frameDuration}\n`);
    await writeFile(listPath, `${lines}\nduration ${frameDuration}\n`, "utf8");

    const args = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", String(options.crf),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ];
    if (options.maxWidth !== null && options.maxWidth > 0) {
      args.push("-vf", `scale='min(${options.maxWidth},iw)':-2`);
    }
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
  }
}
