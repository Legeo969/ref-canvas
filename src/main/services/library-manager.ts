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
import type { LibrarySummary } from "../../shared/contracts";
import { RefCanvasDatabase } from "../persistence/database";

const MANIFEST_FILENAME = "refcanvas.library.json";
const REGISTRY_FILENAME = "libraries.json";

interface LibraryManifest {
  format: "refcanvas-library";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
}

export interface LibraryEntry {
  id: string;
  name: string;
  root: string;
  createdAt: string;
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
 * `data/`, a trash under `trash/` and migration snapshots under `backups/`. The
 * registry of known libraries lives in a small JSON file in the app data
 * directory so it survives a corrupted library database and is readable before
 * any library is opened.
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
    let entry = this.registry.libraries.find((item) => item.legacy);
    if (!entry) {
      entry = {
        id: randomUUID(),
        name: "默认资料库",
        root: this.userDataDirectory,
        createdAt: new Date().toISOString(),
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
    let assetCount: number;
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
    };
    // Initialize the database so a freshly created library is immediately
    // usable and its migration history starts clean.
    const db = new RefCanvasDatabase(databasePathFor({
      id: manifest.id,
      name: manifest.name,
      root,
      createdAt: manifest.createdAt,
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
      legacy: false,
    };
    if (!existing) {
      this.registry.libraries.push(entry);
    } else {
      existing.name = manifest.name;
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
