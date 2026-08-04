import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  detectSequences,
  type SequenceGroup,
} from "./sequence-detector";

/**
 * 序列目录服务（计划 §9.4）。
 *
 * 扫描目录全部文件 → 序列分组 → 按 mtime 间隔推断 FPS（默认 24）。
 */

/** 常用帧率（推断时优先归入最近档位）。 */
const COMMON_FPS = [12, 15, 24, 25, 30, 48, 50, 60, 90, 120, 240];

function inferFpsFromMtimes(mtimes: number[]): number | null {
  if (mtimes.length < 2) return null;
  const sorted = [...mtimes].sort((left, right) => left - right);
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return null;
  gaps.sort((left, right) => left - right);
  const median = gaps[Math.floor(gaps.length / 2)];
  // 间隔过小（<5ms）视为同批写入；过大（>5s）无帧率意义。
  if (median < 5 || median > 5_000) return null;
  const fps = 1000 / median;
  let nearest = COMMON_FPS[0];
  let bestDiff = Math.abs(COMMON_FPS[0] - fps);
  for (const candidate of COMMON_FPS.slice(1)) {
    const diff = Math.abs(candidate - fps);
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = candidate;
    }
  }
  return Math.abs(nearest - fps) / fps <= 0.12
    ? nearest
    : Math.round(fps * 10) / 10;
}

/**
 * 检测目录内的图片序列并推断帧率。
 * @param directory 绝对目录路径
 * @param options.customPatterns 用户自定义 regex（阶段 5 UI）
 */
export async function detectSequencesInDirectory(
  directory: string,
  options: { customPatterns?: Array<string | RegExp> } = {},
): Promise<SequenceGroup[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name));
  const sequences = detectSequences(filenames, options);
  // 并发推断 FPS（mtime 统计），失败保持默认 24。
  await Promise.all(
    sequences.map(async (sequence) => {
      const mtimes: number[] = [];
      for (const file of sequence.files) {
        const info = await stat(file).catch(() => null);
        if (info) mtimes.push(info.mtimeMs);
      }
      const inferred = inferFpsFromMtimes(mtimes);
      if (inferred != null) sequence.fps = inferred;
    }),
  );
  return sequences;
}
