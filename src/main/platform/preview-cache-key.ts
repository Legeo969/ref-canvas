import { createHash } from "node:crypto";

// Bump after changing the thumbnail encode pipeline (PNG→WebP) so stale
// PNG caches are regenerated instead of being served with a WebP header.
export const PREVIEW_CACHE_VERSION = "preview-v6";

export interface PreviewCacheIdentity {
  realPath: string;
  size: number;
  mtimeMs: number;
  variant:
    | "thumbnail-480x320-webp"
    | "thumbnail-shell-480x320-webp"
    | "thumbnail-480x480-webp"
    | "thumbnail-shell-480x480-webp"
    | `thumbnail-480x320-webp-${string}`
    | `thumbnail-shell-480x320-webp-${string}`
    | `thumbnail-480x480-webp-${string}`
    | `thumbnail-shell-480x480-webp-${string}`
    | "thumbnail-960x960-webp"
    | "thumbnail-shell-960x960-webp"
    | `thumbnail-960x960-webp-${string}`
    | `thumbnail-shell-960x960-webp-${string}`
    | "thumbnail-1920x1920-webp"
    | "thumbnail-shell-1920x1920-webp"
    | `thumbnail-1920x1920-webp-${string}`
    | `thumbnail-shell-1920x1920-webp-${string}`
    | "thumbnail-4096x4096-webp"
    | "thumbnail-shell-4096x4096-webp"
    | `thumbnail-4096x4096-webp-${string}`
    | `thumbnail-shell-4096x4096-webp-${string}`
    | "palette-320-webp"
    | "sample-320-webp"
    | `board-${512 | 1024 | 2048}-webp`;
}

/** 生成只用于文件名的缓存键；绝对路径不会出现在返回值中。 */
export function previewCacheKey(identity: PreviewCacheIdentity): string {
  return createHash("sha256")
    .update(PREVIEW_CACHE_VERSION)
    .update("\0")
    .update(identity.realPath)
    .update("\0")
    .update(String(identity.size))
    .update("\0")
    .update(String(identity.mtimeMs))
    .update("\0")
    .update(identity.variant)
    .digest("hex");
}
