/**
 * 白板缩放的单一真相：滚轮、± 按钮、适应视图、聚焦、紧凑排列全部引用这里。
 * 分散在五处各写一遍 Math.min(4, ...) 曾导致上限难以确认、也难以统一调整。
 *
 * 0.08（8%）用于看整块大画布，8.0（800%）用于像素级核对参考图。
 * 旧值 400% 对 4K 素材的细节核对不够用。
 */
export const BOARD_MIN_ZOOM = 0.08;
export const BOARD_MAX_ZOOM = 8;

/**
 * 像素级核对时的缩放上限。
 *
 * 800% 是相对视图的倍数，对 4000px 的素材可能仍远小于 1:1（画布通常已经
 * 缩到很小）。要真正看到单个源像素，必须允许放大到远高于 8 倍。
 * 这个上限用于「像素级」开关打开时。
 */
export const BOARD_PIXEL_ZOOM = 64;

/** 把任意缩放值钳制到白板允许区间。 */
export function clampBoardZoom(zoom: number, max = BOARD_MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return 1;
  const upper = Number.isFinite(max) && max > 0 ? max : BOARD_MAX_ZOOM;
  return Math.min(upper, Math.max(BOARD_MIN_ZOOM, zoom));
}
