/**
 * 白板对象检查器的纯函数：fabric 属性 ↔ 数值表单的换算与钳制。
 * 组件只负责渲染与事件接线，数值语义全部收敛在这里（便于单测）。
 */

/** 检查器可编辑的最小对象形状（fabric 对象的结构子集）。 */
export interface InspectableObjectMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
}

export interface InspectorMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

/** 展示/编辑用的像素尺寸下限与透明度范围。 */
export const MIN_DIMENSION = 0.5;
export const MAX_DIMENSION = 100_000;
export const MIN_OPACITY = 0.02;
export const MAX_OPACITY = 1;

export const roundMetric = (value: number): number =>
  Math.round(value * 10) / 10;

/** fabric 对象 → 表单数值（宽高 = 原始尺寸 × 缩放，取一位小数）。 */
export function inspectorMetrics(
  object: InspectableObjectMetrics,
): InspectorMetrics {
  return {
    x: roundMetric(object.left),
    y: roundMetric(object.top),
    width: roundMetric(object.width * object.scaleX),
    height: roundMetric(object.height * object.scaleY),
    rotation: roundMetric(object.angle),
    opacity: roundMetric(object.opacity),
  };
}

/** 表单数值 → fabric 属性补丁（钳制非法值；宽高换算为 scale）。 */
export function inspectorPatch(
  object: InspectableObjectMetrics,
  patch: Partial<InspectorMetrics>,
): Record<string, number> {
  const next: Record<string, number> = {};
  if (patch.x !== undefined) next.left = patch.x;
  if (patch.y !== undefined) next.top = patch.y;
  if (patch.rotation !== undefined) next.angle = patch.rotation;
  if (patch.opacity !== undefined) {
    next.opacity = Math.min(
      MAX_OPACITY,
      Math.max(MIN_OPACITY, patch.opacity),
    );
  }
  if (patch.width !== undefined && object.width > 0) {
    const dimension = Math.min(
      MAX_DIMENSION,
      Math.max(MIN_DIMENSION, patch.width),
    );
    next.scaleX = Math.max(0.0001, dimension / object.width);
  }
  if (patch.height !== undefined && object.height > 0) {
    const dimension = Math.min(
      MAX_DIMENSION,
      Math.max(MIN_DIMENSION, patch.height),
    );
    next.scaleY = Math.max(0.0001, dimension / object.height);
  }
  return next;
}

/** 数值输入解析：空串/非法 → undefined（不修改该字段）。 */
export function parseInspectorNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
