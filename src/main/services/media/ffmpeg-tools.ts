import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { readFfprobeFullMetadata } from "./ffprobe-full";

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
 * ffmpeg filtergraph 的路径转义：`:` 分割 option、反斜杠会被当成转义前缀，
 * 所以 Windows 盘符与目录分隔符都必须重写。命名参数 + 单引号是 ffmpeg 6.x
 * 里带盘符绝对路径最稳的形式（`lut3d=file='C\:/dir/x.cube'`），裸写
 * `lut3d=C\:/...` 会被 option 解析器在冒号处截断。
 */
function lut3dFilter(lutPath: string): string {
  const normalized = lutPath.replaceAll("\\", "/").replaceAll(":", "\\:");
  return `lut3d=file='${normalized}'`;
}

/**
 * `lut3d=file='...'` 无法表达路径里的单引号：ffmpeg 6.1 会把单引号一律当作
 * 引号开关，`\'` / `'\''` 都会被吞掉（实测）。这类路径改为复制到无特殊
 * 字符的临时文件再喂给 filter；普通路径零拷贝。
 */
async function filterSafeLutPath(
  lutPath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  if (!lutPath.includes("'")) {
    return { path: lutPath, cleanup: async () => undefined };
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-lut-"));
  const extension = /^\.[a-z0-9]{1,8}$/i.test(path.extname(lutPath))
    ? path.extname(lutPath).toLowerCase()
    : ".cube";
  const safePath = path.join(
    directory,
    `lut-${createHash("sha256").update(lutPath).digest("hex").slice(0, 12)}${extension}`,
  );
  try {
    await copyFile(lutPath, safePath);
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    path: safePath,
    cleanup: () => rm(directory, { recursive: true, force: true }).catch(() => undefined),
  };
}

/**
 * 对一张静态图应用 3D LUT 并编码为指定格式；输出先写临时文件再 rename。
 *
 * 编码器与容器显式指定：此前只给 `-f image2` + `.lut-tmp` 未知扩展名，
 * ffmpeg 会按扩展名猜成 mjpeg，把 JPEG 字节写进 .webp 缓存文件名。
 * quality 只对 WebP 生效（libwebp 的 0-100）。
 */
export async function applyLut3dImage(
  inputPath: string,
  lutPath: string,
  outputPath: string,
  options: {
    encoder?: "png" | "webp";
    quality?: number;
    executable?: string;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const encoder = options.encoder ?? "png";
  const executable = options.executable ?? packagedFfmpegPath();
  const quality = Math.min(100, Math.max(0, Math.round(options.quality ?? 90)));
  const temporary = `${outputPath}.${randomSuffix()}.tmp.${encoder}`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const lut = await filterSafeLutPath(lutPath);
  try {
    await execFileAsync(
      executable,
      [
        "-v",
        "error",
        "-i",
        inputPath,
        "-vf",
        lut3dFilter(lut.path),
        "-frames:v",
        "1",
        "-c:v",
        encoder === "png" ? "png" : "libwebp",
        ...(encoder === "webp" ? ["-quality", String(quality)] : []),
        "-f",
        "image2",
        "-y",
        temporary,
      ],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
        windowsHide: true,
        signal: options.signal,
      },
    );
    const info = await stat(temporary).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new Error("LUT_OUTPUT_EMPTY");
    }
    await rename(temporary, outputPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await lut.cleanup();
  }
}

/** 临时文件名只需进程内唯一；扩展名保持与编码器一致，避免再被 ffmpeg 推断。 */
function randomSuffix(): string {
  return randomUUID().slice(0, 8);
}

/**
 * 阶段 5 §10.3：对 PNG 应用 Camera LUT（ffmpeg lut3d filter）。
 * 保留旧签名转调通用实现；编码固定 PNG，避免调用方缓存 `.png` 却拿到
 * JPEG/WebP 字节。
 */
export async function applyLut3dToPng(
  inputPath: string,
  lutPath: string,
  outputPath: string,
  executable = packagedFfmpegPath(),
  signal?: AbortSignal,
): Promise<void> {
  await applyLut3dImage(inputPath, lutPath, outputPath, {
    encoder: "png",
    executable,
    signal,
  });
}

export interface DecodedRgbImage {
  /** 交错 RGB，0..1。DPX 下为 16-bit 码值的归一化结果，未经任何传输曲线。 */
  samples: Float32Array;
  width: number;
  height: number;
}

/**
 * 用 ffmpeg 把 DPX（以及其它 sharp 读不了的位图）解成归一化 RGB。
 *
 * DPX 里装的是 DaVinci Intermediate 或原生 S-Log3 码值，不是 sRGB 图像。
 * 这里刻意不做缩放、不套传输曲线：色域与码值的解释交给调用方，否则
 * "DWG 直方图拟合"会在尺寸变换那一步就被悄悄污染。
 */
export async function decodeImageToRgb48(
  filename: string,
  executable = packagedFfmpegPath(),
  signal?: AbortSignal,
): Promise<DecodedRgbImage> {
  const metadata = await readFfprobeFullMetadata(filename);
  const width = metadata.streams[0]?.width ?? 0;
  const height = metadata.streams[0]?.height ?? 0;
  if (!width || !height) throw new Error("DECODED_IMAGE_SIZE_UNKNOWN");
  const expected = width * height * 6;
  const { stdout } = await execFileAsync(
    executable,
    [
      "-v",
      "error",
      "-i",
      filename,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb48le",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: expected + 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      signal,
    },
  );
  const raw = stdout as Buffer;
  if (raw.length !== expected) throw new Error("DECODED_IMAGE_INCOMPLETE");
  const samples = new Float32Array(width * height * 3);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = raw.readUInt16LE(index * 2) / 65535;
  }
  return { samples, width, height };
}
