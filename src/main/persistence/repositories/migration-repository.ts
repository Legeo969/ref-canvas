import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATABASE_SCHEMA_VERSION = 13;

/**
 * Ordered migration model.
 *
 * Each `MigrationStep` advances the database from `version - 1` to `version`.
 * The runner reads the persisted `user_version` and applies every step whose
 * version is greater than the current one, in order. Steps run inside a
 * transaction; after each step succeeds the new `user_version` is stamped so a
 * crash or failure resumes from the last completed step on the next launch.
 *
 * A database at any historical version (including a fresh `user_version = 0`
 * database with only the original schema) can be opened and is brought up to
 * `DATABASE_SCHEMA_VERSION`. The first step (`version: 1`, the legacy baseline)
 * is idempotent so it is a no-op on databases that already contain the tables,
 * which is how pre-versioned (legacy) databases reach v7 in a single pass.
 */
export interface MigrationStep {
  /** Target schema version this step produces. */
  readonly version: number;
  /** Stable identifier recorded in the migration log. */
  readonly id: string;
  /** Human-readable summary of the change. */
  readonly description: string;
  apply(db: Database.Database): void;
}

export interface MigrationLogEntry {
  id: string;
  stepId: string;
  fromVersion: number;
  toVersion: number;
  snapshotPath: string | null;
  result: "completed" | "failed";
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export const MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 7,
    id: "baseline-legacy-schema",
    description:
      "Original idempotent schema through v7: assets, tags, collections, boards, annotations, watch roots and supporting indexes.",
    apply(db) {
      // Delegate to a database-bound helper on a throwaway instance that shares
      // the baseline implementation. We construct the helper against the same
      // connection by calling the static baseline applier.
      BaselineSchemaApplier.apply(db);
    },
  },
  {
    version: 8,
    id: "v8-dual-mode-library",
    description:
      "Dual-mode storage (linked | managed), persistent file identity index and deferred watch-reconciliation queue.",
    apply(db) {
      V8DualModeLibrary.apply(db);
    },
  },
  {
    version: 9,
    id: "v9-eagle-management",
    description:
      "Eagle-grade management: font/generic kinds, BPM and custom fields, tag aliases and shortcuts, smart-folder editing, batch folder ops, folder locks, auto-tag rules and saved preferences.",
    apply(db) {
      V9EagleManagement.apply(db);
    },
  },
  {
    version: 10,
    id: "v10-media-notes",
    description:
      "Time-point media notes for video/audio previews, searchable from the local notes query.",
    apply(db) {
      V10MediaNotes.apply(db);
    },
  },
  {
    version: 11,
    id: "v11-board-v3",
    description:
      "BoardDocumentV3: rich-text notes, links and checklists on board objects, plus persistent window mode, canvas mode, sampling and export settings.",
    apply(db) {
      V11BoardV3.apply(db);
    },
  },
  {
    version: 12,
    id: "v12-watch-collection-sources",
    description:
      "Tracks folders generated from watched directories so empty mirrored folders can be pruned without touching user folders.",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS collection_sources (
          collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
          watch_root_path TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          UNIQUE(watch_root_path, relative_path)
        );
        CREATE INDEX IF NOT EXISTS collection_sources_root
          ON collection_sources(watch_root_path);
      `);
    },
  },
  {
    version: 13,
    id: "v13-asset-metadata-state-and-query-indexes",
    description:
      "Persistent metadata enrichment state plus stable asset-window query indexes.",
    apply(db) {
      const columns = new Set(
        (db.pragma("table_info(assets)") as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
      if (!columns.has("metadata_status")) {
        db.exec("ALTER TABLE assets ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'ready'");
      }
      if (!columns.has("metadata_error")) {
        db.exec("ALTER TABLE assets ADD COLUMN metadata_error TEXT");
      }
      if (!columns.has("metadata_updated_at")) {
        db.exec("ALTER TABLE assets ADD COLUMN metadata_updated_at TEXT");
      }
      if (!columns.has("metadata_job_id")) {
        db.exec("ALTER TABLE assets ADD COLUMN metadata_job_id TEXT");
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS assets_lifecycle_created
          ON assets(lifecycle, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS assets_lifecycle_updated
          ON assets(lifecycle, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS assets_lifecycle_mtime
          ON assets(lifecycle, mtime_ms DESC, id DESC);
        CREATE INDEX IF NOT EXISTS assets_lifecycle_title
          ON assets(lifecycle, title COLLATE NOCASE, id);
        CREATE INDEX IF NOT EXISTS assets_lifecycle_size
          ON assets(lifecycle, size DESC, id DESC);
        CREATE INDEX IF NOT EXISTS assets_lifecycle_rating
          ON assets(lifecycle, rating DESC, id DESC);
        CREATE INDEX IF NOT EXISTS asset_tags_asset
          ON asset_tags(asset_id, tag_id);
        CREATE INDEX IF NOT EXISTS collection_assets_asset
          ON collection_assets(asset_id, collection_id);
        CREATE INDEX IF NOT EXISTS assets_metadata_pending
          ON assets(metadata_status, metadata_job_id, updated_at, id);
      `);
    },
  },
];

/**
 * Stateless helper that owns the legacy baseline DDL. Kept separate from the
 * database class so the ordered migration steps remain pure functions of a
 * `Database` connection (no instance state), which is what makes them safe to
 * re-run and easy to test in isolation.
 */
class BaselineSchemaApplier {
  static apply(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        extension TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        fingerprint TEXT NOT NULL,
        link_state TEXT NOT NULL DEFAULT 'online',
        notes TEXT NOT NULL DEFAULT '',
        width INTEGER,
        height INTEGER,
        duration REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    BaselineSchemaApplier.addColumn(db, "assets", "content_hash TEXT");
    BaselineSchemaApplier.addColumn(
      db,
      "assets",
      "lifecycle TEXT NOT NULL DEFAULT 'active'",
    );
    BaselineSchemaApplier.addColumn(db, "assets", "deleted_at TEXT");
    BaselineSchemaApplier.addColumn(db, "assets", "trash_path TEXT");
    BaselineSchemaApplier.addColumn(db, "assets", "favorite INTEGER NOT NULL DEFAULT 0");
    BaselineSchemaApplier.addColumn(db, "assets", "rating INTEGER NOT NULL DEFAULT 0");
    BaselineSchemaApplier.addColumn(db, "assets", "color_label TEXT NOT NULL DEFAULT 'none'");
    BaselineSchemaApplier.addColumn(db, "assets", "visual_hash TEXT");
    BaselineSchemaApplier.addColumn(db, "assets", "color_signature TEXT");
    BaselineSchemaApplier.addColumn(db, "assets", "dominant_r INTEGER");
    BaselineSchemaApplier.addColumn(db, "assets", "dominant_g INTEGER");
    BaselineSchemaApplier.addColumn(db, "assets", "dominant_b INTEGER");

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
        title, path, notes, content='assets', content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN
        INSERT INTO assets_fts(rowid, title, path, notes)
        VALUES (new.rowid, new.title, new.path, new.notes);
      END;
      CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN
        INSERT INTO assets_fts(assets_fts, rowid, title, path, notes)
        VALUES ('delete', old.rowid, old.title, old.path, old.notes);
      END;
      CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE ON assets BEGIN
        INSERT INTO assets_fts(assets_fts, rowid, title, path, notes)
        VALUES ('delete', old.rowid, old.title, old.path, old.notes);
        INSERT INTO assets_fts(rowid, title, path, notes)
        VALUES (new.rowid, new.title, new.path, new.notes);
      END;
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT
      );
      CREATE TABLE IF NOT EXISTS tag_groups (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL UNIQUE COLLATE NOCASE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_tags (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (asset_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_assets (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        PRIMARY KEY (collection_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS watch_roots (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS board_assets (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        PRIMARY KEY (board_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS asset_annotations (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
        y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS asset_annotations_fts USING fts5(
        text, content='asset_annotations', content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS asset_annotations_ai
        AFTER INSERT ON asset_annotations BEGIN
          INSERT INTO asset_annotations_fts(rowid, text)
          VALUES (new.rowid, new.text);
        END;
      CREATE TRIGGER IF NOT EXISTS asset_annotations_ad
        AFTER DELETE ON asset_annotations BEGIN
          INSERT INTO asset_annotations_fts(asset_annotations_fts, rowid, text)
          VALUES ('delete', old.rowid, old.text);
        END;
      CREATE TRIGGER IF NOT EXISTS asset_annotations_au
        AFTER UPDATE ON asset_annotations BEGIN
          INSERT INTO asset_annotations_fts(asset_annotations_fts, rowid, text)
          VALUES ('delete', old.rowid, old.text);
          INSERT INTO asset_annotations_fts(rowid, text)
          VALUES (new.rowid, new.text);
        END;
      CREATE TABLE IF NOT EXISTS saved_views (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, search_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS file_operations (
        id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, operation TEXT NOT NULL,
        source_path TEXT NOT NULL, target_path TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_lifecycle_created
        ON assets(lifecycle, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS assets_fingerprint ON assets(fingerprint, size);
      CREATE INDEX IF NOT EXISTS assets_content_hash ON assets(content_hash, size);
      CREATE INDEX IF NOT EXISTS assets_visual_hash ON assets(visual_hash);
      CREATE INDEX IF NOT EXISTS assets_dominant_color
        ON assets(dominant_r, dominant_g, dominant_b);
      CREATE INDEX IF NOT EXISTS asset_annotations_asset_created
        ON asset_annotations(asset_id, created_at);
    `);
    BaselineSchemaApplier.addColumn(db, "collections", "parent_id TEXT");
    BaselineSchemaApplier.addColumn(
      db,
      "collections",
      "sort_order INTEGER NOT NULL DEFAULT 0",
    );
    BaselineSchemaApplier.addColumn(
      db,
      "tags",
      "group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL",
    );
    db.exec(`
      CREATE INDEX IF NOT EXISTS collections_parent_sort
        ON collections(parent_id, sort_order, created_at);
      CREATE INDEX IF NOT EXISTS tags_group_name
        ON tags(group_id, name COLLATE NOCASE);
    `);
  }

  private static hasColumn(
    db: Database.Database,
    table: string,
    column: string,
  ): boolean {
    const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private static addColumn(
    db: Database.Database,
    table: string,
    definition: string,
  ): void {
    const column = definition.split(/\s+/)[0];
    if (!BaselineSchemaApplier.hasColumn(db, table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }
}

/**
 * v8 dual-mode library migration.
 *
 * Adds the storage-mode columns to `assets` and stamps every existing record
 * as `linked` (the `0.32` default — existing files stay exactly where they
 * are), then creates the persistent identity index and the deferred watch
 * reconciliation queue. The migration is idempotent (column/index guards) so
 * re-running it on a database already at v8 is a no-op.
 */
class V8DualModeLibrary {
  static apply(db: Database.Database): void {
    V8DualModeLibrary.addColumn(
      db,
      "assets",
      "storage_mode TEXT NOT NULL DEFAULT 'linked'",
    );
    V8DualModeLibrary.addColumn(db, "assets", "library_relative_path TEXT");
    V8DualModeLibrary.addColumn(db, "assets", "original_source_path TEXT");
    db.exec(`
      UPDATE assets SET storage_mode = 'linked'
      WHERE storage_mode IS NULL OR storage_mode = '';
      CREATE TABLE IF NOT EXISTS file_identities (
        path_key TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        size INTEGER NOT NULL,
        root_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS file_identities_asset
        ON file_identities(asset_id);
      CREATE INDEX IF NOT EXISTS file_identities_fingerprint
        ON file_identities(fingerprint, size);
      CREATE TABLE IF NOT EXISTS reconcile_queue (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        event_type TEXT NOT NULL,
        filename TEXT NOT NULL,
        asset_id TEXT,
        state TEXT NOT NULL DEFAULT 'pending',
        candidates_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reconcile_queue_pending
        ON reconcile_queue(state, created_at);
    `);
  }

  private static hasColumn(
    db: Database.Database,
    table: string,
    column: string,
  ): boolean {
    const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private static addColumn(
    db: Database.Database,
    table: string,
    definition: string,
  ): void {
    const column = definition.split(/\s+/)[0];
    if (!V8DualModeLibrary.hasColumn(db, table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }
}

/**
 * v9 Eagle-management migration.
 *
 * Extends assets with local media metadata (BPM, custom fields) and a
 * user-chosen thumbnail override, extends tags with alias/shortcut metadata,
 * adds saved-view editing support, batch folder operations, local folder locks,
 * auto-tag rules and a preferences bag. All guards are idempotent so re-running
 * on a database already at v9 is a no-op.
 */
class V9EagleManagement {
  static apply(db: Database.Database): void {
    V9EagleManagement.addColumn(db, "assets", "bpm REAL");
    V9EagleManagement.addColumn(db, "assets", "custom_fields TEXT");
    V9EagleManagement.addColumn(db, "assets", "custom_thumbnail_path TEXT");
    V9EagleManagement.addColumn(db, "tags", "alias TEXT");
    V9EagleManagement.addColumn(db, "tags", "shortcut_key TEXT");
    V9EagleManagement.addColumn(db, "collections", "lock_hash TEXT");
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_view_tags (
        view_id TEXT NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (view_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS auto_tag_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename_pattern TEXT,
        path_pattern TEXT,
        extension TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tags_alias ON tags(alias);
    `);
    // Backfill: previously saved views have no tag rows; nothing to migrate
    // since the join table is only populated going forward.
  }

  private static hasColumn(
    db: Database.Database,
    table: string,
    column: string,
  ): boolean {
    const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private static addColumn(
    db: Database.Database,
    table: string,
    definition: string,
  ): void {
    const column = definition.split(/\s+/)[0];
    if (!V9EagleManagement.hasColumn(db, table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }
}

/**
 * v10 media-notes migration: time-point notes attached to video/audio assets.
 */
class V10MediaNotes {
  static apply(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_notes (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_notes_asset_time
        ON media_notes(asset_id, time_ms);
    `);
  }
}

/**
 * v11 BoardDocumentV3 migration: deterministic upgrade of every stored V1/V2
 * board to V3. The upgrade is a pure function of the stored document — same
 * input always yields the same V3 output — so re-running the migration is
 * safe and repeatable.
 */
class V11BoardV3 {
  static apply(db: Database.Database): void {
    const rows = db
      .prepare("SELECT id, document_json FROM boards")
      .all() as Array<{ id: string; document_json: string }>;
    const update = db.prepare(
      "UPDATE boards SET document_json = ? WHERE id = ?",
    );
    for (const row of rows) {
      let document: Record<string, unknown>;
      try {
        document = JSON.parse(row.document_json) as Record<string, unknown>;
      } catch {
        continue; // Corrupt boards are left untouched; loading still guards.
      }
      const next = V11BoardV3.toV3(document);
      update.run(JSON.stringify(next), row.id);
    }
  }

  static toV3(document: Record<string, unknown>): Record<string, unknown> {
    if (document.schemaVersion === 3) return document;
    const appearance = (document.appearance ?? {}) as Record<string, unknown>;
    const background =
      typeof appearance.backgroundColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(appearance.backgroundColor)
        ? appearance.backgroundColor
        : "#202426";
    const gridSize =
      typeof appearance.gridSize === "number" &&
      Number.isFinite(appearance.gridSize)
        ? Math.min(96, Math.max(8, Math.round(appearance.gridSize)))
        : 24;
    return {
      schemaVersion: 3,
      canvas: document.canvas ?? {},
      viewport:
        document.viewport ?? { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
      guides: document.guides ?? { x: [], y: [] },
      appearance: {
        backgroundColor: background,
        gridVisible:
          typeof appearance.gridVisible === "boolean"
            ? appearance.gridVisible
            : true,
        gridSize,
      },
      windowMode: "normal",
      canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
      sampling: "bilinear",
      exportSettings: { format: "png", embedAssets: false },
    };
  }
}

/**
 * Result of running one or more migration steps via {@link runMigrationSteps}.
 */
export interface MigrationRunResult {
  /** Version the connection reached after running. */
  finalVersion: number;
  /** Whether every pending step completed. */
  completed: boolean;
}

/**
 * Standalone, connection-bound ordered migration runner.
 *
 * This is the pure heart of the migration system: given a `Database`
 * connection and a list of steps, it advances the connection to the latest
 * version, applying each pending step in a transaction, taking a pre-step
 * snapshot when a backup directory is provided, and recording every attempt in
 * the `migration_log` table (which it creates if absent). The class-based
 * database delegates here so the ordered contract is testable in isolation.
 *
 * On a step failure the transaction rolls back, `user_version` is not
 * advanced, the failure is logged, and the error re-throws — the next run
 * resumes from the last completed step.
 */
export function runMigrationSteps(
  db: Database.Database,
  steps: readonly MigrationStep[],
  options: { migrationBackupDirectory?: string } = {},
): MigrationRunResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_log (
      id TEXT PRIMARY KEY,
      step_id TEXT NOT NULL,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      snapshot_path TEXT,
      result TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS migration_log_started
      ON migration_log(started_at);
  `);

  let current = db.pragma("user_version", { simple: true }) as number;
  if (typeof current !== "number" || Number.isNaN(current)) current = 0;

  const insertLog = db.prepare(
    `INSERT INTO migration_log
      (id, step_id, from_version, to_version, snapshot_path, result, error,
       started_at, finished_at)
     VALUES (@id, @step_id, @from_version, @to_version, @snapshot_path,
       @result, @error, @started_at, @finished_at)`,
  );

  for (const step of steps) {
    if (step.version <= current) continue;
    const startedAt = new Date().toISOString();
    let snapshotPath: string | null = null;
    if (options.migrationBackupDirectory) {
      snapshotPath = snapshotDatabase(
        db,
        options.migrationBackupDirectory,
        current,
        step.version,
      );
    }
    const logId = randomUUID();
    try {
      current = db.transaction(() => {
        step.apply(db);
        db.pragma(`user_version = ${step.version}`);
        return step.version;
      })();
      insertLog.run({
        id: logId,
        step_id: step.id,
        from_version: current - 1 < 0 ? 0 : step.version - 1,
        to_version: step.version,
        snapshot_path: snapshotPath,
        result: "completed",
        error: null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      insertLog.run({
        id: logId,
        step_id: step.id,
        from_version: current,
        to_version: step.version,
        snapshot_path: snapshotPath,
        result: "failed",
        error: message,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
      return { finalVersion: current, completed: false };
    }
  }

  return { finalVersion: current, completed: true };
}

/**
 * Synchronously snapshot a database to a file.
 *
 * `db.backup()` is asynchronous (returns a Promise), so it cannot be used
 * inside the synchronous migration runner. `VACUUM INTO` is SQLite's
 * synchronous online-backup command and is safe to run between migrations.
 */
function backupDatabaseSync(
  db: Database.Database,
  target: string,
): boolean {
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    return true;
  } catch {
    return false;
  }
}

/** Synchronously back a connection up to a file inside the backup directory. */
function snapshotDatabase(
  db: Database.Database,
  backupDirectory: string,
  fromVersion: number,
  toVersion: number,
): string | null {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const snapshotPath = path.join(
    backupDirectory,
    `migrate-v${fromVersion}-to-v${toVersion}-${stamp}.db`,
  );
  try {
    mkdirSync(backupDirectory, { recursive: true });
    return backupDatabaseSync(db, snapshotPath) ? snapshotPath : null;
  } catch {
    return null;
  }
}

/** Reads the migration history recorded on a connection, oldest first. */
export function readMigrationLog(
  db: Database.Database,
): MigrationLogEntry[] {
  return db
    .prepare(
      `SELECT id, step_id AS stepId, from_version AS fromVersion,
         to_version AS toVersion, snapshot_path AS snapshotPath, result,
         error, started_at AS startedAt, finished_at AS finishedAt
       FROM migration_log ORDER BY started_at ASC, rowid ASC`,
    )
    .all() as MigrationLogEntry[];
}

export class MigrationRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly backupDirectory?: string,
  ) {}

  migrate(steps: readonly MigrationStep[]): number {
    this.ensureLog();
    let current = this.db.pragma("user_version", { simple: true }) as number;
    if (typeof current !== "number" || Number.isNaN(current)) current = 0;
    for (const step of steps) {
      if (step.version <= current) continue;
      const startedAt = new Date().toISOString();
      const snapshotPath = this.snapshot(current, step.version);
      const id = randomUUID();
      try {
        const fromVersion = current;
        current = this.db.transaction(() => {
          step.apply(this.db);
          this.db.pragma(`user_version = ${step.version}`);
          return step.version;
        })();
        this.record({
          id,
          stepId: step.id,
          fromVersion,
          toVersion: current,
          snapshotPath,
          result: "completed",
          error: null,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        this.record({
          id,
          stepId: step.id,
          fromVersion: current,
          toVersion: step.version,
          snapshotPath,
          result: "failed",
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        throw error;
      }
    }
    return current;
  }

  history(): MigrationLogEntry[] {
    this.ensureLog();
    return this.db.prepare(`
      SELECT id, step_id AS stepId, from_version AS fromVersion,
        to_version AS toVersion, snapshot_path AS snapshotPath, result,
        error, started_at AS startedAt, finished_at AS finishedAt
      FROM migration_log ORDER BY started_at ASC, rowid ASC
    `).all() as MigrationLogEntry[];
  }

  private ensureLog(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_log (
        id TEXT PRIMARY KEY, step_id TEXT NOT NULL, from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL, snapshot_path TEXT, result TEXT NOT NULL,
        error TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS migration_log_started ON migration_log(started_at);
    `);
  }

  private snapshot(fromVersion: number, toVersion: number): string | null {
    if (!this.backupDirectory) return null;
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const filename = path.join(
      this.backupDirectory,
      `migrate-v${fromVersion}-to-v${toVersion}-${stamp}.db`,
    );
    try {
      mkdirSync(this.backupDirectory, { recursive: true });
      this.db.exec(`VACUUM INTO '${filename.replaceAll("'", "''")}'`);
      return filename;
    } catch {
      return null;
    }
  }

  private record(entry: MigrationLogEntry): void {
    this.db.prepare(`
      INSERT INTO migration_log(
        id, step_id, from_version, to_version, snapshot_path, result, error,
        started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.stepId,
      entry.fromVersion,
      entry.toVersion,
      entry.snapshotPath,
      entry.result,
      entry.error,
      entry.startedAt,
      entry.finishedAt,
    );
  }
}
