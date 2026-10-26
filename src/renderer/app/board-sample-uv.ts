/**
 * 画布取色的坐标换算。
 *
 * fabric 的 `calcTransformMatrix()` 逆变换后得到的是**以对象中心为原点**的
 * 局部坐标：范围 -w/2..+w/2，中心为 (0,0)。这不是左上角原点。
 * （fabric v7 实测：对象中心 → (0,0)，对象左上角 → (-w/2,-h/2)。）
 *
 * 直接用 local.x / width 归一化会同时产生两个错误：
 *  - 左半部分 local.x < 0 被当成「在对象外」，点不上
 *  - 右半部分 u 偏小一半，取到偏左的像素
 */
export interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

/** 中心原点局部坐标 → 源图归一化坐标；落在对象外返回 null。 */
export function localToUv(
  local: LocalPoint,
  width: number,
  height: number,
): { u: number; v: number } | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (
    local.x < -halfWidth ||
    local.y < -halfHeight ||
    local.x > halfWidth ||
    local.y > halfHeight
  ) {
    return null;
  }
  return {
    u: Math.min(1, Math.max(0, (local.x + halfWidth) / width)),
    v: Math.min(1, Math.max(0, (local.y + halfHeight) / height)),
  };
}
