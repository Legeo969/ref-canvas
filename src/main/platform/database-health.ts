import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { APP_MAX_SCHEMA_VERSION } from "../persistence/repositories/migration-repository";

/**
 * Result of inspecting the primary library database before opening it.
 *
 * SPEC-1 graded recovery: instead of letting `new Database(filename)` /
 * `migrate()` crash startup on a corrupt or too-new database, we probe the file
 * first and decide one of three paths:
 *
 * - `ok`        → quick_check passed; open normally.
 * - `degraded`  → quick_check failed but the file still opens read-only; the
 *                 app keeps browsing and shows a persistent banner (writes
 *                 refused by SQLite `query_only`).
 * - `too-new`   → schema version is newer than this build (SPEC-7); refused.
 * - `unsafe`    → the file cannot be opened at all (read-only open failed);
 *                 safe mode: do not open, offer restore/rescan.
 */
export type PrimaryDatabaseHealth =
  | { status: "ok"; schemaVersion: number }
  | { status: "degraded"; schemaVersion: number | null; reason: string }
  | { status: "too-new"; schemaVersion: number }
  | { status: "unsafe"; reason: string };

/**
 * Inspect the primary library database file without opening it for writes.
 * Runs `PRAGMA quick_check` (lightweight) and reads `user_version`.
 *
 * Does not mutate the database. Returns the health decision plus the schema
 * version when it could be read.
 */
export function inspectPrimaryDatabase(
  filename: string,
  appMaxVersion: number = APP_MAX_SCHEMA_VERSION,
): PrimaryDatabaseHealth {
  if (!existsSync(filename)) {
    // Fresh install — no file yet, safe to create.
    return { status: "ok", schemaVersion: 0 };
  }
  let candidate: Database.Database | null = null;
  try {
    candidate = new Database(filename, { readonly: true, fileMustExist: true });
    const version = candidate.pragma("user_version", { simple: true }) as number;
    const schemaVersion =
      typeof version === "number" && !Number.isNaN(version) ? version : 0;
    if (schemaVersion > appMaxVersion) {
      return { status: "too-new", schemaVersion };
    }
    const quick = candidate.pragma("quick_check", { simple: true });
    if (quick === "ok") {
      return { status: "ok", schemaVersion };
    }
    return { status: "degraded", schemaVersion, reason: String(quick) };
  } catch (error) {
    return {
      status: "unsafe",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      candidate?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Before any recovery action on a corrupt primary database, copy the file to a
 * timestamped `corrupted-backup-<stamp>.db` inside `userData` so a recovery
 * attempt can never make the original damage worse (SPEC-1). Returns the
 * backup path, or null when the file is not readable / copy failed.
 */
export function backupCorruptPrimary(
  filename: string,
  userDataDirectory: string,
): string | null {
  try {
    if (!existsSync(filename)) return null;
    mkdirSync(userDataDirectory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const target = path.join(userDataDirectory, `corrupted-backup-${stamp}.db`);
    copyFileSync(filename, target);
    return target;
  } catch {
    return null;
  }
}

/**
 * Reset a primary database by removing it (and WAL/SHM sidecars). Used by the
 * "new empty database" path in safe mode; the file is recreated on next open.
 */
export function resetPrimaryDatabase(filename: string): void {
  rmSync(filename, { force: true });
  rmSync(`${filename}-wal`, { force: true });
  rmSync(`${filename}-shm`, { force: true });
}
