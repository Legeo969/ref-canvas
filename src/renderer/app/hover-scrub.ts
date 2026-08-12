export function hoverScrubTime(
  pointerX: number,
  left: number,
  width: number,
  durationSeconds: number,
): number {
  if (width <= 0 || durationSeconds <= 0) return 0;
  const position = Math.max(0, Math.min(1, (pointerX - left) / width));
  return position * durationSeconds;
}
