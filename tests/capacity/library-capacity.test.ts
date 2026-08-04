import Sqlite from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../src/main/persistence/database";

function p95(samples: number[]): number {
  return [...samples].sort((left, right) => left - right)[
    Math.floor(samples.length * 0.95)
  ];
}

describe("500k capacity gates", () => {
  it("pages warm 500,000-entry directory indexes under 250ms P95", () => {
    const database = new Sqlite(":memory:");
    try {
      database.exec(`
        CREATE TABLE directory_entries (
          directory_path TEXT NOT NULL,
          entry_path TEXT NOT NULL,
          name TEXT NOT NULL,
          is_directory INTEGER NOT NULL,
          extension TEXT NOT NULL,
          discovery_ordinal INTEGER NOT NULL,
          PRIMARY KEY(directory_path, entry_path)
        );
        CREATE INDEX directory_entries_name
          ON directory_entries(
            directory_path, is_directory DESC, name COLLATE NOCASE, entry_path
          );
      `);
      const insert = database.prepare(`
        INSERT INTO directory_entries VALUES (?, ?, ?, 0, 'png', ?)
      `);
      database.transaction(() => {
        for (let index = 0; index < 500_000; index += 1) {
          const name = `asset-${String(index).padStart(6, "0")}.png`;
          insert.run("D:\\capacity", `D:\\capacity\\${name}`, name, index);
        }
      })();
      const page = database.prepare(`
        SELECT entry_path, name FROM directory_entries
        WHERE directory_path = ?
        ORDER BY is_directory DESC, name COLLATE NOCASE, entry_path
        LIMIT 512 OFFSET ?
      `);
      page.all("D:\\capacity", 0);
      const samples: number[] = [];
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const offset = (attempt * 19_937) % (500_000 - 512);
        const started = performance.now();
        expect(page.all("D:\\capacity", offset)).toHaveLength(512);
        samples.push(performance.now() - started);
      }
      expect(p95(samples)).toBeLessThanOrEqual(250);
    } finally {
      database.close();
    }
  });

  it("serves first, deep, and hydrated windows from 500,000 assets under 250ms P95", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const sqlite = (database as unknown as { db: Sqlite.Database }).db;
      const insert = sqlite.prepare(`
        INSERT INTO assets(
          id, title, kind, path, path_key, extension, size, mtime_ms,
          fingerprint, link_state, notes, created_at, updated_at
        ) VALUES (?, ?, 'image', ?, ?, 'png', ?, ?, ?, 'online', '', ?, ?)
      `);
      sqlite.transaction(() => {
        for (let index = 0; index < 500_000; index += 1) {
          const id = `asset-${String(index).padStart(6, "0")}`;
          const filename = `D:\\capacity\\${id}.png`;
          const timestamp = String(index).padStart(6, "0");
          insert.run(
            id,
            `Asset ${String(index).padStart(6, "0")}`,
            filename,
            filename.toLocaleLowerCase("en-US"),
            1_024 + index,
            index,
            id,
            timestamp,
            timestamp,
          );
        }
      })();
      sqlite.exec(`
        INSERT INTO tags(id, name) VALUES ('capacity-tag', 'capacity');
        INSERT INTO collections(id, title, created_at)
          VALUES ('capacity-collection', 'Capacity', '2026-08-03');
        INSERT INTO mount_roots(id, path, display_name)
          VALUES ('capacity-mount', 'D:\\capacity', 'Capacity');
      `);
      const addTag = sqlite.prepare(
        "INSERT INTO asset_tags(asset_id, tag_id) VALUES (?, 'capacity-tag')",
      );
      // v15：collection_refs 需要 mount_id/relative_path/fingerprint。
      const addCollection = sqlite.prepare(
        `INSERT INTO collection_refs
          (id, collection_id, asset_id, mount_id, relative_path, fingerprint, state)
         VALUES (?, 'capacity-collection', ?, 'capacity-mount', ?, ?, 'resolved')`,
      );
      sqlite.transaction(() => {
        for (const base of [249_800, 499_800]) {
          for (let index = base; index < base + 200; index += 1) {
            const id = `asset-${String(index).padStart(6, "0")}`;
            addTag.run(id);
            addCollection.run(id, id, `${id}.png`, "capacity");
          }
        }
      })();

      database.searchAssetWindow({
        query: {},
        offset: 0,
        pageSize: 200,
        includeTotal: true,
      });
      const samples: number[] = [];
      for (let attempt = 0; attempt < 21; attempt += 1) {
        const offset = attempt % 2 === 0 ? 0 : 250_000;
        const started = performance.now();
        const window = database.searchAssetWindow({
          query: {},
          offset,
          pageSize: 200,
          includeTotal: attempt === 0,
        });
        samples.push(performance.now() - started);
        expect(window.items).toHaveLength(200);
      }
      const hydrated = database.searchAssetWindow({
        query: {},
        offset: 0,
        pageSize: 200,
        includeTotal: false,
      });

      expect(p95(samples)).toBeLessThanOrEqual(250);
      expect(hydrated.items[0]).toMatchObject({
        tags: ["capacity"],
        collectionIds: ["capacity-collection"],
      });
    } finally {
      database.close();
    }
  });
});
