export interface GifExportRange {
  startMs: number;
  endMs: number;
}

export function centeredGifRange(
  currentTimeMs: number,
  durationMs: number,
  rangeDurationMs = 5_000,
): GifExportRange {
  const duration = Math.max(0, durationMs);
  const length = Math.min(duration, Math.max(0, rangeDurationMs));
  const center = Math.max(0, Math.min(duration, currentTimeMs));
  const startMs = Math.max(0, Math.min(duration - length, center - length / 2));
  return { startMs, endMs: startMs + length };
}
