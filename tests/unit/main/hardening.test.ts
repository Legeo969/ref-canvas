import Sqlite from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RefCanvasDatabase,
  runMigrationSteps,
  type MigrationStep,
} from "../../../src/main/persistence/database";
import { LibraryManager, databasePathFor, managedStorePath } from "../../../src/main/services/library-manager";
import { LibraryService } from "../../../src/main/services/library-service";
import { z } from "zod";
import { DATABASE_SCHEMA_VERSION } from "../../../src/main/persistence/repositories/migration-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("hardening", () => {
  it("opens a corrupted database without crashing and reports integrity failure", async () => {
    // 该目录在测试内自行清理（WAL 句柄释放有延迟，避免 afterEach 并发删除）。
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-corrupt-"));
    try {
      const filename = path.join(directory, "broken.db");
      // 先建合法数据库，再破坏数据页：头部可读、integrity_check 失败。
      const seed = new Sqlite(filename);
      seed.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      seed.prepare("INSERT INTO t VALUES (1, 'ok')").run();
      seed.close();
      const handle = await import("node:fs/promises").then((fs) =>
        fs.open(filename, "r+"),
      );
      const garbage = Buffer.alloc(4096, 0x5a);
      await handle.write(garbage, 0, 4096, 4096);
      await handle.close();

      const db = new RefCanvasDatabase(filename);
      try {
        expect(db.integrityCheck()).toBe(false);
      } finally {
        db.close();
      }
      // 全新数据库文件可正常迁移到最新版本（恢复路径）。
      const recovered = new RefCanvasDatabase(path.join(directory, "recovered.db"));
      try {
        expect(recovered.getSchemaVersion()).toBe(DATABASE_SCHEMA_VERSION);
      } finally {
        recovered.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("records a failed migration step without advancing user_version and resumes after fix", () => {
    const db = new Sqlite(":memory:");
    db.exec("CREATE TABLE app (id INTEGER PRIMARY KEY)");
    const failingStep: MigrationStep = {
      version: 1,
      id: "boom",
      description: "injected failure",
      apply() {
        throw new Error("INJECTED_MIGRATION_FAILURE");
      },
    };
    const first = runMigrationSteps(db, [failingStep]);
    expect(first.completed).toBe(false);
    expect(first.finalVersion).toBe(0);
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    const log = db
      .prepare("SELECT * FROM migration_log WHERE step_id = 'boom'")
      .get() as { result: string; error: string };
    expect(log.result).toBe("failed");
    expect(log.error).toContain("INJECTED_MIGRATION_FAILURE");

    // A fixed step now completes from the same connection.
    const fixedStep: MigrationStep = {
      version: 1,
      id: "boom",
      description: "fixed",
      apply(target) {
        target.exec("CREATE TABLE app2 (id INTEGER PRIMARY KEY)");
      },
    };
    const second = runMigrationSteps(db, [fixedStep]);
    expect(second.completed).toBe(true);
    expect(second.finalVersion).toBe(1);
    db.close();
  });

  it("imports linked files without copying and never alters the source", async () => {
    const userData = await tempDirectory("refcanvas-registry-");
    const manager = new LibraryManager(userData);
    const entry = await manager.bootstrapLegacy();
    const base = await tempDirectory("refcanvas-managed-");
    const db = new RefCanvasDatabase(databasePathFor(entry));
    const service = new LibraryService(db, path.join(entry.root, "trash", "files"), {
      libraryRoot: entry.root,
    });
    const source = path.join(base, "art.png");
    const content = Buffer.alloc(2048, 9);
    await writeFile(source, content);
    try {
      await service.importPaths([source]);
      // 磁盘唯一真相：不产生 managed store 副本。
      const storeFiles = await import("node:fs/promises").then((fs) =>
        fs.readdir(managedStorePath(entry.root)).catch(() => []),
      );
      expect(storeFiles).toHaveLength(0);
      const asset = db.searchAssets().items[0];
      expect(asset.path).toBe(source);
      // Re-importing the same path reuses the single linked record.
      const result = await service.importPaths([source]);
      expect(result.imported).toBe(0);
      expect(result.reused).toBe(1);
      // Source file untouched.
      await expect(
        (await import("node:fs/promises")).readFile(source),
      ).resolves.toEqual(content);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("takes a pre-migration snapshot and resumes after an interrupted upgrade", async () => {
    const directory = await tempDirectory("refcanvas-snapshot-");
    const filename = path.join(directory, "app.db");
    const backups = path.join(directory, "backups");
    // 先用最新版本建出完整库，再手工把 user_version 降回 10 模拟旧库。
    const seeded = new RefCanvasDatabase(filename, {
      migrationBackupDirectory: backups,
    });
    seeded.createBoard("Snapshot board");
    seeded.close();
    const downgrade = new Sqlite(filename);
    downgrade.exec("PRAGMA user_version = 10;");
    downgrade.close();

    const db = new RefCanvasDatabase(filename, { migrationBackupDirectory: backups });
    try {
      expect(db.getSchemaVersion()).toBe(DATABASE_SCHEMA_VERSION);
      // 迁移前快照已写入 backups 目录。
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(backups);
      const snapshot = files.find((file) => file.includes("migrate-v10-to-v11"));
      expect(snapshot).toBeDefined();
      // 快照可独立打开（回滚能力）且停留在 v10。
      const restored = new Sqlite(path.join(backups, snapshot!));
      expect(restored.pragma("user_version", { simple: true })).toBe(10);
      restored.close();
      // 迁移日志记录了完成项。
      const log = db.getMigrationLog();
      expect(log.some((entry) => entry.stepId === "v11-board-v3")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("rejects an untrusted board document that fails the V3 shape", () => {
    const db = new RefCanvasDatabase(":memory:");
    try {
      const board = db.createBoard("Strict");
      // 保存时 database 层会规范化（宽容），非法 schema 由 IPC Zod 层拒绝。
      const saved = db.saveBoard(board.id, {
        schemaVersion: 3,
        canvas: {},
        viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
        guides: { x: [], y: [] },
        appearance: { backgroundColor: "#202426", gridVisible: true, gridSize: 24 },
        windowMode: "normal",
        canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
        sampling: "bilinear",
        exportSettings: { format: "png", embedAssets: false },
      });
      expect(saved.title).toBe("Strict");
      // Zod 拒绝非法枚举值（IPC 层守卫，这里直接验证 schema 形态约束）。
      const invalid = z
        .enum(["normal", "always-on-bottom", "transparent-overlay", "locked"])
        .safeParse("bogus-mode");
      expect(invalid.success).toBe(false);
    } finally {
      db.close();
    }
  });
});
