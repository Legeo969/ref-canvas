/**
 * 引用集合仓储（schema 17，§6.1/§6.3）。
 *
 * `collections` 为自引用树（parent_id 默认拒绝删除非空父集合）；
 * `collection_items` 只对 collection_id 级联删除，不依赖 assets.id 存活；
 * 同一集合同一规范化 path_key 只保留一项（重复添加返回原条目）。
 */
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  CollectionItemState,
  ReferenceCollection,
  ReferenceCollectionItem,
} from "../../../shared/contracts";

interface CollectionRow {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface CollectionItemRow {
  id: string;
  collection_id: string;
  identity_id: string | null;
  mount_id: string | null;
  relative_path: string | null;
  last_resolved_path: string;
  path_key: string;
  fingerprint: string | null;
  state: CollectionItemState;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function normalizePathKey(filename: string): string {
  return path.normalize(filename).toLocaleLowerCase("en-US");
}

export class CollectionsRepository {
  constructor(private readonly db: Database.Database) {}

  private mapCollection(row: CollectionRow): ReferenceCollection {
    return {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapItem(row: CollectionItemRow): ReferenceCollectionItem {
    return {
      id: row.id,
      collectionId: row.collection_id,
      identityId: row.identity_id,
      mountId: row.mount_id,
      relativePath: row.relative_path,
      lastResolvedPath: row.last_resolved_path,
      pathKey: row.path_key,
      fingerprint: row.fingerprint,
      state: row.state,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): ReferenceCollection[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM collections ORDER BY parent_id, sort_order, created_at, id",
      )
      .all() as CollectionRow[];
    return rows.map((row) => this.mapCollection(row));
  }

  get(id: string): ReferenceCollection | null {
    const row = this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as
      | CollectionRow
      | undefined;
    return row ? this.mapCollection(row) : null;
  }

  getByParentAndName(parentId: string | null, name: string): ReferenceCollection | null {
    const row = this.db
      .prepare(
        "SELECT * FROM collections WHERE parent_id IS ? AND name = ? COLLATE NOCASE",
      )
      .get(parentId, name) as CollectionRow | undefined;
    return row ? this.mapCollection(row) : null;
  }

  childrenOf(id: string): ReferenceCollection[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM collections WHERE parent_id = ? ORDER BY sort_order, created_at, id",
      )
      .all(id) as CollectionRow[];
    return rows.map((row) => this.mapCollection(row));
  }

  create(input: { parentId?: string | null; name: string }): ReferenceCollection {
    const name = input.name.trim();
    if (!name || name.length > 256) throw new Error("COLLECTION_INVALID_NAME");
    const parentId = input.parentId ?? null;
    if (parentId && !this.get(parentId)) {
      throw new Error("COLLECTION_PARENT_NOT_FOUND");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const nextOrder = (
      this.db
        .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS v FROM collections WHERE parent_id IS ?")
        .get(parentId) as { v: number }
    ).v;
    this.db
      .prepare(
        "INSERT INTO collections (id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, parentId, name, nextOrder, now, now);
    return this.get(id)!;
  }

  update(
    id: string,
    patch: { name?: string; parentId?: string | null; sortOrder?: number },
  ): ReferenceCollection {
    const current = this.get(id);
    if (!current) throw new Error("COLLECTION_NOT_FOUND");
    const name = patch.name !== undefined ? patch.name.trim() : current.name;
    if (!name || name.length > 256) throw new Error("COLLECTION_INVALID_NAME");
    const parentId =
      patch.parentId !== undefined ? (patch.parentId ?? null) : current.parentId;
    if (parentId) {
      if (!this.get(parentId)) throw new Error("COLLECTION_PARENT_NOT_FOUND");
      // 不能把集合移到自身或其子孙之下（防环）。
      let cursor: string | null = parentId;
      const visited = new Set<string>();
      while (cursor) {
        if (cursor === id) throw new Error("COLLECTION_CYCLE");
        if (visited.has(cursor)) throw new Error("COLLECTION_CYCLE");
        visited.add(cursor);
        const parent = this.get(cursor);
        cursor = parent?.parentId ?? null;
      }
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE collections SET name = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, parentId, patch.sortOrder ?? current.sortOrder, now, id);
    return this.get(id)!;
  }

  /** 删除集合。非空（含子集合或条目）时默认拒绝；recursive 才显式递归删除。 */
  delete(id: string, options: { recursive: boolean }): void {
    const current = this.get(id);
    if (!current) throw new Error("COLLECTION_NOT_FOUND");
    const childCount = this.childrenOf(id).length;
    const itemCount = this.listItemCount(id);
    if (!options.recursive && (childCount > 0 || itemCount > 0)) {
      throw new Error("COLLECTION_NOT_EMPTY");
    }
    const run = this.db.transaction(() => {
      if (options.recursive) {
        const stack = [id];
        const descendants: string[] = [];
        while (stack.length) {
          const currentId = stack.pop()!;
          descendants.push(currentId);
          for (const child of this.childrenOf(currentId)) stack.push(child.id);
        }
        // parent_id 使用 ON DELETE RESTRICT；必须先删最深层子集合。
        for (const currentId of descendants.reverse()) {
          this.db.prepare("DELETE FROM collection_items WHERE collection_id = ?").run(currentId);
          this.db.prepare("DELETE FROM collections WHERE id = ?").run(currentId);
        }
      } else {
        this.db.prepare("DELETE FROM collection_items WHERE collection_id = ?").run(id);
        this.db.prepare("DELETE FROM collections WHERE id = ?").run(id);
      }
    });
    run();
  }

  // --- collection_items ---

  listItems(collectionId: string): ReferenceCollectionItem[] {
    if (!this.get(collectionId)) throw new Error("COLLECTION_NOT_FOUND");
    const rows = this.db
      .prepare(
        "SELECT * FROM collection_items WHERE collection_id = ? ORDER BY sort_order, created_at, id",
      )
      .all(collectionId) as CollectionItemRow[];
    return rows.map((row) => this.mapItem(row));
  }

  listItemCount(collectionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM collection_items WHERE collection_id = ?")
      .get(collectionId) as { c: number };
    return row.c;
  }

  getItem(itemId: string): ReferenceCollectionItem | null {
    const row = this.db
      .prepare("SELECT * FROM collection_items WHERE id = ?")
      .get(itemId) as CollectionItemRow | undefined;
    return row ? this.mapItem(row) : null;
  }

  /**
   * 添加磁盘路径到集合。同一集合相同规范化 path_key 只保留一项；
   * 重复添加返回原条目。路径不移动/复制（零拷贝引用）。
   */
  addPaths(collectionId: string, paths: string[]): ReferenceCollectionItem[] {
    if (!this.get(collectionId)) throw new Error("COLLECTION_NOT_FOUND");
    const now = new Date().toISOString();
    const run = this.db.transaction((inputs: string[]) => {
      const results: ReferenceCollectionItem[] = [];
      let order = this.listItemCount(collectionId);
      for (const filename of inputs) {
        const resolved = path.resolve(filename);
        const pathKey = normalizePathKey(resolved);
        const existing = this.db
          .prepare(
            "SELECT * FROM collection_items WHERE collection_id = ? AND path_key = ?",
          )
          .get(collectionId, pathKey) as CollectionItemRow | undefined;
        if (existing) {
          results.push(this.mapItem(existing));
          continue;
        }
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO collection_items
              (id, collection_id, identity_id, mount_id, relative_path,
               last_resolved_path, path_key, fingerprint, state, sort_order,
               created_at, updated_at)
             VALUES (?, ?, NULL, NULL, NULL, ?, ?, NULL, 'resolved', ?, ?, ?)`,
          )
          .run(id, collectionId, resolved, pathKey, order, now, now);
        order += 1;
        results.push(this.getItem(id)!);
      }
      return results;
    });
    return run(paths);
  }

  /** 按 identity 引用添加（v15 迁移/资产引用路径，identityId 可空）。 */
  addIdentityItem(
    collectionId: string,
    input: {
      identityId: string | null;
      mountId: string | null;
      relativePath: string | null;
      lastResolvedPath: string;
      fingerprint: string | null;
      state: CollectionItemState;
    },
  ): ReferenceCollectionItem {
    if (!this.get(collectionId)) throw new Error("COLLECTION_NOT_FOUND");
    const now = new Date().toISOString();
    const pathKey = normalizePathKey(input.lastResolvedPath);
    const existing = this.db
      .prepare(
        "SELECT * FROM collection_items WHERE collection_id = ? AND path_key = ?",
      )
      .get(collectionId, pathKey) as CollectionItemRow | undefined;
    if (existing) return this.mapItem(existing);
    const id = randomUUID();
    const order = this.listItemCount(collectionId);
    this.db
      .prepare(
        `INSERT INTO collection_items
          (id, collection_id, identity_id, mount_id, relative_path,
           last_resolved_path, path_key, fingerprint, state, sort_order,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        collectionId,
        input.identityId,
        input.mountId,
        input.relativePath,
        input.lastResolvedPath,
        pathKey,
        input.fingerprint,
        input.state,
        order,
        now,
        now,
      );
    return this.getItem(id)!;
  }

  removeItems(collectionId: string, itemIds: string[]): void {
    if (!this.get(collectionId)) throw new Error("COLLECTION_NOT_FOUND");
    const run = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.db
          .prepare(
            "DELETE FROM collection_items WHERE id = ? AND collection_id = ?",
          )
          .run(id, collectionId);
      }
    });
    run(itemIds);
  }

  /** 更新条目解析结果（路径/指纹/挂载/状态）。 */
  updateItem(
    itemId: string,
    patch: {
      identityId?: string | null;
      mountId?: string | null;
      relativePath?: string | null;
      lastResolvedPath?: string;
      pathKey?: string;
      fingerprint?: string | null;
      state?: CollectionItemState;
    },
  ): ReferenceCollectionItem {
    const current = this.getItem(itemId);
    if (!current) throw new Error("COLLECTION_ITEM_NOT_FOUND");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE collection_items SET
           identity_id = ?, mount_id = ?, relative_path = ?,
           last_resolved_path = ?, path_key = ?, fingerprint = ?,
           state = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.identityId !== undefined ? patch.identityId : current.identityId,
        patch.mountId !== undefined ? patch.mountId : current.mountId,
        patch.relativePath !== undefined ? patch.relativePath : current.relativePath,
        patch.lastResolvedPath ?? current.lastResolvedPath,
        patch.pathKey ?? current.pathKey,
        patch.fingerprint !== undefined ? patch.fingerprint : current.fingerprint,
        patch.state ?? current.state,
        now,
        itemId,
      );
    return this.getItem(itemId)!;
  }

  touchItem(itemId: string): void {
    this.db
      .prepare("UPDATE collection_items SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), itemId);
  }
}
