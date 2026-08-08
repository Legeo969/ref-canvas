/**
 * 集合导出服务（found-clone.md §6.3）。
 *
 * - 只复制 `resolved` 条目；不移动源文件。
 * - 重名默认生成 `name (2).ext`，绝不覆盖目标文件。
 * - 导出目录写入 `.refcanvas-collection.json` 清单：集合层级、原引用、
 *   导出相对路径、跳过原因与导出时间。
 * - 部分失败不回滚已成功复制的文件；返回 copied/skipped/failed 摘要。
 */
import { constants, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CollectionExportSnapshot,
  ReferenceCollectionItem,
} from "../../shared/contracts";
import type { CollectionsRepository } from "../persistence/repositories/collections-repository-v17";

export type { CollectionExportSnapshot } from "../../shared/contracts";

export interface CollectionExportOptions {
  /** 已存在的同名文件使用编号（默认 true）。 */
  conflictRename?: boolean;
}

export interface CollectionManifest {
  format: "refcanvas-collection";
  version: 1;
  exportedAt: string;
  sourceCollectionId: string;
  sourceName: string;
  hierarchy: Array<{ id: string; parentId: string | null; name: string }>;
  entries: Array<{
    itemId: string;
    collectionId: string;
    sourcePath: string;
    relativePath: string;
    fingerprint: string | null;
    state: ReferenceCollectionItem["state"];
    reason: string | null;
  }>;
}

export class CollectionExportService {
  constructor(private readonly collections: CollectionsRepository) {}

  /**
   * 导出集合到目录。返回最终摘要快照；manifest 与文件写入都在同一个
   * 调用内完成（部分失败不清理已复制文件，符合 §6.3）。
   */
  async export(
    collectionId: string,
    targetDirectory: string,
    _options: CollectionExportOptions = {},
  ): Promise<CollectionExportSnapshot> {
    const collection = this.collections.get(collectionId);
    if (!collection) throw new Error("COLLECTION_NOT_FOUND");
    // 冲突重命名由 nextUnique 在导出前统一处理（不会覆盖已有文件）；
    // 当前实现恒为编号策略，conflictRename=false 语义留给后续调用方扩展。
    void _options;
    const hierarchy = this.collectionHierarchy(collectionId);
    const items = this.collections.listItems(collectionId);
    const resolvedItems = items.filter((item) => item.state === "resolved");

    const root = path.resolve(targetDirectory);
    await mkdir(root, { recursive: true });

    let copied = 0;
    let skipped = 0;
    let failed = 0;
    const entries: CollectionManifest["entries"] = [];
    // 磁盘上已存在的目标名（防止任何覆盖）。
    const onDisk = new Set(await readdir(root).catch(() => []));
    const takenNames = new Set(onDisk);

    for (const item of resolvedItems) {
      const source = item.lastResolvedPath;
      if (!source) {
        entries.push(this.entryFor(item, collectionId, "", "", null, "missing-source"));
        skipped += 1;
        continue;
      }
      const base = path.basename(source);
      const safeBase = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,191}$/.test(base)
        ? base
        : `item_${item.id.slice(0, 8)}.bin`;
      const unique = this.nextUnique(takenNames, safeBase);
      const relative = unique;
      const target = path.join(root, unique);
      if (target !== root && !target.startsWith(root + path.sep)) {
        entries.push(this.entryFor(item, collectionId, source, "", null, "path-escape"));
        skipped += 1;
        continue;
      }
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
        copied += 1;
        entries.push(this.entryFor(item, collectionId, source, relative, item.fingerprint, null));
      } catch {
        failed += 1;
        entries.push(this.entryFor(item, collectionId, source, relative, null, "copy-failed"));
      }
    }

    for (const item of items.filter((i) => i.state !== "resolved")) {
      entries.push(
        this.entryFor(item, collectionId, item.lastResolvedPath, "", item.fingerprint, `not-${item.state}`),
      );
      skipped += 1;
    }

    const manifest: CollectionManifest = {
      format: "refcanvas-collection",
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceCollectionId: collectionId,
      sourceName: collection.name,
      hierarchy,
      entries,
    };
    const manifestPath = path.join(root, ".refcanvas-collection.json");
    try {
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    } catch {
      // manifest 写入失败不阻塞文件复制结果；manifestPath 保留为 null 语义由
      // 调用方按 failed 状态处理。
      return {
        id: `export-${collectionId}-${Date.now()}`,
        collectionId,
        targetDirectory: root,
        state: failed > 0 ? "failed" : "completed",
        copied,
        skipped,
        failed,
        manifestPath: null,
        errorCode: "COLLECTION_MANIFEST_WRITE_FAILED",
        errorMessage: "清单写入失败，但已复制的文件保留",
      };
    }

    return {
      id: `export-${collectionId}-${Date.now()}`,
      collectionId,
      targetDirectory: root,
      state: failed > 0 ? "failed" : "completed",
      copied,
      skipped,
      failed,
      manifestPath,
      errorCode: failed > 0 ? "COLLECTION_EXPORT_PARTIAL_FAILURE" : null,
      errorMessage:
        failed > 0 ? `${failed} 个文件复制失败（已复制的文件保留）` : null,
    };
  }

  private entryFor(
    item: ReferenceCollectionItem,
    collectionId: string,
    sourcePath: string,
    relativePath: string,
    fingerprint: string | null,
    reason: string | null,
  ): CollectionManifest["entries"][number] {
    return {
      itemId: item.id,
      collectionId,
      sourcePath,
      relativePath,
      fingerprint,
      state: item.state,
      reason,
    };
  }

  private collectionHierarchy(collectionId: string): CollectionManifest["hierarchy"] {
    const ordered: Array<{ id: string; parentId: string | null; name: string }> = [];
    const seen = new Set<string>();
    const stack = [collectionId];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const collection = this.collections.get(id);
      if (!collection) continue;
      ordered.unshift({
        id: collection.id,
        parentId: collection.parentId,
        name: collection.name,
      });
      if (collection.parentId) stack.push(collection.parentId);
    }
    return ordered;
  }

  private nextUnique(taken: Set<string>, base: string): string {
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    const parsed = path.parse(base);
    let index = 2;
    let candidate = `${parsed.name} (${index})${parsed.ext}`;
    while (taken.has(candidate)) {
      index += 1;
      candidate = `${parsed.name} (${index})${parsed.ext}`;
    }
    taken.add(candidate);
    return candidate;
  }
}
