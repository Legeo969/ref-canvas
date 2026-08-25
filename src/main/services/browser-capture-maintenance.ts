import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * browser-captures 目录维护：
 *
 * 捕获服务器把扩展发来的图片写到 <userData>/browser-captures/，渲染端
 * 导入后 materialize 成 linked 资产——源文件就是库的磁盘真相，因此**被
 * 引用的文件永远不能删**。但存在两类无人认领的残留：
 * 1. 主进程写盘后渲染端没来得及导入（应用退出 / 无主窗口时 IPC 丢弃）；
 * 2. 用户在导入前手动清掉了记录。
 * 这些文件没有对应资产行，只会无限堆积。启动时按 mtime 宽限期内跳过，
 * 超期且无资产引用的删除。
 */
export interface PruneOrphanedCapturesOptions {
  /** browser-captures 绝对路径。 */
  directory: string;
  /** 该绝对路径是否已有资产记录（linked 引用 = 磁盘真相，必须保留）。 */
  hasAssetAtPath: (absolutePath: string) => boolean;
  /** 当前时间戳（ms），默认 Date.now()。 */
  now?: number;
  /** 孤儿宽限期（ms），默认 7 天：给"写入后尚未导入"的在途文件留时间。 */
  maxAgeMs?: number;
}

export interface PruneOrphanedCapturesResult {
  removed: Array<{ path: string; reason: "orphan-expired" }>;
  kept: number;
}

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function pruneOrphanedCaptures(
  options: PruneOrphanedCapturesOptions,
): Promise<PruneOrphanedCapturesResult> {
  const {
    directory,
    hasAssetAtPath,
    now = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS,
  } = options;
  const result: PruneOrphanedCapturesResult = { removed: [], kept: 0 };
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // 目录不存在 = 从未捕获过，无需清理。
    return result;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (hasAssetAtPath(absolutePath)) {
      result.kept += 1;
      continue;
    }
    const info = await stat(absolutePath).catch(() => null);
    if (!info?.isFile()) continue;
    if (now - info.mtimeMs <= maxAgeMs) {
      // 在途或新近落盘：保留，等下次启动再判。
      result.kept += 1;
      continue;
    }
    await rm(absolutePath, { force: true }).catch(() => undefined);
    result.removed.push({ path: absolutePath, reason: "orphan-expired" });
  }
  return result;
}
