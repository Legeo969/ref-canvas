export type BoardContextResolution<T> =
  | { mode: "empty" }
  | { mode: "multi" }
  | { mode: "single"; target: T; selectTarget: boolean };

export function resolveBoardContext<T>(
  selected: readonly T[],
  target: T | undefined,
  targetIsActiveSelection: boolean,
): BoardContextResolution<T> {
  if (!target) return { mode: "empty" };
  if (
    targetIsActiveSelection ||
    (selected.length > 1 && selected.includes(target))
  ) {
    return { mode: "multi" };
  }
  return {
    mode: "single",
    target,
    selectTarget: !selected.includes(target),
  };
}

export function clampBoardContextPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, viewportWidth - 232)),
    y: Math.max(8, Math.min(y, viewportHeight - 368)),
  };
}
