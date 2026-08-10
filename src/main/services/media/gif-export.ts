import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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
  sizeBytes: number;
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
  startMs?: number;
  endMs?: number;
  colors?: number;
  dither?: GifDither;
}

export type GifDither = "none" | "bayer" | "floyd_steinberg" | "sierra2_4a";

export interface VideoGifClip {
  inputPath: string;
  startMs?: number;
  endMs?: number;
}

export interface MultiVideoGifExportOptions {
  clips: VideoGifClip[];
  fps: number;
  maxWidth: number;
  outputPath: string;
  colors?: number;
  dither?: GifDither;
}

function gifFilter(
  fps: number,
  maxWidth: number,
  colors = 256,
  dither: GifDither = "sierra2_4a",
): string {
  const safeFps = Math.min(60, Math.max(1, Math.round(fps)));
  const safeWidth = Math.min(3840, Math.max(64, Math.round(maxWidth)));
  const safeColors = Math.min(256, Math.max(16, Math.round(colors)));
  return [
    `[0:v]fps=${safeFps},scale='min(${safeWidth},iw)':-1:flags=lanczos,split[v0][v1]`,
    `[v0]palettegen=max_colors=${safeColors}:stats_mode=diff[p]`,
    `[v1][p]paletteuse=dither=${dither}`,
  ].join(";");
}

async function probeGif(outputPath: string): Promise<GifExportResult> {
  const [info, file] = await Promise.all([
    readFfprobeFullMetadata(outputPath),
    stat(outputPath),
  ]);
  return {
    width: info.video?.width ?? 0,
    height: info.video?.height ?? 0,
    durationSeconds: info.duration ?? info.video?.duration ?? 0,
    sizeBytes: file.size,
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
  const startMs = Math.max(0, options.startMs ?? 0);
  const endMs = options.endMs == null ? null : Math.max(startMs, options.endMs);
  await execFileAsync(packagedFfmpegPath(), [
    "-y",
    ...(startMs > 0 ? ["-ss", String(startMs / 1000)] : []),
    "-i", options.inputPath,
    ...(endMs !== null && endMs > startMs
      ? ["-t", String((endMs - startMs) / 1000)]
      : []),
    "-filter_complex", gifFilter(
      options.fps,
      options.maxWidth,
      options.colors,
      options.dither,
    ),
    "-loop", "0",
    options.outputPath,
  ], {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal,
  });
  return probeGif(options.outputPath);
}

/**
 * Concatenates ordered video ranges and encodes one optimized GIF. Inputs are
 * normalized to the first clip's aspect ratio so mixed resolutions are safe.
 */
export async function exportVideosToGif(
  options: MultiVideoGifExportOptions,
  signal?: AbortSignal,
): Promise<GifExportResult> {
  if (!options.clips.length) throw new Error("GIF_EXPORT_EMPTY");
  if (options.clips.length === 1) {
    const [clip] = options.clips;
    return exportVideoToGif({
      ...options,
      inputPath: clip.inputPath,
      startMs: clip.startMs,
      endMs: clip.endMs,
    }, signal);
  }
  const first = await readFfprobeFullMetadata(options.clips[0].inputPath);
  const sourceWidth = Math.max(1, first.video?.width ?? options.maxWidth);
  const sourceHeight = Math.max(1, first.video?.height ?? Math.round(sourceWidth * 9 / 16));
  const width = Math.min(options.maxWidth, sourceWidth);
  const height = Math.max(2, Math.round((width * sourceHeight / sourceWidth) / 2) * 2);
  const fps = Math.min(60, Math.max(1, Math.round(options.fps)));
  const colors = Math.min(256, Math.max(16, Math.round(options.colors ?? 256)));
  const dither = options.dither ?? "sierra2_4a";
  const args: string[] = ["-y"];
  for (const clip of options.clips) {
    const startMs = Math.max(0, clip.startMs ?? 0);
    const endMs = clip.endMs == null ? null : Math.max(startMs, clip.endMs);
    if (startMs > 0) args.push("-ss", String(startMs / 1000));
    if (endMs !== null && endMs > startMs) {
      args.push("-t", String((endMs - startMs) / 1000));
    }
    args.push("-i", clip.inputPath);
  }
  const normalized = options.clips.map((_, index) =>
    `[${index}:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${index}]`,
  );
  const inputs = options.clips.map((_, index) => `[v${index}]`).join("");
  const filters = [
    ...normalized,
    `${inputs}concat=n=${options.clips.length}:v=1:a=0[joined]`,
    "[joined]split[palette_source][gif_source]",
    `[palette_source]palettegen=max_colors=${colors}:stats_mode=diff[palette]`,
    `[gif_source][palette]paletteuse=dither=${dither}[gif]`,
  ].join(";");
  args.push(
    "-filter_complex", filters,
    "-map", "[gif]",
    "-loop", "0",
    options.outputPath,
  );
  await execFileAsync(packagedFfmpegPath(), args, {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal,
  });
  return probeGif(options.outputPath);
}
