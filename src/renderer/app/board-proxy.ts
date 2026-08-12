export type BoardProxySize = 512 | 1024 | 2048;

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

/** Prefer the cached board proxy, but never replace a decodable source with a format card. */
export async function loadBoardImageWithFallback<T>(
  proxyUrl: string,
  sourceUrl: string,
  load: (url: string) => Promise<T>,
): Promise<{ image: T; source: "proxy" | "original" }> {
  try {
    return { image: await load(proxyUrl), source: "proxy" };
  } catch {
    return { image: await load(sourceUrl), source: "original" };
  }
}
