import Sqlite, { type Database as SqliteDatabase } from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import {
  MIGRATIONS,
  runMigrationSteps,
} from "../../../src/main/persistence/repositories/migration-repository";

const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      // Windows 上 WAL -shm/-wal 句柄释放有延迟，短暂等待后重试。
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeDirectory));
});

/** 在 schema 15 上放入带数据的旧集合表，模拟升级前用户库。 */
function seedV15Collections(db: SqliteDatabase): void {
  db.prepare(`
    INSERT INTO collections (id, title, parent_id, sort_order, lock_hash, created_at)
    VALUES ('c1', '灵感', NULL, 0, NULL, '2026-08-01T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO collections (id, title, parent_id, sort_order, lock_hash, created_at)
    VALUES ('c2', '角色', 'c1', 1, NULL, '2026-08-01T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO collection_refs
      (id, collection_id, asset_id, mount_id, relative_path, fingerprint, state)
    VALUES ('r1', 'c1', NULL, 'm1', 'a.png', 'fp-a', 'resolved')
  `).run();
  db.prepare(`
    INSERT INTO collection_refs
      (id, collection_id, asset_id, mount_id, relative_path, fingerprint, state)
    VALUES ('r2', 'c2', NULL, 'm1', 'b.png', 'fp-b', 'missing')
  `).run();
}

describe("schema 17 collection restore（FND-001 §6.4）", () => {
  it("schema 13 数据库可事务性升级到 17，集合/条目为空但表已建立", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v13-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "v13.db");
    // 用真实迁移步骤构建一个停在 schema 13 的库。
    const seed = new Sqlite(filename);
    const up = runMigrationSteps(
      seed,
      MIGRATIONS.filter((step) => step.version <= 13),
    );
    expect(up.completed).toBe(true);
    expect(up.finalVersion).toBe(13);
    seed.close();

    const db = new RefCanvasDatabase(filename);
    try {
      expect(db.getSchemaVersion()).toBe(17);
      const raw = new Sqlite(filename, { readonly: true });
      try {
        const tables = raw
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('collections', 'collection_items', 'ai_jobs')",
          )
          .all() as Array<{ name: string }>;
        expect(tables.map((item) => item.name).sort()).toEqual([
          "ai_jobs",
          "collection_items",
          "collections",
        ]);
        expect(
          (raw.prepare("SELECT COUNT(*) AS c FROM collections").get() as { c: number }).c,
        ).toBe(0);
      } finally {
        raw.close();
      }
    } finally {
      db.close();
    }
  });

  it("schema 15 非空集合升级到 17：层级、条目与路径计数与迁移前一致，且幂等重跑", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v15-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "v15.db");
    const full = new Sqlite(filename);
    const up15 = runMigrationSteps(
      full,
      MIGRATIONS.filter((step) => step.version <= 15),
    );
    expect(up15.completed).toBe(true);
    expect(up15.finalVersion).toBe(15);
    // mount root 与资产身份，让 collection_refs 能解析出真实路径。
    full.prepare(`
      INSERT INTO mount_roots (id, path, display_name, state, last_seen_at)
      VALUES ('m1', 'D:\\refs', 'refs', 'online', '2026-08-01T00:00:00.000Z')
    `).run();
    seedV15Collections(full);
    full.close();

    const db = new RefCanvasDatabase(filename);
    try {
      expect(db.getSchemaVersion()).toBe(17);
      const raw = new Sqlite(filename, { readonly: true });
      try {
        const collections = raw
          .prepare(
            "SELECT id, parent_id, name, sort_order FROM collections ORDER BY sort_order",
          )
          .all();
        expect(collections).toEqual([
          { id: "c1", parent_id: null, name: "灵感", sort_order: 0 },
          { id: "c2", parent_id: "c1", name: "角色", sort_order: 1 },
        ]);
        const items = raw
          .prepare(
            "SELECT collection_id, last_resolved_path, path_key, state FROM collection_items ORDER BY collection_id",
          )
          .all() as Array<{
          collection_id: string;
          last_resolved_path: string;
          path_key: string;
          state: string;
        }>;
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
          collection_id: "c1",
          last_resolved_path: "D:\\refs\\a.png",
          state: "resolved",
        });
        expect(items[0].path_key).toBe("d:\\refs\\a.png");
        expect(items[1]).toMatchObject({
          collection_id: "c2",
          state: "missing",
        });
      } finally {
        raw.close();
      }
    } finally {
      db.close();
    }

    // 幂等：再次打开不新增行。
    const reopen = new RefCanvasDatabase(filename);
    try {
      expect(reopen.getSchemaVersion()).toBe(17);
      const raw = new Sqlite(filename, { readonly: true });
      try {
        expect(
          (raw.prepare("SELECT COUNT(*) AS c FROM collections").get() as { c: number }).c,
        ).toBe(2);
        expect(
          (raw.prepare("SELECT COUNT(*) AS c FROM collection_items").get() as {
            c: number;
          }).c,
        ).toBe(2);
      } finally {
        raw.close();
      }
    } finally {
      reopen.close();
    }
  });

  it("v17 数据库的 user_version 被降级后重跑迁移不会删除当前集合", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v17-repair-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "app.db");
    const original = new RefCanvasDatabase(filename);
    const collection = original.collections().create({ name: "保留我" });
    original.collections().addPaths(collection.id, [path.join(directory, "missing.png")]);
    original.close();

    const damaged = new Sqlite(filename);
    damaged.pragma("user_version = 15");
    damaged.close();

    const repaired = new RefCanvasDatabase(filename);
    try {
      expect(repaired.getSchemaVersion()).toBe(17);
      expect(repaired.collections().get(collection.id)?.name).toBe("保留我");
      expect(repaired.collections().listItems(collection.id)).toHaveLength(1);
    } finally {
      repaired.close();
    }
  });

  it("旧构建破坏性 v16（无归档）+ 迁移前快照：从快照恢复", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v16snap-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "app.db");
    const backups = path.join(directory, "backups");
    // 1) 建一个真实 schema 15 库，模拟旧构建的升级前状态。
    const seed = new Sqlite(filename);
    runMigrationSteps(seed, MIGRATIONS.filter((step) => step.version <= 15));
    seed.close();
    // 2) 模拟旧构建破坏性 v16：删除集合表并把 user_version 升到 16。
    const destroyed = new Sqlite(filename);
    destroyed.exec(`
      DROP TABLE IF EXISTS collections;
      DROP TABLE IF EXISTS collection_refs;
      DROP TABLE IF EXISTS collection_assets;
      DROP TABLE IF EXISTS collection_sources;
    `);
    destroyed.pragma("user_version = 16");
    destroyed.close();
    // 3) 制造一份含集合数据的 migrate-v15-to-v16 快照（旧构建 v15→v16 前备份）。
    const snapshotName = "migrate-v15-to-v16-" + Date.now() + ".db";
    const snapshotPath = path.join(backups, snapshotName);
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(backups, { recursive: true }),
    );
    const snap = new Sqlite(snapshotPath);
    snap.pragma("user_version = 15");
    snap.exec(`
      CREATE TABLE collections (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0, lock_hash TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE collection_refs (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        asset_id TEXT,
        mount_id TEXT,
        relative_path TEXT,
        fingerprint TEXT,
        state TEXT NOT NULL DEFAULT 'resolved'
      );
      CREATE TABLE mount_roots (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        volume_id TEXT, state TEXT NOT NULL DEFAULT 'online', last_seen_at TEXT
      );
    `);
    snap.prepare(`
      INSERT INTO collections VALUES
        ('c1', '存档', NULL, 0, NULL, '2026-07-01T00:00:00.000Z'),
        ('c2', '子存档', 'c1', 1, NULL, '2026-07-01T00:00:00.000Z')
    `).run();
    snap.prepare(`
      INSERT INTO mount_roots VALUES
        ('m9', 'D:\\archive', 'archive', NULL, 'online', '2026-07-01T00:00:00.000Z')
    `).run();
    snap.prepare(`
      INSERT INTO collection_refs (id, collection_id, asset_id, mount_id, relative_path, fingerprint, state)
      VALUES ('r9', 'c1', NULL, 'm9', 'x.png', 'fp-x', 'resolved')
    `).run();
    snap.close();

    const db = new RefCanvasDatabase(filename, { migrationBackupDirectory: backups });
    try {
      expect(db.getSchemaVersion()).toBe(17);
      const raw = new Sqlite(filename, { readonly: true });
      try {
        const collections = raw
          .prepare("SELECT id, parent_id, name FROM collections ORDER BY sort_order")
          .all();
        expect(collections).toEqual([
          { id: "c1", parent_id: null, name: "存档" },
          { id: "c2", parent_id: "c1", name: "子存档" },
        ]);
        const items = raw
          .prepare("SELECT collection_id, fingerprint, state FROM collection_items")
          .all();
        expect(items).toEqual([
          { collection_id: "c1", fingerprint: "fp-x", state: "resolved" },
        ]);
      } finally {
        raw.close();
      }
      // 无 dataLoss 说明（数据已恢复）。
      expect(db.getSetting("collections.v16.dataLossNotice", null)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("旧构建破坏性 v16 且无快照：建空集合表并写入一次性 dataLoss 说明", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v16loss-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "app.db");
    // 造一个 schema 15 库并模拟旧 v16 破坏（无备份目录 → 无快照）。
    const seed = new Sqlite(filename);
    runMigrationSteps(seed, MIGRATIONS.filter((step) => step.version <= 15));
    seed.exec(`
      DROP TABLE IF EXISTS collections;
      DROP TABLE IF EXISTS collection_refs;
      DROP TABLE IF EXISTS collection_assets;
      DROP TABLE IF EXISTS collection_sources;
    `);
    seed.pragma("user_version = 16");
    seed.close();

    const db = new RefCanvasDatabase(filename);
    try {
      expect(db.getSchemaVersion()).toBe(17);
      const raw = new Sqlite(filename, { readonly: true });
      try {
        expect(
          (raw.prepare("SELECT COUNT(*) AS c FROM collections").get() as { c: number }).c,
        ).toBe(0);
      } finally {
        raw.close();
      }
      // 一次性、事实准确的恢复说明。
      const notice = db.getSetting("collections.v16.dataLossNotice", null) as {
        notice?: string;
        detail?: string;
      } | null;
      expect(notice).not.toBeNull();
      expect(notice?.notice).toBe("collections.v16.dataLoss");
      expect(notice?.detail).toContain("无法恢复");
    } finally {
      db.close();
    }
  });

  it("v17 导入失败时事务回滚，user_version 不前进，v17 表未落库", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v17rollback-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "app.db");
    // 造一个 v15 库并注入集合数据（走归档路径导入）。
    const seed = new Sqlite(filename);
    const up = runMigrationSteps(
      seed,
      MIGRATIONS.filter((step) => step.version <= 15),
    );
    expect(up.completed).toBe(true);
    seed.prepare(`
      INSERT INTO collections (id, title, parent_id, sort_order, lock_hash, created_at)
      VALUES ('c1', '灵感', NULL, 0, NULL, '2026-08-01T00:00:00.000Z')
    `).run();
    seed.close();

    // 破坏归档表结构：collection_refs 归档表缺 state 列，令 v17 导入抛错。
    const sabotage = new Sqlite(filename);
    sabotage.exec("ALTER TABLE collection_refs RENAME TO _legacy_collection_refs_v16");
    sabotage.exec("ALTER TABLE collections RENAME TO _legacy_collections_v16");
    sabotage.exec("ALTER TABLE _legacy_collection_refs_v16 DROP COLUMN state");
    sabotage.close();

    // 直接调用 v17 步骤（迁移 runner 事务包裹），观察回滚。
    const v17Step = MIGRATIONS.find((step) => step.version === 17)!;
    const attempt = new Sqlite(filename);
    attempt.pragma("user_version = 16");
    let threw = false;
    try {
      attempt.transaction(() => {
        v17Step.apply(attempt, { migrationBackupDirectory: undefined });
        attempt.pragma("user_version = 17");
      })();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // user_version 保持 16，v17 表未落库（事务回滚）。
    expect(attempt.pragma("user_version", { simple: true })).toBe(16);
    const tableNames = attempt
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_jobs'",
      )
      .all();
    expect(tableNames).toHaveLength(0);
    attempt.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 原库仍可打开并再次升级（先修好归档表 → 导入可重试）。
    const repaired = new Sqlite(filename);
    repaired.exec("ALTER TABLE _legacy_collection_refs_v16 RENAME TO collection_refs");
    repaired.exec("ALTER TABLE _legacy_collections_v16 RENAME TO collections");
    repaired.close();
    const recovered = new RefCanvasDatabase(filename);
    try {
      expect(recovered.getSchemaVersion()).toBe(17);
      expect(
        (recovered.getSetting("collections.v16.dataLossNotice", null) ? 1 : 0),
      ).toBe(0);
      const raw = new Sqlite(filename, { readonly: true });
      try {
        expect(
          (raw.prepare("SELECT COUNT(*) AS c FROM collections").get() as { c: number }).c,
        ).toBe(1);
      } finally {
        raw.close();
      }
    } finally {
      recovered.close();
    }
  });
});
