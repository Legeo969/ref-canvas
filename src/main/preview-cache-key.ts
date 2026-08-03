import { createHash } from "node:crypto";

export const PREVIEW_CACHE_VERSION = "preview-v2";

export interface PreviewCacheIdentity {
  realPath: string;
  size: number;
  mtimeMs: number;
  variant:
    | "thumbnail-480x320-png"
    | "thumbnail-shell-480x320-png"
    | `board-${512 | 1024 | 2048}-png`;
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
