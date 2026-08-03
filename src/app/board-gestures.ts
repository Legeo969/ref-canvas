export interface GesturePoint {
  x: number;
  y: number;
}

/** 围绕 center 的指针角位移（弧度），用于 Ctrl+左旋转。 */
export function pointerAngleDelta(
  center: GesturePoint,
  from: GesturePoint,
  to: GesturePoint,
): number {
  const angleOf = (point: GesturePoint) =>
    Math.atan2(point.y - center.y, point.x - center.x);
  let delta = angleOf(to) - angleOf(from);
  // 归一化到 (-π, π]，避免跨 180° 时旋转方向跳变。
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** 指针相对 center 的距离比例，用于 Ctrl+Alt+左缩放。 */
export function pointerDistanceRatio(
  center: GesturePoint,
  from: GesturePoint,
  to: GesturePoint,
): number {
  const distance = (point: GesturePoint) =>
    Math.hypot(point.x - center.x, point.y - center.y);
  const start = distance(from);
  if (!start) return 1;
  return distance(to) / start;
}

export function rotationForGesture(
  baseAngle: number,
  center: GesturePoint,
  from: GesturePoint,
  to: GesturePoint,
): number {
  return baseAngle + (pointerAngleDelta(center, from, to) * 180) / Math.PI;
}

export function snapRotationAngle(angle: number, enabled: boolean): number {
  return enabled ? Math.round(angle / 45) * 45 : angle;
}

export function normalizeSignedAngle(angle: number): number {
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function restoreRotationGesture(
  target: { rotate(angle: number): unknown; setCoords(): unknown },
  baseAngle: number,
): void {
  target.rotate(baseAngle);
  target.setCoords();
}

export function scaleForGesture(
  baseScaleX: number,
  baseScaleY: number,
  center: GesturePoint,
  from: GesturePoint,
  to: GesturePoint,
): { scaleX: number; scaleY: number } {
  const ratio = pointerDistanceRatio(center, from, to);
  return {
    scaleX: baseScaleX * ratio,
    scaleY: baseScaleY * ratio,
  };
}

/** 垂直拖动转 opacity 增量（每 200px 变化 1.0），用于 Ctrl+Alt+Shift+左。 */
export function opacityDelta(deltaY: number): number {
  return -deltaY / 200;
}

export function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0.02, value));
}

/** Z+左连续缩放：按垂直拖动距离计算缩放倍率（向上放大）。 */
export function zoomFactorForDrag(deltaY: number): number {
  return 1.001 ** -deltaY;
}

/**
 * Shift+拖动选中对象时约束轴向：按初始位移方向锁定到水平或垂直轴。
 * 返回 { axis }，axis 为 "x" | "y"；位移接近对角线时保持原始偏移。
 */
export function constrainedAxis(
  start: GesturePoint,
  current: GesturePoint,
): "x" | "y" | null {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return null;
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
}

export interface CropGestureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * C+左 非破坏性裁切：与绘图框选一致，按起点终点计算归一化矩形。
 * constrain 时保持正方形比例。
 */
export function cropGestureRect(
  start: GesturePoint,
  end: GesturePoint,
  constrain: boolean,
): CropGestureRect {
  let deltaX = end.x - start.x;
  let deltaY = end.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    deltaX = Math.sign(deltaX || 1) * size;
    deltaY = Math.sign(deltaY || 1) * size;
  }
  return {
    left: Math.min(start.x, start.x + deltaX),
    top: Math.min(start.y, start.y + deltaY),
    width: Math.abs(deltaX),
    height: Math.abs(deltaY),
  };
}

/** V+左 裁切区内移动：将指针位移换算为裁切偏移（像素，按对象缩放修正）。 */
export function cropPanDelta(
  pointerDeltaX: number,
  pointerDeltaY: number,
  scaleX: number,
  scaleY: number,
): { cropX: number; cropY: number } {
  return {
    cropX: pointerDeltaX / Math.max(0.001, scaleX),
    cropY: pointerDeltaY / Math.max(0.001, scaleY),
  };
}
