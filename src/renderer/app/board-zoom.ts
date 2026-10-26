/**
 * 白板缩放的单一真相：滚轮、± 按钮、适应视图、聚焦、紧凑排列全部引用这里。
 * 分散在五处各写一遍 Math.min(4, ...) 曾导致上限难以确认、也难以统一调整。
 *
 * 0.08（8%）用于看整块大画布，8.0（800%）用于像素级核对参考图。
 * 旧值 400% 对 4K 素材的细节核对不够用。
 */
export const BOARD_MIN_ZOOM = 0.08;
export const BOARD_MAX_ZOOM = 8;

/** 把任意缩放值钳制到白板允许区间。 */
export function clampBoardZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, zoom));
}
