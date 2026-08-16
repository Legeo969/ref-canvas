import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PreviewTokenRegistry } from "../../platform/refbrowse";
import { packagedFfmpegPath } from "./ffmpeg-tools";
import { readFfprobeFullMetadata } from "./ffprobe-full";

/**
 * 至臻画质（视频预览增强代理，仅视频；序列不参与）。
 *
 * 视频预览默认直接播放原始文件（refasset/refbrowse，Range 206）。对低于
 * 「超高分辨率 + 60fps」目标的源，按需生成一次增强代理并缓存：
 *
 * - 分辨率：lanczos 上采样到 3840 宽（4K UHD；源更宽不再放大）；
 * - 细节：unsharp 轻度锐化（放大后质感不糊）；
 * - 流畅度：minterpolate 运动补帧到 60fps（源已 ≥60fps 则跳过）；
 * - 编码：H.264 yuv420p + faststart，Chromium 硬解友好，播放更顺。
 *
 * 缓存键含源文件身份（路径+大小+mtime）与管线版本；ffmpeg 失败写
 * `.failed` 标记防轮询重试风暴，cancel() 清标记后可重试。进度经
 * `-progress pipe:1` 的 out_time_us 解析（时长未知时为不确定进度）。
 */

export interface SupremeVideoStatusResult {
  /** generating = 代理生成中；ready = 可直接播放；failed = 生成失败。 */
  state: "idle" | "generating" | "ready" | "failed";
  /** 0..1；时长未知时为 null（不确定进度）。 */
  progress: number | null;
  /** false = 源视频已是超高画质（≥3840 宽且 ≥60fps），无需代理。 */
  needsEnhancement: boolean;
  /** ready 且 needsEnhancement 时的 refbrowse://preview/<token> 代理 URL。 */
  source: string | null;
  error: string | null;
}

export const SUPREME_VIDEO_PIPELINE = {
  /** 超高分辨率目标宽度（4K UHD）。 */
  targetWidth: 3840,
  /** 60fps 流畅播放。 */
  targetFps: 60,
  /** 管线版本：滤镜/编码参数变化时递增，旧代理缓存自然失效。 */
  version: "v1",
} as const;

interface SupremeJob {
  promise: Promise<void>;
  controller: AbortController;
  progress: number | null;
}

interface SupremeVideoServiceDependencies {
  cacheDirectory(): string;
  previewTokens: PreviewTokenRegistry;
}

function frameRateOf(rate: string | null | undefined): number | null {
  if (!rate) return null;
  const [numerator, denominator] = rate.split("/").map(Number);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function parseProgressLine(line: string, durationSeconds: number | null): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match) return null;
  const seconds = Number(match[1]) / 1_000_000;
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, seconds / durationSeconds));
}

function failedMarkerFor(cacheFile: string): string {
  return `${cacheFile}.failed`;
}

export class SupremeVideoService {
  private readonly jobs = new Map<string, SupremeJob>();

  constructor(private readonly dependencies: SupremeVideoServiceDependencies) {}

  private cachePathFor(sourcePath: string, info: { size: number; mtimeMs: number }): string {
    const identity = createHash("sha256")
      .update(
        `${path.normalize(sourcePath)}:${info.size}:${info.mtimeMs}:${SUPREME_VIDEO_PIPELINE.version}`,
      )
      .digest("hex")
      .slice(0, 24);
    return path.join(
      this.dependencies.cacheDirectory(),
      "supreme",
      `supreme-${identity}.mp4`,
    );
  }

  /**
   * 查询（并在必要时启动）至臻代理。不阻塞等待生成完成：首次调用返回
   * generating，调用方轮询直到 ready/failed。
   */
  async status(sourcePath: string): Promise<SupremeVideoStatusResult> {
    const resolved = path.resolve(sourcePath);
    const info = await stat(resolved).catch(() => null);
    if (!info || !info.isFile()) {
      return {
        state: "failed",
        progress: null,
        needsEnhancement: false,
        source: null,
        error: "SOURCE_UNAVAILABLE",
      };
    }
    const metadata = await readFfprobeFullMetadata(resolved).catch(() => null);
    if (!metadata?.valid) {
      return {
        state: "failed",
        progress: null,
        needsEnhancement: false,
        source: null,
        error: "VIDEO_PROBE_FAILED",
      };
    }
    const width = metadata.video?.width ?? null;
    const fps = frameRateOf(metadata.video?.avgFrameRate);
    const duration = metadata.duration;
    const hasAudio = metadata.audio != null;
    const needsUpscale = width != null && width < SUPREME_VIDEO_PIPELINE.targetWidth;
    const needsInterpolation = fps != null && fps < SUPREME_VIDEO_PIPELINE.targetFps;
    const needsEnhancement = needsUpscale || needsInterpolation;
    if (!needsEnhancement) {
      // 源视频已是超高画质：直接播原文件，无需代理。
      return {
        state: "ready",
        progress: null,
        needsEnhancement: false,
        source: null,
        error: null,
      };
    }

    const cacheFile = this.cachePathFor(resolved, info);
    if (await stat(failedMarkerFor(cacheFile)).catch(() => null)) {
      return {
        state: "failed",
        progress: null,
        needsEnhancement: true,
        source: null,
        error: "SUPREME_GENERATION_FAILED",
      };
    }
    if (await stat(cacheFile).catch(() => null)) {
      return {
        state: "ready",
        progress: 1,
        needsEnhancement: true,
        source: `refbrowse://preview/${this.dependencies.previewTokens.tokenFor(cacheFile)}`,
        error: null,
      };
    }

    const existing = this.jobs.get(resolved);
    if (existing) {
      return {
        state: "generating",
        progress: existing.progress,
        needsEnhancement: true,
        source: null,
        error: null,
      };
    }

    const controller = new AbortController();
    const job: SupremeJob = {
      controller,
      progress: null,
      promise: this.generate(resolved, cacheFile, {
        needsUpscale,
        needsInterpolation,
        hasAudio,
        duration,
        signal: controller.signal,
        onProgress: (progress) => {
          job.progress = progress;
        },
      }).finally(() => {
        this.jobs.delete(resolved);
      }),
    };
    this.jobs.set(resolved, job);
    return {
      state: "generating",
      progress: null,
      needsEnhancement: true,
      source: null,
      error: null,
    };
  }

  /** 取消进行中的生成（并清失败标记，允许重试）。 */
  cancel(sourcePath: string): void {
    const resolved = path.resolve(sourcePath);
    const job = this.jobs.get(resolved);
    if (job) job.controller.abort();
    void this.clearFailedMarker(resolved);
  }

  private async clearFailedMarker(resolved: string): Promise<void> {
    const info = await stat(resolved).catch(() => null);
    if (!info || !info.isFile()) return;
    const failedMarker = failedMarkerFor(this.cachePathFor(resolved, info));
    await rm(failedMarker, { force: true }).catch(() => undefined);
  }

  private async generate(
    sourcePath: string,
    cacheFile: string,
    options: {
      needsUpscale: boolean;
      needsInterpolation: boolean;
      hasAudio: boolean;
      duration: number | null;
      signal: AbortSignal;
      onProgress: (progress: number | null) => void;
    },
  ): Promise<void> {
    const directory = path.dirname(cacheFile);
    await mkdir(directory, { recursive: true });
    const partFile = `${cacheFile}.${randomUUID()}.part`;
    const filters: string[] = [];
    if (options.needsUpscale) {
      filters.push(`scale=${SUPREME_VIDEO_PIPELINE.targetWidth}:-2:flags=lanczos`);
    }
    filters.push("unsharp=5:5:0.4:5:5:0.0");
    if (options.needsInterpolation) {
      filters.push(`minterpolate=fps=${SUPREME_VIDEO_PIPELINE.targetFps}`);
    }
    const args = [
      "-y",
      "-i", sourcePath,
      "-vf", filters.join(","),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      ...(options.hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : []),
      "-movflags", "+faststart",
      "-progress", "pipe:1",
      "-nostats",
      partFile,
    ];
    const child = spawn(packagedFfmpegPath(), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const progress = parseProgressLine(line, options.duration);
        if (progress != null) options.onProgress(progress);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-8_000);
    });
    try {
      const code = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
        child.on("error", (error) => {
          stderrTail = `${stderrTail}\n${error.message}`.slice(-8_000);
          resolve(null);
        });
        options.signal.addEventListener("abort", () => child.kill(), { once: true });
      });
      if (options.signal.aborted) {
        await rm(partFile, { force: true }).catch(() => undefined);
        return;
      }
      if (code !== 0) {
        await rm(partFile, { force: true }).catch(() => undefined);
        await writeFile(failedMarkerFor(cacheFile), stderrTail || `ffmpeg exited ${code}`);
        return;
      }
      await rename(partFile, cacheFile);
    } catch (error) {
      await rm(partFile, { force: true }).catch(() => undefined);
      await writeFile(
        failedMarkerFor(cacheFile),
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
