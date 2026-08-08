import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  deriveExrDisplayLayers,
  parseExrHeader,
  selectDefaultExrLayer,
} from "./exr-header";
import { packagedFfmpegPath } from "./ffmpeg-tools";
import { readFfprobeFullMetadata } from "./ffprobe-full";

const execFileAsync = promisify(execFile);

export interface GifExportResult {
  width: number;
  height: number;
  durationSeconds: number;
}

export interface SequenceGifExportOptions {
  files: string[];
  fps: number;
  maxWidth: number;
  outputPath: string;
}

export interface VideoGifExportOptions {
  inputPath: string;
  fps: number;
  maxWidth: number;
  outputPath: string;
}

function gifFilter(fps: number, maxWidth: number): string {
  const safeFps = Math.min(60, Math.max(1, Math.round(fps)));
  const safeWidth = Math.min(3840, Math.max(64, Math.round(maxWidth)));
  return [
    `[0:v]fps=${safeFps},scale='min(${safeWidth},iw)':-1:flags=lanczos,split[v0][v1]`,
    "[v0]palettegen=stats_mode=diff[p]",
    "[v1][p]paletteuse=dither=sierra2_4a",
  ].join(";");
}

async function probeGif(outputPath: string): Promise<GifExportResult> {
  const info = await readFfprobeFullMetadata(outputPath);
  return {
    width: info.video?.width ?? 0,
    height: info.video?.height ?? 0,
    durationSeconds: info.duration ?? info.video?.duration ?? 0,
  };
}

async function defaultExrLayer(files: string[]): Promise<string | null> {
  if (path.extname(files[0] ?? "").toLowerCase() !== ".exr") return null;
  const header = await parseExrHeader(files[0]);
  if (!header.valid) return null;
  return selectDefaultExrLayer(deriveExrDisplayLayers(header.channels))?.name ?? null;
}

export async function exportSequenceToGif(
  options: SequenceGifExportOptions,
  signal?: AbortSignal,
): Promise<GifExportResult> {
  if (!options.files.length) throw new Error("GIF_EXPORT_EMPTY");
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-gif-"));
  try {
    const listPath = path.join(tempDirectory, "frames.txt");
    const frameDuration = 1 / Math.max(1, options.fps);
    const lines = options.files
      .map((file) => `file '${file.replaceAll("'", "'\\''")}'`)
      .join(`\nduration ${frameDuration}\n`);
    await writeFile(listPath, `${lines}\nduration ${frameDuration}\n`, "utf8");
    const layer = await defaultExrLayer(options.files);
    await execFileAsync(packagedFfmpegPath(), [
      "-y",
      ...(layer ? ["-layer", layer] : []),
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-filter_complex", gifFilter(options.fps, options.maxWidth),
      "-loop", "0",
      options.outputPath,
    ], {
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      signal,
    });
    return probeGif(options.outputPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function exportVideoToGif(
  options: VideoGifExportOptions,
  signal?: AbortSignal,
): Promise<GifExportResult> {
  await execFileAsync(packagedFfmpegPath(), [
    "-y",
    "-i", options.inputPath,
    "-filter_complex", gifFilter(options.fps, options.maxWidth),
    "-loop", "0",
    options.outputPath,
  ], {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal,
  });
  return probeGif(options.outputPath);
}
