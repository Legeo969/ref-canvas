import Sqlite from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_MAX_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION,
  DatabaseSchemaTooNewError,
  RefCanvasDatabase,
} from "../../../src/main/persistence/database";
import {
  inspectPrimaryDatabase,
  backupCorruptPrimary,
  resetPrimaryDatabase,
} from "../../../src/main/platform/database-health";
import { reconcileCacheDatabase } from "../../../src/main/platform/cache-db-guard";

const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  // WAL/SHM 句柄释放有延迟，重试清理避免 EBUSY。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => removeDirectory(directory)),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function seedValidDatabase(filename: string): void {
  const db = new Sqlite(filename);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t VALUES (1, 'ok')").run();
  db.close();
}

describe("SPEC-7 version guard", () => {
  it("derives APP_MAX_SCHEMA_VERSION from migration steps (equals DATABASE_SCHEMA_VERSION)", () => {
    expect(APP_MAX_SCHEMA_VERSION).toBe(DATABASE_SCHEMA_VERSION);
  });

  it("rejects a database whose user_version is newer than the app", async () => {
    const directory = await tempDirectory("spec7-too-new-");
    const filename = path.join(directory, "db.sqlite");
    seedValidDatabase(filename);
    // 手动调高 user_version 模拟未来版本创建的库。
    const db = new Sqlite(filename);
    db.pragma(`user_version = ${APP_MAX_SCHEMA_VERSION + 1}`);
    db.close();

    expect(() => new RefCanvasDatabase(filename)).toThrowError(
      DatabaseSchemaTooNewError,
    );
    try {
      new RefCanvasDatabase(filename);
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseSchemaTooNewError);
      const typed = error as DatabaseSchemaTooNewError;
      expect(typed.databaseVersion).toBe(APP_MAX_SCHEMA_VERSION + 1);
      expect(typed.appMaxVersion).toBe(APP_MAX_SCHEMA_VERSION);
      expect(typed.message).toContain("DB_SCHEMA_TOO_NEW");
    }
  });

  it("opens a database at the app's own schema version normally", async () => {
    const directory = await tempDirectory("spec7-ok-");
    const filename = path.join(directory, "db.sqlite");
    const db = new RefCanvasDatabase(filename);
    try {
      expect(db.getSchemaVersion()).toBe(DATABASE_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

describe("SPEC-1 primary database health", () => {
  it("reports ok for a fresh/valid database", async () => {
    const directory = await tempDirectory("spec1-ok-");
    const filename = path.join(directory, "db.sqlite");
    seedValidDatabase(filename);
    const health = inspectPrimaryDatabase(filename);
    expect(health.status).toBe("ok");
  });

  it("reports degraded when quick_check fails but file still opens", async () => {
    const directory = await tempDirectory("spec1-degraded-");
    const filename = path.join(directory, "db.sqlite");
    // 先建合法库再破坏。
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

    const health = inspectPrimaryDatabase(filename);
    expect(health.status).toBe("degraded");
  });

  it("reports too-new for a future schema version", async () => {
    const directory = await tempDirectory("spec1-too-new-");
    const filename = path.join(directory, "db.sqlite");
    seedValidDatabase(filename);
    const db = new Sqlite(filename);
    db.pragma(`user_version = ${APP_MAX_SCHEMA_VERSION + 5}`);
    db.close();
    const health = inspectPrimaryDatabase(filename);
    expect(health.status).toBe("too-new");
    if (health.status === "too-new") {
      expect(health.schemaVersion).toBe(APP_MAX_SCHEMA_VERSION + 5);
    }
  });

  it("backupCorruptPrimary copies the damaged file before recovery", async () => {
    const directory = await tempDirectory("spec1-backup-");
    const userData = path.join(directory, "userData");
    const filename = path.join(directory, "db.sqlite");
    seedValidDatabase(filename);
    const backup = backupCorruptPrimary(filename, userData);
    expect(backup).toBeTruthy();
    expect(existsSync(backup!)).toBe(true);
    expect(backup).toContain("corrupted-backup-");
  });

  it("resetPrimaryDatabase removes the database and sidecars", async () => {
    const directory = await tempDirectory("spec1-reset-");
    const filename = path.join(directory, "db.sqlite");
    seedValidDatabase(filename);
    resetPrimaryDatabase(filename);
    expect(existsSync(filename)).toBe(false);
  });
});

describe("SPEC-1/SPEC-7 cache database reconciliation", () => {
  it("leaves a valid cache database untouched", async () => {
    const directory = await tempDirectory("cache-ok-");
    const filename = path.join(directory, "cache.sqlite");
    const db = new Sqlite(filename);
    db.pragma("user_version = 3");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.close();
    const result = reconcileCacheDatabase(filename, APP_MAX_SCHEMA_VERSION);
    expect(result.recreated).toBe(false);
    expect(existsSync(filename)).toBe(true);
  });

  it("deletes a cache database with a too-new schema", async () => {
    const directory = await tempDirectory("cache-too-new-");
    const filename = path.join(directory, "cache.sqlite");
    const db = new Sqlite(filename);
    db.pragma(`user_version = ${APP_MAX_SCHEMA_VERSION + 1}`);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.close();
    const result = reconcileCacheDatabase(filename, APP_MAX_SCHEMA_VERSION);
    expect(result.recreated).toBe(true);
    expect(result.reason).toContain("newer");
    expect(existsSync(filename)).toBe(false);
  });

  it("deletes a corrupt cache database", async () => {
    const directory = await tempDirectory("cache-corrupt-");
    const filename = path.join(directory, "cache.sqlite");
    const seed = new Sqlite(filename);
    seed.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    seed.close();
    const handle = await import("node:fs/promises").then((fs) =>
      fs.open(filename, "r+"),
    );
    const garbage = Buffer.alloc(4096, 0xff);
    await handle.write(garbage, 0, 4096, 4096);
    await handle.close();
    const result = reconcileCacheDatabase(filename, APP_MAX_SCHEMA_VERSION);
    expect(result.recreated).toBe(true);
    expect(existsSync(filename)).toBe(false);
  });
});

describe("SPEC-1 read-only database mode", () => {
  it("opens read-only and refuses writes", async () => {
    const directory = await tempDirectory("spec1-readonly-");
    const filename = path.join(directory, "db.sqlite");
    const writable = new RefCanvasDatabase(filename);
    writable.close();
    // 以只读模式打开已存在的合法库（不迁移）。
    const readOnly = new RefCanvasDatabase(filename, { readonly: true });
    try {
      expect(readOnly.readOnly).toBe(true);
      expect(() => readOnly.transaction(() => {})).toThrowError(
        "DATABASE_READ_ONLY",
      );
    } finally {
      readOnly.close();
    }
  });
});
