import { execFile } from "node:child_process";
import { packagedFfmpegPath } from "./ffmpeg-tools";

/**
 * 音频波形提取（阶段 4：专业格式 — 音频 waveform）。
 *
 * 用 ffmpeg 将音频解码为 8kHz 单声道 s16le，流式读 stdout，
 * 按桶聚合峰值（每桶 64ms），最多输出 WAVEFORM_MAX_POINTS 个点。
 * 长音频（数小时）流式处理，不落盘、不整载内存。
 */

export interface WaveformData {
  /** 归一化峰值（0..1），等时间间隔。 */
  peaks: number[];
  /** 每点对应的时间跨度（秒）。 */
  secondsPerPoint: number;
  durationSeconds: number | null;
}

/** 渲染端波形图默认点数（宽 1200 的 2x 图）。 */
export const WAVEFORM_MAX_POINTS = 2400;
/** 采样率：8kHz（峰值聚合，不需高保真）。 */
const SAMPLE_RATE = 8000;
/** 每桶 64ms = 512 样本。 */
const SAMPLES_PER_BUCKET = SAMPLE_RATE / 16;
const S16_MAX = 32768;

export async function extractWaveform(
  filename: string,
  maxPoints: number = WAVEFORM_MAX_POINTS,
  signal?: AbortSignal,
): Promise<WaveformData> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      packagedFfmpegPath(),
      [
        "-v", "error",
        "-i", filename,
        "-map", "0:a:0",
        "-ac", "1",
        "-ar", String(SAMPLE_RATE),
        "-f", "s16le",
        "-",
      ],
      { maxBuffer: 1024 * 1024 * 1024, encoding: "buffer", windowsHide: true },
      () => {
        // 错误在 close 统一处理（无音频流 → 空波形）。
      },
    );
    if (signal) {
      const onAbort = () => child.kill();
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("exit", () => signal.removeEventListener("abort", onAbort));
    }

    const buckets: number[] = [];
    const bucketCeiling = Math.ceil(maxPoints * 8); // 提前终止保护
    let currentBucket: number[] = [];
    let residual = Buffer.alloc(0);

    const stdout = child.stdout;
    if (!stdout) {
      reject(new Error("WAVEFORM_NO_STDOUT"));
      return;
    }

    stdout.on("data", (chunk: Buffer) => {
      // 只保留不足一个样本的残留，避免 O(n²) 累积拷贝。
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      // 只保留不足一个样本的残留，避免 O(n²) 累积拷贝。
      const available = Buffer.concat([residual, data]);
      const sampleCount = Math.floor(available.length / 2);
      for (let i = 0; i < sampleCount; i += 1) {
        const peak = Math.abs(available.readInt16LE(i * 2)) / S16_MAX;
        currentBucket.push(peak);
        if (currentBucket.length >= SAMPLES_PER_BUCKET) {
          buckets.push(maxOf(currentBucket));
          currentBucket = [];
        }
      }
      residual = available.subarray(sampleCount * 2);
      if (buckets.length >= bucketCeiling) {
        child.kill(); // 保护内存；实际到不了（数小时音频也远小于上限）。
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", () => {
      if (currentBucket.length) {
        buckets.push(maxOf(currentBucket));
      }
      if (!buckets.length) {
        resolve({
          peaks: [],
          secondsPerPoint: SAMPLES_PER_BUCKET / SAMPLE_RATE,
          durationSeconds: null,
        });
        return;
      }
      const merged = mergeBuckets(buckets, maxPoints);
      resolve({
        peaks: merged,
        secondsPerPoint:
          (SAMPLES_PER_BUCKET / SAMPLE_RATE) * (buckets.length / merged.length),
        durationSeconds: (buckets.length * SAMPLES_PER_BUCKET) / SAMPLE_RATE,
      });
    });
  });
}

function maxOf(values: number[]): number {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}

/** 把 N 桶等比归并到最多 maxPoints 桶（取区间峰值）。 */
export function mergeBuckets(buckets: number[], maxPoints: number): number[] {
  if (buckets.length <= maxPoints) return buckets;
  const factor = buckets.length / maxPoints;
  const merged: number[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const start = Math.floor(i * factor);
    const end = Math.min(buckets.length, Math.ceil((i + 1) * factor));
    let max = 0;
    for (let j = start; j < end; j += 1) {
      if (buckets[j] > max) max = buckets[j];
    }
    merged.push(max);
  }
  return merged;
}
