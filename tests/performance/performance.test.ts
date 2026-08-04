import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { calculateCompactLayout } from "../../src/renderer/app/board-layout";
import type { NewAsset } from "../../src/main/persistence/database";
import { RefCanvasDatabase } from "../../src/main/persistence/database";
import { LibraryService } from "../../src/main/services/library-service";
import { visualSimilarity } from "../../src/main/services/library-service";

describe("capacity smoke", () => {
  it("pages a warm 500,000-entry directory index under 250ms P95", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE directory_entries (
          directory_path TEXT NOT NULL,
          entry_path TEXT NOT NULL,
          name TEXT NOT NULL,
          is_directory INTEGER NOT NULL,
          extension TEXT NOT NULL,
          discovery_ordinal INTEGER NOT NULL,
          size INTEGER,
          mtime_ms REAL,
          sequence_json TEXT,
          PRIMARY KEY(directory_path, entry_path)
        );
        CREATE INDEX directory_entries_name
          ON directory_entries(directory_path, is_directory DESC, name COLLATE NOCASE);
      `);
      const insert = database.prepare(`
        INSERT INTO directory_entries(
          directory_path, entry_path, name, is_directory, extension,
          discovery_ordinal, size, mtime_ms
        ) VALUES (?, ?, ?, 0, 'png', ?, 1024, ?)
      `);
      database.transaction(() => {
        for (let index = 0; index < 500_000; index += 1) {
          const name = `asset-${String(index).padStart(6, "0")}.png`;
          insert.run("D:\\scale", `D:\\scale\\${name}`, name, index, index);
        }
      })();
      const readPage = database.prepare(`
        SELECT entry_path, name, extension, size, mtime_ms
        FROM directory_entries
        WHERE directory_path = ?
        ORDER BY is_directory DESC, name COLLATE NOCASE, entry_path
        LIMIT 512 OFFSET ?
      `);
      readPage.all("D:\\scale", 0);
      const samples: number[] = [];
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const offset = (attempt * 19_937) % (500_000 - 512);
        const startedAt = performance.now();
        const rows = readPage.all("D:\\scale", offset);
        samples.push(performance.now() - startedAt);
        expect(rows.length).toBeLessThanOrEqual(512);
      }
      samples.sort((left, right) => left - right);
      const p95 = samples[Math.floor(samples.length * 0.95)];
      expect(p95).toBeLessThan(250);
    } finally {
      database.close();
    }
  });

  it("indexes 50,000 assets and persists 1,000 board objects", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const assets: NewAsset[] = Array.from({ length: 50_000 }, (_, index) => ({
        title: `Reference ${index}`,
        kind: index % 2 === 0 ? "image" : "model3d",
        path: `D:\\library\\asset-${index}.${index % 2 === 0 ? "png" : "glb"}`,
        pathKey: `d:\\library\\asset-${index}.${index % 2 === 0 ? "png" : "glb"}`,
        extension: index % 2 === 0 ? "png" : "glb",
        size: 1024 + index,
        mtimeMs: index,
        fingerprint: `fingerprint-${index}`,
        linkState: "online",
        notes: "",
        width: null,
        height: null,
        duration: null,
      }));
      const startedAt = performance.now();
      database.upsertAssets(assets);
      const indexedMs = performance.now() - startedAt;
      const colorSignature = Buffer.alloc(48, 96).toString("base64");
      const colorIndexStartedAt = performance.now();
      for (const asset of database
        .listAllAssetPaths()
        .filter((item) => item.path.endsWith(".png"))) {
        const index = Number(/asset-(\d+)/.exec(asset.path)?.[1] ?? 0);
        database.setVisualSignature(
          asset.id,
          index.toString(16).padStart(16, "0"),
          colorSignature,
          {
            r: index % 256,
            g: (index * 3) % 256,
            b: (index * 7) % 256,
          },
        );
      }
      const colorIndexMs = performance.now() - colorIndexStartedAt;
      const colorQueryStartedAt = performance.now();
      const colorPage = database.searchAssets({
        kind: "image",
        dominantColor: "#804080",
        colorTolerance: 25,
        pageSize: 200,
      });
      const colorQueryMs = performance.now() - colorQueryStartedAt;

      const board = database.createBoard("Capacity");
      database.saveBoard(board.id, {
        schemaVersion: 1,
        canvas: {
          version: "7.4.0",
          objects: Array.from({ length: 1_000 }, (_, index) => ({
            type: "rect",
            left: index * 3,
            top: index * 2,
            width: 120,
            height: 80,
          })),
        },
      });
      const loaded = database.loadBoard(board.id);
      const sourceSignature = {
        visualHash: "a55aa55aa55aa55a",
        colorSignature: Buffer.alloc(48, 96).toString("base64"),
      };
      const signatures = Array.from({ length: 25_000 }, (_, index) => ({
        visualHash: index.toString(16).padStart(16, "0"),
        colorSignature: Buffer.alloc(48, index % 256).toString("base64"),
      }));
      const similarityStartedAt = performance.now();
      const scores = signatures.map((signature) =>
        visualSimilarity(sourceSignature, signature),
      );
      const similarityMs = performance.now() - similarityStartedAt;
      const layoutStartedAt = performance.now();
      const positions = calculateCompactLayout(
        Array.from({ length: 1_000 }, (_, index) => ({
          width: 80 + (index % 7) * 20,
          height: 60 + (index % 5) * 18,
        })),
        1_920,
      );
      const layoutMs = performance.now() - layoutStartedAt;

      expect(database.getLibraryStats().total).toBe(50_000);
      expect(
        database.searchAssets({ kind: "image", pageSize: 200 }).items,
      ).toHaveLength(200);
      expect(
        loaded?.document.canvas.objects as unknown[],
      ).toHaveLength(1_000);
      expect(indexedMs).toBeLessThan(30_000);
      expect(colorIndexMs).toBeLessThan(15_000);
      expect(colorPage.total).toBeGreaterThan(0);
      expect(colorQueryMs).toBeLessThan(1_500);
      expect(scores).toHaveLength(25_000);
      expect(similarityMs).toBeLessThan(1_500);
      expect(positions).toHaveLength(1_000);
      expect(layoutMs).toBeLessThan(50);
    } finally {
      database.close();
    }
  });

  it("warms 100k assets and answers warm-cache first-page queries under 250ms P95", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const assets: NewAsset[] = Array.from({ length: 100_000 }, (_, index) => ({
        title: `Warm ${index}`,
        kind: index % 2 === 0 ? "image" : "video",
        path: `D:\\warm\\asset-${index}.${index % 2 === 0 ? "png" : "mp4"}`,
        pathKey: `d:\\warm\\asset-${index}.${index % 2 === 0 ? "png" : "mp4"}`,
        extension: index % 2 === 0 ? "png" : "mp4",
        size: 2048 + index,
        mtimeMs: index,
        fingerprint: `warm-${index}`,
        linkState: "online",
        notes: "",
        width: index % 2 === 0 ? 1920 : null,
        height: index % 2 === 0 ? 1080 : null,
        duration: index % 2 === 0 ? null : 30,
      }));
      const indexedAt = performance.now();
      database.upsertAssets(assets);
      expect(performance.now() - indexedAt).toBeLessThan(60_000);

      // 暖缓存首屏查询：3 种代表性查询各跑 7 次，取 P95。
      const queries: Array<() => void> = [
        () => database.searchAssets({ pageSize: 120 }),
        () =>
          database.searchAssets({
            kind: "image",
            minWidth: 1000,
            sort: "createdAt",
            direction: "desc",
            pageSize: 120,
          }),
        () =>
          database.searchAssets({
            query: "Warm 42",
            pageSize: 120,
          }),
      ];
      const samples: number[] = [];
      for (const run of queries) {
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const startedAt = performance.now();
          run();
          samples.push(performance.now() - startedAt);
        }
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(samples.length * 0.95)];
      expect(database.getLibraryStats().total).toBe(100_000);
      expect(p95).toBeLessThan(250);
    } finally {
      database.close();
    }
  });

  it("cancels a 10,000-file import within one second", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-cancel-"));
    try {
      const database = new RefCanvasDatabase(":memory:");
      const service = new LibraryService(database, path.join(directory, "trash"));
      try {
        // 生成 10,000 个小型可导入文件。
        const source = path.join(directory, "in");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(source, { recursive: true });
        for (let index = 0; index < 10_000; index += 100) {
          await Promise.all(
            Array.from({ length: 100 }, (_, offset) =>
              writeFile(
                path.join(source, `batch-${index + offset}.png`),
                Buffer.alloc(8, index % 256),
              ),
            ),
          );
        }
        const job = service.startImport([source]);
        // 等待任务进入处理阶段后再取消。
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const snapshot = service.getImportJob(job.id)!;
          if (snapshot.state === "processing") break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const cancelAt = performance.now();
        const cancelled = service.cancelImport(job.id);
        expect(cancelled).toBe(true);
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const snapshot = service.getImportJob(job.id)!;
          if (snapshot.state === "cancelled") break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const responseMs = performance.now() - cancelAt;
        expect(service.getImportJob(job.id)!.state).toBe("cancelled");
        expect(responseMs).toBeLessThan(1_000);
      } finally {
        await service.close();
        database.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("imports 3,000 nested linked files without repeated hierarchy scans", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-import-"));
    try {
      const database = new RefCanvasDatabase(":memory:");
      const service = new LibraryService(database, path.join(directory, "trash"));
      try {
        const source = path.join(directory, "in");
        const { mkdir } = await import("node:fs/promises");
        for (let folder = 0; folder < 60; folder += 1) {
          const nested = path.join(
            source,
            `group-${Math.floor(folder / 10)}`,
            `folder-${folder}`,
          );
          await mkdir(nested, { recursive: true });
          await Promise.all(
            Array.from({ length: 50 }, (_, index) =>
              writeFile(
                path.join(nested, `asset-${index}.txt`),
                Buffer.alloc(128, index),
              ),
            ),
          );
        }
        const startedAt = performance.now();
        const result = await service.importPaths([source]);
        const elapsedMs = performance.now() - startedAt;
        expect(result.failed).toHaveLength(0);
        expect(result.imported).toBe(3_000);
        expect(database.getLibraryStats().total).toBe(3_000);
        // §13.4：导入不再镜像创建合集（ImportOptions 已移除）。
        expect(database.listCollections()).toHaveLength(0);
        expect(elapsedMs).toBeLessThan(15_000);
      } finally {
        await service.close();
        database.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
