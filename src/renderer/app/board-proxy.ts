export type BoardProxySize = 512 | 1024 | 2048;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 给缩略图 URL 加 previewRetry=nonce，绕过已被标记失败/未生成的 404 缓存。 */
function thumbnailUrlWithRetry(url: string, nonce: number): string {
  if (nonce <= 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}previewRetry=${nonce}`;
}

/**
 * 非图片资产导入白板时，缩略图由主进程 provider 异步生成，首次请求常为
 * 404。这里带 nonce 重试数次（每次换 previewRetry，会清失败标记并重新排队
 * 生成），避免「只出格式卡片、内容永远不显示」。仍失败则交给调用方保留
 * 可恢复的参考卡片。
 */
export const BOARD_THUMBNAIL_RETRY_DELAYS_MS = [350, 900, 1800] as const;
export async function loadThumbnailWithRetry<T>(
  thumbnailUrl: string,
  load: (url: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const [index, delay] of BOARD_THUMBNAIL_RETRY_DELAYS_MS.entries()) {
    try {
      // 首轮用原始 URL；重试才带 previewRetry nonce（清失败标记并重新排队）。
      const url = index === 0
        ? thumbnailUrl
        : thumbnailUrlWithRetry(thumbnailUrl, index);
      return await load(url);
    } catch (error) {
      lastError = error;
      const isLast = index + 1 >= BOARD_THUMBNAIL_RETRY_DELAYS_MS.length;
      if (!isLast) await sleep(delay);
    }
  }
  throw lastError;
}

export function boardProxySizeForPixels(pixels: number): BoardProxySize {
  if (pixels <= 512) return 512;
  if (pixels <= 1024) return 1024;
  return 2048;
}

export function boardProxyUrl(
  thumbnailUrl: string,
  size: BoardProxySize,
): string {
  const separator = thumbnailUrl.includes("?") ? "&" : "?";
  return `${thumbnailUrl}${separator}variant=board&size=${size}&priority=visible`;
}

/** Races a promise against a timeout; rejects with IMAGE_LOAD_TIMEOUT if it
 *  doesn't settle within `ms`. Timer is cleared on settle (no leak). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("IMAGE_LOAD_TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Prefer the cached board proxy, but never replace a decodable source with a format card.
 *  If the proxy doesn't settle within `proxyTimeoutMs` (e.g. thumbnail worker
 *  is cold-starting or queued behind heavy work), fall back to the original
 *  image URL which serves the raw file directly. */
export async function loadBoardImageWithFallback<T>(
  proxyUrl: string,
  sourceUrl: string,
  load: (url: string) => Promise<T>,
  proxyTimeoutMs = 4_000,
): Promise<{ image: T; source: "proxy" | "original" }> {
  try {
    return { image: await withTimeout(load(proxyUrl), proxyTimeoutMs), source: "proxy" };
  } catch {
    return { image: await load(sourceUrl), source: "original" };
  }
}
