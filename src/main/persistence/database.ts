import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AssetPage,
  AssetAnnotation,
  AssetRecord,
  AssetSearchInput,
  AssetSearchWindow,
  AssetSearchWindowInput,
  AutoTagRule,
  BatchAssetPatch,
  BoardDocument,
  BoardDocumentV3,
  BoardSummary,
  DuplicateGroup,
  LibraryStats,
  MediaNote,
  MountRoot,
  PlaybackState,
  ReconcileEntry,
  SavedView,
  SelectionScope,
  TagGroupRecord,
  TagRecord,
  WatchRoot,
} from "../../shared/contracts";
import {
  AssetsRepository,
  mapAssetRow as mapAsset,
  type AssetPersistenceRow as AssetRow,
} from "./repositories/assets-repository";
import {
  boardAssetIds,
  BoardsRepository,
  rewriteBoardAssetId,
  toBoardV2,
  toBoardV3,
} from "./repositories/boards-repository";
import {
  MIGRATIONS,
  MigrationRepository,
  type MigrationLogEntry,
} from "./repositories/migration-repository";
import { CollectionsRepository } from "./repositories/collections-repository-v17";
import { AiJobsRepository } from "./repositories/ai-jobs-repository";
import { CollectionService } from "../services/collection-service";
import { CollectionResolutionService } from "../services/collection-resolution-service";
import { SettingsRepository } from "./repositories/settings-repository";
import { hasSameAssetContentIdentity } from "./asset-content-identity";

export {
  DATABASE_SCHEMA_VERSION,
  readMigrationLog,
  runMigrationSteps,
} from "./repositories/migration-repository";
export type {
  MigrationLogEntry,
  MigrationRunResult,
  MigrationStep,
} from "./repositories/migration-repository";

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
  | "contentHash"
  | "lifecycle"
  | "deletedAt"
  | "trashPath"
  | "favorite"
  | "rating"
  | "colorLabel"
  | "bpm"
  | "customFields"
  | "customThumbnailPath"
  | "metadataStatus"
  | "metadataError"
  | "metadataUpdatedAt"
> & {
  pathKey: string;
  /**
   * Legacy storage-mode column value. The runtime always writes `linked`;
   * only the §13.3 managed preflight reads/seeds `managed` while retiring
   * pre-existing stores.
   */
  storageMode?: "linked" | "managed";
  libraryRelativePath?: string | null;
  originalSourcePath?: string | null;
  contentHash?: string | null;
  bpm?: number | null;
  customFields?: Record<string, string>;
  customThumbnailPath?: string | null;
  metadataStatus?: AssetRecord["metadataStatus"];
  metadataError?: string | null;
  metadataUpdatedAt?: string | null;
  metadataJobId?: string | null;
  /** Optional freshly-computed visual index values supplied with the write. */
  visualHash?: string | null;
  colorSignature?: string | null;
  dominantColor?: { r: number; g: number; b: number } | null;
};

function visualSignatureParams(asset: NewAsset): {
  visual_hash: string | null;
  color_signature: string | null;
  dominant_r: number | null;
  dominant_g: number | null;
  dominant_b: number | null;
} {
  return {
    visual_hash: asset.visualHash ?? null,
    color_signature: asset.colorSignature ?? null,
    dominant_r: asset.dominantColor?.r ?? null,
    dominant_g: asset.dominantColor?.g ?? null,
    dominant_b: asset.dominantColor?.b ?? null,
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

function pathKeyFor(filename: string): string {
  return path.normalize(filename).toLocaleLowerCase("en-US");
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
  private readonly assetsRepository: AssetsRepository;
  private readonly boardsRepository: BoardsRepository;
  private readonly migrationRepository: MigrationRepository;
  private readonly settingsRepository: SettingsRepository;
  private readonly collectionsRepository: CollectionsRepository;
  private closed = false;
  readonly filename: string;

  constructor(filename: string, options: RefCanvasDatabaseOptions = {}) {
    this.filename = filename;
    this.db = new Database(filename);
    this.assetsRepository = new AssetsRepository(this.db);
    this.boardsRepository = new BoardsRepository(this.db);
    this.migrationRepository = new MigrationRepository(
      this.db,
      options.migrationBackupDirectory,
    );
    this.settingsRepository = new SettingsRepository(this.db);
    this.collectionsRepository = new CollectionsRepository(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.migrationRepository.migrate(MIGRATIONS);
    this.rebuildBoardAssetIndex();
  }

  /** Returns the recorded migration history, oldest first. */
  getMigrationLog(): MigrationLogEntry[] {
    return this.migrationRepository.history();
  }

  getSchemaVersion(): number {
    return this.db.pragma("user_version", { simple: true }) as number;
  }

  integrityCheck(): boolean {
    const result = this.db.pragma("integrity_check", { simple: true });
    return result === "ok";
  }

  /** 在内部连接的显式事务中执行操作（失败自动回滚）。 */
  transaction<T>(fn: () => T): T {
    const run = this.db.transaction(fn);
    return run();
  }

  async backupTo(filename: string): Promise<void> {
    await this.db.backup(filename);
  }

  upsertAsset(
    asset: NewAsset,
    hydrateRelations = true,
  ): { asset: AssetRecord; reused: boolean } {
    const existing = this.db
      .prepare("SELECT * FROM assets WHERE path_key = ?")
      .get(asset.pathKey) as AssetRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      const preserveVisual = hasSameAssetContentIdentity(existing, asset);
      this.db.prepare(`
        UPDATE assets SET title = @title, path = @path, extension = @extension,
          size = @size, mtime_ms = @mtime_ms, fingerprint = @fingerprint,
          content_hash = @content_hash,
          visual_hash = CASE
            WHEN @visual_hash IS NOT NULL THEN @visual_hash
            WHEN @preserve_visual = 1 THEN visual_hash
            ELSE NULL END,
          color_signature = CASE
            WHEN @color_signature IS NOT NULL THEN @color_signature
            WHEN @preserve_visual = 1 THEN color_signature
            ELSE NULL END,
          dominant_r = CASE
            WHEN @dominant_r IS NOT NULL THEN @dominant_r
            WHEN @preserve_visual = 1 THEN dominant_r
            ELSE NULL END,
          dominant_g = CASE
            WHEN @dominant_g IS NOT NULL THEN @dominant_g
            WHEN @preserve_visual = 1 THEN dominant_g
            ELSE NULL END,
          dominant_b = CASE
            WHEN @dominant_b IS NOT NULL THEN @dominant_b
            WHEN @preserve_visual = 1 THEN dominant_b
            ELSE NULL END,
          lifecycle = 'active', deleted_at = NULL, trash_path = NULL,
          link_state = 'online', storage_mode = @storage_mode,
          width = @width, height = @height, duration = @duration, bpm = @bpm,
          custom_fields = @custom_fields, metadata_status = @metadata_status,
          metadata_error = @metadata_error,
          metadata_updated_at = @metadata_updated_at,
          metadata_job_id = @metadata_job_id,
          updated_at = @updated_at WHERE id = @id
      `).run({
        id: existing.id,
        title: asset.title,
        path: asset.path,
        extension: asset.extension,
        size: asset.size,
        mtime_ms: asset.mtimeMs,
        fingerprint: asset.fingerprint,
        content_hash: asset.contentHash ?? null,
        storage_mode: asset.storageMode ?? "linked",
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        bpm: asset.bpm ?? null,
        custom_fields: JSON.stringify(asset.customFields ?? {}),
        metadata_status: asset.metadataStatus ?? "ready",
        metadata_error: asset.metadataError ?? null,
        metadata_updated_at: asset.metadataUpdatedAt ?? now,
        metadata_job_id: asset.metadataJobId ?? null,
        updated_at: now,
        preserve_visual: preserveVisual ? 1 : 0,
        ...visualSignatureParams(asset),
      });
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
      return {
        asset: this.getAssetAfterWrite(existing.id, hydrateRelations),
        reused: true,
      };
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO assets (
        id, title, kind, path, path_key, extension, size, mtime_ms,
        fingerprint, content_hash, visual_hash, color_signature,
        dominant_r, dominant_g, dominant_b, lifecycle, deleted_at, trash_path,
        favorite, rating, color_label, link_state, notes, width, height,
        duration, bpm, custom_fields, custom_thumbnail_path,
        metadata_status, metadata_error, metadata_updated_at, metadata_job_id,
        storage_mode, library_relative_path, original_source_path,
        created_at, updated_at
      ) VALUES (@id, @title, @kind, @path, @path_key, @extension, @size,
        @mtime_ms, @fingerprint, @content_hash, @visual_hash, @color_signature,
        @dominant_r, @dominant_g, @dominant_b, 'active', NULL, NULL,
        0, 0, 'none', @link_state, @notes, @width, @height, @duration, @bpm,
        @custom_fields, @custom_thumbnail_path, @metadata_status,
        @metadata_error, @metadata_updated_at, @metadata_job_id, @storage_mode,
        @library_relative_path, @original_source_path, @created_at, @updated_at)
    `).run({
      id,
      title: asset.title,
      kind: asset.kind,
      path: asset.path,
      path_key: asset.pathKey,
      extension: asset.extension,
      size: asset.size,
      mtime_ms: asset.mtimeMs,
      fingerprint: asset.fingerprint,
      content_hash: asset.contentHash ?? null,
      link_state: asset.linkState,
      notes: asset.notes,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      bpm: asset.bpm ?? null,
      custom_fields: JSON.stringify(asset.customFields ?? {}),
      custom_thumbnail_path: asset.customThumbnailPath ?? null,
      metadata_status: asset.metadataStatus ?? "ready",
      metadata_error: asset.metadataError ?? null,
      metadata_updated_at: asset.metadataUpdatedAt ?? now,
      metadata_job_id: asset.metadataJobId ?? null,
      storage_mode: asset.storageMode ?? "linked",
      library_relative_path: asset.libraryRelativePath ?? null,
      original_source_path: asset.originalSourcePath ?? null,
      created_at: now,
      updated_at: now,
      ...visualSignatureParams(asset),
    });
    return { asset: this.getAssetAfterWrite(id, hydrateRelations), reused: false };
  }

  upsertAssets(assets: NewAsset[]): Array<{ asset: AssetRecord; reused: boolean }> {
    return this.db.transaction((items: NewAsset[]) =>
      items.map((asset) => this.upsertAsset(asset, false)),
    )(assets);
  }

  private getAssetAfterWrite(id: string, hydrateRelations: boolean): AssetRecord {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
      | AssetRow
      | undefined;
    if (!row) throw new Error("ASSET_WRITE_FAILED");
    const asset = mapAsset(row);
    return hydrateRelations ? this.hydrateAssets([asset])[0] : asset;
  }

  listPendingAssetMetadata(limit = 256, jobId?: string): Array<{
    id: string;
    path: string;
    kind: AssetRecord["kind"];
  }> {
    const clause = jobId ? "AND metadata_job_id = ?" : "";
    return this.db.prepare(`
      SELECT id, path, kind FROM assets
      WHERE lifecycle = 'active' AND metadata_status = 'pending' ${clause}
      ORDER BY updated_at, id LIMIT ?
    `).all(
      ...(jobId ? [jobId] : []),
      Math.max(1, Math.min(limit, 10_000)),
    ) as Array<{
      id: string;
      path: string;
      kind: AssetRecord["kind"];
    }>;
  }

  resetFailedAssetMetadata(): number {
    return this.db.prepare(`
      UPDATE assets SET metadata_status = 'pending', metadata_error = NULL,
        metadata_job_id = NULL, updated_at = ?
      WHERE lifecycle = 'active' AND metadata_status = 'failed'
    `).run(new Date().toISOString()).changes;
  }

  updateAssetMetadata(
    id: string,
    metadata: {
      width: number | null;
      height: number | null;
      duration: number | null;
      bpm: number | null;
      status: AssetRecord["metadataStatus"];
      error?: string | null;
    },
  ): AssetRecord {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE assets SET width = ?, height = ?, duration = ?, bpm = ?,
        metadata_status = ?, metadata_error = ?, metadata_updated_at = ?,
        metadata_job_id = NULL, updated_at = ? WHERE id = ?
    `).run(
      metadata.width,
      metadata.height,
      metadata.duration,
      metadata.bpm,
      metadata.status,
      metadata.error ?? null,
      now,
      now,
      id,
    );
    if (!result.changes) throw new Error("ASSET_NOT_FOUND");
    return this.getAsset(id)!;
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
        metadata_status, metadata_error, metadata_updated_at, metadata_job_id,
        storage_mode, library_relative_path, original_source_path,
        created_at, updated_at
      ) VALUES (@id, @title, @kind, @path, @path_key, @extension, @size,
        @mtime_ms, @fingerprint, @content_hash, 'active', NULL, NULL,
        0, 0, 'none', @link_state, @notes, @width, @height, @duration, @bpm,
        @custom_fields, @custom_thumbnail_path, @metadata_status,
        @metadata_error, @metadata_updated_at, @metadata_job_id, @storage_mode,
        @library_relative_path, @original_source_path, @created_at, @updated_at)
    `).run({
      id,
      title: asset.title,
      kind: asset.kind,
      path: asset.path,
      path_key: asset.pathKey,
      extension: asset.extension,
      size: asset.size,
      mtime_ms: asset.mtimeMs,
      fingerprint: asset.fingerprint,
      content_hash: asset.contentHash ?? null,
      link_state: asset.linkState,
      notes: asset.notes,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      bpm: asset.bpm ?? null,
      custom_fields: JSON.stringify(asset.customFields ?? {}),
      custom_thumbnail_path: asset.customThumbnailPath ?? null,
      metadata_status: asset.metadataStatus ?? "ready",
      metadata_error: asset.metadataError ?? null,
      metadata_updated_at: asset.metadataUpdatedAt ?? now,
      metadata_job_id: asset.metadataJobId ?? null,
      storage_mode: asset.storageMode ?? "linked",
      library_relative_path: asset.libraryRelativePath ?? null,
      original_source_path: asset.originalSourcePath ?? null,
      created_at: now,
      updated_at: now,
    });
    const inserted = this.getAsset(id);
    if (!inserted) throw new Error("ASSET_INSERT_FAILED");
    return inserted;
  }

  getAsset(id: string): AssetRecord | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
      | AssetRow
      | undefined;
    return row ? this.hydrateAssets([mapAsset(row)])[0] : null;
  }

  private hydrateAssets(assets: AssetRecord[]): AssetRecord[] {
    return this.assetsRepository.hydrateRelations(assets);
  }

  getAssetSource(id: string): {
    id: string;
    kind: AssetRecord["kind"];
    lifecycle: AssetRecord["lifecycle"];
    customThumbnailPath: string | null;
    mtimeMs: number;
    size: number;
    fingerprint: string;
    sourcePath: string | null;
  } | null {
    return this.assetsRepository.getSource(id);
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
    return row ? this.hydrateAssets([mapAsset(row)])[0] : null;
  }

  getAssetBaseByPath(filename: string): AssetRecord | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE path_key = ?").get(
      pathKeyFor(filename),
    ) as AssetRow | undefined;
    return row ? mapAsset(row) : null;
  }

  searchAssets(input: AssetSearchInput = {}): AssetPage {
    return this.assetsRepository.searchAssets(input);
  }

  searchAssetWindow(input: AssetSearchWindowInput): AssetSearchWindow {
    return this.assetsRepository.searchAssetWindow(input);
  }

  resolveSelection(scope: SelectionScope): string[] {
    return this.assetsRepository.resolveSelection(scope);
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
      SELECT id, asset_id AS assetId, time_ms AS timeMs,
        position_kind AS positionKind, position, text,
        created_at AS createdAt, updated_at AS updatedAt
      FROM media_notes WHERE asset_id = ?
      ORDER BY CASE position_kind WHEN 'general' THEN 0 WHEN 'time' THEN 1 ELSE 2 END,
        position, created_at
    `).all(assetId) as MediaNote[];
  }

  createMediaNote(
    assetId: string,
    input: { timeMs?: number; positionKind?: MediaNote["positionKind"]; position?: number; text: string },
  ): MediaNote {
    if (!this.getAsset(assetId)) throw new Error("ASSET_NOT_FOUND");
    const id = randomUUID();
    const now = new Date().toISOString();
    const positionKind = input.positionKind ?? "time";
    const position = input.position ?? input.timeMs ?? 0;
    const timeMs = positionKind === "time" ? position : (input.timeMs ?? 0);
    this.db.prepare(`
      INSERT INTO media_notes (id, asset_id, time_ms, position_kind, position, text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, assetId, timeMs, positionKind, position, input.text, now, now);
    return this.db.prepare(`
      SELECT id, asset_id AS assetId, time_ms AS timeMs,
        position_kind AS positionKind, position, text,
        created_at AS createdAt, updated_at AS updatedAt
      FROM media_notes WHERE id = ?
    `).get(id) as MediaNote;
  }

  updateMediaNote(
    id: string,
    patch: { timeMs?: number; positionKind?: MediaNote["positionKind"]; position?: number; text?: string },
  ): MediaNote {
    const current = this.db.prepare(`
      SELECT id, asset_id AS assetId, time_ms AS timeMs,
        position_kind AS positionKind, position, text,
        created_at AS createdAt, updated_at AS updatedAt
      FROM media_notes WHERE id = ?
    `).get(id) as MediaNote | undefined;
    if (!current) throw new Error("MEDIA_NOTE_NOT_FOUND");
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE media_notes SET time_ms = ?, position_kind = ?, position = ?, text = ?, updated_at = ? WHERE id = ?
    `).run(
      patch.timeMs ?? current.timeMs,
      patch.positionKind ?? current.positionKind,
      patch.position ?? patch.timeMs ?? current.position,
      patch.text ?? current.text,
      now,
      id,
    );
    return this.db.prepare(`
      SELECT id, asset_id AS assetId, time_ms AS timeMs,
        position_kind AS positionKind, position, text,
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

  /**
   * mount 离线时把该挂载根下的资产标记为 offline（计划 §7.5）。
   * 不做批量删除；mount 恢复后由 reconcile 增量修正。
   */
  markIdentitiesOfflineByMount(mountId: string): number {
    const result = this.db.prepare(`
      UPDATE assets SET link_state = 'offline', updated_at = ?
      WHERE lifecycle = 'active'
        AND id IN (
          SELECT fi.asset_id FROM file_identities fi
          WHERE fi.mount_id = ? AND fi.asset_id IS NOT NULL
        )
    `).run(new Date().toISOString(), mountId);
    return result.changes;
  }

  relinkAsset(id: string, asset: NewAsset): AssetRecord {
    const current = this.db
      .prepare("SELECT * FROM assets WHERE id = ?")
      .get(id) as AssetRow | undefined;
    if (!current) throw new Error("ASSET_NOT_FOUND");
    const preserveVisual = hasSameAssetContentIdentity(current, asset);
    this.db.prepare(`
      UPDATE assets SET kind = ?, path = ?, path_key = ?, extension = ?,
        size = ?, mtime_ms = ?, fingerprint = ?, content_hash = ?,
        visual_hash = CASE
          WHEN ? IS NOT NULL THEN ?
          WHEN ? = 1 THEN visual_hash ELSE NULL END,
        color_signature = CASE
          WHEN ? IS NOT NULL THEN ?
          WHEN ? = 1 THEN color_signature ELSE NULL END,
        dominant_r = CASE
          WHEN ? IS NOT NULL THEN ?
          WHEN ? = 1 THEN dominant_r ELSE NULL END,
        dominant_g = CASE
          WHEN ? IS NOT NULL THEN ?
          WHEN ? = 1 THEN dominant_g ELSE NULL END,
        dominant_b = CASE
          WHEN ? IS NOT NULL THEN ?
          WHEN ? = 1 THEN dominant_b ELSE NULL END,
        lifecycle = 'active', deleted_at = NULL, trash_path = NULL,
        link_state = 'online', storage_mode = ?, width = ?, height = ?,
        duration = ?, bpm = ?, custom_fields = ?, updated_at = ? WHERE id = ?
    `).run(
      asset.kind, asset.path, asset.pathKey, asset.extension, asset.size,
      asset.mtimeMs, asset.fingerprint, asset.contentHash ?? null,
      asset.visualHash ?? null, asset.visualHash ?? null,
      preserveVisual ? 1 : 0,
      asset.colorSignature ?? null, asset.colorSignature ?? null,
      preserveVisual ? 1 : 0,
      asset.dominantColor?.r ?? null, asset.dominantColor?.r ?? null,
      preserveVisual ? 1 : 0,
      asset.dominantColor?.g ?? null, asset.dominantColor?.g ?? null,
      preserveVisual ? 1 : 0,
      asset.dominantColor?.b ?? null, asset.dominantColor?.b ?? null,
      preserveVisual ? 1 : 0,
      asset.storageMode ?? "linked",
      asset.width, asset.height, asset.duration, asset.bpm ?? null,
      JSON.stringify(asset.customFields ?? {}), new Date().toISOString(), id,
    );
    if (
      asset.libraryRelativePath !== undefined ||
      asset.originalSourcePath !== undefined
    ) {
      const current = this.db
        .prepare(
          "SELECT library_relative_path, original_source_path FROM assets WHERE id = ?",
        )
        .get(id) as
        | { library_relative_path: string | null; original_source_path: string | null }
        | undefined;
      this.db.prepare(`
        UPDATE assets SET library_relative_path = ?,
          original_source_path = ? WHERE id = ?
      `).run(
        asset.libraryRelativePath ?? current?.library_relative_path ?? null,
        asset.originalSourcePath ?? current?.original_source_path ?? null,
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
        assets: this.hydrateAssets(rows.map(mapAsset)),
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
        this.db.prepare(
          "UPDATE asset_annotations SET asset_id = ? WHERE asset_id = ?",
        ).run(keepId, removeId);
        this.updateAsset(keepId, {
          favorite: keep.favorite || removed.favorite,
          rating: Math.max(keep.rating, removed.rating),
        });
        for (const board of this.boardsRepository.listRows()) {
          let document = toBoardV2(JSON.parse(board.document_json) as BoardDocument);
          if (boardAssetIds(document).includes(removeId)) {
            document = rewriteBoardAssetId(document, removeId, keepId);
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
    // watch root 即挂载根：同步注册 mount root（id 一致），供 mount 状态机与
    // identity 的 mount_id 外键引用。
    this.upsertMountRoot({
      id,
      path: rootPath,
      displayName: path.basename(rootPath) || rootPath,
      state: "online",
    });
    return { id, path: rootPath, createdAt };
  }

  removeWatchRoot(id: string): WatchRoot {
    const row = this.db.prepare(
      "SELECT * FROM watch_roots WHERE id = ?",
    ).get(id) as WatchRootRow | undefined;
    if (!row) throw new Error("WATCH_ROOT_NOT_FOUND");
    this.db.transaction(() => {
      this.db.prepare(
        "UPDATE file_identities SET mount_id = NULL, link_state = 'offline' WHERE mount_id = ?",
      ).run(id);
      this.db.prepare("DELETE FROM watch_roots WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM mount_roots WHERE id = ?").run(id);
    })();
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
    mountId?: string | null;
  }): void {
    const now = new Date().toISOString();
    // 新插入时生成稳定 id（cache/media 以 file_identities.id 为引用键）。
    this.db.prepare(`
      INSERT INTO file_identities
        (id, path_key, asset_id, fingerprint, size, root_path, mount_id, created_at, updated_at)
      VALUES (@id, @path_key, @asset_id, @fingerprint, @size, @root_path, @mount_id, @created_at, @updated_at)
      ON CONFLICT(path_key) DO UPDATE SET
        asset_id = excluded.asset_id,
        fingerprint = excluded.fingerprint,
        size = excluded.size,
        root_path = excluded.root_path,
        mount_id = excluded.mount_id,
        updated_at = excluded.updated_at
    `).run({
      id: randomUUID(),
      path_key: identity.pathKey,
      asset_id: identity.assetId,
      fingerprint: identity.fingerprint,
      size: identity.size,
      root_path: identity.rootPath,
      mount_id: identity.mountId ?? null,
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
      mountId?: string | null;
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
    mountId: string | null;
  } | null {
    const row = this.db.prepare(
      "SELECT * FROM file_identities WHERE asset_id = ?",
    ).get(assetId) as {
      path_key: string;
      fingerprint: string;
      size: number;
      root_path: string;
      mount_id: string | null;
    } | undefined;
    return row
      ? {
          pathKey: row.path_key,
          fingerprint: row.fingerprint,
          size: row.size,
          rootPath: row.root_path,
          mountId: row.mount_id ?? null,
        }
      : null;
  }

  /**
   * 按 file_identities 主键（ref 键）读取身份（schema 17 集合引用使用）。
   * 返回 null 表示该引用键已不存在（identity 被删除/归档）。
   */
  getFileIdentityByRefId(identityId: string): {
    pathKey: string;
    fingerprint: string;
    size: number;
    rootPath: string;
    mountId: string | null;
  } | null {
    const row = this.db.prepare(
      "SELECT * FROM file_identities WHERE id = ?",
    ).get(identityId) as {
      path_key: string;
      fingerprint: string;
      size: number;
      root_path: string;
      mount_id: string | null;
    } | undefined;
    return row
      ? {
          pathKey: row.path_key,
          fingerprint: row.fingerprint,
          size: row.size,
          rootPath: row.root_path,
          mountId: row.mount_id ?? null,
        }
      : null;
  }

  /** 返回某资产的全部身份行（含主键 id，供集合条目引用）。 */
  listFileIdentitiesByAsset(assetId: string): Array<{
    id: string;
    pathKey: string;
    fingerprint: string;
    size: number;
    rootPath: string;
  }> {
    const rows = this.db.prepare(`
      SELECT id, path_key AS pathKey, fingerprint, size, root_path AS rootPath
      FROM file_identities WHERE asset_id = ?
    `).all(assetId) as Array<{
      id: string;
      pathKey: string;
      fingerprint: string;
      size: number;
      rootPath: string;
    }>;
    return rows;
  }

  listFileIdentitiesByRoot(
    rootPath: string,
  ): Array<{
    id: string;
    pathKey: string;
    assetId: string;
    fingerprint: string;
    size: number;
  }> {
    const rows = this.db.prepare(`
      SELECT id, path_key AS pathKey, asset_id AS assetId,
        fingerprint, size
      FROM file_identities WHERE root_path = ?
    `).all(rootPath) as Array<{
      id: string;
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
  ): Array<{ pathKey: string; assetId: string; rootPath: string | null }> {
    const rows = this.db.prepare(`
      SELECT path_key AS pathKey, asset_id AS assetId, root_path AS rootPath
      FROM file_identities WHERE fingerprint = ? AND size = ?
    `).all(fingerprint, size) as Array<{
      pathKey: string;
      assetId: string;
      rootPath: string | null;
    }>;
    return rows;
  }

  /**
   * 按指纹查找已索引身份（不限定 size，schema 17 集合条目无 size 字段）。
   * 返回挂载内候选（rootPath 非空），供集合引用按指纹自动重定位。
   */
  findIdentityByFingerprintAnySize(
    fingerprint: string,
  ): Array<{
    id: string;
    mountId: string | null;
    pathKey: string;
    rootPath: string;
  }> {
    return this.db.prepare(`
      SELECT id, mount_id AS mountId, path_key AS pathKey,
        root_path AS rootPath
      FROM file_identities
      WHERE fingerprint = ? AND root_path IS NOT NULL AND root_path <> ''
    `).all(fingerprint) as Array<{
      id: string;
      mountId: string | null;
      pathKey: string;
      rootPath: string;
    }>;
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

  /** v14：注册或更新挂载根（计划 §7.2 MountRoot）。 */
  upsertMountRoot(input: {
    id: string;
    path: string;
    displayName: string;
    volumeId?: string | null;
    state?: MountRoot["state"];
  }): void {
    this.db.prepare(`
      INSERT INTO mount_roots (id, path, display_name, volume_id, state, last_seen_at)
      VALUES (@id, @path, @display_name, @volume_id, @state, @last_seen_at)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        display_name = excluded.display_name,
        volume_id = excluded.volume_id,
        state = excluded.state,
        last_seen_at = excluded.last_seen_at
    `).run({
      id: input.id,
      path: input.path,
      display_name: input.displayName,
      volume_id: input.volumeId ?? null,
      state: input.state ?? "online",
      last_seen_at: new Date().toISOString(),
    });
  }

  listMountRoots(): MountRoot[] {
    return this.db.prepare(`
      SELECT id, path, display_name AS displayName, volume_id AS volumeId,
        state, last_seen_at AS lastSeenAt
      FROM mount_roots ORDER BY path
    `).all() as MountRoot[];
  }

  /**
   * v14：把绝对路径解析为 identity + mount 引用键（§7.4）。
   * 返回 null 表示该路径不在任何已注册 mount 内（无引用键）。
   */
  resolveIdentityRef(filename: string): {
    pathKey: string;
    fingerprint: string;
    size: number;
    mountId: string;
    relativePath: string;
  } | null {
    const resolved = path.resolve(filename);
    const pathKey = path.normalize(resolved).toLocaleLowerCase("en-US");
    const identity = this.db.prepare(
      "SELECT fingerprint, size FROM file_identities WHERE path_key = ?",
    ).get(pathKey) as { fingerprint: string; size: number } | undefined;
    if (!identity) return null;
    const mounts = this.db.prepare(`
      SELECT id, path FROM mount_roots ORDER BY length(path) DESC
    `).all() as Array<{ id: string; path: string }>;
    const mount = mounts.find(
      (candidate) =>
        resolved === candidate.path ||
        resolved.startsWith(`${candidate.path}${path.sep}`),
    );
    if (!mount) return null;
    return {
      pathKey,
      fingerprint: identity.fingerprint,
      size: identity.size,
      mountId: mount.id,
      relativePath: path.relative(mount.path, resolved),
    };
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
    return this.hydrateAssets(rows.map(mapAsset));
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

  listBoards(): BoardSummary[] {
    return this.boardsRepository.list();
  }

  createBoard(title = "未命名白板"): BoardSummary {
    return this.boardsRepository.create(title);
  }

  renameBoard(id: string, title: string): BoardSummary {
    return this.boardsRepository.rename(id, title);
  }

  deleteBoard(id: string): void {
    this.boardsRepository.delete(id);
  }

  loadBoard(id: string): { summary: BoardSummary; document: BoardDocumentV3 } | null {
    return this.boardsRepository.load(id);
  }

  saveBoard(id: string, input: BoardDocument): BoardSummary {
    const document = toBoardV3(input);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.boardsRepository.updateDocument(id, document, now);
      this.boardsRepository.replaceAssetIds(
        id,
        boardAssetIds(document).filter((assetId) => Boolean(this.getAsset(assetId))),
      );
    })();
    const row = this.boardsRepository.row(id);
    if (!row) throw new Error("BOARD_NOT_FOUND");
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Records that a board was opened, most recent first (max 10). */
  touchBoard(id: string): void {
    const current = this.getSetting<string[]>("recentBoards", []);
    const next = [id, ...current.filter((item) => item !== id)].slice(0, 10);
    this.setSetting("recentBoards", next);
  }

  recentBoards(): BoardSummary[] {
    const ids = this.getSetting<string[]>("recentBoards", []);
    return this.boardsRepository.listByIds(ids);
  }

  rebuildBoardAssetIndex(): void {
    this.db.transaction(() => {
      this.boardsRepository.clearAssetIndex();
      for (const board of this.boardsRepository.listRows()) {
        const document = JSON.parse(board.document_json) as BoardDocument;
        this.boardsRepository.replaceAssetIds(
          board.id,
          boardAssetIds(document).filter((assetId) => Boolean(this.getAsset(assetId))),
        );
      }
    })();
  }

  getAssetReferences(assetId: string): Array<{ boardId: string; boardTitle: string }> {
    return this.boardsRepository.references(assetId);
  }

  getBoardAssetIds(boardId: string): string[] {
    return this.boardsRepository.assetIds(boardId);
  }

  getSetting<T>(key: string, fallback: T): T {
    return this.settingsRepository.get(key, fallback);
  }

  setSetting(key: string, value: unknown): void {
    this.settingsRepository.set(key, value);
  }

  /**
   * schema 17 引用集合仓储（FND-003）。仓储直接使用内部连接；
   * IPC 层只通过这里访问集合 CRUD/解析/导出。
   */
  collections(): CollectionsRepository {
    return this.collectionsRepository;
  }

  /** 引用集合业务服务（异步 addPaths/relink/export + 解析）。 */
  collectionService(): CollectionService {
    return new CollectionService(this, this.collectionsRepository);
  }

  /** 引用集合解析服务（复用本连接的 identity/mount 数据）。 */
  collectionResolution(): CollectionResolutionService {
    return new CollectionResolutionService(this, this.collectionsRepository);
  }

  /** AI 任务持久化仓储（FND-008 §9.3）。 */
  aiJobs(): AiJobsRepository {
    return new AiJobsRepository(this.db);
  }

  getPlaybackState(assetId: string): PlaybackState | null {
    return this.settingsRepository.getPlayback(assetId);
  }

  setPlaybackState(
    assetId: string,
    state: Partial<PlaybackState>,
  ): PlaybackState {
    return this.settingsRepository.setPlayback(assetId, state);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
