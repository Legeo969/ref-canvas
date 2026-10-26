/**
 * 预览取色的坐标反算与取值来源。
 *
 * 关键前提：`<img>` 自身带着
 * `transform: translate3d(panX, panY, 0) rotate(θ) scale(s)`（transform-origin: center）。
 *
 * 因此 `getBoundingClientRect()` 返回的是**变换后**的轴对齐外框：
 * 它随缩放变大、随旋转变成外包矩形，**不能当作布局尺寸**。
 * 旧实现把变换后的 rect 当布局框，又把同一组变换逆了一次——
 * 变换被算了两遍，缩放/旋转后必然取错像素。
 *
 * 正确做法：
 *  - 布局框取 offsetWidth / offsetHeight（不受 transform 影响）
 *  - 中心取 rect 中心（transform-origin 为 center，平移后中心跟着走）
 *  - 再用 rotate ∘ scale 的逆变换把屏幕偏移还原到布局坐标
 *
 * 注意 pan 不需要单独逆算：它已经体现在 rect 中心里了。
 */

export interface ViewportTransform {
  /** 旋转，度（正值为顺时针，CSS 约定）。 */
  readonly rotateDeg: number;
  /** 缩放倍数。 */
  readonly scale: number;
}

export interface LayoutBox {
  /** 元素中心，屏幕 px（含平移，因为来自变换后的 rect）。 */
  readonly centerX: number;
  readonly centerY: number;
  /** 布局宽高，屏幕 px（不含变换，来自 offsetWidth/offsetHeight）。 */
  readonly width: number;
  readonly height: number;
}

/**
 * 屏幕坐标 → 元素内归一化坐标（u/v ∈ [0,1]，点在元素外返回 null）。
 *
 * 中心来自变换后的 rect，所以平移自动被吸收；
 * 只需逆算 rotate 与 scale。
 */
export function screenPointToUv(
  clientX: number,
  clientY: number,
  box: LayoutBox,
  transform: ViewportTransform,
): { u: number; v: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  if (!Number.isFinite(transform.scale) || transform.scale <= 0) return null;
  if (!Number.isFinite(box.centerX) || !Number.isFinite(box.centerY)) return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

  const offsetX = clientX - box.centerX;
  const offsetY = clientY - box.centerY;

  // 逆旋转（CSS 正角为顺时针，故逆变换用 -θ）。
  const radians = (-transform.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedX = offsetX * cos - offsetY * sin;
  const rotatedY = offsetX * sin + offsetY * cos;

  // 逆缩放。
  const localX = rotatedX / transform.scale;
  const localY = rotatedY / transform.scale;

  const u = (localX + box.width / 2) / box.width;
  const v = (localY + box.height / 2) / box.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/**
 * object-fit: contain 下，元素盒内实际图片所占区域（相对元素的 0–1 比例）。
 * 图片比盒子「扁」时上下留白，更「瘦」时左右留白。
 */
export function containBox(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = (imageWidth * scale) / boxWidth;
  const height = (imageHeight * scale) / boxHeight;
  return {
    left: (1 - width) / 2,
    top: (1 - height) / 2,
    width,
    height,
  };
}

/**
 * 「元素内 u/v」→「源图内 u/v」：扣掉 contain 留白后再归一化。
 * 落在留白上返回 null（那里没有像素，不应悄悄取到边缘色）。
 */
export function uvInsideContain(
  u: number,
  v: number,
  box: { left: number; top: number; width: number; height: number },
): { u: number; v: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const su = (u - box.left) / box.width;
  const sv = (v - box.top) / box.height;
  if (su < 0 || su > 1 || sv < 0 || sv > 1) return null;
  return { u: su, v: sv };
}
