import { execFile } from "node:child_process";
import { copyFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { packagedFfmpegPath } from "./ffmpeg-tools";
import { readFfprobeFullMetadata } from "./ffprobe-full";

const execFileAsync = promisify(execFile);

export type DownscaleMode = "suffix" | "subdirectory" | "backup";

export interface DownscaleItem {
  /** 源文件绝对路径。 */
  sourcePath: string;
  /** 输出文件绝对路径。 */
  outputPath: string;
  /** backup 模式：备份文件路径（原路径保留）。 */
  backupPath: string | null;
}

export interface DownscalePlan {
  items: DownscaleItem[];
  /** backup 模式会覆盖原路径，UI 必须先展示源/备份/输出。 */
  modifiesSources: boolean;
}

export interface DownscaleOptions {
  /** 最大边像素。 */
  maxDimension: number;
  mode: DownscaleMode;
  /** suffix 模式后缀（不含点），如 "2k"。 */
  suffix?: string;
  /** subdirectory 模式目录名。 */
  subdirectory?: string;
}

/**
 * §10.4 Downscale naming：生成输出计划（不执行）。
 * - suffix：image_2k.png
 * - subdirectory：<dir>/<subdirectory>/image.png
 * - backup：原文件保留，备份原文件到 <name>.bak.<ext>，输出覆盖原路径
 */
export function planDownscale(
  sourcePath: string,
  options: DownscaleOptions,
): DownscaleItem {
  const directory = path.dirname(sourcePath);
  const extension = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, extension);
  switch (options.mode) {
    case "suffix": {
      const suffix = options.suffix || "2k";
      return {
        sourcePath,
        outputPath: path.join(directory, `${baseName}_${suffix}${extension}`),
        backupPath: null,
      };
    }
    case "subdirectory": {
      const sub = options.subdirectory || "downscaled";
      return {
        sourcePath,
        outputPath: path.join(directory, sub, `${baseName}${extension}`),
        backupPath: null,
      };
    }
    case "backup":
    default:
      return {
        sourcePath,
        // 输出覆盖原路径（§10.4 第三种模式）。
        outputPath: sourcePath,
        backupPath: path.join(directory, `${baseName}.bak${extension}`),
      };
  }
}

export interface DownscaleResultItem {
  sourcePath: string;
  outputPath: string;
  width: number;
  height: number;
}

/**
 * 执行单文件 downscale（ffmpeg scale；输出格式跟随源扩展名）。
 */
export async function downscaleImage(
  item: DownscaleItem,
  maxDimension: number,
  signal?: AbortSignal,
): Promise<DownscaleResultItem> {
  const extension = path.extname(item.sourcePath).toLowerCase();
  const args = [
    "-y",
    "-i", item.sourcePath,
    "-vf", `scale='min(${maxDimension},iw)':-2`,
  ];
  if (extension === ".jpg" || extension === ".jpeg") {
    args.push("-q:v", "2");
  } else if (extension === ".png") {
    args.push("-compression_level", "6");
  } else if (extension === ".webp") {
    args.push("-quality", "80");
  }
  // backup 模式：先把原文件备份，再写原路径（ffmpeg 拒绝输出=输入，
  // 故先写临时文件再 rename 覆盖）。
  if (item.backupPath) {
    await copyFile(item.sourcePath, item.backupPath);
  }
  const writeTarget =
    item.backupPath !== null ? `${item.outputPath}.refcanvas-tmp` : item.outputPath;
  if (item.backupPath === null) {
    await mkdir(path.dirname(item.outputPath), { recursive: true });
  }
  // 临时文件扩展名不再是图片格式，需 -f image2 强制 muxer。
  args.push("-f", "image2", writeTarget);
  await execFileAsync(packagedFfmpegPath(), args, {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal,
  });
  if (item.backupPath !== null) {
    await rename(writeTarget, item.outputPath);
  }
  let width = 0;
  let height = 0;
  try {
    const info = await readFfprobeFullMetadata(item.outputPath);
    if (info.valid && info.video) {
      width = info.video.width ?? 0;
      height = info.video.height ?? 0;
    }
  } catch {
    // 输出已生成；尺寸回读失败不阻塞。
  }
  return { sourcePath: item.sourcePath, outputPath: item.outputPath, width, height };
}
