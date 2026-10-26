/**
 * 预览缩放的两种比例。
 *
 * `zoom` 是相对「适配容器后的大小」的倍数，不是相对源像素：
 * 一张 4000px 的图在 800px 视口里，适配后显示为 1:8，此时 zoom=1 只代表
 * 「1 个源像素占 1/8 个屏幕像素」。所以 zoom=8 看起来很大，实际仍远未到
 * 1:1，浏览器还在做低分辨率放大——这就是「放到最大还是糊」的原因。
 *
 * 像素级查看需要的是 **像素比例（pixel ratio）= 1 个源像素占几个屏幕像素**。
 * 两者差一个适配系数，这里把换算显式化。
 */

/** 像素比例：1 个源像素对应多少屏幕像素。 */
export interface PixelScale {
  readonly ratio: number;
  /**
   * 达到 1:1 时对应的 zoom 值。
   * 源图本来就比视口小（适配时被放大）时该值 < 1，即 1:1 在 100% 之内。
   */
  readonly nativeZoom: number;
}

/**
 * @param fittedWidth 适配状态下图片在屏幕上的宽度（CSS px）
 * @param naturalWidth 源图宽度（px）
 */
export function pixelScale(
  fittedWidth: number,
  naturalWidth: number,
): PixelScale | null {
  if (fittedWidth <= 0 || naturalWidth <= 0) return null;
  if (!Number.isFinite(fittedWidth) || !Number.isFinite(naturalWidth)) return null;
  // 适配时 zoom=1，此时每个源像素占 fittedWidth / naturalWidth 个屏幕像素。
  const baseRatio = fittedWidth / naturalWidth;
  return {
    ratio: baseRatio,
    nativeZoom: 1 / baseRatio,
  };
}

/**
 * 当前 zoom 下的像素比例。用于显示「1 : N」或百分比。
 * @param zoom 相对适配尺寸的缩放倍数
 */
export function pixelRatioAt(
  zoom: number,
  fittedWidth: number,
  naturalWidth: number,
): number | null {
  const scale = pixelScale(fittedWidth, naturalWidth);
  if (!scale) return null;
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  return scale.ratio * zoom;
}

/**
 * 缩放上限（相对适配尺寸）。
 *
 * 普通查看固定 8 倍。但大图适配后可能已缩到 1:8，此时 8 倍才勉强到 1:1，
 * 更不要说看清单个像素——所以上限必须随图的尺寸走，不能是个常数。
 *
 * 规则：至少能到「1 个源像素占 8 个屏幕像素」（ratio 8），
 * 同时保留 8 倍下限（小图放大时不至于受限）。
 */
export function maxPixelZoom(
  fittedWidth: number,
  naturalWidth: number,
  maxRatio = 8,
): number {
  const scale = pixelScale(fittedWidth, naturalWidth);
  if (!scale) return 8;
  return Math.max(8, scale.nativeZoom * maxRatio);
}
