/**
 * 引用集合业务服务（found-clone.md §6）。
 *
 * 负责需要磁盘 IO 的集合操作：
 * - addPaths：为每个路径计算 quickFingerprint 并关联挂载引用（mountId +
 *   relativePath，最长前缀匹配），再落库；不移动/复制源文件（零拷贝）。
 * - resolveCollection：委托 CollectionResolutionService 按固定顺序解析。
 * - relink：手动重定位；指纹不一致时需 confirmFingerprintChange，否则拒绝。
 * - export：委托 CollectionExportService。
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  CollectionAddResult,
  ReferenceCollectionItem,
} from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { CollectionsRepository } from "../persistence/repositories/collections-repository-v17";
import { CollectionResolutionService } from "./collection-resolution-service";
import { CollectionExportService, type CollectionExportSnapshot } from "./collection-export-service";
import { quickFingerprint } from "./library-service";

export class CollectionService {
  private readonly resolution: CollectionResolutionService;
  private readonly exportService: CollectionExportService;

  constructor(
    private readonly database: RefCanvasDatabase,
    private readonly collections: CollectionsRepository,
  ) {
    this.resolution = new CollectionResolutionService(database, collections);
    this.exportService = new CollectionExportService(collections);
  }

  list(): ReturnType<CollectionsRepository["list"]> {
    return this.collections.list();
  }

  create(input: { parentId?: string | null; name: string }) {
    return this.collections.create(input);
  }

  update(id: string, patch: { name?: string; parentId?: string | null; sortOrder?: number }) {
    return this.collections.update(id, patch);
  }

  delete(id: string, options: { recursive: boolean }) {
    return this.collections.delete(id, options);
  }

  listItems(collectionId: string) {
    return this.collections.listItems(collectionId);
  }

  removeItems(collectionId: string, itemIds: string[]) {
    return this.collections.removeItems(collectionId, itemIds);
  }

  /** 添加路径（计算指纹 + 挂载关联）。同一路径重复添加返回原条目。 */
  async addPaths(
    collectionId: string,
    paths: string[],
  ): Promise<ReferenceCollectionItem[]> {
    return (await this.addPathsDetailed(collectionId, paths)).added;
  }

  /** 添加路径并报告被跳过的目录/缺失路径（供渲染层给出反馈）。 */
  async addPathsDetailed(
    collectionId: string,
    paths: string[],
  ): Promise<CollectionAddResult> {
    const enriched: Array<{ path: string; fingerprint: string | null }> = [];
    const skipped: CollectionAddResult["skipped"] = {
      directories: [],
      missing: [],
    };
    for (const filename of paths) {
      const resolved = path.resolve(filename);
      const info = await stat(resolved).catch(() => null);
      if (!info) {
        skipped.missing.push(resolved);
        continue;
      }
      if (!info.isFile()) {
        // 只接受真实文件（目录本身不加入，但向调用方报告以便反馈）。
        skipped.directories.push(resolved);
        continue;
      }
      const fingerprint = await quickFingerprint(resolved, info.size);
      enriched.push({ path: resolved, fingerprint });
    }
    if (enriched.length === 0) return { added: [], skipped };
    const mountRefs = this.mountRefsFor(enriched.map((entry) => entry.path));
    const results = this.database.transaction(() => {
      const added: ReferenceCollectionItem[] = [];
      for (const entry of enriched) {
        const mountRef = mountRefs.get(entry.path);
        if (mountRef) {
          added.push(
            this.collections.addIdentityItem(collectionId, {
              identityId: null,
              mountId: mountRef.mountId,
              relativePath: mountRef.relativePath,
              lastResolvedPath: entry.path,
              fingerprint: entry.fingerprint,
              state: "resolved",
            }),
          );
        } else {
          // 无挂载关联：走路径引用。
          const [item] = this.collections.addPaths(collectionId, [entry.path]);
          if (item) {
            this.collections.updateItem(item.id, { fingerprint: entry.fingerprint });
            added.push(this.collections.getItem(item.id)!);
          }
        }
      }
      return added;
    });
    return { added: results, skipped };
  }

  async resolveCollection(collectionId: string) {
    return this.resolution.resolveCollection(collectionId);
  }

  /**
   * 手动重定位。指纹不一致时要求 confirmFingerprintChange；确认后更新
   * 身份、挂载、路径与指纹。取消（未确认）时条目完全不变。
   */
  async relink(
    itemId: string,
    filename: string,
    confirmFingerprintChange: boolean,
  ): Promise<ReferenceCollectionItem> {
    const item = this.collections.getItem(itemId);
    if (!item) throw new Error("COLLECTION_ITEM_NOT_FOUND");
    const resolved = path.resolve(filename);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) throw new Error("RELINE_TARGET_NOT_FILE");
    const fingerprint = await quickFingerprint(resolved, info.size);
    if (item.fingerprint && fingerprint !== item.fingerprint) {
      if (!confirmFingerprintChange) {
        throw new Error("RELINE_FINGERPRINT_CHANGED");
      }
    }
    const mountRefs = this.mountRefsFor([resolved]);
    const mountRef = mountRefs.get(resolved);
    return this.database.transaction(() =>
      this.collections.updateItem(itemId, {
        // 手动选择的是新的磁盘身份。若目标不在任何挂载下，必须清掉旧的
        // identity/mount 元数据，避免下次解析又跳回旧文件。
        identityId: null,
        mountId: mountRef?.mountId ?? null,
        relativePath: mountRef?.relativePath ?? null,
        lastResolvedPath: resolved,
        pathKey: path.normalize(resolved).toLocaleLowerCase("en-US"),
        fingerprint,
        state: "resolved",
      }),
    );
  }

  export(
    collectionId: string,
    targetDirectory: string,
    options?: { jobId?: string },
  ): Promise<CollectionExportSnapshot> {
    return this.exportService.export(collectionId, targetDirectory, options);
  }

  /** 取消进行中的导出（jobId 为 export 返回的 id）；已复制文件保留。 */
  cancelExport(jobId: string): boolean {
    return this.exportService.cancel(jobId);
  }

  /** 路径 → 挂载引用（最长路径前缀优先）。 */
  private mountRefsFor(
    paths: string[],
  ): Map<string, { mountId: string; relativePath: string }> {
    const mounts = this.database
      .listMountRoots()
      .filter((mount) => mount.state === "online")
      .sort((a, b) => b.path.length - a.path.length);
    const result = new Map<string, { mountId: string; relativePath: string }>();
    for (const filename of paths) {
      const mount = mounts.find(
        (candidate) =>
          filename === candidate.path ||
          filename.startsWith(`${candidate.path}${path.sep}`),
      );
      if (mount) {
        result.set(filename, {
          mountId: mount.id,
          relativePath: path.relative(mount.path, filename),
        });
      }
    }
    return result;
  }
}
