import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

/** 不属于统一 preview-index 管理的遗留/临时缓存前缀。 */
const ORPHAN_PREFIX = /^(frame|palette|media)-/i;

interface ThumbnailIdentity {
  id: string;
  mtimeMs: number;
  size: number;
  fingerprint: string;
}

const safeId = (id: string): string => id.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

export function thumbnailCacheFilename(
  asset: ThumbnailIdentity,
  variant = "composite",
): string {
  const identity = createHash("sha256")
    .update(`${asset.mtimeMs}:${asset.size}:${asset.fingerprint}`);
  if (variant !== "composite") identity.update(`:${variant}`);
  const signature = identity.digest("hex")
    .slice(0, 20);
  return `${safeId(asset.id)}-${signature}.webp`;
}

export async function pruneStaleThumbnails(
  directory: string,
  assetId: string,
  keepFilename: string,
): Promise<void> {
  const prefix = `${safeId(assetId)}-`;
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix) && entry !== keepFilename)
      .map((entry) => rm(path.join(directory, entry), { force: true })),
  );
}

/**
 * 清理未被 preview-index 管理的遗留缓存文件：
 * - frame-/palette-/media- 前缀文件（旧版未纳入索引的抽帧/取色/媒体缓存）
 * - 非 frame-/media- 前缀的 .png（WebP 迁移前的旧缩量图残留）
 *
 * 已纳入索引的文件会保留；调用方应传入 `PreviewCacheIndex.listValidFilenames()`
 * 的路径集合。返回实际删除的文件路径。
 */
export async function cleanupOrphanThumbnails(
  directory: string,
  indexedFiles: ReadonlySet<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          // gif-frames 是托管缓存（自身 manifest + LRU 修剪，坐标为
          // frame_0001.png 易被下面的「legacy png」规则误删，删了每次启动
          // 都要重拆 165 帧）。这里明确跳过。
          if (entry.name === "gif-frames") return;
          await visit(full);
          return;
        }
        if (!entry.isFile()) return;
        const basename = entry.name;
        const orphanPrefix = ORPHAN_PREFIX.test(basename);
        const legacyPng = basename.toLowerCase().endsWith(".png") && !orphanPrefix;
        if (!orphanPrefix && !legacyPng) return;
        // 已纳入索引的前缀文件（frame/media/palette）保留；
        // 旧迁移遗留 .png 即使仍在索引中也属于应删除的旧格式。
        if (indexedFiles.has(full) && !legacyPng) return;
        try {
          await rm(full, { force: true });
          removed.push(full);
        } catch {
          // 文件可能正被占用或已被删除，忽略单文件失败。
        }
      }),
    );
  };
  await visit(directory);
  return removed;
}
