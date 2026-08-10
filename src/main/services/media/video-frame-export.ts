import { execFile } from "node:child_process";
import { access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { packagedFfmpegPath } from "./ffmpeg-tools";

const execFileAsync = promisify(execFile);

export interface VideoFrameExportOptions {
  inputPath: string;
  outputDirectory: string;
  baseName: string;
  format: "png" | "jpeg";
  fps?: number | null;
  startMs?: number;
  endMs?: number;
  quality?: number;
}

export interface VideoFrameExportResult {
  outputDirectory: string;
  frameCount: number;
  format: "png" | "jpeg";
}

function safeSegment(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120) || "frames";
}

async function availableDirectory(parent: string, stem: string): Promise<string> {
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = path.join(parent, suffix === 0 ? stem : `${stem}-${suffix + 1}`);
    try {
      await access(candidate);
    } catch {
      await mkdir(candidate, { recursive: false });
      return candidate;
    }
  }
  throw new Error("VIDEO_FRAMES_OUTPUT_UNAVAILABLE");
}

export async function exportVideoFrames(
  options: VideoFrameExportOptions,
  signal?: AbortSignal,
): Promise<VideoFrameExportResult> {
  const outputDirectory = await availableDirectory(
    options.outputDirectory,
    `${safeSegment(options.baseName)}-frames`,
  );
  const extension = options.format === "jpeg" ? "jpg" : "png";
  const outputPattern = path.join(outputDirectory, `${safeSegment(options.baseName)}-%06d.${extension}`);
  const startMs = Math.max(0, options.startMs ?? 0);
  const endMs = options.endMs == null ? null : Math.max(startMs, options.endMs);
  const filters = options.fps && options.fps > 0 ? [`fps=${Math.min(240, options.fps)}`] : [];
  const args = ["-v", "error", "-y"];
  if (startMs > 0) args.push("-ss", String(startMs / 1000));
  args.push("-i", options.inputPath);
  if (endMs !== null && endMs > startMs) {
    args.push("-t", String((endMs - startMs) / 1000));
  }
  if (filters.length) args.push("-vf", filters.join(","));
  args.push("-map", "0:v:0", "-start_number", "1");
  if (options.format === "jpeg") {
    const quality = Math.min(100, Math.max(1, options.quality ?? 92));
    const qscale = Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29)));
    args.push("-q:v", String(qscale));
  } else {
    args.push("-compression_level", "6");
  }
  args.push(outputPattern);
  await execFileAsync(packagedFfmpegPath(), args, {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal,
  });
  const frameCount = (await readdir(outputDirectory)).filter((name) =>
    name.toLowerCase().endsWith(`.${extension}`),
  ).length;
  return { outputDirectory, frameCount, format: options.format };
}
