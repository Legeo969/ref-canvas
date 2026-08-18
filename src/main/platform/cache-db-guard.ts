import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Result of reconciling a cache database before opening it in-process.
 */
export interface CacheDbReconciliation {
  /** The database file existed on disk before reconciliation. */
  existed: boolean;
  /** Whether the file was deleted because it was unusable (corrupt or too new). */
  recreated: boolean;
  /** Human-readable reason when `recreated` is true. */
  reason?: string;
}

/**
 * Guard a disposable cache database (e.g. `preview-index.sqlite`,
 * `directory-index.sqlite`) before a worker/class opens it.
 *
 * Caches are derived data and can always be rebuilt, so instead of failing
 * startup we delete and let the owner recreate them. This handles both
 * SPEC-1 (corrupt cache → rebuild) and SPEC-7 (cache with a newer schema →
 * delete, never try to read it).
 *
 * The database is opened read-only and closed immediately; no connection is
 * returned. Call this from the main process before constructing the cache
 * owner, while no worker holds the file.
 */
export function reconcileCacheDatabase(
  filename: string,
  appMaxVersion: number,
): CacheDbReconciliation {
  if (!existsSync(filename)) {
    return { existed: false, recreated: false };
  }
  let candidate: Database.Database | null = null;
  try {
    candidate = new Database(filename, { readonly: true, fileMustExist: true });
    const version = candidate.pragma("user_version", { simple: true }) as number;
    const integrity = candidate.pragma("quick_check", { simple: true });
    if (
      typeof version === "number" &&
      !Number.isNaN(version) &&
      version <= appMaxVersion &&
      integrity === "ok"
    ) {
      return { existed: true, recreated: false };
    }
    const reason =
      version > appMaxVersion
        ? `schema v${version} newer than app max v${appMaxVersion}`
        : `quick_check failed (${integrity})`;
    candidate.close();
    candidate = null;
    // Remove the file so the owner recreates it fresh on next open.
    rmSync(filename, { force: true });
    // Also drop stale WAL/SHM sidecars that would otherwise be reattached.
    rmSync(`${filename}-wal`, { force: true });
    rmSync(`${filename}-shm`, { force: true });
    return { existed: true, recreated: true, reason };
  } catch (error) {
    // Read-only open failed entirely — treat as corrupt and delete.
    try {
      candidate?.close();
    } catch {
      /* ignore */
    }
    rmSync(filename, { force: true });
    rmSync(`${filename}-wal`, { force: true });
    rmSync(`${filename}-shm`, { force: true });
    return {
      existed: true,
      recreated: true,
      reason: `unable to open: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Create the parent directory for a cache database if it does not exist yet. */
export function ensureCacheDirectory(filename: string): void {
  mkdirSync(path.dirname(filename), { recursive: true });
}
