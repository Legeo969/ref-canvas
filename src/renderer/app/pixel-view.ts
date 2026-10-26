/**
 * 像素级查看的判定与缩放上限。
 *
 * 白板与预览面板的缩放都建立在「相对某个基准的倍数」上：
 *  - 白板：相对画布视图
 *  - 预览：相对适配容器后的尺寸
 * 两者都不是「相对源像素」。所以 800% 可能是放大，也可能仍小于 1:1。
 *
 * 真正的判据只有一个：**1 个源像素是否被拉到 1 个屏幕像素以上**。
 * 到这个点之后继续放大，浏览器的平滑插值只会把像素糊成过渡色；
 * 关掉它才是像素级查看。因此不需要开关按钮 —— 放大到 1:1 自动切换。
 */

/** 像素比：1 个源像素占几个屏幕像素。≤1 表示还没到 1:1。 */
export const PIXEL_VIEW_THRESHOLD = 1;

/**
 * 显示比例（屏幕像素 / 源像素）达到 1 即进入像素级显示。
 *
 * @param screenPixels 当前屏幕上该图占的宽度（CSS px）
 * @param sourcePixels 源图宽度（px）
 */
export function isPixelView(
  screenPixels: number,
  sourcePixels: number,
): boolean {
  if (!Number.isFinite(screenPixels) || !Number.isFinite(sourcePixels)) return false;
  if (screenPixels <= 0 || sourcePixels <= 0) return false;
  return screenPixels / sourcePixels >= PIXEL_VIEW_THRESHOLD;
}

/**
 * 放大到「1 个源像素 = 8 个屏幕像素」所需的倍数。
 * 用于决定缩放上限：上限必须能越过 1:1，否则永远到不了像素级。
 *
 * @param baseRatio 基准显示比例（屏幕/源），即当前 zoom=1 时的比例
 * @param maxRatio 允许的最大像素比，默认 8
 * @param floor 常规查看的下限倍数，默认 8
 */
export function pixelViewMaxZoom(
  baseRatio: number,
  maxRatio = 8,
  floor = 8,
): number {
  if (!Number.isFinite(baseRatio) || baseRatio <= 0) return floor;
  return Math.max(floor, (maxRatio / baseRatio));
}
