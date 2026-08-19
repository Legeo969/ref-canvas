import { execFile } from "node:child_process";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
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
  // 失败时清理半截输出：否则下次点击会命中缓存里的损坏 PNG，直接显示
  // “无法提取该帧”而不再重新生成。
  try {
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
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
  // 校验产物确为 PNG；失败时删除半截文件，避免缓存命中损坏帧。
  try {
    const info = await stat(outputPath);
    if (info.size < 8) throw new Error("EXTRACTED_FRAME_TOO_SMALL");
    const handle = await open(outputPath, "r");
    try {
      const magic = Buffer.alloc(8);
      await handle.read(magic, 0, 8, 0);
      if (!magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        throw new Error("EXTRACTED_FRAME_NOT_PNG");
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
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


/**
 * 阶段 5 §10.3：对 PNG 应用 Camera LUT（ffmpeg lut3d filter）。
 * 输入输出为同一目录下的图片；输出先写临时文件再 rename（ffmpeg 拒绝
 * 输出=输入）。LUT 进 thumbnail cache key 由调用方保证。
 */
export async function applyLut3dToPng(
  inputPath: string,
  lutPath: string,
  outputPath: string,
  executable = packagedFfmpegPath(),
  signal?: AbortSignal,
): Promise<void> {
  const temporary = `${outputPath}.lut-tmp`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(
    executable,
    [
      "-v",
      "error",
      "-i",
      inputPath,
      "-vf",
      `lut3d=${lutPath.replaceAll(":", "\\:")}`,
      "-f",
      "image2",
      "-y",
      temporary,
    ],
    {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
      signal,
    },
  );
  await rename(temporary, outputPath);
}
