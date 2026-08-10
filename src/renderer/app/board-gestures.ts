export interface GesturePoint {
  x: number;
  y: number;
}

export interface PanPointerEvent {
  button: number;
  buttons: number;
  altKey: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export interface PrimaryPointerSnapshot {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Builds the synthetic mouse-up used to finish a Fabric gesture after the OS
 * drops the native release event (for example when the window loses focus).
 */
export function recoveredPrimaryMouseUp(
  event: PrimaryPointerSnapshot,
): MouseEventInit {
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

/**
 * ActiveSelection is not part of canvas.getObjects(); its members are. Exclude
 * the whole moving selection so snapping only considers stationary anchors.
 */
export function stationarySnapCandidates<T>(
  objects: readonly T[],
  movingTarget: T,
  movingMembers: readonly T[] = [],
): T[] {
  const moving = new Set<T>([movingTarget, ...movingMembers]);
  return objects.filter((object) => !moving.has(object));
}

export function isMiddleButtonPointer(
  event: Pick<PanPointerEvent, "button" | "buttons">,
): boolean {
  return event.button === 1 || (event.buttons & 4) !== 0;
}

export function isPanPointerEvent(
  event: PanPointerEvent,
  pureRef: boolean,
): boolean {
  return (
    isMiddleButtonPointer(event) ||
    (pureRef &&
      event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.button === 0 || (event.buttons & 1) !== 0))
  );
}

export interface MiddlePanUpdate {
  dx: number;
  dy: number;
  finished: boolean;
}

/**
 * Native middle-button session used before Fabric receives pointer events.
 * Fabric does not reliably emit its synthetic mouse events for auxiliary
 * buttons, especially when an object is under the pointer.
 */
export class MiddlePanSession {
  private active = false;
  private lastX = 0;
  private lastY = 0;

  get isActive(): boolean {
    return this.active;
  }

  start(event: Pick<MouseEvent, "button" | "buttons" | "clientX" | "clientY">): boolean {
    if (!isMiddleButtonPointer(event)) return false;
    this.active = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    return true;
  }

  move(event: Pick<MouseEvent, "buttons" | "clientX" | "clientY">): MiddlePanUpdate | null {
    if (!this.active) return null;
    if ((event.buttons & 4) === 0) {
      this.active = false;
      return { dx: 0, dy: 0, finished: true };
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    return { dx, dy, finished: false };
  }

  end(event: Pick<MouseEvent, "button" | "buttons">): boolean {
    if (!this.active) return false;
    if (event.button !== 1 && (event.buttons & 4) !== 0) return false;
    this.active = false;
    return true;
  }

  cancel(): boolean {
    if (!this.active) return false;
    this.active = false;
    return true;
  }
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

/** PureRef 的连续数值操作：向右放大/增加，向左缩小/降低。 */
export function horizontalDragFactor(deltaX: number): number {
  return Math.min(100, Math.max(0.01, 1.005 ** deltaX));
}

export function scaleForHorizontalDrag(
  baseScaleX: number,
  baseScaleY: number,
  deltaX: number,
): { scaleX: number; scaleY: number } {
  const factor = horizontalDragFactor(deltaX);
  return {
    scaleX: baseScaleX * factor,
    scaleY: baseScaleY * factor,
  };
}

/** 水平拖动转 opacity 增量（每 200px 变化 1.0）。 */
export function opacityDelta(deltaX: number): number {
  return deltaX / 200;
}

export function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, value));
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
    // PureRef 的 V 手势是“抓住图片”移动，因此裁切窗口内的源坐标
    // 与指针方向相反：向右拖图片，看到的是更靠左的源区域。
    cropX: -pointerDeltaX / Math.max(0.001, Math.abs(scaleX)),
    cropY: -pointerDeltaY / Math.max(0.001, Math.abs(scaleY)),
  };
}

export interface CropZoomSnapshot {
  cropX: number;
  cropY: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Shift+V 裁切内缩放。显示框尺寸保持不变，只改变框内可见的源图范围。
 */
export function cropZoomForHorizontalDrag(
  snapshot: CropZoomSnapshot,
  original: { width: number; height: number },
  deltaX: number,
): CropZoomSnapshot {
  const requested = horizontalDragFactor(deltaX);
  const minimumFactor = Math.max(
    snapshot.width / Math.max(1, original.width),
    snapshot.height / Math.max(1, original.height),
  );
  const maximumFactor = Math.min(snapshot.width, snapshot.height);
  const factor = Math.min(
    Math.max(0.001, maximumFactor),
    Math.max(minimumFactor, requested),
  );
  const width = Math.max(1, Math.min(original.width, snapshot.width / factor));
  const height = Math.max(
    1,
    Math.min(original.height, snapshot.height / factor),
  );
  const centerX = snapshot.cropX + snapshot.width / 2;
  const centerY = snapshot.cropY + snapshot.height / 2;
  const cropX = Math.max(0, Math.min(original.width - width, centerX - width / 2));
  const cropY = Math.max(
    0,
    Math.min(original.height - height, centerY - height / 2),
  );
  return {
    cropX,
    cropY,
    width,
    height,
    scaleX: (snapshot.width * snapshot.scaleX) / width,
    scaleY: (snapshot.height * snapshot.scaleY) / height,
  };
}

/** Alt+Shift+左拖动：主方向决定水平或垂直翻转，轻微抖动不触发。 */
export function flipAxisForDrag(
  deltaX: number,
  deltaY: number,
  threshold = 8,
): "x" | "y" | null {
  if (Math.hypot(deltaX, deltaY) < threshold) return null;
  return Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y";
}
