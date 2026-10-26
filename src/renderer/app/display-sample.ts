/**
 * 屏幕像素取样：取「用户此刻看到的那份像素」（白板代理 WebP / 预览 WebP）。
 *
 * 与主进程的源文件采样互补：
 *  - 主进程 sharp 读源文件 → 设计规格色值（不受压缩影响，可直接交付给设计/开发）
 *  - 这里读显示层像素   → 视觉所见色值（含 WebP 有损与缩放，与眼睛一致）
 *
 * 两者只在无压缩、无缩放、无显示变换时相等；差异本身就是有用信息，
 * 所以面板同时展示并标注来源，而不是替用户选一个。
 */

export interface DisplaySample {
  /** 大写 #RRGGBB。 */
  readonly hex: string;
  /** 0–255。 */
  readonly alpha: number;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

/**
 * 从已加载的图片 URL 取单像素。
 *
 * 用 fetch + createImageBitmap 而不是 canvas.drawImage(imageElement)：
 * 前者不受「图片以普通 <img> 跨源加载把 canvas 标记为 tainted」的影响，
 * 也不需要为 refasset:// 放宽 CORS；后者在 Electron 自定义协议下会抛
 * SecurityError（这正是旧实现失败的原因）。
 */
export async function sampleDisplayPixel(
  url: string,
  u: number,
  v: number,
): Promise<DisplaySample | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    bitmap = await createImageBitmap(await response.blob());
    const width = bitmap.width;
    const height = bitmap.height;
    if (width <= 0 || height <= 0) return null;
    const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    // 只把 1 个像素画进 1×1 canvas：不必为大图分配整张缓冲。
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, 1, 1);
    context.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return {
      hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
      alpha,
    };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
