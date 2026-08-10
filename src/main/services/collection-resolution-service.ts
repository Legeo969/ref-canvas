/**
 * 引用集合解析服务（found-clone.md §6.2）。
 *
 * 解析顺序固定：
 * 1. identityId 存在且指向可访问文件 → resolved。
 * 2. 挂载在线且 mountId + relativePath 存在，校验指纹后解析并刷新绝对路径。
 * 3. lastResolvedPath 存在且指纹匹配 → resolved。
 * 4. 在同一挂载的已索引文件中按指纹查找：唯一候选自动重定位；多个候选 →
 *    ambiguous；无候选 → missing。
 * 5. 挂载本身不可用 → offline，不降级为 missing。
 *
 * 自动解析只查已索引的 file_identities，不遍历未索引磁盘。
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import type { ReferenceCollectionItem } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { CollectionsRepository } from "../persistence/repositories/collections-repository-v17";
import { quickFingerprint } from "./library-service";

export interface ResolutionResult {
  item: ReferenceCollectionItem;
  /** 本次是否自动重定位（fingerprint 匹配 → 更新了路径）。 */
  relinked: boolean;
}

export class CollectionResolutionService {
  constructor(
    private readonly database: RefCanvasDatabase,
    private readonly collections: CollectionsRepository,
  ) {}

  /**
   * 批量解析集合内全部条目（并行 stat，不阻塞主线程）。
   * 只更新有变化的条目；无变化条目原样返回。
   */
  async resolveCollection(collectionId: string): Promise<ResolutionResult[]> {
    const items = this.collections.listItems(collectionId);
    return Promise.all(items.map((item) => this.resolveOne(item)));
  }

  private async resolveOne(item: ReferenceCollectionItem): Promise<ResolutionResult> {
    // 步骤 5：挂载不可用 → offline（不降级为 missing）。
    if (item.mountId) {
      const mount = this.database
        .listMountRoots()
        .find((candidate) => candidate.id === item.mountId);
      if (mount && mount.state !== "online") {
        if (item.state !== "offline") {
          this.collections.updateItem(item.id, { state: "offline" });
        }
        return { item: this.collections.getItem(item.id)!, relinked: false };
      }
    }

    // 步骤 1：identityId 指向可访问文件 → resolved。
    if (item.identityId) {
      const identity = this.database.getFileIdentityByRefId(item.identityId);
      if (identity) {
        const realPath = this.realPathFromIdentity(identity.pathKey, identity.rootPath);
        if (realPath) {
          const resolved = await this.resolveIdentityPath(
            item,
            realPath,
            identity.fingerprint,
            identity.mountId,
          );
          if (resolved) return resolved;
        }
      }
    }

    // 步骤 2：挂载在线且 mountId + relativePath 存在 → 校验指纹后解析。
    if (item.mountId && item.relativePath) {
      const mount = this.database
        .listMountRoots()
        .find((candidate) => candidate.id === item.mountId);
      if (mount && mount.state === "online") {
        const candidatePath = path.join(mount.path, item.relativePath);
        const candidateStat = await stat(candidatePath).catch(() => null);
        if (candidateStat?.isFile()) {
          const fingerprint = await quickFingerprint(candidatePath, candidateStat.size);
          if (!item.fingerprint || fingerprint === item.fingerprint) {
            return this.applyResolved(item, candidatePath, fingerprint);
          }
        }
      }
    }

    // 步骤 3：lastResolvedPath 存在且指纹匹配 → resolved。
    if (item.lastResolvedPath) {
      const current = await stat(item.lastResolvedPath).catch(() => null);
      if (current?.isFile()) {
        const fingerprint = item.fingerprint
          ? await quickFingerprint(item.lastResolvedPath, current.size)
          : null;
        if (!item.fingerprint || fingerprint === item.fingerprint) {
          return this.applyResolved(item, item.lastResolvedPath, item.fingerprint);
        }
      }
    }

    // 步骤 4：同一挂载的已索引文件中按指纹查找。
    if (item.fingerprint) {
      const matches: Array<{
        id: string;
        mountId: string | null;
        path: string;
      }> = [];
      for (const match of this.database.findIdentityByFingerprintAnySize(
        item.fingerprint,
      )) {
        if (item.mountId && match.mountId !== item.mountId) continue;
        const realPath = this.realPathFromIdentity(match.pathKey, match.rootPath);
        if (!realPath) continue;
        const matchStat = await stat(realPath).catch(() => null);
        if (matchStat?.isFile()) {
          matches.push({ id: match.id, mountId: match.mountId, path: realPath });
        }
      }
      if (matches.length === 1) {
        const match = matches[0];
        return this.applyResolved(item, match.path, item.fingerprint, {
          identityId: match.id,
          mountId: match.mountId,
          relativePath: this.relativePathForMount(match.path, match.mountId),
        });
      }
      if (matches.length > 1) {
        if (item.state !== "ambiguous") {
          this.collections.updateItem(item.id, { state: "ambiguous" });
        }
        return { item: this.collections.getItem(item.id)!, relinked: false };
      }
    }

    // 无候选 → missing。
    if (item.state !== "missing") {
      this.collections.updateItem(item.id, { state: "missing" });
    }
    return { item: this.collections.getItem(item.id)!, relinked: false };
  }

  /** pathKey 是全小写；用 root_path（原始大小写）还原真实路径。 */
  private realPathFromIdentity(pathKey: string, rootPath: string): string | null {
    const rootKey = rootPath.toLocaleLowerCase("en-US");
    if (!pathKey.startsWith(rootKey)) return null;
    const suffix = pathKey.slice(rootKey.length).replace(/^[\\/]+/, "");
    return suffix ? path.join(rootPath, suffix) : null;
  }

  private async resolveIdentityPath(
    item: ReferenceCollectionItem,
    candidatePath: string,
    candidateFingerprint: string,
    mountId: string | null,
  ): Promise<ResolutionResult | null> {
    const current = await stat(candidatePath).catch(() => null);
    if (!current?.isFile()) return null;
    const fingerprint = await quickFingerprint(candidatePath, current.size);
    if (fingerprint !== candidateFingerprint) return null;
    return this.applyResolved(item, candidatePath, candidateFingerprint, {
      mountId,
      relativePath: this.relativePathForMount(candidatePath, mountId),
    });
  }

  private async applyResolved(
    item: ReferenceCollectionItem,
    resolvedPath: string,
    fingerprint: string | null,
    identity?: {
      identityId?: string | null;
      mountId?: string | null;
      relativePath?: string | null;
    },
  ): Promise<ResolutionResult> {
    const pathKey = path.normalize(resolvedPath).toLocaleLowerCase("en-US");
    const identityId =
      identity && "identityId" in identity ? identity.identityId! : item.identityId;
    const mountId =
      identity && "mountId" in identity ? identity.mountId! : item.mountId;
    const relativePath =
      identity && "relativePath" in identity
        ? identity.relativePath!
        : item.relativePath;
    if (
      item.state === "resolved" &&
      item.lastResolvedPath === resolvedPath &&
      item.pathKey === pathKey &&
      item.fingerprint === fingerprint &&
      item.identityId === identityId &&
      item.mountId === mountId &&
      item.relativePath === relativePath
    ) {
      return { item, relinked: false };
    }
    this.collections.updateItem(item.id, {
      lastResolvedPath: resolvedPath,
      pathKey,
      fingerprint,
      identityId,
      mountId,
      relativePath,
      state: "resolved",
    });
    return { item: this.collections.getItem(item.id)!, relinked: true };
  }

  private relativePathForMount(
    filename: string,
    mountId: string | null,
  ): string | null {
    if (!mountId) return null;
    const mount = this.database
      .listMountRoots()
      .find((candidate) => candidate.id === mountId);
    if (!mount) return null;
    const relative = path.relative(mount.path, filename);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      return null;
    }
    return relative;
  }
}
