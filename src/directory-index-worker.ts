import Database from "better-sqlite3";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { detectFileSequences } from "./shared/file-sequence";
import type {
  DirectoryEntry,
  DirectoryPage,
  DirectorySearchSnapshot,
} from "./shared/contracts";

interface WorkerRequest {
  id: string;
  type:
    | "list"
    | "locate"
    | "resolve-selection"
    | "start-search"
    | "search-page"
    | "resolve-search-selection"
    | "cancel-search"
    | "invalidate"
    | "close";
  databasePath?: string;
  directoryPath?: string;
  offset?: number;
  pageSize?: number;
  revision?: string;
  excludedPaths?: string[];
  entryPath?: string;
  searchId?: string;
  query?: string;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: WorkerRequest }) => void): void;
}

interface ScanState {
  revision: string;
  discovered: number;
  fileTotal: number;
  complete: boolean;
  cancelled: boolean;
  waiters: Array<{
    id: string;
    offset: number;
    pageSize: number;
  }>;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort) throw new Error("DIRECTORY_WORKER_PARENT_MISSING");

let database: Database.Database | null = null;
const scans = new Map<string, ScanState>();
const cancelledSearches = new Set<string>();

function extensionFor(name: string, isDirectory: boolean): string {
  if (isDirectory) return "";
  const extension = path.extname(name).toLowerCase();
  return extension.startsWith(".") ? extension.slice(1) : extension;
}

function initialize(filename: string): Database.Database {
  if (database) return database;
  database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.pragma("user_version = 2");
  database.exec(`
    CREATE TABLE IF NOT EXISTS directory_scans (
      directory_path TEXT PRIMARY KEY,
      revision TEXT NOT NULL,
      directory_mtime_ms REAL NOT NULL,
      state TEXT NOT NULL,
      discovered INTEGER NOT NULL,
      file_total INTEGER NOT NULL,
      last_access_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS directory_entries (
      directory_path TEXT NOT NULL,
      entry_path TEXT NOT NULL,
      name TEXT NOT NULL,
      is_directory INTEGER NOT NULL,
      extension TEXT NOT NULL,
      discovery_ordinal INTEGER NOT NULL,
      size INTEGER,
      mtime_ms REAL,
      sequence_json TEXT,
      PRIMARY KEY(directory_path, entry_path)
    );
    CREATE INDEX IF NOT EXISTS directory_entries_discovery
      ON directory_entries(directory_path, discovery_ordinal);
    CREATE INDEX IF NOT EXISTS directory_entries_name
      ON directory_entries(directory_path, is_directory DESC, name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS directory_searches (
      search_id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      query TEXT NOT NULL,
      revision TEXT NOT NULL,
      state TEXT NOT NULL,
      discovered INTEGER NOT NULL,
      processed_directories INTEGER NOT NULL,
      total_directories INTEGER,
      failed_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS directory_search_entries (
      search_id TEXT NOT NULL,
      entry_path TEXT NOT NULL,
      name TEXT NOT NULL,
      extension TEXT NOT NULL,
      discovery_ordinal INTEGER NOT NULL,
      PRIMARY KEY(search_id, entry_path)
    );
    CREATE INDEX IF NOT EXISTS directory_search_entries_discovery
      ON directory_search_entries(search_id, discovery_ordinal);
    CREATE INDEX IF NOT EXISTS directory_search_entries_name
      ON directory_search_entries(search_id, name COLLATE NOCASE, entry_path);
  `);
  return database;
}

function readSearchSnapshot(searchId: string): DirectorySearchSnapshot {
  const row = database!.prepare(`
    SELECT root_path, query, revision, state, discovered, processed_directories,
      total_directories, failed_json, created_at, completed_at
    FROM directory_searches WHERE search_id = ?
  `).get(searchId) as {
    root_path: string;
    query: string;
    revision: string;
    state: DirectorySearchSnapshot["state"];
    discovered: number;
    processed_directories: number;
    total_directories: number | null;
    failed_json: string;
    created_at: string;
    completed_at: string | null;
  } | undefined;
  if (!row) throw new Error("DIRECTORY_SEARCH_NOT_FOUND");
  return {
    id: searchId,
    state: row.state,
    rootPath: row.root_path,
    query: row.query,
    entries: readSearchPage(searchId, 0, 512).entries,
    totalFiles: row.discovered,
    revision: row.revision,
    order: row.state === "completed" ? "name" : "discovery",
    processedDirectories: row.processed_directories,
    totalDirectories: row.total_directories,
    failedDirectories: JSON.parse(row.failed_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function readSearchPage(
  searchId: string,
  offset: number,
  pageSize: number,
): DirectoryPage {
  const search = database!.prepare(
    "SELECT revision, state, discovered FROM directory_searches WHERE search_id = ?",
  ).get(searchId) as {
    revision: string;
    state: DirectorySearchSnapshot["state"];
    discovered: number;
  } | undefined;
  if (!search) throw new Error("DIRECTORY_SEARCH_NOT_FOUND");
  const order = search.state === "completed" ? "name" : "discovery";
  const rows = database!.prepare(`
    SELECT entry_path, name, extension
    FROM directory_search_entries WHERE search_id = ?
    ORDER BY ${order === "name" ? "name COLLATE NOCASE, entry_path" : "discovery_ordinal"}
    LIMIT ? OFFSET ?
  `).all(searchId, pageSize, offset) as Array<{
    entry_path: string;
    name: string;
    extension: string;
  }>;
  return {
    entries: rows.map((row) => ({
      path: row.entry_path,
      name: row.name,
      isDirectory: false,
      extension: row.extension,
    })),
    total: search.discovered,
    totalFiles: search.discovered,
    offset,
    revision: search.revision,
    scanState: search.state === "completed" ? "complete" : "scanning",
    order,
    nextCursor:
      offset + rows.length < search.discovered
        ? String(offset + rows.length)
        : null,
  };
}

function emitSearchProgress(searchId: string): void {
  parentPort!.postMessage({
    type: "search-progress",
    search: readSearchSnapshot(searchId),
  });
}

async function runSearch(
  searchId: string,
  rootPath: string,
  query: string,
): Promise<void> {
  const db = database!;
  const pending = [rootPath];
  const failed: Array<{ path: string; reason: string }> = [];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO directory_search_entries(
      search_id, entry_path, name, extension, discovery_ordinal
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertBatch = db.transaction((entries: DirectoryEntry[], base: number) => {
    entries.forEach((entry, index) =>
      insert.run(searchId, entry.path, entry.name, entry.extension, base + index),
    );
  });
  let directoryOffset = 0;
  let discovered = 0;
  while (directoryOffset < pending.length && !cancelledSearches.has(searchId)) {
    const directory = pending[directoryOffset++];
    const matches: DirectoryEntry[] = [];
    try {
      const handle = await opendir(directory);
      try {
        for await (const dirent of handle) {
          if (cancelledSearches.has(searchId)) break;
          const entry = entryFromName(directory, dirent.name, dirent.isDirectory());
          if (entry.isDirectory) {
            pending.push(entry.path);
          } else if (!query || entry.name.toLocaleLowerCase("en-US").includes(query)) {
            matches.push(entry);
          }
          if (matches.length === 1_000) {
            insertBatch(matches, discovered);
            discovered += matches.length;
            matches.length = 0;
            db.prepare(
              "UPDATE directory_searches SET discovered = ?, processed_directories = ?, total_directories = ? WHERE search_id = ?",
            ).run(discovered, directoryOffset, pending.length, searchId);
            emitSearchProgress(searchId);
          }
        }
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch (error) {
      failed.push({
        path: directory,
        reason: error instanceof Error ? error.message : "EACCES",
      });
    }
    if (matches.length) {
      insertBatch(matches, discovered);
      discovered += matches.length;
    }
    db.prepare(`
      UPDATE directory_searches
      SET discovered = ?, processed_directories = ?, total_directories = ?, failed_json = ?
      WHERE search_id = ?
    `).run(discovered, directoryOffset, pending.length, JSON.stringify(failed), searchId);
    emitSearchProgress(searchId);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const completedAt = new Date().toISOString();
  if (cancelledSearches.delete(searchId)) {
    db.prepare(
      "UPDATE directory_searches SET state = 'cancelled', completed_at = ? WHERE search_id = ?",
    ).run(completedAt, searchId);
  } else {
    const revision = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    db.prepare(`
      UPDATE directory_searches
      SET state = 'completed', revision = ?, total_directories = ?, completed_at = ?
      WHERE search_id = ?
    `).run(revision, pending.length, completedAt, searchId);
  }
  emitSearchProgress(searchId);
}

function entryFromName(
  directory: string,
  name: string,
  isDirectory: boolean,
): DirectoryEntry {
  return {
    path: path.join(directory, name),
    name,
    isDirectory,
    extension: extensionFor(name, isDirectory),
  };
}

function readPage(
  directoryPath: string,
  offset: number,
  pageSize: number,
): DirectoryPage {
  const db = database!;
  const scan = db.prepare(
    "SELECT revision, state, discovered, file_total FROM directory_scans WHERE directory_path = ?",
  ).get(directoryPath) as {
    revision: string;
    state: "scanning" | "complete";
    discovered: number;
    file_total: number;
  };
  const order = scan.state === "complete" ? "name" : "discovery";
  const rows = db.prepare(`
    SELECT entry_path, name, is_directory, extension, size, mtime_ms, sequence_json
    FROM directory_entries
    WHERE directory_path = ?
    ORDER BY ${order === "name"
      ? "is_directory DESC, name COLLATE NOCASE, entry_path"
      : "discovery_ordinal"}
    LIMIT ? OFFSET ?
  `).all(directoryPath, pageSize, offset) as Array<{
    entry_path: string;
    name: string;
    is_directory: number;
    extension: string;
    size: number | null;
    mtime_ms: number | null;
    sequence_json: string | null;
  }>;
  const entries: DirectoryEntry[] = rows.map((row) => ({
    path: row.entry_path,
    name: row.name,
    isDirectory: row.is_directory === 1,
    extension: row.extension,
    ...(row.size === null ? {} : { size: row.size }),
    ...(row.mtime_ms === null ? {} : { mtimeMs: row.mtime_ms }),
    ...(row.sequence_json ? { sequence: JSON.parse(row.sequence_json) } : {}),
  }));
  return {
    entries,
    total: scan.discovered,
    totalFiles: scan.file_total,
    offset,
    revision: scan.revision,
    scanState: scan.state,
    order,
    nextCursor:
      offset + entries.length < scan.discovered
        ? String(offset + entries.length)
        : null,
  };
}

function resolveWaiters(directoryPath: string, state: ScanState): void {
  const ready = state.waiters.filter(
    (waiter) => state.complete || state.discovered >= waiter.offset + waiter.pageSize,
  );
  state.waiters = state.waiters.filter((waiter) => !ready.includes(waiter));
  for (const waiter of ready) {
    parentPort!.postMessage({
      id: waiter.id,
      ok: true,
      page: readPage(directoryPath, waiter.offset, waiter.pageSize),
    });
  }
}

async function fillMetadata(directoryPath: string, entries: DirectoryEntry[]): Promise<void> {
  const db = database!;
  const update = db.prepare(
    "UPDATE directory_entries SET size = ?, mtime_ms = ? WHERE directory_path = ? AND entry_path = ?",
  );
  const patches: DirectoryEntry[] = [];
  for (let offset = 0; offset < entries.length; offset += 16) {
    const batch = entries.slice(offset, offset + 16);
    const results = await Promise.allSettled(batch.map(async (entry) => {
      const info = await stat(entry.path);
      entry.size = info.size;
      entry.mtimeMs = info.mtimeMs;
      return entry;
    }));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const entry = result.value;
      update.run(entry.size, entry.mtimeMs, directoryPath, entry.path);
      patches.push(entry);
    }
  }
  if (patches.length) {
    parentPort!.postMessage({
      type: "progress",
      progress: {
        path: directoryPath,
        revision: scans.get(directoryPath)?.revision ?? "",
        state: "metadata",
        entries: patches,
      },
    });
  }
}

async function scanDirectory(directoryPath: string, state: ScanState, mtimeMs: number): Promise<void> {
  const db = database!;
  const insert = db.prepare(`
    INSERT OR REPLACE INTO directory_entries(
      directory_path, entry_path, name, is_directory, extension, discovery_ordinal
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertBatch = db.transaction((entries: DirectoryEntry[], base: number) => {
    entries.forEach((entry, index) => insert.run(
      directoryPath,
      entry.path,
      entry.name,
      entry.isDirectory ? 1 : 0,
      entry.extension,
      base + index,
    ));
  });
  const sequenceCandidates: DirectoryEntry[] = [];
  let batch: DirectoryEntry[] = [];
  const handle = await opendir(directoryPath);
  try {
    for await (const dirent of handle) {
      if (state.cancelled) break;
      const entry: DirectoryEntry = {
        path: path.join(directoryPath, dirent.name),
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        extension: extensionFor(dirent.name, dirent.isDirectory()),
      };
      batch.push(entry);
      if (!entry.isDirectory && /[_.-]\d{3,}\.[^.]+$/.test(entry.name)) {
        sequenceCandidates.push(entry);
      }
      if (batch.length < 1_000) continue;
      insertBatch(batch, state.discovered);
      state.discovered += batch.length;
      state.fileTotal += batch.filter((item) => !item.isDirectory).length;
      db.prepare(
        "UPDATE directory_scans SET discovered = ?, file_total = ? WHERE directory_path = ?",
      ).run(state.discovered, state.fileTotal, directoryPath);
      parentPort!.postMessage({
        type: "progress",
        progress: {
          path: directoryPath,
          revision: state.revision,
          state: "discovered",
          discovered: state.discovered,
          totalFiles: state.fileTotal,
        },
      });
      resolveWaiters(directoryPath, state);
      batch = [];
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (state.cancelled) return;
  if (batch.length) {
    insertBatch(batch, state.discovered);
    state.discovered += batch.length;
    state.fileTotal += batch.filter((item) => !item.isDirectory).length;
  }
  const sequences = detectFileSequences(sequenceCandidates);
  const updateSequence = db.prepare(
    "UPDATE directory_entries SET sequence_json = ? WHERE directory_path = ? AND entry_path = ?",
  );
  db.transaction(() => {
    for (const [entryPath, sequence] of sequences) {
      updateSequence.run(JSON.stringify(sequence), directoryPath, entryPath);
    }
  })();
  state.complete = true;
  state.revision = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  db.prepare(`
    UPDATE directory_scans
    SET revision = ?, directory_mtime_ms = ?, state = 'complete', discovered = ?, file_total = ?
    WHERE directory_path = ?
  `).run(state.revision, mtimeMs, state.discovered, state.fileTotal, directoryPath);
  resolveWaiters(directoryPath, state);
  parentPort!.postMessage({
    type: "progress",
    progress: {
      path: directoryPath,
      revision: state.revision,
      state: "reset",
      discovered: state.discovered,
      totalFiles: state.fileTotal,
    },
  });
}

async function list(request: WorkerRequest): Promise<void> {
  const directoryPath = path.resolve(request.directoryPath!);
  const offset = Math.max(0, request.offset ?? 0);
  const pageSize = Math.max(1, Math.min(512, request.pageSize ?? 512));
  const info = await stat(directoryPath);
  const db = database!;
  const cached = db.prepare(
    "SELECT revision, directory_mtime_ms, state, discovered, file_total FROM directory_scans WHERE directory_path = ?",
  ).get(directoryPath) as {
    revision: string;
    directory_mtime_ms: number;
    state: "scanning" | "complete";
    discovered: number;
    file_total: number;
  } | undefined;
  if (cached?.state === "complete" && cached.directory_mtime_ms === info.mtimeMs) {
    db.prepare("UPDATE directory_scans SET last_access_ms = ? WHERE directory_path = ?")
      .run(Date.now(), directoryPath);
    const page = readPage(directoryPath, offset, pageSize);
    parentPort!.postMessage({ id: request.id, ok: true, page });
    void fillMetadata(directoryPath, page.entries);
    return;
  }
  let scan = scans.get(directoryPath);
  if (!scan || scan.cancelled || scan.complete) {
    db.prepare("DELETE FROM directory_entries WHERE directory_path = ?").run(directoryPath);
    const revision = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    db.prepare(`
      INSERT INTO directory_scans(directory_path, revision, directory_mtime_ms, state, discovered, file_total, last_access_ms)
      VALUES (?, ?, ?, 'scanning', 0, 0, ?)
      ON CONFLICT(directory_path) DO UPDATE SET revision = excluded.revision,
        directory_mtime_ms = excluded.directory_mtime_ms, state = 'scanning',
        discovered = 0, file_total = 0, last_access_ms = excluded.last_access_ms
    `).run(directoryPath, revision, info.mtimeMs, Date.now());
    scan = {
      revision,
      discovered: 0,
      fileTotal: 0,
      complete: false,
      cancelled: false,
      waiters: [],
    };
    scans.set(directoryPath, scan);
    void scanDirectory(directoryPath, scan, info.mtimeMs).catch((error) => {
      for (const waiter of scan!.waiters.splice(0)) {
        parentPort!.postMessage({
          id: waiter.id,
          ok: false,
          error: error instanceof Error ? error.message : "DIRECTORY_SCAN_FAILED",
        });
      }
    });
  }
  scan.waiters.push({ id: request.id, offset, pageSize });
  resolveWaiters(directoryPath, scan);
}

parentPort.on("message", (event) => {
  const request = event.data;
  try {
    if (request.databasePath) initialize(request.databasePath);
    if (request.type === "list") {
      void list(request).catch((error) => parentPort.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : "DIRECTORY_LIST_FAILED",
      }));
    } else if (request.type === "start-search") {
      const searchId = request.searchId!;
      const rootPath = path.resolve(request.directoryPath!);
      const query = (request.query ?? "").trim().toLocaleLowerCase("en-US");
      const revision = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const createdAt = new Date().toISOString();
      cancelledSearches.delete(searchId);
      database!.prepare("DELETE FROM directory_search_entries WHERE search_id = ?")
        .run(searchId);
      database!.prepare(`
        INSERT OR REPLACE INTO directory_searches(
          search_id, root_path, query, revision, state, discovered,
          processed_directories, total_directories, failed_json, created_at, completed_at
        ) VALUES (?, ?, ?, ?, 'running', 0, 0, NULL, '[]', ?, NULL)
      `).run(searchId, rootPath, request.query ?? "", revision, createdAt);
      parentPort.postMessage({
        id: request.id,
        ok: true,
        search: readSearchSnapshot(searchId),
      });
      void runSearch(searchId, rootPath, query).catch((error) => {
        database?.prepare(`
          UPDATE directory_searches SET state = 'failed', completed_at = ?, failed_json = ?
          WHERE search_id = ?
        `).run(
          new Date().toISOString(),
          JSON.stringify([{ path: rootPath, reason: error instanceof Error ? error.message : "SEARCH_FAILED" }]),
          searchId,
        );
        emitSearchProgress(searchId);
      });
    } else if (request.type === "search-page") {
      const offset = Math.max(0, request.offset ?? 0);
      const pageSize = Math.max(1, Math.min(512, request.pageSize ?? 512));
      parentPort.postMessage({
        id: request.id,
        ok: true,
        page: readSearchPage(request.searchId!, offset, pageSize),
      });
    } else if (request.type === "cancel-search") {
      const searchId = request.searchId!;
      cancelledSearches.add(searchId);
      parentPort.postMessage({ id: request.id, ok: true, cancelled: true });
    } else if (request.type === "resolve-search-selection") {
      const search = database!.prepare(
        "SELECT revision, state, discovered FROM directory_searches WHERE search_id = ?",
      ).get(request.searchId!) as {
        revision: string;
        state: string;
        discovered: number;
      } | undefined;
      if (!search || search.state !== "completed") {
        throw new Error("DIRECTORY_SEARCH_NOT_COMPLETE");
      }
      if (search.revision !== request.revision) {
        throw new Error("DIRECTORY_REVISION_CHANGED");
      }
      const offset = Math.max(0, request.offset ?? 0);
      const limit = Math.max(1, Math.min(1_000, request.pageSize ?? 1_000));
      const rows = database!.prepare(`
        SELECT entry_path FROM directory_search_entries
        WHERE search_id = ? ORDER BY name COLLATE NOCASE, entry_path
        LIMIT ? OFFSET ?
      `).all(request.searchId!, limit, offset) as Array<{ entry_path: string }>;
      const excluded = new Set(request.excludedPaths ?? []);
      parentPort.postMessage({
        id: request.id,
        ok: true,
        selection: {
          paths: rows.map((row) => row.entry_path).filter((entryPath) => !excluded.has(entryPath)),
          nextOffset: offset + rows.length < search.discovered ? offset + rows.length : null,
          total: Math.max(0, search.discovered - excluded.size),
        },
      });
    } else if (request.type === "locate") {
      const directoryPath = path.resolve(request.directoryPath!);
      const entryPath = path.resolve(request.entryPath!);
      const scan = database?.prepare(
        "SELECT revision, state FROM directory_scans WHERE directory_path = ?",
      ).get(directoryPath) as { revision: string; state: string } | undefined;
      if (!scan || scan.state !== "complete" || scan.revision !== request.revision) {
        throw new Error("DIRECTORY_REVISION_CHANGED");
      }
      const target = database!.prepare(
        "SELECT name, is_directory FROM directory_entries WHERE directory_path = ? AND entry_path = ?",
      ).get(directoryPath, entryPath) as { name: string; is_directory: number } | undefined;
      const location = target
        ? (database!.prepare(`
            SELECT COUNT(*) AS count FROM directory_entries
            WHERE directory_path = ? AND (
              is_directory > ? OR
              (is_directory = ? AND name COLLATE NOCASE < ? COLLATE NOCASE) OR
              (is_directory = ? AND name COLLATE NOCASE = ? COLLATE NOCASE AND entry_path < ?)
            )
          `).get(
            directoryPath,
            target.is_directory,
            target.is_directory,
            target.name,
            target.is_directory,
            target.name,
            entryPath,
          ) as { count: number }).count
        : null;
      parentPort.postMessage({ id: request.id, ok: true, location });
    } else if (request.type === "resolve-selection") {
      const directoryPath = path.resolve(request.directoryPath!);
      const scan = database?.prepare(
        "SELECT revision, state, file_total FROM directory_scans WHERE directory_path = ?",
      ).get(directoryPath) as {
        revision: string;
        state: string;
        file_total: number;
      } | undefined;
      if (!scan || scan.state !== "complete") {
        throw new Error("DIRECTORY_SCAN_NOT_COMPLETE");
      }
      if (scan.revision !== request.revision) {
        throw new Error("DIRECTORY_REVISION_CHANGED");
      }
      const offset = Math.max(0, request.offset ?? 0);
      const limit = Math.max(1, Math.min(1_000, request.pageSize ?? 1_000));
      const rows = database!.prepare(`
        SELECT entry_path FROM directory_entries
        WHERE directory_path = ? AND is_directory = 0
        ORDER BY name COLLATE NOCASE, entry_path
        LIMIT ? OFFSET ?
      `).all(directoryPath, limit, offset) as Array<{ entry_path: string }>;
      const excluded = new Set(request.excludedPaths ?? []);
      parentPort.postMessage({
        id: request.id,
        ok: true,
        selection: {
          paths: rows.map((row) => row.entry_path).filter((entryPath) => !excluded.has(entryPath)),
          nextOffset: offset + rows.length < scan.file_total ? offset + rows.length : null,
          total: Math.max(0, scan.file_total - excluded.size),
        },
      });
    } else if (request.type === "invalidate") {
      const directoryPath = path.resolve(request.directoryPath!);
      const scan = scans.get(directoryPath);
      if (scan) scan.cancelled = true;
      database?.prepare("DELETE FROM directory_scans WHERE directory_path = ?").run(directoryPath);
      database?.prepare("DELETE FROM directory_entries WHERE directory_path = ?").run(directoryPath);
      parentPort.postMessage({ id: request.id, ok: true });
    } else if (request.type === "close") {
      for (const scan of scans.values()) scan.cancelled = true;
      for (const row of database?.prepare(
        "SELECT search_id FROM directory_searches WHERE state = 'running'",
      ).all() as Array<{ search_id: string }> ?? []) {
        cancelledSearches.add(row.search_id);
      }
      database?.close();
      database = null;
      parentPort.postMessage({ id: request.id, ok: true });
    }
  } catch (error) {
    parentPort.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "DIRECTORY_WORKER_FAILED",
    });
  }
});
