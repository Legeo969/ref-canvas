import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

/**
 * FFmpeg 工具（阶段 3 §9.3）。
 *
 * ffmpeg 二进制随包分发（ffmpeg-static，新版构建含完整滤镜链），
 * 不依赖开发机 PATH；`REFCANVAS_FFMPEG` 环境变量可覆盖（测试/调试用）。
 */

const execFileAsync = promisify(execFile);

export function packagedFfmpegPath(
  filename = process.env.REFCANVAS_FFMPEG || ffmpegStatic,
): string {
  return filename.includes("app.asar")
    ? filename.replace("app.asar", "app.asar.unpacked")
    : filename;
}

export interface ExtractedFrame {
  outputPath: string;
  width: number;
  height: number;
}

/**
 * 从视频/图片序列中提取指定时间（毫秒）的帧为 PNG。
 * -ss 放在 -i 前做快速 seek（关键帧）；-accurate_seek 保证帧准确。
 * 输出写入 outputPath 所在目录（调用方保证在缓存目录内）。
 */
export async function extractVideoFrame(
  filename: string,
  timeMs: number,
  outputPath: string,
  size: { width: number; height: number } = { width: 960, height: 540 },
  executable = packagedFfmpegPath(),
  signal?: AbortSignal,
): Promise<ExtractedFrame> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(
    executable,
    [
      "-v",
      "error",
      "-ss",
      String(Math.max(0, timeMs) / 1000),
      "-accurate_seek",
      "-i",
      filename,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${size.width},iw)':'min(${size.height},ih)':force_original_aspect_ratio=decrease`,
      "-f",
      "image2",
      "-y",
      outputPath,
    ],
    {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
      signal,
    },
  );
  return { outputPath, width: size.width, height: size.height };
}

/**
 * 提取视频 poster 帧（默认取时长中点附近，保证不是黑场首帧）。
 * durationMs 未知时用 0。
 */
export async function extractVideoPoster(
  filename: string,
  outputPath: string,
  durationMs: number | null,
  executable?: string,
  signal?: AbortSignal,
): Promise<ExtractedFrame> {
  const timeMs =
    durationMs != null && durationMs > 2_000
      ? Math.min(durationMs / 2, 30_000)
      : 0;
  return extractVideoFrame(filename, timeMs, outputPath, { width: 480, height: 320 }, executable, signal);
}
