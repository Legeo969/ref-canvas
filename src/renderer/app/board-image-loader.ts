/**
 * 白板图片的 CORS-clean 加载工具。
 *
 * 白板图片通过 `FabricImage.fromURL`（裸 `<img>`，无 crossOrigin）加载，
 * 打包环境里 file:// 页面跨协议请求 refasset:// 不带 Referer/Origin，
 * 协议策略无法签发 CORS 头，每张图都会污染画布：任何 canvas 回读
 * （toDataURL / getImageData）抛 SecurityError。取色器已改走主进程采样
 * 绕开（35c7a25）；导出 PNG 不能绕开，必须在导出前把图片元素换成
 * fetch+blob 拿到的干净位图（同 GIFPreview 的帧加载通路，协议对带
 * referrer 的 fetch 返回 Access-Control-Allow-Origin）。
 *
 * 只在导出窗口内临时替换 `FabricImage._element`，导出后恢复原元素；
 * 不触碰 `_originalElement`（序列化 src 不变），也不改 width/scale
 * （干净位图与原图同尺寸，直接 drawImage 即可）。
 */

type CleanImageElement = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const cleanElementCache = new Map<string, Promise<CleanImageElement | null>>();

async function fetchCleanElement(url: string): Promise<CleanImageElement | null> {
  try {
    const response = await fetch(url, { referrer: window.location.href });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }
    // 兜底：老环境无 createImageBitmap 时用 blob URL <img>（blob: 同源，干净）。
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
        image.src = objectUrl;
      });
      return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/**
 * 取一张白板图片的 CORS-clean 元素（带会话级缓存，同一 URL 只 fetch 一次）。
 * 返回 null 表示加载失败（网络/协议/解码任一环节），调用方决定降级行为。
 */
export function loadCleanBoardImageElement(url: string): Promise<CleanImageElement | null> {
  const cached = cleanElementCache.get(url);
  if (cached) return cached;
  const pending = fetchCleanElement(url).finally(() => {
    cleanElementCache.delete(url);
  });
  cleanElementCache.set(url, pending);
  return pending;
}

/** 仅测试用：清空会话级缓存。 */
export function resetCleanBoardImageCache(): void {
  cleanElementCache.clear();
}
