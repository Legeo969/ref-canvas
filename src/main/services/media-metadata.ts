import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);

export interface MediaMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  /** Beats per minute, estimated locally for uncompressed audio. */
  bpm: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  duration?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

interface FfprobeDocument {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseFfprobeOutput(output: string): MediaMetadata {
  const document = JSON.parse(output) as FfprobeDocument;
  const streams = document.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const streamDurations = streams
    .map((stream) => finitePositive(stream.duration))
    .filter((value): value is number => value !== null);
  const duration =
    finitePositive(document.format?.duration) ??
    (streamDurations.length ? Math.max(...streamDurations) : null);
  let width = finitePositive(video?.width);
  let height = finitePositive(video?.height);
  const rotation =
    video?.side_data_list
      ?.map((item) => finitePositive(Math.abs(item.rotation ?? 0)))
      .find((value) => value !== null) ??
    finitePositive(Math.abs(Number(video?.tags?.rotate ?? 0)));
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }
  return {
    duration,
    width: width === null ? null : Math.round(width),
    height: height === null ? null : Math.round(height),
    bpm: null,
  };
}

export function packagedFfprobePath(filename = ffprobeInstaller.path): string {
  return filename.includes("app.asar")
    ? filename.replace("app.asar", "app.asar.unpacked")
    : filename;
}

export async function readMediaMetadata(
  filename: string,
  executable = packagedFfprobePath(),
  signal?: AbortSignal,
): Promise<MediaMetadata> {
  const { stdout } = await execFileAsync(
    executable,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filename,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
      signal,
    },
  );
  const parsed = parseFfprobeOutput(stdout);
  // BPM is estimated locally from the sample data; ffprobe cannot provide it.
  parsed.bpm = await estimateBpm(filename).catch(() => null);
  return parsed;
}

/**
 * Lightweight, fully-local BPM estimate for uncompressed WAV files based on
 * onset-energy autocorrelation. Compressed formats (and anything unreadable)
 * simply return null — no online analysis is ever used.
 */
export async function estimateBpm(
  filename: string,
): Promise<number | null> {
  if (!filename.toLowerCase().endsWith(".wav")) return null;
  const handle = await open(filename, "r");
  try {
    const header = Buffer.alloc(44);
    await handle.read(header, 0, 44, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF") return null;
    const audioFormat = header.readUInt16LE(20);
    const channels = header.readUInt16LE(22);
    const sampleRate = header.readUInt32LE(24);
    const bitsPerSample = header.readUInt16LE(34);
    if (
      (audioFormat !== 1 && audioFormat !== 3) ||
      channels === 0 ||
      sampleRate < 4_000 ||
      sampleRate > 192_000 ||
      (bitsPerSample !== 16 && bitsPerSample !== 32)
    ) {
      return null;
    }
    // Read the first ~10 seconds of PCM data for the analysis window.
    const bytesPerSample = bitsPerSample / 8;
    const frameBytes = bytesPerSample * channels;
    const windowFrames = Math.min(sampleRate * 10, 2_000_000);
    const windowBytes = Math.min(
      windowFrames * frameBytes,
      64 * 1024 * 1024,
    );
    const data = Buffer.alloc(windowBytes);
    const { bytesRead } = await handle.read(data, 0, windowBytes, 44);
    const usableFrames = Math.floor(bytesRead / frameBytes);
    if (usableFrames < sampleRate) return null;

    // Mono energy envelope: RMS per 1024-sample frame.
    const hop = 1024;
    const envelope: number[] = [];
    for (let frame = 0; frame + hop <= usableFrames; frame += hop) {
      let sum = 0;
      for (let index = 0; index < hop; index += 1) {
        const byteOffset = (frame + index) * frameBytes;
        let sample: number;
        if (bitsPerSample === 16) {
          sample = data.readInt16LE(byteOffset) / 32_768;
        } else {
          sample = data.readFloatLE(byteOffset);
        }
        sum += sample * sample;
      }
      envelope.push(Math.sqrt(sum / hop));
    }
    const framesPerSecond = sampleRate / hop;
    // Autocorrelation over candidate lags (60–200 BPM).
    const minLag = Math.round(framesPerSecond * 60 / 200);
    const maxLag = Math.round(framesPerSecond * 60 / 60);
    // Need at least two full lag windows of onset energy.
    if (envelope.length < maxLag * 2 + 1) return null;

    // Onset strength: positive half-wave rectified frame-to-frame difference.
    const onset: number[] = [];
    for (let index = 1; index < envelope.length; index += 1) {
      onset.push(Math.max(0, envelope[index] - envelope[index - 1]));
    }
    const totalEnergy = onset.reduce((sum, value) => sum + value, 0);
    if (totalEnergy < 1e-4) return null; // silence / constant tone

    let bestLag = 0;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let score = 0;
      let count = 0;
      for (let index = 0; index + lag < onset.length; index += 1) {
        score += onset[index] * onset[index + lag];
        count += 1;
      }
      if (!count) continue;
      const normalized = score / count;
      if (normalized > bestScore) {
        bestScore = normalized;
        bestLag = lag;
      }
    }
    if (!bestLag) return null;
    const bpm = 60 * framesPerSecond / bestLag;
    return bpm >= 50 && bpm <= 220 ? Math.round(bpm * 10) / 10 : null;
  } finally {
    await handle.close();
  }
}
