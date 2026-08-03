import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AssetRecord,
  AssetStorageMode,
  LibraryExportReport,
  LibrarySummary,
  LibraryVerifyReport,
  MergeLibraryReport,
} from "../shared/contracts";
import { RefCanvasDatabase } from "./database";

const MANIFEST_FILENAME = "refcanvas.library.json";
const REGISTRY_FILENAME = "libraries.json";

interface LibraryManifest {
  format: "refcanvas-library";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  defaultStorageMode: AssetStorageMode;
}

export interface LibraryEntry {
  id: string;
  name: string;
  root: string;
  createdAt: string;
  defaultStorageMode: AssetStorageMode;
  /** The pre-existing `0.32` data directory is kept in place (legacy). */
  legacy: boolean;
}

interface RegistryFile {
  version: 1;
  activeId: string | null;
  libraries: LibraryEntry[];
}

const LEGACY_DB_RELATIVE = "refcanvas.db";
const LIBRARY_DB_RELATIVE = path.join("data", "refcanvas.db");
const MANAGED_STORE_RELATIVE = "files";
const TRASH_RELATIVE = path.join("trash", "files");
const BACKUPS_RELATIVE = "backups";

export function managedStorePath(root: string): string {
  return path.join(root, MANAGED_STORE_RELATIVE);
}

export function databasePathFor(entry: LibraryEntry): string {
  return path.join(entry.root, entry.legacy ? LEGACY_DB_RELATIVE : LIBRARY_DB_RELATIVE);
}

export function trashPathFor(entry: LibraryEntry): string {
  return path.join(entry.root, TRASH_RELATIVE);
}

export function backupDirectoryFor(entry: LibraryEntry): string {
  return path.join(entry.root, BACKUPS_RELATIVE);
}

/**
 * File-level management of self-contained libraries.
 *
 * A library is a directory holding a manifest, the SQLite database under
 * `data/`, a managed-file store under `files/`, a trash under `trash/` and
 * migration snapshots under `backups/`. The registry of known libraries lives
 * in a small JSON file in the app data directory so it survives a corrupted
 * library database and is readable before any library is opened.
 *
 * This class only touches files and the registry; the main process owns the
 * live database/service connections and calls {@link switchConnection} style
 * orchestration itself.
 */
export class LibraryManager {
  private readonly registryPath: string;
  private registry: RegistryFile = { version: 1, activeId: null, libraries: [] };

  constructor(private readonly userDataDirectory: string) {
    this.registryPath = path.join(userDataDirectory, REGISTRY_FILENAME);
  }

  /** Loads (or creates) the registry. Call once at startup. */
  async initialize(): Promise<void> {
    try {
      const raw = JSON.parse(
        await readFile(this.registryPath, "utf8"),
      ) as RegistryFile;
      if (raw.version === 1 && Array.isArray(raw.libraries)) {
        this.registry = raw;
        if (
          this.registry.activeId &&
          !this.registry.libraries.some(
            (entry) => entry.id === this.registry.activeId,
          )
        ) {
          this.registry.activeId = null;
        }
      }
    } catch {
      this.registry = { version: 1, activeId: null, libraries: [] };
    }
  }

  /**
   * Registers the pre-existing `0.32` data directory as the legacy linked
   * library on first run. Returns the active entry afterwards.
   */
  async bootstrapLegacy(): Promise<LibraryEntry> {
    const legacyPath = path.join(this.userDataDirectory, LEGACY_DB_RELATIVE);
    let entry = this.registry.libraries.find((item) => item.legacy);
    if (!entry) {
      const hasDatabase = await stat(legacyPath).then(() => true).catch(() => false);
      entry = {
        id: randomUUID(),
        name: "默认资料库",
        root: this.userDataDirectory,
        createdAt: hasDatabase
          ? new Date().toISOString()
          : new Date().toISOString(),
        defaultStorageMode: "linked",
        legacy: true,
      };
      this.registry.libraries.unshift(entry);
    }
    if (!this.current()) {
      this.registry.activeId = entry.id;
    }
    await this.persist();
    return this.current() ?? entry;
  }

  list(): LibrarySummary[] {
    return this.registry.libraries.map((entry) => {
      const isActive = entry.id === this.registry.activeId;
      return {
        id: entry.id,
        name: entry.name,
        root: entry.root,
        createdAt: entry.createdAt,
        defaultStorageMode: entry.defaultStorageMode,
        isActive,
        assetCount: 0,
        databaseBytes: 0,
        legacy: entry.legacy,
      };
    });
  }

  current(): LibrarySummary | null {
    const entry = this.registry.libraries.find(
      (item) => item.id === this.registry.activeId,
    );
    return entry ? this.list().find((item) => item.id === entry.id) ?? null : null;
  }

  currentEntry(): LibraryEntry | null {
    return this.registry.libraries.find(
      (item) => item.id === this.registry.activeId,
    ) ?? null;
  }

  getEntry(id: string): LibraryEntry {
    const entry = this.registry.libraries.find((item) => item.id === id);
    if (!entry) throw new Error("LIBRARY_NOT_FOUND");
    return entry;
  }

  /** Enriched summary (asset count + database size) for one library. */
  async describe(id: string): Promise<LibrarySummary> {
    const entry = this.getEntry(id);
    const base = this.list().find((item) => item.id === id)!;
    let assetCount = 0;
    let databaseBytes = 0;
    const dbPath = databasePathFor(entry);
    try {
      const db = new RefCanvasDatabase(dbPath);
      try {
        assetCount = db.getLibraryStats().total;
      } finally {
        db.close();
      }
      databaseBytes = await stat(dbPath).then((value) => value.size).catch(() => 0);
    } catch {
      assetCount = 0;
    }
    return { ...base, assetCount, databaseBytes };
  }

  /** Creates a new self-contained library (default storage: linked). */
  async create(options: { name: string; directory: string }): Promise<LibraryEntry> {
    const root = path.resolve(options.directory);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, TRASH_RELATIVE), { recursive: true });
    await mkdir(path.join(root, BACKUPS_RELATIVE), { recursive: true });
    const manifest: LibraryManifest = {
      format: "refcanvas-library",
      version: 1,
      id: randomUUID(),
      name: options.name.trim() || "未命名资料库",
      createdAt: new Date().toISOString(),
      defaultStorageMode: "linked",
    };
    // Initialize the database so a freshly created library is immediately
    // usable and its migration history starts clean.
    const db = new RefCanvasDatabase(databasePathFor({
      id: manifest.id,
      name: manifest.name,
      root,
      createdAt: manifest.createdAt,
      defaultStorageMode: "linked",
      legacy: false,
    }));
    db.createBoard("参考板 01");
    db.close();
    await writeFile(
      path.join(root, MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    const entry: LibraryEntry = {
      id: manifest.id,
      name: manifest.name,
      root,
      createdAt: manifest.createdAt,
      defaultStorageMode: "linked",
      legacy: false,
    };
    this.registry.libraries.push(entry);
    this.registry.activeId = entry.id;
    await this.persist();
    return entry;
  }

  /** Opens an existing library directory by manifest. */
  async open(directory: string): Promise<LibraryEntry> {
    const root = path.resolve(directory);
    const manifest = JSON.parse(
      await readFile(path.join(root, MANIFEST_FILENAME), "utf8"),
    ) as LibraryManifest;
    if (manifest.format !== "refcanvas-library" || manifest.version !== 1) {
      throw new Error("INVALID_LIBRARY_MANIFEST");
    }
    const existing = this.registry.libraries.find((item) => item.root === root);
    const entry: LibraryEntry = existing ?? {
      id: manifest.id,
      name: manifest.name,
      root,
      createdAt: manifest.createdAt,
      defaultStorageMode: manifest.defaultStorageMode,
      legacy: false,
    };
    if (!existing) {
      this.registry.libraries.push(entry);
    } else {
      existing.name = manifest.name;
      existing.defaultStorageMode = manifest.defaultStorageMode;
    }
    this.registry.activeId = entry.id;
    await this.persist();
    return entry;
  }

  async switchTo(id: string): Promise<LibraryEntry> {
    const entry = this.getEntry(id);
    this.registry.activeId = entry.id;
    await this.persist();
    return entry;
  }

  /** Moves a library directory (and any sibling WAL files) to a new location. */
  async move(id: string, newDirectory: string): Promise<LibraryEntry> {
    const entry = this.getEntry(id);
    if (entry.legacy) throw new Error("LIBRARY_MOVE_LEGACY_UNSUPPORTED");
    const target = path.resolve(newDirectory);
    if (target === entry.root) return entry;
    // Refuse moving a library into its own subtree.
    if (target.startsWith(`${entry.root}${path.sep}`)) {
      throw new Error("LIBRARY_MOVE_INVALID");
    }
    if (await pathExists(target)) throw new Error("LIBRARY_MOVE_TARGET_EXISTS");
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await rename(entry.root, target);
    } catch (error) {
      if (!isCrossDeviceError(error)) throw error;
      await moveAcrossDevicesVerified(entry.root, target);
    }
    entry.root = target;
    await this.persist();
    return entry;
  }

  async verify(id: string): Promise<LibraryVerifyReport> {
    const entry = this.getEntry(id);
    const dbPath = databasePathFor(entry);
    const errors: string[] = [];
    let integrityOk = false;
    let assets = 0;
    try {
      const db = new RefCanvasDatabase(dbPath);
      try {
        integrityOk = db.integrityCheck();
        assets = db.getLibraryStats().total;
      } finally {
        db.close();
      }
    } catch (error) {
      errors.push(
        `database: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const store = managedStorePath(entry.root);
    const files = await listFilesRecursive(store);
    const managedMissing: string[] = [];
    const owned = new Set<string>();
    try {
      const db = new RefCanvasDatabase(dbPath);
      try {
        for (const asset of db.listManagedAssets()) {
          owned.add(path.normalize(asset.path));
          const exists = await stat(asset.path).then(() => true).catch(() => false);
          if (!exists) managedMissing.push(asset.libraryRelativePath);
        }
      } finally {
        db.close();
      }
    } catch (error) {
      errors.push(
        `managed scan: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const orphanFiles = files.filter(
      (filename) => !owned.has(path.normalize(filename)),
    );
    return {
      id,
      integrityOk,
      assets,
      managedFiles: files.length,
      managedMissing: managedMissing.length,
      orphanFiles: orphanFiles.length,
      errors,
    };
  }

  async exportLibrary(
    id: string,
    destination: string,
  ): Promise<LibraryExportReport> {
    const entry = this.getEntry(id);
    const target = path.resolve(destination);
    await mkdir(path.join(target, "data"), { recursive: true });
    const dbPath = databasePathFor(entry);
    const db = new RefCanvasDatabase(dbPath);
    const exportedDbPath = path.join(target, "data", "refcanvas.db");
    let assets = 0;
    let managedBytes = 0;
    let files = 0;
    try {
      assets = db.getLibraryStats().total;
      const store = managedStorePath(entry.root);
      const stored = await listFilesRecursive(store);
      for (const filename of stored) {
        const relative = path.relative(store, filename);
        const dest = path.join(target, MANAGED_STORE_RELATIVE, relative);
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(filename, dest);
        managedBytes += (await stat(filename)).size;
        files += 1;
      }
      await rm(exportedDbPath, { force: true });
      await db.backupTo(exportedDbPath);
    } finally {
      db.close();
    }
    const manifest: LibraryManifest = {
      format: "refcanvas-library",
      version: 1,
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      defaultStorageMode: entry.defaultStorageMode,
    };
    await writeFile(
      path.join(target, MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    return {
      id,
      destination: target,
      assets,
      files,
      databaseBytes: (await stat(exportedDbPath)).size,
      managedBytes,
    };
  }

  /**
   * Merges every active asset of the source library into the target library.
   *
   * Identical files (full SHA-256 + size) are deduplicated and their metadata
   * (tags, notes, rating, favorites, annotations) is merged onto the existing
   * target record; new files are copied into the target managed store with
   * their records (ids preserved). Every step is appended to an operation log
   * inside the target library so a partially failed merge can be inspected and
   * recovered.
   */
  async merge(sourceId: string, targetId: string): Promise<MergeLibraryReport> {
    const source = this.getEntry(sourceId);
    const target = this.getEntry(targetId);
    if (source.id === target.id) throw new Error("LIBRARY_MERGE_SELF");
    const report: MergeLibraryReport = {
      sourceId,
      targetId,
      mergedAssets: 0,
      deduplicated: 0,
      copiedFiles: 0,
      conflicts: [],
      skipped: 0,
      logFile: null,
    };
    const sourceDb = new RefCanvasDatabase(databasePathFor(source));
    const targetDbPath = databasePathFor(target);
    const targetDb = new RefCanvasDatabase(targetDbPath);
    const logLines: string[] = [];
    const copiedFiles: string[] = [];
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const logFile = path.join(
      target.root,
      "operations",
      `merge-${stamp}.jsonl`,
    );
    const rollbackDb = path.join(
      target.root,
      "operations",
      `merge-${stamp}.rollback.db`,
    );
    await mkdir(path.dirname(logFile), { recursive: true });
    const appendLog = async (line: Record<string, unknown>) => {
      logLines.push(JSON.stringify({ ...line, at: new Date().toISOString() }));
      await writeFile(logFile, `${logLines.join("\n")}\n`, "utf8");
    };
    let mergeError: unknown = null;
    let rollbackReady = false;
    try {
      await targetDb.backupTo(rollbackDb);
      rollbackReady = true;
      let cursor: string | undefined;
      do {
        const page = sourceDb.searchAssets({
          lifecycle: "active",
          pageSize: 500,
          cursor,
        });
        for (const asset of page.items) {
          await this.mergeOneAsset(
            target,
            sourceDb,
            targetDb,
            asset,
            report,
            appendLog,
            (filename) => copiedFiles.push(filename),
          );
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      await appendLog({ action: "merge-complete", report });
    } catch (error) {
      mergeError = error;
    } finally {
      sourceDb.close();
      targetDb.close();
    }
    if (mergeError) {
      if (!rollbackReady) throw mergeError;
      try {
        await Promise.all(copiedFiles.map((filename) => rm(filename, { force: true })));
        await rm(targetDbPath, { force: true });
        await rm(`${targetDbPath}-wal`, { force: true });
        await rm(`${targetDbPath}-shm`, { force: true });
        await rename(rollbackDb, targetDbPath);
        await appendLog({
          action: "merge-rolled-back",
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        });
      } catch (rollbackError) {
        throw new AggregateError(
          [mergeError, rollbackError],
          "LIBRARY_MERGE_ROLLBACK_FAILED",
        );
      }
      throw mergeError;
    }
    await rm(rollbackDb, { force: true });
    report.logFile = logFile;
    return report;
  }

  private async mergeOneAsset(
    target: LibraryEntry,
    sourceDb: RefCanvasDatabase,
    targetDb: RefCanvasDatabase,
    asset: AssetRecord,
    report: MergeLibraryReport,
    appendLog: (line: Record<string, unknown>) => Promise<void>,
    recordCopiedFile: (filename: string) => void,
  ): Promise<void> {
    const sourcePath = sourceDb.getAssetPath(asset.id);
    if (!sourcePath) {
      report.skipped += 1;
      return;
    }
    const hash = await fullHash(sourcePath).catch(() => null);
    if (!hash) {
      report.conflicts.push({ path: asset.path, reason: "UNREADABLE_SOURCE" });
      return;
    }
    const existingRecord = await this.findByHash(targetDb, hash, asset.size);
    if (existingRecord) {
      await this.mergeMetadataInto(sourceDb, targetDb, existingRecord.id, asset);
      report.deduplicated += 1;
      await appendLog({ action: "dedupe", assetId: asset.id, hash });
      return;
    }

    // A record with the same id already present means a previous partial merge
    // inserted it; fold metadata in instead of duplicating.
    const existingById = targetDb.getAsset(asset.id);
    if (existingById) {
      await this.mergeMetadataInto(sourceDb, targetDb, existingById.id, asset);
      report.deduplicated += 1;
      await appendLog({ action: "dedupe-by-id", assetId: asset.id, hash });
      return;
    }

    let targetPath: string;
    if (asset.storageMode === "managed") {
      const extension = path.extname(sourcePath);
      const filename = `${asset.id}${extension}`;
      const dest = path.join(managedStorePath(target.root), filename);
      if (await pathExists(dest)) {
        report.conflicts.push({ path: dest, reason: "PATH_OCCUPIED" });
        return;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFileVerifiedAtomically(sourcePath, dest, hash);
      targetPath = dest;
      recordCopiedFile(dest);
      report.copiedFiles += 1;
    } else {
      targetPath = sourcePath;
    }

    const existingAtPath = targetDb.getAssetByPath(targetPath);
    if (existingAtPath) {
      report.conflicts.push({ path: targetPath, reason: "PATH_OCCUPIED" });
      return;
    }

    targetDb.insertAssetWithId(asset.id, {
      ...asset,
      path: targetPath,
      pathKey: path.normalize(targetPath).toLocaleLowerCase("en-US"),
      storageMode: asset.storageMode,
      libraryRelativePath:
        asset.storageMode === "managed"
          ? path.relative(managedStorePath(target.root), targetPath)
          : null,
      originalSourcePath: asset.originalSourcePath,
      linkState: "online",
    });
    const record = targetDb.getAsset(asset.id);
    if (!record) throw new Error("MERGE_INSERT_FAILED");
    await this.mergeTags(targetDb, record.id, asset.tags);
    for (const annotation of sourceDb.listAssetAnnotations(asset.id)) {
      targetDb.createAssetAnnotation(record.id, {
        x: annotation.x,
        y: annotation.y,
        text: annotation.text,
      });
    }
    report.mergedAssets += 1;
    await appendLog({ action: "merged", assetId: asset.id, targetPath, hash });
  }

  /** Folds tags, annotations, rating and favorite from the source record onto a target record. */
  private async mergeMetadataInto(
    sourceDb: RefCanvasDatabase,
    targetDb: RefCanvasDatabase,
    targetAssetId: string,
    asset: AssetRecord,
  ): Promise<void> {
    const merged = targetDb.getAsset(targetAssetId)!;
    targetDb.updateAsset(targetAssetId, {
      favorite: merged.favorite || asset.favorite,
      rating: Math.max(merged.rating, asset.rating),
      notes: merged.notes || asset.notes,
    });
    await this.mergeTags(targetDb, targetAssetId, asset.tags);
    for (const annotation of sourceDb.listAssetAnnotations(asset.id)) {
      targetDb.createAssetAnnotation(targetAssetId, {
        x: annotation.x,
        y: annotation.y,
        text: annotation.text,
      });
    }
  }

  /**
   * Finds an active target record with the same content hash and size.
   * Records whose `contentHash` was never computed are matched lazily by
   * hashing them on demand (memoized per call).
   */
  private async findByHash(
    db: RefCanvasDatabase,
    hash: string,
    size: number,
  ): Promise<AssetRecord | null> {
    const computed = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = db.searchAssets({ lifecycle: "active", pageSize: 500, cursor });
      for (const item of page.items) {
        if (item.size !== size) continue;
        const candidateHash = await (async () => {
          if (item.contentHash) return item.contentHash;
          const memo = computed.get(item.id);
          if (memo) return memo;
          const filename = db.getAssetPath(item.id);
          const value = filename
            ? await fullHash(filename).catch(() => null)
            : null;
          if (value) {
            computed.set(item.id, value);
            db.setContentHash(item.id, value);
          }
          return value;
        })();
        if (candidateHash === hash) return item;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return null;
  }

  private async mergeTags(
    db: RefCanvasDatabase,
    assetId: string,
    tags: string[],
  ): Promise<void> {
    const current = db.getAsset(assetId);
    if (!current) return;
    const combined = [...new Set([...current.tags, ...tags])];
    db.setAssetTags(assetId, combined);
  }

  private async persist(): Promise<void> {
    await writeFile(
      this.registryPath,
      JSON.stringify(this.registry, null, 2),
      "utf8",
    );
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [] as never[]);
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await listFilesRecursive(full)));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function fullHash(filename: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function copyFileVerifiedAtomically(
  source: string,
  destination: string,
  expectedHash?: string,
): Promise<void> {
  const temporary = `${destination}.partial-${randomUUID()}`;
  try {
    await copyFile(source, temporary);
    const [sourceStat, copiedStat] = await Promise.all([
      stat(source),
      stat(temporary),
    ]);
    if (sourceStat.size !== copiedStat.size) {
      throw new Error("FILE_COPY_SIZE_MISMATCH");
    }
    const sourceHash = expectedHash ?? (await fullHash(source));
    const copiedHash = await fullHash(temporary);
    if (sourceHash !== copiedHash) {
      throw new Error("FILE_COPY_HASH_MISMATCH");
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function moveAcrossDevicesVerified(
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const temporaryRoot = `${targetRoot}.partial-${randomUUID()}`;
  let targetInstalled = false;
  try {
    await mkdir(temporaryRoot, { recursive: true });
    const files = await listFilesRecursive(sourceRoot);
    for (const source of files) {
      const relative = path.relative(sourceRoot, source);
      const destination = path.join(temporaryRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFileVerifiedAtomically(source, destination);
    }
    await rename(temporaryRoot, targetRoot);
    targetInstalled = true;
    await rm(sourceRoot, { recursive: true });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (targetInstalled && (await pathExists(sourceRoot))) {
      await rm(targetRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

async function pathExists(filename: string): Promise<boolean> {
  return stat(filename).then(() => true).catch(() => false);
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EXDEV"
  );
}
