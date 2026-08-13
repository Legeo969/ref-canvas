import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type PreviewCacheStatus = "success" | "failed";

export interface PreviewCacheRecord {
  key: string;
  filename: string;
  size: number;
  status: PreviewCacheStatus;
  retryAfterMs: number;
}

// A decode can fail while a source file is still being written or while a
// native provider is restarting. Keep a short negative cache to avoid hot
// retry loops without making a recoverable preview disappear for the session.
const FAILURE_TTL_MS = 30_000;
const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class PreviewCacheIndex {
  private readonly database: Database.Database;

  constructor(
    filename: string,
    private readonly maximumBytes = 2 * 1024 * 1024 * 1024,
  ) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new Database(filename);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("user_version = 1");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS preview_cache (
        cache_key TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        retry_after_ms INTEGER NOT NULL DEFAULT 0,
        accessed_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS preview_cache_accessed
      ON preview_cache(accessed_at_ms);
    `);
    // Cap failures written by older builds (which used a 24-hour TTL) so an
    // upgrade immediately benefits from the recoverable-failure policy.
    const failureCap = Date.now() + FAILURE_TTL_MS;
    this.database
      .prepare(
        `UPDATE preview_cache
         SET retry_after_ms = ?
         WHERE status = 'failed' AND retry_after_ms > ?`,
      )
      .run(failureCap, failureCap);
  }

  get(key: string, now = Date.now()): PreviewCacheRecord | null {
    const row = this.database
      .prepare(
        `SELECT cache_key, filename, size, status, retry_after_ms
         FROM preview_cache WHERE cache_key = ?`,
      )
      .get(key) as
      | {
          cache_key: string;
          filename: string;
          size: number;
          status: PreviewCacheStatus;
          retry_after_ms: number;
        }
      | undefined;
    if (!row) return null;
    if (row.status === "failed" && row.retry_after_ms <= now) {
      this.database.prepare("DELETE FROM preview_cache WHERE cache_key = ?").run(key);
      return null;
    }
    this.database
      .prepare("UPDATE preview_cache SET accessed_at_ms = ? WHERE cache_key = ?")
      .run(now, key);
    return {
      key: row.cache_key,
      filename: row.filename,
      size: row.size,
      status: row.status,
      retryAfterMs: row.retry_after_ms,
    };
  }

  recordSuccess(key: string, filename: string, size: number, now = Date.now()): void {
    this.upsert(key, filename, size, "success", 0, now);
  }

  recordFailure(key: string, now = Date.now()): void {
    this.upsert(key, "", 0, "failed", now + FAILURE_TTL_MS, now);
  }

  /** Manual/renderer retries may bypass a negative cache without deleting a success. */
  clearFailure(key: string): void {
    this.database
      .prepare("DELETE FROM preview_cache WHERE cache_key = ? AND status = 'failed'")
      .run(key);
  }

  prune(now = Date.now()): string[] {
    const expired = this.database
      .prepare(
        "SELECT filename FROM preview_cache WHERE accessed_at_ms < ? AND filename <> ''",
      )
      .all(now - ACCESS_TTL_MS) as Array<{ filename: string }>;
    this.database
      .prepare("DELETE FROM preview_cache WHERE accessed_at_ms < ?")
      .run(now - ACCESS_TTL_MS);
    const total = this.database
      .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM preview_cache WHERE status = 'success'")
      .get() as { total: number };
    const removed = [...expired.map((row) => row.filename)];
    let remaining = total.total;
    if (remaining > this.maximumBytes) {
      const rows = this.database
        .prepare(
          "SELECT cache_key, filename, size FROM preview_cache WHERE status = 'success' ORDER BY accessed_at_ms ASC",
        )
        .all() as Array<{ cache_key: string; filename: string; size: number }>;
      const remove = this.database.prepare(
        "DELETE FROM preview_cache WHERE cache_key = ?",
      );
      const transaction = this.database.transaction(() => {
        for (const row of rows) {
          if (remaining <= this.maximumBytes) break;
          remove.run(row.cache_key);
          remaining -= row.size;
          removed.push(row.filename);
        }
      });
      transaction();
    }
    return removed;
  }

  clear(): void {
    this.database.exec("DELETE FROM preview_cache");
  }

  close(): void {
    this.database.close();
  }

  private upsert(
    key: string,
    filename: string,
    size: number,
    status: PreviewCacheStatus,
    retryAfterMs: number,
    now: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO preview_cache(cache_key, filename, size, status, retry_after_ms, accessed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           filename = excluded.filename,
           size = excluded.size,
           status = excluded.status,
           retry_after_ms = excluded.retry_after_ms,
           accessed_at_ms = excluded.accessed_at_ms`,
      )
      .run(key, filename, size, status, retryAfterMs, now);
  }
}
