import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
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

/** SPEC-5：触发式 prune 的累计新增字节阈值（超过则触发一次 prune）。 */
const PRUNE_TRIGGER_BYTES = 200 * 1024 * 1024;
/** SPEC-5：两次 prune 之间的最小间隔。 */
const PRUNE_MIN_INTERVAL_MS = 10 * 60 * 1_000;

export interface PreviewCacheIndexOptions {
  /** 超过该上限（字节）时 prune 会清理最久未访问的条目。默认 2GB。 */
  maximumBytes?: number;
  /** SPEC-5：触发式 prune 的累计新增阈值（默认 200MB）。 */
  pruneTriggerBytes?: number;
  /** SPEC-5：两次 prune 最小间隔（默认 10 分钟）。 */
  pruneMinIntervalMs?: number;
  /** SPEC-5：prune 完成后回调（供上层记日志 / 回收文件）。 */
  onPrune?: (result: {
    removedFiles: string[];
    totalBefore: number;
    totalAfter: number;
    elapsedMs: number;
  }) => void;
}

export class PreviewCacheIndex {
  private readonly database: Database.Database;
  private readonly maximumBytes: number;
  private readonly pruneTriggerBytes: number;
  private readonly pruneMinIntervalMs: number;
  private readonly onPrune?: PreviewCacheIndexOptions["onPrune"];
  /** 自上次 prune 以来成功写入累计的字节数。 */
  private accumulatedBytes = 0;
  /** 上次执行 prune 的时间戳。 */
  private lastPruneAtMs = 0;
  /** 避免 setImmediate 排队时重复调度。 */
  private pruneScheduled = false;

  constructor(filename: string, options: PreviewCacheIndexOptions | number = {}) {
    const resolved: PreviewCacheIndexOptions =
      typeof options === "number" ? { maximumBytes: options } : options;
    this.maximumBytes = resolved.maximumBytes ?? 2 * 1024 * 1024 * 1024;
    this.pruneTriggerBytes = resolved.pruneTriggerBytes ?? PRUNE_TRIGGER_BYTES;
    this.pruneMinIntervalMs = resolved.pruneMinIntervalMs ?? PRUNE_MIN_INTERVAL_MS;
    this.onPrune = resolved.onPrune;
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
    // SPEC-5：累计新增字节，超过阈值时在后台调度一次 prune（节流）。
    this.accumulatedBytes += size;
    this.upsert(key, filename, size, "success", 0, now);
    if (this.accumulatedBytes >= this.pruneTriggerBytes) {
      this.schedulePrune();
    }
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

  /**
   * SPEC-5：事件触发 + 节流的后台 prune。用 setImmediate 不阻塞主线程，
   * 且两次执行间隔不少于 `pruneMinIntervalMs`。
   */
  private schedulePrune(): void {
    if (this.pruneScheduled) return;
    if (Date.now() - this.lastPruneAtMs < this.pruneMinIntervalMs) {
      // 节流期内：重置累计值但本周期内不再触发（避免刚 prune 完又排队）。
      this.accumulatedBytes = 0;
      return;
    }
    this.pruneScheduled = true;
    setImmediate(() => {
      this.pruneScheduled = false;
      this.accumulatedBytes = 0;
      const started = Date.now();
      const totalBefore = this.database
        .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM preview_cache WHERE status = 'success'")
        .get() as { total: number };
      const removedFiles = this.pruneInternal(Date.now());
      const totalAfter = this.database
        .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM preview_cache WHERE status = 'success'")
        .get() as { total: number };
      this.lastPruneAtMs = Date.now();
      this.onPrune?.({
        removedFiles,
        totalBefore: totalBefore.total,
        totalAfter: totalAfter.total,
        elapsedMs: Date.now() - started,
      });
    });
  }

  prune(now = Date.now()): string[] {
    this.lastPruneAtMs = Date.now();
    return this.pruneInternal(now);
  }

  private pruneInternal(now = Date.now()): string[] {
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

  /**
   * SPEC-2：列出所有有效（success）缓存文件路径，用于库打包导出。
   * 只返回仍存在的文件，避免打包已被 LRU 剔除的孤儿文件。
   */
  listValidFilenames(): string[] {
    const rows = this.database
      .prepare(
        "SELECT filename FROM preview_cache WHERE status = 'success' AND filename <> ''",
      )
      .all() as Array<{ filename: string }>;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of rows) {
      if (seen.has(row.filename)) continue;
      seen.add(row.filename);
      result.push(row.filename);
    }
    return result;
  }

  /**
   * 删除索引中已不存在的缓存文件记录（如迁移后磁盘文件被清理）。
   * 返回删除的记录数。只处理 success 且 filename 非空的行。
   */
  removeMissingFiles(): number {
    const rows = this.database
      .prepare(
        "SELECT cache_key, filename FROM preview_cache WHERE status = 'success' AND filename <> ''",
      )
      .all() as Array<{ cache_key: string; filename: string }>;
    const remove = this.database.prepare(
      "DELETE FROM preview_cache WHERE cache_key = ?",
    );
    let removed = 0;
    const transaction = this.database.transaction(() => {
      for (const row of rows) {
        if (!existsSync(row.filename)) {
          remove.run(row.cache_key);
          removed += 1;
        }
      }
    });
    transaction();
    return removed;
  }

  /**
   * SPEC-8：主动 WAL checkpoint（PASSIVE 不阻塞读者；TRUNCATE 仅在退出前）。
   */
  checkpoint(mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"): void {
    try {
      this.database.pragma(`wal_checkpoint(${mode})`);
    } catch {
      // best-effort。
    }
  }

  close(): void {
    // SPEC-8：退出前 TRUNCATE 收缩 WAL。
    this.checkpoint("TRUNCATE");
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
