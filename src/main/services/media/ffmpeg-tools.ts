import { execFile } from "node:child_process";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
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
  // 校验产物是有效图片（PNG 或 WebP）；失败时删除半截文件，避免缓存命中
  // 损坏帧。ffmpeg 的 image2 会按输出扩展名选编码器：.png 目标=PNG，
  // .webp 目标=WebP（视频缩略图缓存走 .webp）。只认 PNG 会让 WebP 目标
  // 必抛 EXTRACTED_FRAME_NOT_PNG，导致视频 poster 生成永远失败。
  try {
    const info = await stat(outputPath);
    if (info.size < 12) throw new Error("EXTRACTED_FRAME_TOO_SMALL");
    const handle = await open(outputPath, "r");
    try {
      const head = Buffer.alloc(12);
      await handle.read(head, 0, 12, 0);
      const isPng = head
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isWebp =
        head.subarray(0, 4).toString("latin1") === "RIFF" &&
        head.subarray(8, 12).toString("latin1") === "WEBP";
      if (!isPng && !isWebp) {
        throw new Error("EXTRACTED_FRAME_NOT_IMAGE");
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
 * 把 GIF/APNG 拆成逐帧 PNG 序列写入 outputDir（frame_0001.png …）。
 *
 * 背景：上一版尝试用 Chromium 的 ImageDecoder 在渲染端解 GIF，但该构建对
 * 大型 GIF 只报 1 帧（哪怕完整 14MB body 已送达），导致动画卡死首帧。这里
 * 绕开 Chromium 的 GIF 解码器，直接用 ffmpeg 拆帧（ffprobe 已确认文件是
 * 165 帧 / 24fps），渲染端把拆出的 PNG 当位图播放，暂停/拖动/续播都精确。
 */
export async function extractGifFramesToDirectory(
  filename: string,
  outputDir: string,
  executable = packagedFfmpegPath(),
  signal?: AbortSignal,
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  await execFileAsync(
    executable,
    [
      "-v",
      "error",
      "-i",
      filename,
      "-vsync",
      "0",
      "-f",
      "image2",
      path.join(outputDir, "frame_%04d.png"),
    ],
    {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      signal,
    },
  );
  const names = (await readdir(outputDir))
    .filter((name) => /^frame_\d{4}\.png$/.test(name))
    .sort();
  const files = names.map((name) => path.join(outputDir, name));
  if (files.length === 0) {
    throw new Error("GIF_FRAME_EXTRACTION_EMPTY");
  }
  // 校验首帧确为 PNG，避免把损坏的半截输出当帧用。
  const handle = await open(files[0], "r");
  try {
    const magic = Buffer.alloc(8);
    await handle.read(magic, 0, 8, 0);
    if (!magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      throw new Error("GIF_FRAME_NOT_PNG");
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return files;
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
