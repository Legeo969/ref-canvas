import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  BatchCollectionOp,
  CollectionRecord,
} from "../../../shared/contracts";

interface CollectionPersistenceRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  asset_count: number;
  lock_hash: string | null;
}

function lockHash(password: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update("\0")
    .update(password)
    .digest("hex");
}

export class CollectionsRepository {
  private readonly unlockedFolders = new Set<string>();

  constructor(private readonly db: Database.Database) {}

  list(): CollectionRecord[] {
    const rows = this.listWithDirectCounts();
    const directCounts = new Map(rows.map((row) => [row.id, row.asset_count]));
    const children = new Map<string | null, CollectionPersistenceRow[]>();
    for (const row of rows) {
      const siblings = children.get(row.parent_id) ?? [];
      siblings.push(row);
      children.set(row.parent_id, siblings);
    }
    const totals = new Map<string, number>();
    const countTree = (id: string, visiting = new Set<string>()): number => {
      if (totals.has(id)) return totals.get(id)!;
      if (visiting.has(id)) return directCounts.get(id) ?? 0;
      visiting.add(id);
      const total = (directCounts.get(id) ?? 0) +
        (children.get(id) ?? []).reduce(
          (sum, child) => sum + countTree(child.id, visiting),
          0,
        );
      visiting.delete(id);
      totals.set(id, total);
      return total;
    };
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      directAssetCount: row.asset_count,
      assetCount: countTree(row.id),
      locked: Boolean(row.lock_hash),
      createdAt: row.created_at,
    }));
  }

  create(title: string, parentId: string | null = null): CollectionRecord {
    if (parentId && !this.get(parentId)) {
      throw new Error("COLLECTION_PARENT_NOT_FOUND");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const nextOrder = (this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM collections WHERE parent_id IS ?
    `).get(parentId) as { value: number }).value;
    this.db.prepare(
      `INSERT INTO collections
        (id, title, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, title, parentId, nextOrder, createdAt);
    return this.get(id)!;
  }

  get(id: string): CollectionRecord | null {
    return this.list().find((collection) => collection.id === id) ?? null;
  }

  findOrCreate(title: string, parentId: string | null = null): CollectionRecord {
    const existing = this.list().find(
      (collection) =>
        collection.parentId === parentId &&
        collection.title.localeCompare(title, undefined, { sensitivity: "accent" }) === 0,
    );
    return existing ?? this.create(title, parentId);
  }

  findOrCreateId(title: string, parentId: string | null = null): string {
    const existing = this.db.prepare(`
      SELECT id FROM collections
      WHERE parent_id IS ? AND title = ? COLLATE NOCASE
      LIMIT 1
    `).get(parentId, title) as { id: string } | undefined;
    if (existing) return existing.id;
    if (
      parentId &&
      !this.db.prepare("SELECT 1 FROM collections WHERE id = ?").get(parentId)
    ) {
      throw new Error("COLLECTION_PARENT_NOT_FOUND");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const nextOrder = (this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM collections WHERE parent_id IS ?
    `).get(parentId) as { value: number }).value;
    this.db.prepare(
      `INSERT INTO collections
        (id, title, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, title, parentId, nextOrder, createdAt);
    return id;
  }

  update(
    id: string,
    patch: { title?: string; parentId?: string | null; sortOrder?: number },
  ): CollectionRecord {
    const current = this.get(id);
    if (!current) throw new Error("COLLECTION_NOT_FOUND");
    const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
    if (parentId === id) throw new Error("COLLECTION_CYCLE");
    if (parentId) {
      if (!this.get(parentId)) throw new Error("COLLECTION_PARENT_NOT_FOUND");
      if (new Set(this.descendantIds(id)).has(parentId)) {
        throw new Error("COLLECTION_CYCLE");
      }
    }
    this.db.prepare(`
      UPDATE collections SET title = ?, parent_id = ?, sort_order = ? WHERE id = ?
    `).run(
      patch.title ?? current.title,
      parentId,
      patch.sortOrder ?? current.sortOrder,
      id,
    );
    return this.get(id)!;
  }

  delete(id: string): void {
    if (!this.get(id)) throw new Error("COLLECTION_NOT_FOUND");
    const ids = [id, ...this.descendantIds(id)];
    this.db.transaction(() => {
      for (const collectionId of ids.reverse()) {
        this.db.prepare(
          "DELETE FROM collection_refs WHERE collection_id = ?",
        ).run(collectionId);
        this.db.prepare("DELETE FROM collections WHERE id = ?").run(collectionId);
      }
    })();
  }

  batch(op: BatchCollectionOp): CollectionRecord[] {
    for (const title of op.create ?? []) this.create(title);
    for (const rename of op.rename ?? []) {
      if (this.get(rename.id)) this.update(rename.id, { title: rename.title });
    }
    for (const move of op.move ?? []) {
      if (this.get(move.id)) this.update(move.id, { parentId: move.parentId });
    }
    for (const reorder of op.reorder ?? []) {
      if (this.get(reorder.id)) this.update(reorder.id, { sortOrder: reorder.sortOrder });
    }
    return this.list();
  }

  setLock(
    id: string,
    password: string | null,
  ): { collectionId: string; locked: boolean } {
    if (!this.get(id)) throw new Error("COLLECTION_NOT_FOUND");
    if (password === null || password === "") {
      this.db.prepare(
        "UPDATE collections SET lock_hash = NULL WHERE id = ?",
      ).run(id);
      this.unlockedFolders.delete(id);
      return { collectionId: id, locked: false };
    }
    const salt = randomBytes(16).toString("hex");
    this.db.prepare(
      "UPDATE collections SET lock_hash = ? WHERE id = ?",
    ).run(`${salt}:${lockHash(password, salt)}`, id);
    return { collectionId: id, locked: true };
  }

  unlock(id: string, password: string): boolean {
    const row = this.db.prepare(
      "SELECT lock_hash FROM collections WHERE id = ?",
    ).get(id) as { lock_hash: string | null } | undefined;
    if (!row?.lock_hash) return true;
    const [salt, expected] = row.lock_hash.split(":");
    if (!salt || !expected) return false;
    if (lockHash(password, salt) !== expected) return false;
    this.unlockedFolders.add(id);
    return true;
  }

  isUnlocked(id: string): boolean {
    const row = this.db.prepare(
      "SELECT lock_hash FROM collections WHERE id = ?",
    ).get(id) as { lock_hash: string | null } | undefined;
    return !row?.lock_hash || this.unlockedFolders.has(id);
  }

  private listWithDirectCounts(): CollectionPersistenceRow[] {
    return this.db.prepare(`
      SELECT c.*, COUNT(CASE WHEN a.lifecycle = 'active' AND a.link_state = 'online' THEN 1 END) AS asset_count
      FROM collections c
      LEFT JOIN collection_refs ca ON ca.collection_id = c.id
      LEFT JOIN assets a ON a.id = ca.asset_id
      GROUP BY c.id ORDER BY c.sort_order, c.created_at
    `).all() as CollectionPersistenceRow[];
  }

  private descendantIds(id: string): string[] {
    const rows = this.db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM collections WHERE parent_id = ?
        UNION ALL
        SELECT c.id FROM collections c
        JOIN descendants d ON c.parent_id = d.id
      )
      SELECT id FROM descendants
    `).all(id) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
}
