export type BoardContextResolution<T> =
  | { mode: "empty" }
  | { mode: "multi" }
  | { mode: "single"; target: T; selectTarget: boolean };

type ContextMenuPointer = Pick<
  MouseEvent,
  | "buttons"
  | "clientX"
  | "clientY"
  | "screenX"
  | "screenY"
  | "ctrlKey"
  | "shiftKey"
  | "altKey"
  | "metaKey"
>;

export function interruptedSelectionMouseUp(
  event: ContextMenuPointer,
): MouseEventInit | null {
  if ((event.buttons & 1) === 0) return null;
  return {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 0,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

export function resolveBoardContext<T>(
  selected: readonly T[],
  target: T | undefined,
  targetIsActiveSelection: boolean,
): BoardContextResolution<T> {
  // 右键落在空白处时 target 为 undefined,但活动多选仍然有效:对齐/分布等
  // 多选操作只依赖选区本身。若此处回落为 empty,第一次对齐把对象移走后,
  // 下一次右键常落在空白处,对齐/分布入口会整体消失(连击失效)。
  if (!target) {
    return selected.length > 1 ? { mode: "multi" } : { mode: "empty" };
  }
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
