import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  AssetPage,
  AssetAnnotation,
  AssetRecord,
  AssetSearchInput,
  AssetStorageMode,
  AutoTagRule,
  BatchAssetPatch,
  BatchCollectionOp,
  BoardDocument,
  BoardDocumentV2,
  BoardDocumentV3,
  BoardAppearance,
  BoardSummary,
  CollectionRecord,
  DuplicateGroup,
  LibraryStats,
  MediaNote,
  PlaybackState,
  ReconcileEntry,
  SavedView,
  SelectionScope,
  TagGroupRecord,
  TagRecord,
  WatchRoot,
} from "../shared/contracts";

export const DATABASE_SCHEMA_VERSION = 12;

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

interface AssetRow {
  id: string;
  title: string;
  kind: AssetRecord["kind"];
  path: string;
  path_key: string;
  extension: string;
  size: number;
  mtime_ms: number;
  fingerprint: string;
  content_hash: string | null;
  visual_hash: string | null;
  color_signature: string | null;
  dominant_r: number | null;
  dominant_g: number | null;
  dominant_b: number | null;
  lifecycle: AssetRecord["lifecycle"];
  deleted_at: string | null;
  trash_path: string | null;
  favorite: number;
  rating: number;
  color_label: AssetRecord["colorLabel"];
  link_state: AssetRecord["linkState"];
  notes: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  bpm: number | null;
  custom_fields: string | null;
  custom_thumbnail_path: string | null;
  storage_mode: AssetRecord["storageMode"];
  library_relative_path: string | null;
  original_source_path: string | null;
  created_at: string;
  updated_at: string;
}

interface BoardRow {
  id: string;
  title: string;
  document_json: string;
  created_at: string;
  updated_at: string;
}

interface AssetAnnotationRow {
  id: string;
  asset_id: string;
  x: number;
  y: number;
  text: string;
  created_at: string;
  updated_at: string;
}

interface WatchRootRow {
  id: string;
  path: string;
  created_at: string;
}

interface CollectionRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  asset_count: number;
  lock_hash: string | null;
}

interface SavedViewRow {
  id: string;
  title: string;
  search_json: string;
  created_at: string;
  updated_at: string;
}

interface AutoTagRuleRow {
  id: string;
  name: string;
  filenamePattern: string | null;
  pathPattern: string | null;
  extension: string | null;
  tagsJson: string;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

export type NewAsset = Omit<
  AssetRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "previewUrl"
  | "thumbnailUrl"
  | "tags"
  | "collectionIds"
  | "contentHash"
  | "lifecycle"
  | "deletedAt"
  | "trashPath"
  | "favorite"
  | "rating"
  | "colorLabel"
  | "storageMode"
  | "libraryRelativePath"
  | "originalSourcePath"
  | "bpm"
  | "customFields"
  | "customThumbnailPath"
> & {
  pathKey: string;
  storageMode?: AssetStorageMode;
  libraryRelativePath?: string | null;
  originalSourcePath?: string | null;
  contentHash?: string | null;
  bpm?: number | null;
  customFields?: Record<string, string>;
  customThumbnailPath?: string | null;
};

const sortColumns = {
  createdAt: "a.created_at",
  updatedAt: "a.updated_at",
  mtimeMs: "a.mtime_ms",
  title: "a.title COLLATE NOCASE",
  size: "a.size",
  rating: "a.rating",
  random: "RANDOM()",
} as const;

function mapAsset(row: AssetRow): AssetRecord {
  const modelUrl =
    row.kind === "model3d"
      ? `refasset://asset/${row.id}/${encodeURIComponent(path.basename(row.path))}`
      : `refasset://asset/${row.id}`;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    path: row.path,
    extension: row.extension,
    size: row.size,
    mtimeMs: row.mtime_ms,
    fingerprint: row.fingerprint,
    contentHash: row.content_hash,
    lifecycle: row.lifecycle,
    deletedAt: row.deleted_at,
    trashPath: row.trash_path,
    favorite: Boolean(row.favorite),
    rating: row.rating,
    colorLabel: row.color_label,
    linkState: row.link_state,
    notes: row.notes,
    width: row.width,
    height: row.height,
    duration: row.duration,
    bpm: row.bpm,
    customFields: parseCustomFields(row.custom_fields),
    customThumbnailPath: row.custom_thumbnail_path,
    tags: [],
    collectionIds: [],
    storageMode: row.storage_mode ?? "linked",
    libraryRelativePath: row.library_relative_path,
    originalSourcePath: row.original_source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    previewUrl: modelUrl,
    thumbnailUrl: `refasset://thumbnail/${row.id}`,
  };
}

function mapAssetAnnotation(row: AssetAnnotationRow): AssetAnnotation {
  return {
    id: row.id,
    assetId: row.asset_id,
    x: row.x,
    y: row.y,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBoard(row: BoardRow): BoardSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const defaultBoardAppearance: BoardAppearance = {
  backgroundColor: "#202426",
  gridVisible: true,
  gridSize: 24,
};

function normalizeBoardAppearance(
  appearance?: Partial<BoardAppearance>,
): BoardAppearance {
  const backgroundColor =
    typeof appearance?.backgroundColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(appearance.backgroundColor)
      ? appearance.backgroundColor
      : defaultBoardAppearance.backgroundColor;
  const gridSize =
    typeof appearance?.gridSize === "number" &&
    Number.isFinite(appearance.gridSize)
      ? Math.min(96, Math.max(8, Math.round(appearance.gridSize)))
      : defaultBoardAppearance.gridSize;
  return {
    backgroundColor,
    gridVisible:
      typeof appearance?.gridVisible === "boolean"
        ? appearance.gridVisible
        : defaultBoardAppearance.gridVisible,
    gridSize,
  };
}

function toBoardV2(document: BoardDocument): BoardDocumentV2 {
  if (document.schemaVersion === 2) {
    return {
      ...document,
      appearance: normalizeBoardAppearance(document.appearance),
    };
  }
  return {
    schemaVersion: 2,
    canvas: document.canvas,
    viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
    guides: { x: [], y: [] },
    appearance: { ...defaultBoardAppearance },
  };
}

/** Deterministic V3 normalization shared by load/save/migration. */
function toBoardV3(document: BoardDocument): BoardDocumentV3 {
  const source = document.schemaVersion === 3 ? (document as BoardDocumentV3) : null;
  // V3 documents keep their own values; V1/V2 get the shared normalization.
  const legacy = document.schemaVersion !== 3 ? toBoardV2(document) : null;
  const canvasMode = source?.canvasMode ?? {
    locked: false,
    grayscale: false,
    gridStyle: "line" as const,
  };
  return {
    schemaVersion: 3,
    canvas: legacy?.canvas ?? document.canvas,
    viewport: source?.viewport ?? legacy?.viewport ?? toBoardV2(document).viewport,
    guides: source?.guides ?? legacy?.guides ?? toBoardV2(document).guides,
    appearance: legacy?.appearance ?? normalizeBoardAppearance(source!.appearance),
    windowMode: source?.windowMode ?? "normal",
    canvasMode: {
      locked: Boolean(canvasMode.locked),
      grayscale: Boolean(canvasMode.grayscale),
      gridStyle:
        canvasMode.gridStyle === "dot" || canvasMode.gridStyle === "none"
          ? canvasMode.gridStyle
          : "line",
    },
    sampling: source?.sampling === "nearest" ? "nearest" : "bilinear",
    exportSettings: {
      format:
        source?.exportSettings?.format === "jpeg" ||
        source?.exportSettings?.format === "webp"
          ? source.exportSettings.format
          : "png",
      embedAssets: Boolean(source?.exportSettings?.embedAssets),
    },
  };
}

function visitDocument(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitDocument(item, visitor);
    return;
  }
  const record = value as Record<string, unknown>;
  visitor(record);
  for (const child of Object.values(record)) visitDocument(child, visitor);
}

function assetIdsFromDocument(document: BoardDocument): string[] {
  const ids = new Set<string>();
  visitDocument(document.canvas, (record) => {
    const data = record.data;
    if (data && typeof data === "object") {
      const id = (data as Record<string, unknown>).assetId;
      if (typeof id === "string") ids.add(id);
    }
  });
  return [...ids];
}

function rewriteAssetId(
  document: BoardDocumentV2,
  oldId: string,
  newId: string,
): BoardDocumentV2 {
  visitDocument(document.canvas, (record) => {
    const data = record.data;
    if (data && typeof data === "object") {
      const payload = data as Record<string, unknown>;
      if (payload.assetId === oldId) payload.assetId = newId;
    }
    if (typeof record.src === "string") {
      record.src = record.src.replace(
        new RegExp(`refasset://(asset|thumbnail)/${oldId}(?=/|$)`),
        `refasset://$1/${newId}`,
      );
    }
  });
  return document;
}

function pathKeyFor(filename: string): string {
  return path.normalize(filename).toLocaleLowerCase("en-US");
}

function parseCustomFields(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Corrupt custom fields degrade to empty rather than crashing the row.
  }
  return {};
}

/** Salted SHA-256 used for the local folder access lock. */
function lockHash(password: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");
}

/**
 * Ordered list of migration steps. The first entry is the legacy baseline: it
 * carries any database (including an unversioned pre-migration database with
 * `user_version = 0`) up to {@link DATABASE_SCHEMA_VERSION}. Because the
 * baseline is written with `CREATE TABLE IF NOT EXISTS` / `addColumn` guards,
 * re-running it on a database that is already at v7 is a no-op, so the very
 * first open of an existing v7 database performs no work and simply records no
 * log entry.
 *
 * Add future steps (v8+) by appending here; each must target a strictly
 * increasing `version`.
 */
const MIGRATIONS: readonly MigrationStep[] = [
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

export interface RefCanvasDatabaseOptions {
  /**
   * Directory for pre-migration snapshots. When provided and a step actually
   * needs to run, the runner backs the database up here before applying it.
   * When omitted, no on-disk snapshot is taken (used by tests and throwaway
   * databases).
   */
  migrationBackupDirectory?: string;
}

export class RefCanvasDatabase {
  private readonly db: Database.Database;
  private closed = false;
  private readonly unlockedFolders = new Set<string>();
  readonly filename: string;
  private readonly migrationBackupDirectory: string | undefined;

  constructor(filename: string, options: RefCanvasDatabaseOptions = {}) {
    this.filename = filename;
    this.migrationBackupDirectory = options.migrationBackupDirectory;
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    // The migration log is bootstrapped first so it survives every step,
    // including the legacy baseline. It is created idempotently and never
    // depends on a prior version.
    this.db.exec(`
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

    let current = this.db.pragma("user_version", { simple: true }) as number;
    if (typeof current !== "number" || Number.isNaN(current)) current = 0;

    for (const step of MIGRATIONS) {
      if (step.version <= current) continue;
      current = this.applyMigrationStep(step, current);
    }

    this.rebuildBoardAssetIndex();
  }

  /**
   * Apply a single ordered migration step inside a transaction.
   *
   * Before the step runs, if a backup directory was configured, the database
   * is snapshotted so the user (or an automated restore) can roll back. The
   * step executes in a transaction; on success `user_version` is advanced and
   * the log records `completed`. On failure the transaction rolls back, the
   * version is not advanced, the failure is logged, and the error re-throws so
   * the caller (startup) surfaces it — the next launch resumes from here.
   */
  private applyMigrationStep(
    step: MigrationStep,
    fromVersion: number,
  ): number {
    const startedAt = new Date().toISOString();
    let snapshotPath: string | null = null;

    if (this.migrationBackupDirectory) {
      snapshotPath = this.snapshotBeforeMigration(fromVersion, step.version);
    }

    const logId = randomUUID();
    try {
      const outcome = this.db.transaction(() => {
        step.apply(this.db);
        this.db.pragma(`user_version = ${step.version}`);
        return step.version;
      })();
      this.recordMigrationLog({
        id: logId,
        stepId: step.id,
        fromVersion,
        toVersion: outcome,
        snapshotPath,
        result: "completed",
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordMigrationLog({
        id: logId,
        stepId: step.id,
        fromVersion,
        toVersion: step.version,
        snapshotPath,
        result: "failed",
        error: message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Synchronously snapshot the database before a migration step runs.
   *
   * The snapshot uses SQLite's synchronous `VACUUM INTO` (see
   * {@link backupDatabaseSync}) because the migration runner is invoked from
   * the constructor, which cannot await the asynchronous `db.backup()`.
   * The backup directory is created if missing. On any I/O failure the
   * snapshot is skipped (returns null) — the migration still proceeds and is
   * logged, since the ordered runner itself is transactional and resumable.
   */
  private snapshotBeforeMigration(
    fromVersion: number,
    toVersion: number,
  ): string | null {
    if (!this.migrationBackupDirectory) return null;
    const directory = this.migrationBackupDirectory;
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const snapshotPath = path.join(
      directory,
      `migrate-v${fromVersion}-to-v${toVersion}-${stamp}.db`,
    );
    try {
      mkdirSync(directory, { recursive: true });
      return backupDatabaseSync(this.db, snapshotPath) ? snapshotPath : null;
    } catch {
      return null;
    }
  }

  private recordMigrationLog(entry: MigrationLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO migration_log
          (id, step_id, from_version, to_version, snapshot_path, result, error,
           started_at, finished_at)
         VALUES (@id, @step_id, @from_version, @to_version, @snapshot_path,
           @result, @error, @started_at, @finished_at)`,
      )
      .run({
        id: entry.id,
        step_id: entry.stepId,
        from_version: entry.fromVersion,
        to_version: entry.toVersion,
        snapshot_path: entry.snapshotPath,
        result: entry.result,
        error: entry.error,
        started_at: entry.startedAt,
        finished_at: entry.finishedAt,
      });
  }

  /** Returns the recorded migration history, oldest first. */
  getMigrationLog(): MigrationLogEntry[] {
    return this.db
      .prepare(
        `SELECT id, step_id AS stepId, from_version AS fromVersion,
           to_version AS toVersion, snapshot_path AS snapshotPath, result,
           error, started_at AS startedAt, finished_at AS finishedAt
         FROM migration_log ORDER BY started_at ASC, rowid ASC`,
      )
      .all() as MigrationLogEntry[];
  }

  getSchemaVersion(): number {
    return this.db.pragma("user_version", { simple: true }) as number;
  }

  integrityCheck(): boolean {
    const result = this.db.pragma("integrity_check", { simple: true });
    return result === "ok";
  }

  async backupTo(filename: string): Promise<void> {
    await this.db.backup(filename);
  }

  upsertAsset(asset: NewAsset): { asset: AssetRecord; reused: boolean } {
    const existing = this.db
      .prepare("SELECT * FROM assets WHERE path_key = ?")
      .get(asset.pathKey) as AssetRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE assets SET title = ?, path = ?, extension = ?, size = ?,
          mtime_ms = ?, fingerprint = ?, content_hash = ?,
          visual_hash = NULL, color_signature = NULL,
          dominant_r = NULL, dominant_g = NULL, dominant_b = NULL,
          lifecycle = 'active', deleted_at = NULL, trash_path = NULL,
          link_state = 'online', storage_mode = ?, width = ?, height = ?,
          duration = ?, bpm = ?, custom_fields = ?, updated_at = ? WHERE id = ?
      `).run(
        asset.title, asset.path, asset.extension, asset.size, asset.mtimeMs,
        asset.fingerprint, asset.contentHash ?? null, asset.storageMode ?? "linked",
        asset.width, asset.height, asset.duration, asset.bpm ?? null,
        JSON.stringify(asset.customFields ?? {}), now, existing.id,
      );
      if (
        asset.libraryRelativePath !== undefined ||
        asset.originalSourcePath !== undefined
      ) {
        this.db.prepare(`
          UPDATE assets SET library_relative_path = ?,
            original_source_path = ? WHERE id = ?
        `).run(
          asset.libraryRelativePath ?? existing.library_relative_path,
          asset.originalSourcePath ?? existing.original_source_path,
          existing.id,
        );
      }
      return { asset: this.getAsset(existing.id)!, reused: true };
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO assets (
        id, title, kind, path, path_key, extension, size, mtime_ms,
        fingerprint, content_hash, lifecycle, deleted_at, trash_path,
        favorite, rating, color_label, link_state, notes, width, height,
        duration, bpm, custom_fields, custom_thumbnail_path,
        storage_mode, library_relative_path, original_source_path,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL,
        0, 0, 'none', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, asset.title, asset.kind, asset.path, asset.pathKey, asset.extension,
      asset.size, asset.mtimeMs, asset.fingerprint, asset.contentHash ?? null,
      asset.linkState, asset.notes, asset.width, asset.height, asset.duration,
      asset.bpm ?? null, JSON.stringify(asset.customFields ?? {}),
      asset.customThumbnailPath ?? null,
      asset.storageMode ?? "linked",
      asset.libraryRelativePath ?? null,
      asset.originalSourcePath ?? null,
      now, now,
    );
    return { asset: this.getAsset(id)!, reused: false };
  }

  upsertAssets(assets: NewAsset[]): Array<{ asset: AssetRecord; reused: boolean }> {
    return this.db.transaction((items: NewAsset[]) =>
      items.map((asset) => this.upsertAsset(asset)),
    )(assets);
  }

  /**
   * Inserts an asset record with an explicit id (used when merging libraries so
   * board references and ids survive across libraries). Throws when the id or
   * the normalized path is already occupied.
   */
  insertAssetWithId(id: string, asset: NewAsset): AssetRecord {
    if (this.db.prepare("SELECT id FROM assets WHERE id = ?").get(id)) {
      throw new Error("ASSET_ID_EXISTS");
    }
    if (this.getAssetByPath(asset.path)) {
      throw new Error("ASSET_PATH_CONFLICT");
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO assets (
        id, title, kind, path, path_key, extension, size, mtime_ms,
        fingerprint, content_hash, lifecycle, deleted_at, trash_path,
        favorite, rating, color_label, link_state, notes, width, height,
        duration, bpm, custom_fields, custom_thumbnail_path,
        storage_mode, library_relative_path, original_source_path,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL,
        0, 0, 'none', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, asset.title, asset.kind, asset.path, asset.pathKey, asset.extension,
      asset.size, asset.mtimeMs, asset.fingerprint, asset.contentHash ?? null,
      asset.linkState, asset.notes, asset.width, asset.height, asset.duration,
      asset.bpm ?? null, JSON.stringify(asset.customFields ?? {}),
      asset.customThumbnailPath ?? null,
      asset.storageMode ?? "linked",
      asset.libraryRelativePath ?? null,
      asset.originalSourcePath ?? null,
      now, now,
    );
    const inserted = this.getAsset(id);
    if (!inserted) throw new Error("ASSET_INSERT_FAILED");
    return inserted;
  }

  getAsset(id: string): AssetRecord | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
      | AssetRow
      | undefined;
    return row ? this.hydrateAsset(mapAsset(row)) : null;
  }

  private hydrateAsset(asset: AssetRecord): AssetRecord {
    const tags = this.db.prepare(`
      SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id = t.id
      WHERE at.asset_id = ? ORDER BY t.name COLLATE NOCASE
    `).all(asset.id) as Array<{ name: string }>;
    const collections = this.db.prepare(
      "SELECT collection_id FROM collection_assets WHERE asset_id = ?",
    ).all(asset.id) as Array<{ collection_id: string }>;
    asset.tags = tags.map((item) => item.name);
    asset.collectionIds = collections.map((item) => item.collection_id);
    return asset;
  }

  getAssetPath(id: string): string | null {
    const row = this.db.prepare(
      "SELECT path, trash_path, lifecycle FROM assets WHERE id = ?",
    ).get(id) as Pick<AssetRow, "path" | "trash_path" | "lifecycle"> | undefined;
    if (!row || row.lifecycle === "purged") return null;
    return row.lifecycle === "trashed" ? row.trash_path : row.path;
  }

  getAssetByPath(filename: string): AssetRecord | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE path_key = ?").get(
      pathKeyFor(filename),
    ) as AssetRow | undefined;
    return row ? this.hydrateAsset(mapAsset(row)) : null;
  }

  private buildSearch(input: AssetSearchInput, includeCursor: boolean): {
    joins: string;
    where: string;
    params: unknown[];
    order: string;
    pageSize: number;
  } {
    const clauses: string[] = ["a.lifecycle = ?"];
    const params: unknown[] = [input.lifecycle ?? "active"];
    const joins: string[] = [];
    const query = input.query?.trim() ?? "";
    if (input.kind && input.kind !== "all") {
      clauses.push("a.kind = ?");
      params.push(input.kind);
    }
    if (input.linkState && input.linkState !== "all") {
      clauses.push("a.link_state = ?");
      params.push(input.linkState);
    }
    if (input.extension) {
      clauses.push("a.extension = ? COLLATE NOCASE");
      params.push(input.extension.replace(/^\./, ""));
    }
    if (input.orientation) {
      clauses.push("a.width > 0 AND a.height > 0");
      if (input.orientation === "landscape") clauses.push("a.width > a.height");
      if (input.orientation === "portrait") clauses.push("a.height > a.width");
      if (input.orientation === "square") {
        clauses.push("ABS(a.width - a.height) <= MAX(a.width, a.height) * 0.02");
      }
    }
    if (query) {
      const rawTokens = query.split(/\s+/).filter(Boolean);
      const tokens = rawTokens
        .map((token) => `"${token.replaceAll('"', '""')}"*`);
      const ftsQuery = tokens.join(" AND ");
      const annotationFallback = rawTokens
        .map(
          () => `EXISTS (
            SELECT 1 FROM asset_annotations aal
            WHERE aal.asset_id = a.id
              AND LOWER(aal.text) LIKE LOWER(?) ESCAPE '\\'
          )`,
        )
        .join(" AND ");
      clauses.push(`(
        a.rowid IN (
          SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?
        )
        OR a.id IN (
          SELECT aa.asset_id
          FROM asset_annotations aa
          JOIN asset_annotations_fts aaf ON aaf.rowid = aa.rowid
          WHERE asset_annotations_fts MATCH ?
        )
        OR (${annotationFallback})
      )`);
      params.push(
        ftsQuery,
        ftsQuery,
        ...rawTokens.map(
          (token) => `%${token.replace(/[\\%_]/g, "\\$&")}%`,
        ),
      );
    }
    if (input.collectionId) {
      joins.push("JOIN collection_assets ca ON ca.asset_id = a.id");
      if (!input.linkState || input.linkState === "all") {
        clauses.push("a.link_state = 'online'");
      }
      if (input.includeSubcollections === false) {
        clauses.push("ca.collection_id = ?");
        params.push(input.collectionId);
      } else {
        clauses.push(`ca.collection_id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT ?
          UNION ALL
          SELECT c.id FROM collections c
          JOIN descendants d ON c.parent_id = d.id
        )
        SELECT id FROM descendants
      )`);
        params.push(input.collectionId);
      }
    }
    if (input.tag) {
      joins.push("JOIN asset_tags sat ON sat.asset_id = a.id");
      joins.push("JOIN tags st ON st.id = sat.tag_id");
      clauses.push("(st.name = ? COLLATE NOCASE OR st.alias = ? COLLATE NOCASE)");
      params.push(input.tag, input.tag);
    }
    if (input.includeTags?.length) {
      input.includeTags.forEach((tag, tagIndex) => {
        const alias = `it${tagIndex}`;
        joins.push(
          `JOIN asset_tags ${alias} ON ${alias}.asset_id = a.id`,
        );
        joins.push(
          `JOIN tags itg${tagIndex} ON itg${tagIndex}.id = ${alias}.tag_id`,
        );
        clauses.push(
          `(itg${tagIndex}.name = ? COLLATE NOCASE OR itg${tagIndex}.alias = ? COLLATE NOCASE)`,
        );
        params.push(tag, tag);
      });
    }
    if (input.anyTags?.length) {
      joins.push("JOIN asset_tags at_any ON at_any.asset_id = a.id");
      joins.push("JOIN tags atg_any ON atg_any.id = at_any.tag_id");
      clauses.push(
        `(atg_any.name IN (${input.anyTags.map(() => "?").join(",")}) COLLATE NOCASE OR atg_any.alias IN (${input.anyTags.map(() => "?").join(",")}) COLLATE NOCASE)`,
      );
      params.push(...input.anyTags, ...input.anyTags);
    }
    if (input.excludeTags?.length) {
      for (const tag of input.excludeTags) {
        clauses.push(`NOT EXISTS (
          SELECT 1 FROM asset_tags xt JOIN tags xg ON xg.id = xt.tag_id
          WHERE xt.asset_id = a.id
            AND (xg.name = ? COLLATE NOCASE OR xg.alias = ? COLLATE NOCASE)
        )`);
        params.push(tag, tag);
      }
    }
    if (input.pathContains) {
      clauses.push("LOWER(a.path) LIKE LOWER(?) ESCAPE '\\'");
      params.push(`%${input.pathContains.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.filenameContains) {
      clauses.push("LOWER(a.title) LIKE LOWER(?) ESCAPE '\\'");
      params.push(`%${input.filenameContains.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.notesContains) {
      clauses.push("(LOWER(a.notes) LIKE LOWER(?) ESCAPE '\\' OR EXISTS (SELECT 1 FROM asset_annotations an WHERE an.asset_id = a.id AND LOWER(an.text) LIKE LOWER(?) ESCAPE '\\') OR EXISTS (SELECT 1 FROM media_notes mn WHERE mn.asset_id = a.id AND LOWER(mn.text) LIKE LOWER(?) ESCAPE '\\'))");
      params.push(
        `%${input.notesContains.replace(/[\\%_]/g, "\\$&")}%`,
        `%${input.notesContains.replace(/[\\%_]/g, "\\$&")}%`,
        `%${input.notesContains.replace(/[\\%_]/g, "\\$&")}%`,
      );
    }
    if (input.exactAspectRatio) {
      const match = /^(\d+)\s*[:：]\s*(\d+)$/.exec(input.exactAspectRatio);
      if (match) {
        const widthRatio = Number(match[1]);
        const heightRatio = Number(match[2]);
        clauses.push(
          "a.width > 0 AND a.height > 0 AND ABS(a.width * ? - a.height * ?) <= MAX(a.width, a.height)",
        );
        params.push(heightRatio, widthRatio);
      }
    }
    if (input.customFields?.length) {
      for (const condition of input.customFields) {
        clauses.push(`EXISTS (
          SELECT 1 FROM json_each(a.custom_fields) je
          WHERE je.key = ? AND LOWER(je.value) LIKE LOWER(?) ESCAPE '\\'
        )`);
        params.push(
          condition.key,
          `%${condition.value.replace(/[\\%_]/g, "\\$&")}%`,
        );
      }
    }
    if (input.favorite !== undefined) {
      clauses.push("a.favorite = ?");
      params.push(input.favorite ? 1 : 0);
    }
    if (input.ratingMin !== undefined) {
      clauses.push("a.rating >= ?");
      params.push(input.ratingMin);
    }
    if (input.colorLabel && input.colorLabel !== "none") {
      clauses.push("a.color_label = ?");
      params.push(input.colorLabel);
    }
    if (input.dominantColor) {
      const match = /^#([0-9a-f]{6})$/i.exec(input.dominantColor);
      if (!match) throw new Error("INVALID_DOMINANT_COLOR");
      const color = Number.parseInt(match[1], 16);
      const red = (color >> 16) & 255;
      const green = (color >> 8) & 255;
      const blue = color & 255;
      const tolerance = Math.min(Math.max(input.colorTolerance ?? 25, 1), 100);
      const maxDistanceSquared = (441.673 * tolerance / 100) ** 2;
      clauses.push(`
        a.dominant_r IS NOT NULL
        AND (
          (a.dominant_r - ?) * (a.dominant_r - ?)
          + (a.dominant_g - ?) * (a.dominant_g - ?)
          + (a.dominant_b - ?) * (a.dominant_b - ?)
        ) <= ?
      `);
      params.push(
        red,
        red,
        green,
        green,
        blue,
        blue,
        maxDistanceSquared,
      );
    }
    for (const [key, column, operator] of [
      ["minWidth", "a.width", ">="],
      ["maxWidth", "a.width", "<="],
      ["minHeight", "a.height", ">="],
      ["maxHeight", "a.height", "<="],
      ["minSize", "a.size", ">="],
      ["maxSize", "a.size", "<="],
      ["minDuration", "a.duration", ">="],
      ["maxDuration", "a.duration", "<="],
      ["minBpm", "a.bpm", ">="],
      ["maxBpm", "a.bpm", "<="],
      ["createdAfter", "a.created_at", ">="],
      ["createdBefore", "a.created_at", "<="],
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        clauses.push(`${column} ${operator} ?`);
        params.push(value);
      }
    }
    for (const [key, operator] of [
      ["modifiedAfter", ">="],
      ["modifiedBefore", "<="],
    ] as const) {
      const value = input[key];
      if (value !== undefined) {
        clauses.push(`a.mtime_ms ${operator} ?`);
        params.push(Date.parse(value));
      }
    }

    const sort = input.sort ?? "createdAt";
    const direction = input.direction ?? "desc";
    const column = sortColumns[sort];
    // Random order is inherently unstable, so cursor pagination is disabled for it.
    if (includeCursor && input.cursor && sort !== "random") {
      try {
        const cursor = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString("utf8"),
        ) as { value: string | number; id: string };
        const operator = direction === "desc" ? "<" : ">";
        clauses.push(`(${column} ${operator} ? OR (${column} = ? AND a.id ${operator} ?))`);
        params.push(cursor.value, cursor.value, cursor.id);
      } catch {
        throw new Error("INVALID_CURSOR");
      }
    }
    return {
      joins: joins.join("\n"),
      where: `WHERE ${clauses.join(" AND ")}`,
      params,
      order: `${column} ${direction.toUpperCase()}, a.id ${direction.toUpperCase()}`,
      pageSize: Math.min(Math.max(input.pageSize ?? input.limit ?? 120, 1), 500),
    };
  }

  searchAssets(input: AssetSearchInput = {}): AssetPage {
    const query = this.buildSearch(input, true);
    const countQuery = this.buildSearch({ ...input, cursor: undefined }, false);
    const total = (this.db.prepare(`
      SELECT COUNT(DISTINCT a.id) AS count FROM assets a
      ${countQuery.joins} ${countQuery.where}
    `).get(...countQuery.params) as { count: number }).count;
    const offset = Math.max(input.offset ?? 0, 0);
    const rows = this.db.prepare(`
      SELECT DISTINCT a.* FROM assets a ${query.joins} ${query.where}
      ORDER BY ${query.order} LIMIT ? OFFSET ?
    `).all(...query.params, query.pageSize + 1, offset) as AssetRow[];
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize).map((row) =>
      this.hydrateAsset(mapAsset(row)),
    );
    const last = rows[Math.min(query.pageSize, rows.length) - 1];
    const sort = input.sort ?? "createdAt";
    const cursorValues: Record<
      Exclude<typeof sort, "random">,
      string | number
    > = {
      createdAt: last?.created_at,
      updatedAt: last?.updated_at,
      mtimeMs: last?.mtime_ms,
      title: last?.title,
      size: last?.size,
      rating: last?.rating,
    };
    const nextCursor =
      hasMore && last && sort !== "random"
        ? Buffer.from(
            JSON.stringify({
              value: cursorValues[sort as Exclude<typeof sort, "random">],
              id: last.id,
            }),
          ).toString("base64url")
        : null;
    return { items, total, nextCursor };
  }

  resolveSelection(scope: SelectionScope): string[] {
    if (scope.mode === "ids") return [...new Set(scope.ids)];
    const query = this.buildSearch({ ...scope.query, cursor: undefined }, false);
    const excluded = new Set(scope.excludedIds);
    const rows = this.db.prepare(`
      SELECT DISTINCT a.id FROM assets a ${query.joins} ${query.where}
    `).all(...query.params) as Array<{ id: string }>;
    return rows.map((row) => row.id).filter((id) => !excluded.has(id));
  }

  updateAsset(
    id: string,
    patch: {
      title?: string;
      notes?: string;
      favorite?: boolean;
      rating?: number;
      colorLabel?: AssetRecord["colorLabel"];
    },
  ): AssetRecord {
    const current = this.getAsset(id);
    if (!current) throw new Error("ASSET_NOT_FOUND");
    this.db.prepare(`
      UPDATE assets SET title = ?, notes = ?, favorite = ?, rating = ?,
        color_label = ?, updated_at = ? WHERE id = ?
    `).run(
      patch.title ?? current.title,
      patch.notes ?? current.notes,
      patch.favorite === undefined ? Number(current.favorite) : Number(patch.favorite),
      patch.rating ?? current.rating,
      patch.colorLabel ?? current.colorLabel,
      new Date().toISOString(),
      id,
    );
    return this.getAsset(id)!;
  }

  listAssetAnnotations(assetId: string): AssetAnnotation[] {
    const rows = this.db.prepare(`
      SELECT * FROM asset_annotations
      WHERE asset_id = ? ORDER BY created_at, id
    `).all(assetId) as AssetAnnotationRow[];
    return rows.map(mapAssetAnnotation);
  }

  createAssetAnnotation(
    assetId: string,
    input: { x: number; y: number; text: string },
  ): AssetAnnotation {
    if (!this.getAsset(assetId)) throw new Error("ASSET_NOT_FOUND");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO asset_annotations (
        id, asset_id, x, y, text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, assetId, input.x, input.y, input.text, now, now);
    this.db.prepare(
      "UPDATE assets SET updated_at = ? WHERE id = ?",
    ).run(now, assetId);
    return mapAssetAnnotation(
      this.db.prepare(
        "SELECT * FROM asset_annotations WHERE id = ?",
      ).get(id) as AssetAnnotationRow,
    );
  }

  updateAssetAnnotation(
    id: string,
    patch: { x?: number; y?: number; text?: string },
  ): AssetAnnotation {
    const current = this.db.prepare(
      "SELECT * FROM asset_annotations WHERE id = ?",
    ).get(id) as AssetAnnotationRow | undefined;
    if (!current) throw new Error("ANNOTATION_NOT_FOUND");
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE asset_annotations SET x = ?, y = ?, text = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.x ?? current.x,
      patch.y ?? current.y,
      patch.text ?? current.text,
      now,
      id,
    );
    this.db.prepare(
      "UPDATE assets SET updated_at = ? WHERE id = ?",
    ).run(now, current.asset_id);
    return mapAssetAnnotation(
      this.db.prepare(
        "SELECT * FROM asset_annotations WHERE id = ?",
      ).get(id) as AssetAnnotationRow,
    );
  }

  deleteAssetAnnotation(id: string): void {
    const current = this.db.prepare(
      "SELECT asset_id FROM asset_annotations WHERE id = ?",
    ).get(id) as Pick<AssetAnnotationRow, "asset_id"> | undefined;
    if (!current) throw new Error("ANNOTATION_NOT_FOUND");
    this.db.prepare("DELETE FROM asset_annotations WHERE id = ?").run(id);
    this.db.prepare(
      "UPDATE assets SET updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), current.asset_id);
  }

  // --- Time-point media notes (video/audio) ---

  listMediaNotes(assetId: string): MediaNote[] {
    return this.db.prepare(`
      SELECT id, asset_id AS assetId, time_ms AS timeMs, text,
        created_at AS createdAt, updated_at AS updatedAt
      FROM media_notes WHERE asset_id = ? ORDER BY time_ms, created_at
    `).all(assetId) as MediaNote[];
  }

  createMediaNote(
    assetId: string,
    input: { timeMs: number; text: string },
  ): MediaNote {
    if (!this.getAsset(assetId)) throw new Error("ASSET_NOT_FOUND");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO media_notes (id, asset_id, time_ms, text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, assetId, input.timeMs, input.text, now, now);
    return this.db.prepare(`
      SELECT id, asset_id AS assetId, time_ms AS timeMs, text,
        created_at AS createdAt, updated_at AS updatedAt
      FROM media_notes WHERE id = ?
    `).get(id) as MediaNote;
  }

  updateMediaNote(
    id: string,
    patch: { timeMs?: number; text?: string },
  ): MediaNote {
    const current = this.db.prepare(
      "SELECT * FROM media_notes WHERE id = ?",
    ).get(id) as MediaNote | undefined;
    if (!current) throw new Error("MEDIA_NOTE_NOT_FOUND");
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE media_notes SET time_ms = ?, text = ?, updated_at = ? WHERE id = ?
    `).run(
      patch.timeMs ?? current.timeMs,
      patch.text ?? current.text,
      now,
      id,
    );
    return this.db.prepare(`
      SELECT id, asset_id AS assetId, time_ms AS timeMs, text,
        created_at AS createdAt, updated_at AS updatedAt
      FROM media_notes WHERE id = ?
    `).get(id) as MediaNote;
  }

  deleteMediaNote(id: string): void {
    const result = this.db.prepare("DELETE FROM media_notes WHERE id = ?").run(id);
    if (!result.changes) throw new Error("MEDIA_NOTE_NOT_FOUND");
  }

  batchUpdate(scope: SelectionScope, patch: BatchAssetPatch): number {
    const ids = this.resolveSelection(scope);
    const run = this.db.transaction(() => {
      for (const id of ids) {
        const current = this.getAsset(id);
        if (!current) continue;
        this.updateAsset(id, {
          favorite: patch.favorite,
          rating: patch.rating,
          colorLabel: patch.colorLabel,
          notes: patch.notes,
        });
        if (patch.addCollectionId) this.addAssetToCollection(id, patch.addCollectionId);
        if (patch.removeCollectionId) this.removeAssetFromCollection(id, patch.removeCollectionId);
        if (patch.replaceTags) {
          this.setAssetTags(id, patch.replaceTags);
        } else if (patch.addTags?.length || patch.removeTags?.length) {
          const tags = new Set(current.tags);
          for (const tag of patch.addTags ?? []) tags.add(tag);
          for (const tag of patch.removeTags ?? []) tags.delete(tag);
          this.setAssetTags(id, [...tags]);
        }
      }
    });
    run();
    return ids.length;
  }

  batchRename(scope: SelectionScope, pattern: string): number {
    const ids = this.resolveSelection(scope);
    this.db.transaction(() => {
      ids.forEach((id, index) => {
        const asset = this.getAsset(id);
        if (!asset) return;
        const title = pattern
          .replaceAll("{name}", asset.title)
          .replaceAll("{index}", String(index + 1).padStart(3, "0"))
          .trim();
        if (!title || title.length > 256) throw new Error("INVALID_BATCH_TITLE");
        this.updateAsset(id, { title });
      });
    })();
    return ids.length;
  }

  setLinkState(id: string, state: AssetRecord["linkState"]): void {
    this.db.prepare(
      "UPDATE assets SET link_state = ?, updated_at = ? WHERE id = ? AND lifecycle = 'active'",
    ).run(state, new Date().toISOString(), id);
  }

  setLinkStateByPath(filename: string, state: AssetRecord["linkState"]): void {
    this.db.prepare(`
      UPDATE assets SET link_state = ?, updated_at = ?
      WHERE path_key = ? AND lifecycle = 'active'
    `).run(state, new Date().toISOString(), pathKeyFor(filename));
  }

  relinkAsset(id: string, asset: NewAsset): AssetRecord {
    if (!this.getAsset(id)) throw new Error("ASSET_NOT_FOUND");
    this.db.prepare(`
      UPDATE assets SET kind = ?, path = ?, path_key = ?, extension = ?,
        size = ?, mtime_ms = ?, fingerprint = ?, content_hash = ?,
        visual_hash = NULL, color_signature = NULL,
        dominant_r = NULL, dominant_g = NULL, dominant_b = NULL,
        lifecycle = 'active', deleted_at = NULL, trash_path = NULL,
        link_state = 'online', storage_mode = ?, width = ?, height = ?,
        duration = ?, bpm = ?, custom_fields = ?, updated_at = ? WHERE id = ?
    `).run(
      asset.kind, asset.path, asset.pathKey, asset.extension, asset.size,
      asset.mtimeMs, asset.fingerprint, asset.contentHash ?? null,
      asset.storageMode ?? "linked",
      asset.width, asset.height, asset.duration, asset.bpm ?? null,
      JSON.stringify(asset.customFields ?? {}), new Date().toISOString(), id,
    );
    if (
      asset.libraryRelativePath !== undefined ||
      asset.originalSourcePath !== undefined
    ) {
      const current = this.getAsset(id)!;
      this.db.prepare(`
        UPDATE assets SET library_relative_path = ?,
          original_source_path = ? WHERE id = ?
      `).run(
        asset.libraryRelativePath ?? current.libraryRelativePath,
        asset.originalSourcePath ?? current.originalSourcePath,
        id,
      );
    }
    return this.getAsset(id)!;
  }

  listAllAssetPaths(): Array<{ id: string; path: string }> {
    return this.db.prepare(
      "SELECT id, path FROM assets WHERE lifecycle = 'active'",
    ).all() as Array<{ id: string; path: string }>;
  }

  setContentHash(id: string, hash: string): void {
    this.db.prepare("UPDATE assets SET content_hash = ? WHERE id = ?").run(hash, id);
  }

  listImagesMissingVisualIndex(): Array<{ id: string; path: string }> {
    return this.db.prepare(`
      SELECT id, path FROM assets
      WHERE lifecycle = 'active' AND kind = 'image' AND link_state = 'online'
        AND (
          visual_hash IS NULL OR color_signature IS NULL
          OR dominant_r IS NULL OR dominant_g IS NULL OR dominant_b IS NULL
        )
      ORDER BY created_at
    `).all() as Array<{ id: string; path: string }>;
  }

  getVisualSignature(id: string): {
    visualHash: string;
    colorSignature: string;
  } | null {
    const row = this.db.prepare(`
      SELECT visual_hash, color_signature FROM assets
      WHERE id = ? AND lifecycle = 'active' AND kind = 'image'
    `).get(id) as {
      visual_hash: string | null;
      color_signature: string | null;
    } | undefined;
    return row?.visual_hash && row.color_signature
      ? {
          visualHash: row.visual_hash,
          colorSignature: row.color_signature,
        }
      : null;
  }

  setVisualSignature(
    id: string,
    visualHash: string,
    colorSignature: string,
    dominantColor: { r: number; g: number; b: number },
  ): void {
    this.db.prepare(`
      UPDATE assets SET visual_hash = ?, color_signature = ?,
        dominant_r = ?, dominant_g = ?, dominant_b = ?
      WHERE id = ? AND lifecycle = 'active' AND kind = 'image'
    `).run(
      visualHash,
      colorSignature,
      dominantColor.r,
      dominantColor.g,
      dominantColor.b,
      id,
    );
  }

  listVisualSignatures(excludeId?: string): Array<{
    id: string;
    visualHash: string;
    colorSignature: string;
  }> {
    const rows = this.db.prepare(`
      SELECT id, visual_hash, color_signature FROM assets
      WHERE lifecycle = 'active' AND kind = 'image'
        AND visual_hash IS NOT NULL AND color_signature IS NOT NULL
        AND (? IS NULL OR id <> ?)
    `).all(excludeId ?? null, excludeId ?? null) as Array<{
      id: string;
      visual_hash: string;
      color_signature: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      visualHash: row.visual_hash,
      colorSignature: row.color_signature,
    }));
  }

  markTrashed(id: string, trashPath: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE assets SET lifecycle = 'trashed', deleted_at = ?,
        trash_path = ?, updated_at = ? WHERE id = ?
    `).run(now, trashPath, now, id);
  }

  markRestored(id: string, restoredPath: string): void {
    this.db.prepare(`
      UPDATE assets SET lifecycle = 'active', deleted_at = NULL,
        trash_path = NULL, path = ?, path_key = ?, link_state = 'online',
        updated_at = ? WHERE id = ?
    `).run(restoredPath, pathKeyFor(restoredPath), new Date().toISOString(), id);
  }

  markPurged(id: string): void {
    const refs = this.getAssetReferences(id).length;
    if (refs) {
      this.db.prepare(`
        UPDATE assets SET lifecycle = 'purged', trash_path = NULL,
          link_state = 'missing', updated_at = ? WHERE id = ?
      `).run(new Date().toISOString(), id);
    } else {
      this.db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    }
  }

  /**
   * Removes a record from the library without touching any file. Records still
   * referenced by boards are kept as `purged` so canvases keep loading; records
   * without references are fully deleted. Returns true when the record was
   * deleted (callers may then clean up managed store files).
   */
  purgeRecord(id: string): boolean {
    const refs = this.getAssetReferences(id).length;
    if (refs) {
      this.db.prepare(`
        UPDATE assets SET lifecycle = 'purged', trash_path = NULL,
          link_state = 'missing', updated_at = ? WHERE id = ?
      `).run(new Date().toISOString(), id);
      return false;
    }
    const result = this.db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    return result.changes > 0;
  }

  listManagedAssets(): Array<{
    id: string;
    path: string;
    libraryRelativePath: string;
  }> {
    const rows = this.db.prepare(`
      SELECT id, path, library_relative_path AS libraryRelativePath
      FROM assets WHERE lifecycle = 'active' AND storage_mode = 'managed'
    `).all() as Array<{ id: string; path: string; libraryRelativePath: string }>;
    return rows;
  }

  recordFileOperation(
    assetId: string,
    operation: "trash" | "restore" | "purge",
    sourcePath: string,
    targetPath: string,
  ): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO file_operations
        (id, asset_id, operation, source_path, target_path, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, assetId, operation, sourcePath, targetPath, now, now);
    return id;
  }

  completeFileOperation(id: string): void {
    this.db.prepare(
      "UPDATE file_operations SET state = 'completed', updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
  }

  listPendingFileOperations(): Array<{
    id: string;
    assetId: string;
    operation: "trash" | "restore" | "purge";
    sourcePath: string;
    targetPath: string;
  }> {
    const rows = this.db.prepare(
      "SELECT * FROM file_operations WHERE state = 'pending' ORDER BY created_at",
    ).all() as Array<{
      id: string;
      asset_id: string;
      operation: "trash" | "restore" | "purge";
      source_path: string;
      target_path: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      operation: row.operation,
      sourcePath: row.source_path,
      targetPath: row.target_path,
    }));
  }

  listDuplicateCandidates(): Array<{ fingerprint: string; size: number; ids: string[] }> {
    const groups = this.db.prepare(`
      SELECT fingerprint, size, GROUP_CONCAT(id) AS ids
      FROM assets WHERE lifecycle = 'active'
      GROUP BY fingerprint, size HAVING COUNT(*) > 1
    `).all() as Array<{ fingerprint: string; size: number; ids: string }>;
    return groups.map((group) => ({ ...group, ids: group.ids.split(",") }));
  }

  listDuplicateGroups(): DuplicateGroup[] {
    const groups = this.db.prepare(`
      SELECT content_hash, size FROM assets
      WHERE lifecycle = 'active' AND content_hash IS NOT NULL
      GROUP BY content_hash, size HAVING COUNT(*) > 1
      ORDER BY size DESC
    `).all() as Array<{ content_hash: string; size: number }>;
    return groups.map((group) => {
      const rows = this.db.prepare(`
        SELECT * FROM assets WHERE lifecycle = 'active'
          AND content_hash = ? AND size = ? ORDER BY created_at
      `).all(group.content_hash, group.size) as AssetRow[];
      return {
        contentHash: group.content_hash,
        size: group.size,
        assets: rows.map((row) => this.hydrateAsset(mapAsset(row))),
      };
    });
  }

  mergeAssetRecords(keepId: string, removeIds: string[]): AssetRecord {
    const keep = this.getAsset(keepId);
    if (!keep) throw new Error("ASSET_NOT_FOUND");
    this.db.transaction(() => {
      for (const removeId of removeIds) {
        const removed = this.getAsset(removeId);
        if (!removed) continue;
        for (const tag of removed.tags) {
          if (!keep.tags.includes(tag)) keep.tags.push(tag);
        }
        for (const collectionId of removed.collectionIds) {
          this.addAssetToCollection(keepId, collectionId);
        }
        this.db.prepare(
          "UPDATE asset_annotations SET asset_id = ? WHERE asset_id = ?",
        ).run(keepId, removeId);
        this.updateAsset(keepId, {
          favorite: keep.favorite || removed.favorite,
          rating: Math.max(keep.rating, removed.rating),
        });
        for (const board of this.listBoardsRaw()) {
          let document = toBoardV2(JSON.parse(board.document_json) as BoardDocument);
          if (assetIdsFromDocument(document).includes(removeId)) {
            document = rewriteAssetId(document, removeId, keepId);
            this.saveBoard(board.id, document);
          }
        }
      }
      this.setAssetTags(keepId, keep.tags);
    })();
    return this.getAsset(keepId)!;
  }

  listWatchRoots(): WatchRoot[] {
    const rows = this.db.prepare(
      "SELECT * FROM watch_roots ORDER BY created_at",
    ).all() as WatchRootRow[];
    return rows.map((row) => ({ id: row.id, path: row.path, createdAt: row.created_at }));
  }

  addWatchRoot(rootPath: string): WatchRoot {
    const existing = this.db.prepare(
      "SELECT * FROM watch_roots WHERE path = ?",
    ).get(rootPath) as WatchRootRow | undefined;
    if (existing) return { id: existing.id, path: existing.path, createdAt: existing.created_at };
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO watch_roots (id, path, created_at) VALUES (?, ?, ?)",
    ).run(id, rootPath, createdAt);
    return { id, path: rootPath, createdAt };
  }

  removeWatchRoot(id: string): WatchRoot {
    const row = this.db.prepare(
      "SELECT * FROM watch_roots WHERE id = ?",
    ).get(id) as WatchRootRow | undefined;
    if (!row) throw new Error("WATCH_ROOT_NOT_FOUND");
    this.db.prepare("DELETE FROM watch_roots WHERE id = ?").run(id);
    return { id: row.id, path: row.path, createdAt: row.created_at };
  }

  /**
   * Persistent file-identity index for watched roots. Every asset recorded
   * under a watched root keeps a row here keyed by its on-disk path, so a
   * rename or cross-directory move can be confirmed by fingerprint without
   * relying on live watcher events.
   */
  upsertFileIdentity(identity: {
    pathKey: string;
    assetId: string;
    fingerprint: string;
    size: number;
    rootPath: string;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO file_identities
        (path_key, asset_id, fingerprint, size, root_path, created_at, updated_at)
      VALUES (@path_key, @asset_id, @fingerprint, @size, @root_path, @created_at, @updated_at)
      ON CONFLICT(path_key) DO UPDATE SET
        asset_id = excluded.asset_id,
        fingerprint = excluded.fingerprint,
        size = excluded.size,
        root_path = excluded.root_path,
        updated_at = excluded.updated_at
    `).run({
      path_key: identity.pathKey,
      asset_id: identity.assetId,
      fingerprint: identity.fingerprint,
      size: identity.size,
      root_path: identity.rootPath,
      created_at: now,
      updated_at: now,
    });
  }

  upsertFileIdentities(
    identities: Array<{
      pathKey: string;
      assetId: string;
      fingerprint: string;
      size: number;
      rootPath: string;
    }>,
  ): void {
    this.db.transaction((items: typeof identities) => {
      for (const identity of items) this.upsertFileIdentity(identity);
    })(identities);
  }

  deleteFileIdentity(pathKey: string): void {
    this.db.prepare("DELETE FROM file_identities WHERE path_key = ?").run(pathKey);
  }

  deleteFileIdentityByAsset(assetId: string): void {
    this.db.prepare(
      "DELETE FROM file_identities WHERE asset_id = ?",
    ).run(assetId);
  }

  getFileIdentity(assetId: string): {
    pathKey: string;
    fingerprint: string;
    size: number;
    rootPath: string;
  } | null {
    const row = this.db.prepare(
      "SELECT * FROM file_identities WHERE asset_id = ?",
    ).get(assetId) as {
      path_key: string;
      fingerprint: string;
      size: number;
      root_path: string;
    } | undefined;
    return row
      ? {
          pathKey: row.path_key,
          fingerprint: row.fingerprint,
          size: row.size,
          rootPath: row.root_path,
        }
      : null;
  }

  listFileIdentitiesByRoot(
    rootPath: string,
  ): Array<{
    pathKey: string;
    assetId: string;
    fingerprint: string;
    size: number;
  }> {
    const rows = this.db.prepare(`
      SELECT path_key AS pathKey, asset_id AS assetId,
        fingerprint, size
      FROM file_identities WHERE root_path = ?
    `).all(rootPath) as Array<{
      pathKey: string;
      assetId: string;
      fingerprint: string;
      size: number;
    }>;
    return rows;
  }

  findIdentityByFingerprint(
    fingerprint: string,
    size: number,
  ): Array<{ pathKey: string; assetId: string }> {
    const rows = this.db.prepare(`
      SELECT path_key AS pathKey, asset_id AS assetId
      FROM file_identities WHERE fingerprint = ? AND size = ?
    `).all(fingerprint, size) as Array<{
      pathKey: string;
      assetId: string;
    }>;
    return rows;
  }

  listAssetIdentityStatus(): Array<{
    assetId: string;
    path: string;
    fingerprint: string;
    size: number;
  }> {
    return this.db.prepare(`
      SELECT id AS assetId, path, fingerprint, size FROM assets
      WHERE lifecycle = 'active'
    `).all() as Array<{
      assetId: string;
      path: string;
      fingerprint: string;
      size: number;
    }>;
  }

  // --- Deferred watch reconciliation queue ---

  enqueueReconcileEntry(input: {
    rootPath: string;
    eventType: ReconcileEntry["eventType"];
    filename: string;
    assetId: string | null;
    candidates: ReconcileEntry["candidates"];
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO reconcile_queue
        (id, root_path, event_type, filename, asset_id, state, candidates_json, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      randomUUID(),
      input.rootPath,
      input.eventType,
      input.filename,
      input.assetId,
      JSON.stringify(input.candidates),
      now,
    );
  }

  listReconcileEntries(state?: "pending" | "resolved" | "dropped"): ReconcileEntry[] {
    const rows = (state
      ? this.db.prepare(`
          SELECT * FROM reconcile_queue WHERE state = ? ORDER BY created_at, rowid
        `).all(state)
      : this.db.prepare(`
          SELECT * FROM reconcile_queue ORDER BY created_at, rowid
        `).all()) as Array<{
      id: string;
      root_path: string;
      event_type: ReconcileEntry["eventType"];
      filename: string;
      asset_id: string | null;
      state: ReconcileEntry["state"];
      candidates_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      rootPath: row.root_path,
      eventType: row.event_type,
      filename: row.filename,
      assetId: row.asset_id,
      state: row.state,
      candidates: JSON.parse(row.candidates_json) as ReconcileEntry["candidates"],
      createdAt: row.created_at,
    }));
  }

  markReconcileEntryResolved(id: string, assetId: string): void {
    this.db.prepare(`
      UPDATE reconcile_queue SET state = 'resolved', asset_id = ?
      WHERE id = ?
    `).run(assetId, id);
  }

  dropReconcileEntry(id: string): void {
    this.db.prepare(
      "UPDATE reconcile_queue SET state = 'dropped' WHERE id = ?",
    ).run(id);
  }

  deleteResolvedReconcileEntries(): void {
    this.db.prepare(
      "DELETE FROM reconcile_queue WHERE state IN ('resolved', 'dropped')",
    ).run();
  }

  listCollections(): CollectionRecord[] {
    const rows = this.db.prepare(`
      SELECT c.*, COUNT(CASE WHEN a.lifecycle = 'active' AND a.link_state = 'online' THEN 1 END) AS asset_count
      FROM collections c
      LEFT JOIN collection_assets ca ON ca.collection_id = c.id
      LEFT JOIN assets a ON a.id = ca.asset_id
      GROUP BY c.id ORDER BY c.sort_order, c.created_at
    `).all() as CollectionRow[];
    const directCounts = new Map(rows.map((row) => [row.id, row.asset_count]));
    const children = new Map<string | null, CollectionRow[]>();
    for (const row of rows) {
      const siblings = children.get(row.parent_id) ?? [];
      siblings.push(row);
      children.set(row.parent_id, siblings);
    }
    const totals = new Map<string, number>();
    const countTree = (id: string, visiting = new Set<string>()): number => {
      if (totals.has(id)) return totals.get(id)!;
      if (visiting.has(id)) return directCounts.get(id) ?? 0;
      visiting.add(id);
      const total = (directCounts.get(id) ?? 0) +
        (children.get(id) ?? []).reduce(
          (sum, child) => sum + countTree(child.id, visiting),
          0,
        );
      visiting.delete(id);
      totals.set(id, total);
      return total;
    };
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      directAssetCount: row.asset_count,
      assetCount: countTree(row.id),
      locked: Boolean(row.lock_hash),
      createdAt: row.created_at,
    }));
  }

  createCollection(title: string, parentId: string | null = null): CollectionRecord {
    if (parentId && !this.getCollection(parentId)) {
      throw new Error("COLLECTION_PARENT_NOT_FOUND");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const nextOrder = (this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM collections WHERE parent_id IS ?
    `).get(parentId) as { value: number }).value;
    this.db.prepare(
      `INSERT INTO collections
        (id, title, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, title, parentId, nextOrder, createdAt);
    return this.getCollection(id)!;
  }

  getCollection(id: string): CollectionRecord | null {
    return this.listCollections().find((collection) => collection.id === id) ?? null;
  }

  findOrCreateCollection(title: string, parentId: string | null = null): CollectionRecord {
    const existing = this.listCollections().find(
      (collection) =>
        collection.parentId === parentId &&
        collection.title.localeCompare(title, undefined, { sensitivity: "accent" }) === 0,
    );
    return existing ?? this.createCollection(title, parentId);
  }

  findOrCreateCollectionId(title: string, parentId: string | null = null): string {
    const existing = this.db.prepare(`
      SELECT id FROM collections
      WHERE parent_id IS ? AND title = ? COLLATE NOCASE
      LIMIT 1
    `).get(parentId, title) as { id: string } | undefined;
    if (existing) return existing.id;
    if (
      parentId &&
      !this.db.prepare("SELECT 1 FROM collections WHERE id = ?").get(parentId)
    ) {
      throw new Error("COLLECTION_PARENT_NOT_FOUND");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const nextOrder = (this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM collections WHERE parent_id IS ?
    `).get(parentId) as { value: number }).value;
    this.db.prepare(
      `INSERT INTO collections
        (id, title, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, title, parentId, nextOrder, createdAt);
    return id;
  }

  markCollectionSource(
    collectionId: string,
    watchRootPath: string,
    relativePath: string,
  ): void {
    this.db.prepare(`
      INSERT INTO collection_sources(collection_id, watch_root_path, relative_path)
      VALUES (?, ?, ?)
      ON CONFLICT(collection_id) DO UPDATE SET
        watch_root_path = excluded.watch_root_path,
        relative_path = excluded.relative_path
    `).run(collectionId, path.resolve(watchRootPath), relativePath);
  }

  pruneEmptyGeneratedCollections(watchRootPath?: string): string[] {
    const removed: string[] = [];
    const root = watchRootPath ? path.resolve(watchRootPath) : null;
    this.db.transaction(() => {
      while (true) {
        const rows = this.db.prepare(`
          SELECT cs.collection_id AS id
          FROM collection_sources cs
          WHERE (? IS NULL OR cs.watch_root_path = ?)
            AND NOT EXISTS (
              SELECT 1 FROM collections child
              WHERE child.parent_id = cs.collection_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM collection_assets ca
              JOIN assets a ON a.id = ca.asset_id
              WHERE ca.collection_id = cs.collection_id
                AND a.lifecycle = 'active'
                AND a.link_state = 'online'
            )
        `).all(root, root) as Array<{ id: string }>;
        if (!rows.length) break;
        for (const row of rows) {
          this.db.prepare("DELETE FROM collections WHERE id = ?").run(row.id);
          removed.push(row.id);
        }
      }
    })();
    return removed;
  }

  updateCollection(
    id: string,
    patch: { title?: string; parentId?: string | null; sortOrder?: number },
  ): CollectionRecord {
    const current = this.getCollection(id);
    if (!current) throw new Error("COLLECTION_NOT_FOUND");
    const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
    if (parentId === id) throw new Error("COLLECTION_CYCLE");
    if (parentId) {
      if (!this.getCollection(parentId)) throw new Error("COLLECTION_PARENT_NOT_FOUND");
      const descendants = new Set(this.collectionDescendantIds(id));
      if (descendants.has(parentId)) throw new Error("COLLECTION_CYCLE");
    }
    this.db.prepare(`
      UPDATE collections SET title = ?, parent_id = ?, sort_order = ? WHERE id = ?
    `).run(
      patch.title ?? current.title,
      parentId,
      patch.sortOrder ?? current.sortOrder,
      id,
    );
    return this.getCollection(id)!;
  }

  deleteCollection(id: string): void {
    if (!this.getCollection(id)) throw new Error("COLLECTION_NOT_FOUND");
    const ids = [id, ...this.collectionDescendantIds(id)];
    this.db.transaction(() => {
      for (const collectionId of ids.reverse()) {
        this.db.prepare(
          "DELETE FROM collection_assets WHERE collection_id = ?",
        ).run(collectionId);
        this.db.prepare("DELETE FROM collections WHERE id = ?").run(collectionId);
      }
    })();
  }

  private collectionDescendantIds(id: string): string[] {
    const rows = this.db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM collections WHERE parent_id = ?
        UNION ALL
        SELECT c.id FROM collections c
        JOIN descendants d ON c.parent_id = d.id
      )
      SELECT id FROM descendants
    `).all(id) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Batch folder operations: create several folders at once, rename/move with
   * a pattern, and reorder. Each sub-operation is independent; validation
   * errors abort only that item.
   */
  batchCollections(op: BatchCollectionOp): CollectionRecord[] {
    for (const title of op.create ?? []) {
      this.createCollection(title);
    }
    for (const rename of op.rename ?? []) {
      if (!this.getCollection(rename.id)) continue;
      this.updateCollection(rename.id, { title: rename.title });
    }
    for (const move of op.move ?? []) {
      if (!this.getCollection(move.id)) continue;
      this.updateCollection(move.id, { parentId: move.parentId });
    }
    for (const reorder of op.reorder ?? []) {
      if (!this.getCollection(reorder.id)) continue;
      this.updateCollection(reorder.id, { sortOrder: reorder.sortOrder });
    }
    return this.listCollections();
  }

  /**
   * Folder lock is a local interface access lock only — it never claims disk
   * encryption. A salted SHA-256 hash of the password is stored; unlocked
   * folders stay unlocked for the session and re-lock on restart.
   */
  setFolderLock(id: string, password: string | null): { collectionId: string; locked: boolean } {
    if (!this.getCollection(id)) throw new Error("COLLECTION_NOT_FOUND");
    if (password === null || password === "") {
      this.db.prepare(
        "UPDATE collections SET lock_hash = NULL WHERE id = ?",
      ).run(id);
      this.unlockedFolders.delete(id);
      return { collectionId: id, locked: false };
    }
    const salt = randomBytes(16).toString("hex");
    const hash = lockHash(password, salt);
    this.db.prepare(
      "UPDATE collections SET lock_hash = ? WHERE id = ?",
    ).run(`${salt}:${hash}`, id);
    return { collectionId: id, locked: true };
  }

  unlockFolder(id: string, password: string): boolean {
    const row = this.db.prepare(
      "SELECT lock_hash FROM collections WHERE id = ?",
    ).get(id) as { lock_hash: string | null } | undefined;
    if (!row?.lock_hash) return true;
    const [salt, expected] = row.lock_hash.split(":");
    if (!salt || !expected) return false;
    if (lockHash(password, salt) === expected) {
      this.unlockedFolders.add(id);
      return true;
    }
    return false;
  }

  isFolderUnlocked(id: string): boolean {
    const row = this.db.prepare(
      "SELECT lock_hash FROM collections WHERE id = ?",
    ).get(id) as { lock_hash: string | null } | undefined;
    if (!row?.lock_hash) return true;
    return this.unlockedFolders.has(id);
  }

  addAssetToCollection(assetId: string, collectionId: string): AssetRecord {
    if (!this.getAsset(assetId)) throw new Error("ASSET_NOT_FOUND");
    this.db.prepare(`
      INSERT OR IGNORE INTO collection_assets (collection_id, asset_id) VALUES (?, ?)
    `).run(collectionId, assetId);
    return this.getAsset(assetId)!;
  }

  addAssetsToCollections(
    relations: Array<{ assetId: string; collectionId: string }>,
  ): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO collection_assets (collection_id, asset_id)
      VALUES (?, ?)
    `);
    this.db.transaction((items: typeof relations) => {
      for (const item of items) insert.run(item.collectionId, item.assetId);
    })(relations);
  }

  removeAssetFromCollection(assetId: string, collectionId: string): AssetRecord {
    this.db.prepare(
      "DELETE FROM collection_assets WHERE collection_id = ? AND asset_id = ?",
    ).run(collectionId, assetId);
    const asset = this.getAsset(assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    return asset;
  }

  setAssetTags(assetId: string, names: string[]): AssetRecord {
    if (!this.getAsset(assetId)) throw new Error("ASSET_NOT_FOUND");
    const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);
      for (const name of uniqueNames) {
        const existing = this.db.prepare(
          "SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
        ).get(name) as { id: string } | undefined;
        const tagId = existing?.id ?? randomUUID();
        if (!existing) {
          this.db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tagId, name);
        }
        this.db.prepare(
          "INSERT INTO asset_tags (asset_id, tag_id) VALUES (?, ?)",
        ).run(assetId, tagId);
      }
    })();
    return this.getAsset(assetId)!;
  }

  listTags(): TagRecord[] {
    return this.db.prepare(`
      SELECT t.id, t.name, t.alias, t.shortcut_key AS shortcutKey,
        t.group_id AS groupId,
        COUNT(CASE WHEN a.lifecycle = 'active' THEN 1 END) AS assetCount
      FROM tags t
      LEFT JOIN asset_tags at ON at.tag_id = t.id
      LEFT JOIN assets a ON a.id = at.asset_id
      GROUP BY t.id
      ORDER BY assetCount DESC, t.name COLLATE NOCASE
    `).all() as TagRecord[];
  }

  listTagGroups(): TagGroupRecord[] {
    return this.db.prepare(`
      SELECT g.id, g.title, g.sort_order AS sortOrder,
        COUNT(t.id) AS tagCount
      FROM tag_groups g
      LEFT JOIN tags t ON t.group_id = g.id
      GROUP BY g.id
      ORDER BY g.sort_order, g.title COLLATE NOCASE
    `).all() as TagGroupRecord[];
  }

  createTagGroup(title: string): TagGroupRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const nextSortOrder = (
      this.db.prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM tag_groups",
      ).get() as { value: number }
    ).value;
    this.db.prepare(`
      INSERT INTO tag_groups (id, title, sort_order, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, title, nextSortOrder, now);
    return this.listTagGroups().find((group) => group.id === id)!;
  }

  renameTagGroup(id: string, title: string): TagGroupRecord {
    const result = this.db.prepare(
      "UPDATE tag_groups SET title = ? WHERE id = ?",
    ).run(title, id);
    if (!result.changes) throw new Error("TAG_GROUP_NOT_FOUND");
    return this.listTagGroups().find((group) => group.id === id)!;
  }

  deleteTagGroup(id: string): void {
    const group = this.listTagGroups().find((item) => item.id === id);
    if (!group) throw new Error("TAG_GROUP_NOT_FOUND");
    if (group.tagCount) throw new Error("TAG_GROUP_NOT_EMPTY");
    this.db.prepare("DELETE FROM tag_groups WHERE id = ?").run(id);
  }

  moveTagToGroup(id: string, groupId: string | null): TagRecord {
    if (groupId) {
      const group = this.db.prepare(
        "SELECT id FROM tag_groups WHERE id = ?",
      ).get(groupId);
      if (!group) throw new Error("TAG_GROUP_NOT_FOUND");
    }
    const result = this.db.prepare(
      "UPDATE tags SET group_id = ? WHERE id = ?",
    ).run(groupId, id);
    if (!result.changes) throw new Error("TAG_NOT_FOUND");
    return this.listTags().find((tag) => tag.id === id)!;
  }

  renameTag(id: string, name: string): TagRecord {
    const existing = this.db.prepare(
      "SELECT id FROM tags WHERE id = ?",
    ).get(id) as { id: string } | undefined;
    if (!existing) throw new Error("TAG_NOT_FOUND");
    const conflict = this.db.prepare(
      "SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?",
    ).get(name, id) as { id: string } | undefined;
    if (conflict) throw new Error("TAG_NAME_EXISTS");
    this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id);
    return this.listTags().find((tag) => tag.id === id)!;
  }

  updateTagMeta(
    id: string,
    patch: {
      name?: string;
      alias?: string | null;
      shortcutKey?: string | null;
    },
  ): TagRecord {
    const existing = this.listTags().find((tag) => tag.id === id);
    if (!existing) throw new Error("TAG_NOT_FOUND");
    if (patch.name !== undefined && patch.name !== existing.name) {
      const conflict = this.db.prepare(
        "SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?",
      ).get(patch.name, id);
      if (conflict) throw new Error("TAG_NAME_EXISTS");
    }
    this.db.prepare(`
      UPDATE tags SET name = ?, alias = ?, shortcut_key = ? WHERE id = ?
    `).run(
      patch.name ?? existing.name,
      patch.alias === undefined ? existing.alias : patch.alias,
      patch.shortcutKey === undefined ? existing.shortcutKey : patch.shortcutKey,
      id,
    );
    return this.listTags().find((tag) => tag.id === id)!;
  }

  deleteTag(id: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare("DELETE FROM asset_tags WHERE tag_id = ?").run(id);
      const result = this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
      if (!result.changes) throw new Error("TAG_NOT_FOUND");
    });
    run();
  }

  // --- Auto-tag rules (offline, path/name/extension based) ---

  private autoTagRowToRule(row: AutoTagRuleRow): AutoTagRule {
    return {
      id: row.id,
      name: row.name,
      filenamePattern: row.filenamePattern,
      pathPattern: row.pathPattern,
      extension: row.extension,
      tags: JSON.parse(row.tagsJson) as string[],
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listAutoTagRules(): AutoTagRule[] {
    return (
      this.db.prepare(`
        SELECT id, name, filename_pattern AS filenamePattern,
          path_pattern AS pathPattern, extension, tags_json AS tagsJson,
          enabled, created_at AS createdAt, updated_at AS updatedAt
        FROM auto_tag_rules ORDER BY created_at
      `).all() as AutoTagRuleRow[]
    ).map((row) => this.autoTagRowToRule(row));
  }

  createAutoTagRule(
    rule: Omit<AutoTagRule, "id" | "createdAt" | "updatedAt">,
  ): AutoTagRule {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO auto_tag_rules
        (id, name, filename_pattern, path_pattern, extension, tags_json,
         enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      rule.name,
      rule.filenamePattern,
      rule.pathPattern,
      rule.extension,
      JSON.stringify(rule.tags),
      rule.enabled ? 1 : 0,
      now,
      now,
    );
    return this.listAutoTagRules().find((item) => item.id === id)!;
  }

  updateAutoTagRule(
    id: string,
    patch: Partial<Omit<AutoTagRule, "id" | "createdAt" | "updatedAt">>,
  ): AutoTagRule {
    const current = this.listAutoTagRules().find((rule) => rule.id === id);
    if (!current) throw new Error("AUTO_TAG_RULE_NOT_FOUND");
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE auto_tag_rules SET name = ?, filename_pattern = ?,
        path_pattern = ?, extension = ?, tags_json = ?, enabled = ?,
        updated_at = ? WHERE id = ?
    `).run(
      patch.name ?? current.name,
      patch.filenamePattern === undefined
        ? current.filenamePattern
        : patch.filenamePattern,
      patch.pathPattern === undefined ? current.pathPattern : patch.pathPattern,
      patch.extension === undefined ? current.extension : patch.extension,
      JSON.stringify(patch.tags ?? current.tags),
      (patch.enabled ?? current.enabled) ? 1 : 0,
      now,
      id,
    );
    return this.listAutoTagRules().find((rule) => rule.id === id)!;
  }

  deleteAutoTagRule(id: string): void {
    const result = this.db.prepare(
      "DELETE FROM auto_tag_rules WHERE id = ?",
    ).run(id);
    if (!result.changes) throw new Error("AUTO_TAG_RULE_NOT_FOUND");
  }

  /** All active assets (used by the auto-tag rule applier). */
  listActiveAssets(): AssetRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM assets WHERE lifecycle = 'active' ORDER BY created_at",
    ).all() as AssetRow[];
    return rows.map((row) => this.hydrateAsset(mapAsset(row)));
  }

  setCustomThumbnail(id: string, pathOrNull: string | null): AssetRecord {
    if (!this.getAsset(id)) throw new Error("ASSET_NOT_FOUND");
    this.db.prepare(
      "UPDATE assets SET custom_thumbnail_path = ?, updated_at = ? WHERE id = ?",
    ).run(pathOrNull, new Date().toISOString(), id);
    return this.getAsset(id)!;
  }

  listSavedViews(): SavedView[] {
    const rows = this.db.prepare(
      "SELECT * FROM saved_views ORDER BY updated_at DESC",
    ).all() as SavedViewRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      search: JSON.parse(row.search_json) as AssetSearchInput,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  saveView(title: string, search: AssetSearchInput): SavedView {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO saved_views (id, title, search_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title, JSON.stringify({ ...search, cursor: undefined }), now, now);
    return { id, title, search: { ...search, cursor: undefined }, createdAt: now, updatedAt: now };
  }

  deleteSavedView(id: string): void {
    this.db.prepare("DELETE FROM saved_views WHERE id = ?").run(id);
  }

  updateSavedView(
    id: string,
    patch: { title?: string; search?: AssetSearchInput },
  ): SavedView {
    const current = this.listSavedViews().find((view) => view.id === id);
    if (!current) throw new Error("SAVED_VIEW_NOT_FOUND");
    const title = patch.title ?? current.title;
    const search = patch.search ?? current.search;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE saved_views SET title = ?, search_json = ?, updated_at = ?
      WHERE id = ?
    `).run(title, JSON.stringify({ ...search, cursor: undefined }), now, id);
    return {
      id,
      title,
      search: { ...search, cursor: undefined },
      createdAt: current.createdAt,
      updatedAt: now,
    };
  }

  duplicateSavedView(id: string): SavedView {
    const current = this.listSavedViews().find((view) => view.id === id);
    if (!current) throw new Error("SAVED_VIEW_NOT_FOUND");
    const now = new Date().toISOString();
    const newId = randomUUID();
    this.db.prepare(`
      INSERT INTO saved_views (id, title, search_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      newId,
      `${current.title} 副本`,
      JSON.stringify({ ...current.search, cursor: undefined }),
      now,
      now,
    );
    return {
      id: newId,
      title: `${current.title} 副本`,
      search: { ...current.search, cursor: undefined },
      createdAt: now,
      updatedAt: now,
    };
  }

  getLibraryStats(): LibraryStats {
    const rows = this.db.prepare(`
      SELECT kind, COUNT(*) AS count FROM assets
      WHERE lifecycle = 'active' GROUP BY kind
    `).all() as Array<{ kind: AssetRecord["kind"]; count: number }>;
    const totals = this.db.prepare(`
      SELECT
        SUM(CASE WHEN lifecycle = 'active' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN lifecycle = 'active' AND link_state = 'missing' THEN 1 ELSE 0 END) AS missing,
        SUM(CASE WHEN lifecycle = 'trashed' THEN 1 ELSE 0 END) AS trashed,
        SUM(CASE WHEN lifecycle = 'active' AND favorite = 1 THEN 1 ELSE 0 END) AS favorites,
        SUM(CASE WHEN lifecycle = 'trashed' THEN size ELSE 0 END) AS trash_bytes
      FROM assets
    `).get() as Record<string, number | null>;
    const duplicateRows = this.db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT content_hash FROM assets WHERE lifecycle = 'active' AND content_hash IS NOT NULL
        GROUP BY content_hash, size HAVING COUNT(*) > 1
      )
    `).get() as { count: number };
    const byKind: LibraryStats["byKind"] = {
      image: 0, video: 0, audio: 0, pdf: 0, model3d: 0, dcc: 0, font: 0, generic: 0,
    };
    for (const row of rows) byKind[row.kind] = row.count;
    return {
      total: totals.total ?? 0,
      missing: totals.missing ?? 0,
      trashed: totals.trashed ?? 0,
      favorites: totals.favorites ?? 0,
      duplicates: duplicateRows.count,
      trashBytes: totals.trash_bytes ?? 0,
      byKind,
    };
  }

  private listBoardsRaw(): BoardRow[] {
    return this.db.prepare("SELECT * FROM boards ORDER BY updated_at DESC").all() as BoardRow[];
  }

  listBoards(): BoardSummary[] {
    const rows = this.listBoardsRaw();
    if (!rows.length) return [this.createBoard("参考板 01")];
    return rows.map(mapBoard);
  }

  createBoard(title = "未命名白板"): BoardSummary {
    const id = randomUUID();
    const now = new Date().toISOString();
    const document: BoardDocumentV3 = {
      schemaVersion: 3,
      canvas: { version: "7.4.0", objects: [] },
      viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
      guides: { x: [], y: [] },
      appearance: { ...defaultBoardAppearance },
      windowMode: "normal",
      canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
      sampling: "bilinear",
      exportSettings: { format: "png", embedAssets: false },
    };
    this.db.prepare(`
      INSERT INTO boards (id, title, document_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title, JSON.stringify(document), now, now);
    return { id, title, createdAt: now, updatedAt: now };
  }

  renameBoard(id: string, title: string): BoardSummary {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE boards SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title, now, id);
    if (!result.changes) throw new Error("BOARD_NOT_FOUND");
    const row = this.db.prepare("SELECT * FROM boards WHERE id = ?").get(id) as BoardRow;
    return mapBoard(row);
  }

  deleteBoard(id: string): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS value FROM boards").get() as {
        value: number;
      }
    ).value;
    if (count <= 1) throw new Error("LAST_BOARD_REQUIRED");
    const result = this.db.prepare("DELETE FROM boards WHERE id = ?").run(id);
    if (!result.changes) throw new Error("BOARD_NOT_FOUND");
  }

  loadBoard(id: string): { summary: BoardSummary; document: BoardDocumentV3 } | null {
    const row = this.db.prepare("SELECT * FROM boards WHERE id = ?").get(id) as
      | BoardRow
      | undefined;
    if (!row) return null;
    return {
      summary: mapBoard(row),
      document: toBoardV3(JSON.parse(row.document_json) as BoardDocument),
    };
  }

  saveBoard(id: string, input: BoardDocument): BoardSummary {
    const document = toBoardV3(input);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(
        "UPDATE boards SET document_json = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(document), now, id);
      this.db.prepare("DELETE FROM board_assets WHERE board_id = ?").run(id);
      for (const assetId of assetIdsFromDocument(document)) {
        if (this.getAsset(assetId)) {
          this.db.prepare(
            "INSERT OR IGNORE INTO board_assets (board_id, asset_id) VALUES (?, ?)",
          ).run(id, assetId);
        }
      }
    })();
    const row = this.db.prepare("SELECT * FROM boards WHERE id = ?").get(id) as
      | BoardRow
      | undefined;
    if (!row) throw new Error("BOARD_NOT_FOUND");
    return mapBoard(row);
  }

  /** Records that a board was opened, most recent first (max 10). */
  touchBoard(id: string): void {
    const current = this.getSetting<string[]>("recentBoards", []);
    const next = [id, ...current.filter((item) => item !== id)].slice(0, 10);
    this.setSetting("recentBoards", next);
  }

  recentBoards(): BoardSummary[] {
    const ids = this.getSetting<string[]>("recentBoards", []);
    const rows = this.db.prepare(
      "SELECT * FROM boards WHERE id IN (" +
        ids.map(() => "?").join(",") +
        ")",
    ).all(...ids) as BoardRow[];
    const byId = new Map(rows.map((row) => [row.id, mapBoard(row)]));
    return ids
      .map((id) => byId.get(id))
      .filter((board): board is BoardSummary => Boolean(board));
  }

  rebuildBoardAssetIndex(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM board_assets").run();
      for (const board of this.listBoardsRaw()) {
        const document = JSON.parse(board.document_json) as BoardDocument;
        for (const assetId of assetIdsFromDocument(document)) {
          if (this.getAsset(assetId)) {
            this.db.prepare(
              "INSERT OR IGNORE INTO board_assets (board_id, asset_id) VALUES (?, ?)",
            ).run(board.id, assetId);
          }
        }
      }
    })();
  }

  getAssetReferences(assetId: string): Array<{ boardId: string; boardTitle: string }> {
    const rows = this.db.prepare(`
      SELECT b.id, b.title FROM boards b
      JOIN board_assets ba ON ba.board_id = b.id
      WHERE ba.asset_id = ? ORDER BY b.updated_at DESC
    `).all(assetId) as Array<{ id: string; title: string }>;
    return rows.map((row) => ({ boardId: row.id, boardTitle: row.title }));
  }

  getBoardAssetIds(boardId: string): string[] {
    const rows = this.db.prepare(
      "SELECT asset_id FROM board_assets WHERE board_id = ? ORDER BY asset_id",
    ).all(boardId) as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as
      | { value_json: string }
      | undefined;
    return row ? JSON.parse(row.value_json) as T : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO settings (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(key, JSON.stringify(value));
  }

  getPlaybackState(assetId: string): PlaybackState | null {
    return this.getSetting<PlaybackState | null>(`playback:${assetId}`, null);
  }

  setPlaybackState(
    assetId: string,
    state: Partial<PlaybackState>,
  ): PlaybackState {
    const current = this.getSetting<PlaybackState | null>(
      `playback:${assetId}`,
      null,
    ) ?? { playbackRate: 1, muted: false, volume: 1, positionMs: 0 };
    const next = { ...current, ...state };
    this.setSetting(`playback:${assetId}`, next);
    return next;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
