import Sqlite from "better-sqlite3";
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

describe("database migration", () => {
  it("archives legacy collection data and restores it at schema 17 without losing saved searches", () => {
    const database = new Sqlite(":memory:");
    try {
      const v15 = runMigrationSteps(
        database,
        MIGRATIONS.filter((step) => step.version <= 15),
      );
      expect(v15).toMatchObject({ completed: true, finalVersion: 15 });
      database.prepare(`
        INSERT INTO saved_views(id, title, search_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        "saved-search-1",
        "五星图片",
        JSON.stringify({ kind: "image", ratingMin: 5 }),
        "2026-08-05T00:00:00.000Z",
        "2026-08-05T00:00:00.000Z",
      );
      // v15 里放一份真实集合数据（含嵌套与条目），验证归档→恢复闭环。
      database.prepare(`
        INSERT INTO collections (id, title, parent_id, sort_order, lock_hash, created_at)
        VALUES (?, ?, NULL, 0, NULL, ?)
      `).run(
        "collection-1",
        "参考素材",
        "2026-08-05T00:00:00.000Z",
      );
      database.prepare(`
        INSERT INTO collections (id, title, parent_id, sort_order, lock_hash, created_at)
        VALUES (?, ?, ?, 1, NULL, ?)
      `).run(
        "collection-2",
        "子集",
        "collection-1",
        "2026-08-05T00:00:00.000Z",
      );
      database.prepare(`
        INSERT INTO collection_refs
          (id, collection_id, asset_id, mount_id, relative_path, fingerprint, state)
        VALUES (?, ?, NULL, NULL, NULL, 'fp-1', 'resolved')
      `).run("ref-1", "collection-1");

      const result = runMigrationSteps(database, MIGRATIONS);

      expect(result).toMatchObject({ completed: true, finalVersion: 17 });
      // v16（修订）把含数据的旧表改名归档，绝不无条件删除。
      const retiredTables = database
        .prepare(`
          SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'collection_sources', 'collection_refs',
              'collection_assets', 'collections'
            )
        `)
        .all();
      // v17 已按 schema 17 重建 collections；旧 collection_sources /
      // collection_refs / collection_assets 均已退役（归档或删除）。
      expect(retiredTables.map((row) => (row as { name: string }).name).sort()).toEqual([
        "collections",
      ]);
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM _legacy_collections_v16")
          .get(),
      ).toEqual({ count: 2 });
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM _legacy_collection_refs_v16")
          .get(),
      ).toEqual({ count: 1 });
      // v17 从归档恢复：层级、名称与条目都在。
      const collections = database
        .prepare(
          "SELECT id, parent_id, name, sort_order FROM collections ORDER BY sort_order",
        )
        .all();
      expect(collections).toEqual([
        { id: "collection-1", parent_id: null, name: "参考素材", sort_order: 0 },
        {
          id: "collection-2",
          parent_id: "collection-1",
          name: "子集",
          sort_order: 1,
        },
      ]);
      const items = database
        .prepare(
          "SELECT collection_id, fingerprint, state FROM collection_items",
        )
        .all();
      expect(items).toEqual([
        { collection_id: "collection-1", fingerprint: "fp-1", state: "resolved" },
      ]);
      // 重复执行迁移入口不产生重复行。
      const rerun = runMigrationSteps(database, MIGRATIONS);
      expect(rerun.completed).toBe(true);
      expect(rerun.finalVersion).toBe(17);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM collections").get(),
      ).toEqual({ count: 2 });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM collection_items").get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .prepare("SELECT title, search_json FROM saved_views WHERE id = ?")
          .get("saved-search-1"),
      ).toEqual({
        title: "五星图片",
        search_json: JSON.stringify({ kind: "image", ratingMin: 5 }),
      });
    } finally {
      database.close();
    }
  });

  it("upgrades the original schema without losing assets or boards", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-migrate-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "legacy.db");
    const legacy = new Sqlite(filename);
    legacy.exec(`
      CREATE TABLE assets (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
        path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE,
        extension TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms REAL NOT NULL,
        fingerprint TEXT NOT NULL, link_state TEXT NOT NULL DEFAULT 'online',
        notes TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER,
        duration REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE boards (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO assets VALUES (
        '00000000-0000-4000-8000-000000000001', 'Legacy', 'image',
        'D:\\legacy.png', 'd:\\legacy.png', 'png', 42, 1, 'legacy',
        'online', '', 10, 10, NULL, '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO boards VALUES (
        '00000000-0000-4000-8000-000000000002', 'Legacy board',
        '{"schemaVersion":1,"canvas":{"objects":[]}}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const migrated = new RefCanvasDatabase(filename);
    try {
      expect(migrated.getSchemaVersion()).toBe(17);
      expect(migrated.searchAssets().items[0]).toMatchObject({
        title: "Legacy",
        lifecycle: "active",
        favorite: false,
        rating: 0,
      });
      expect(
        migrated.loadBoard("00000000-0000-4000-8000-000000000002")
          ?.document,
      ).toMatchObject({
        schemaVersion: 3,
        windowMode: "normal",
        canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
        appearance: {
          backgroundColor: "#202426",
          gridVisible: true,
          gridSize: 24,
        },
      });
      expect(migrated.listTagGroups()).toEqual([]);
      const verification = new Sqlite(filename, { readonly: true });
      try {
        const columns = verification.pragma("table_info(assets)") as Array<{
          name: string;
        }>;
        expect(columns.map((column) => column.name)).toEqual(
          expect.arrayContaining(["dominant_r", "dominant_g", "dominant_b"]),
        );
        const storageColumns = verification.pragma("table_info(assets)") as Array<{
          name: string;
        }>;
        expect(storageColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "storage_mode",
            "library_relative_path",
            "original_source_path",
          ]),
        );
        const identityTables = verification
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('file_identities', 'reconcile_queue')",
          )
          .all() as Array<{ name: string }>;
        expect(identityTables.map((item) => item.name).sort()).toEqual([
          "file_identities",
          "reconcile_queue",
        ]);
        const annotationColumns = verification.pragma(
          "table_info(asset_annotations)",
        ) as Array<{ name: string }>;
        expect(annotationColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining(["asset_id", "x", "y", "text"]),
        );
      } finally {
        verification.close();
      }
    } finally {
      migrated.close();
    }
  });

  it("upgrades V1/V2 boards to V3 deterministically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v3-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "v3.db");
    const legacy = new Sqlite(filename);
    legacy.exec(`
      CREATE TABLE boards (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO boards VALUES (
        '00000000-0000-4000-8000-000000000001', 'V1 board',
        '{"schemaVersion":1,"canvas":{"objects":[{"type":"rect"}]}}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO boards VALUES (
        '00000000-0000-4000-8000-000000000002', 'V2 board',
        '{"schemaVersion":2,"canvas":{"objects":[]},"viewport":{"transform":[1,0,0,1,10,20],"zoom":1.5},"guides":{"x":[5],"y":[7]},"appearance":{"backgroundColor":"#123456","gridVisible":false,"gridSize":36}}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const migrated = new RefCanvasDatabase(filename);
    try {
      expect(migrated.getSchemaVersion()).toBe(17);
      const v1 = migrated.loadBoard("00000000-0000-4000-8000-000000000001")!;
      expect(v1.document.schemaVersion).toBe(3);
      expect(v1.document.windowMode).toBe("normal");
      expect(v1.document.canvasMode).toEqual({
        locked: false,
        grayscale: false,
        gridStyle: "line",
      });
      expect(v1.document.sampling).toBe("bilinear");
      // V2 的 viewport/guides/appearance 保留。
      const v2 = migrated.loadBoard("00000000-0000-4000-8000-000000000002")!;
      expect(v2.document.viewport.zoom).toBe(1.5);
      expect(v2.document.guides).toEqual({ x: [5], y: [7] });
      expect(v2.document.appearance).toEqual({
        backgroundColor: "#123456",
        gridVisible: false,
        gridSize: 36,
      });
      // 确定性：重复迁移输出不变。
      const first = JSON.stringify(
        migrated.loadBoard("00000000-0000-4000-8000-000000000002")!.document,
      );
      const second = JSON.stringify(
        migrated.loadBoard("00000000-0000-4000-8000-000000000002")!.document,
      );
      expect(first).toBe(second);
    } finally {
      migrated.close();
    }
  });

  it("adds v14 native-filesystem tables and drops collection_sources", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-v14-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "v14.db");
    const legacy = new Sqlite(filename);
    legacy.exec(`
      CREATE TABLE file_identities (
        path_key TEXT PRIMARY KEY, asset_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, size INTEGER NOT NULL,
        root_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE collection_sources (
        collection_id TEXT PRIMARY KEY, watch_root_path TEXT NOT NULL,
        relative_path TEXT NOT NULL
      );
    `);
    legacy.close();

    const migrated = new RefCanvasDatabase(filename);
    try {
      expect(migrated.getSchemaVersion()).toBe(17);
      const verification = new Sqlite(filename, { readonly: true });
      try {
        const tables = verification
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mount_roots', 'cache_entries', 'media_metadata')",
          )
          .all() as Array<{ name: string }>;
        expect(tables.map((item) => item.name).sort()).toEqual([
          "cache_entries",
          "media_metadata",
          "mount_roots",
        ]);
        // collection_sources 已删除。
        const dropped = verification
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_sources'",
          )
          .all() as Array<{ name: string }>;
        expect(dropped).toHaveLength(0);
        const identityColumns = verification.pragma(
          "table_info(file_identities)",
        ) as Array<{ name: string }>;
        expect(identityColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "id",
            "mount_id",
            "relative_path",
            "file_id",
            "quick_hash",
            "content_hash",
            "link_state",
          ]),
        );
        // schema 17：旧 collection_refs / collection_sources / collection_assets
        // 已退役（该 fixture 无数据，v16 空表直接退休）；v17 重建 collections 与
        // collection_items / ai_jobs。
        const retiredTables = verification
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('collection_sources', 'collection_refs', 'collection_assets')",
          )
          .all();
        expect(retiredTables).toHaveLength(0);
        const v17Tables = verification
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('collections', 'collection_items', 'ai_jobs')",
          )
          .all() as Array<{ name: string }>;
        expect(v17Tables.map((item) => item.name).sort()).toEqual([
          "ai_jobs",
          "collection_items",
          "collections",
        ]);
        // cache_entries/media_metadata 引用 file_identities.id 而非 assets。
        const cacheForeignKeys = verification.pragma(
          "foreign_key_list(cache_entries)",
        ) as Array<{ table: string; from: string }>;
        expect(
          cacheForeignKeys.some(
            (fk) => fk.table === "file_identities" && fk.from === "identity_id",
          ),
        ).toBe(true);
        const mediaForeignKeys = verification.pragma(
          "foreign_key_list(media_metadata)",
        ) as Array<{ table: string; from: string }>;
        expect(
          mediaForeignKeys.some(
            (fk) => fk.table === "file_identities" && fk.from === "identity_id",
          ),
        ).toBe(true);
      } finally {
        verification.close();
      }
      // v16 退役迁移可在已完成的连接上安全重跑。
      const rerun = new Sqlite(filename);
      try {
        rerun.pragma("user_version = 15");
        const result = runMigrationSteps(rerun, MIGRATIONS, {});
        expect(result.completed).toBe(true);
        expect(result.finalVersion).toBe(17);
      } finally {
        rerun.close();
      }
    } finally {
      migrated.close();
    }
  });

});
