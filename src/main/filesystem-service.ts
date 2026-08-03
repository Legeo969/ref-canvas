import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "chokidar";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DirectoryEntry,
  DirectoryPage,
  DirectoryProgressSnapshot,
  DirectorySearchSnapshot,
  QuickAccessEntry,
} from "../shared/contracts";
import type { RefCanvasDatabase } from "./database";
import { detectFileSequences } from "../shared/file-sequence";
import type { DirectoryIndexClient } from "./directory-index-client";

const QUICK_ACCESS_KEY = "quickAccessEntries";
const MAX_QUICK_ACCESS = 64;
const ROOT_PROBE_TIMEOUT_MS = 250;

export interface ListDirectoryOptions {
  cursor?: string;
  offset?: number;
  pageSize?: number;
}

function extensionFor(name: string, isDirectory: boolean): string {
  if (isDirectory) return "";
  const extension = path.extname(name).toLowerCase();
  return extension.startsWith(".") ? extension.slice(1) : extension;
}

function entryFromDirent(
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

/** 目录内容按名称稳定排序（目录优先，再按名称）。 */
function sortDirectory(entries: DirectoryEntry[]): DirectoryEntry[] {
  return entries.slice().sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

/**
 * Found 式本地目录浏览服务：浏览不产生任何素材数据库记录；未入库文件
 * 通过 materialize 按需入库。所有路径以参数传入，不接触数据库素材表。
 */
export class FilesystemService {
  private readonly events = new EventEmitter();
  private readonly directoryCache = new Map<
    string,
    { entries: DirectoryEntry[]; metadataResolved: boolean }
  >();
  private readonly metadataJobs = new Map<string, Promise<void>>();
  private readonly searches = new Map<string, DirectorySearchSnapshot>();
  private searchSequence = 0;
  private readonly indexClient: DirectoryIndexClient | null;
  private readonly unsubscribeIndex: (() => void) | null;
  private readonly unsubscribeSearchIndex: (() => void) | null;
  private watcher: FSWatcher | null = null;
  private watchedDirectory: string | null = null;
  private watcherTimer: NodeJS.Timeout | null = null;
  /** 无系统回收站环境（测试/降级）时使用的内部回收站目录。 */
  readonly fallbackTrashRoot: string;

  constructor(
    private readonly database: RefCanvasDatabase,
    options: {
      trashRoot?: string;
      fallbackTrashRoot?: string;
      indexClient?: DirectoryIndexClient;
    } = {},
  ) {
    this.fallbackTrashRoot =
      options.fallbackTrashRoot ?? options.trashRoot ?? "trash";
    this.indexClient = options.indexClient ?? null;
    this.unsubscribeIndex = this.indexClient
      ? this.indexClient.onProgress((snapshot) =>
          this.events.emit("directory-progress", snapshot),
        )
      : null;
    this.unsubscribeSearchIndex = this.indexClient
      ? this.indexClient.onSearchProgress((snapshot) => {
          this.searches.set(snapshot.id, snapshot);
          this.emitSearch(snapshot);
        })
      : null;
  }

  onDirectoryProgress(
    listener: (snapshot: DirectoryProgressSnapshot) => void,
  ): () => void {
    this.events.on("directory-progress", listener);
    return () => this.events.off("directory-progress", listener);
  }

  onSearchProgress(
    listener: (snapshot: DirectorySearchSnapshot) => void,
  ): () => void {
    this.events.on("directory-search-progress", listener);
    return () => this.events.off("directory-search-progress", listener);
  }

  /** 清理内部状态（与 LibraryService 保持对称的收尾接口）。 */
  close(): void {
    this.unsubscribeIndex?.();
    this.unsubscribeSearchIndex?.();
    this.indexClient?.close();
    void this.watcher?.close();
    this.watcher = null;
    if (this.watcherTimer) clearTimeout(this.watcherTimer);
    this.directoryCache.clear();
    this.metadataJobs.clear();
    for (const snapshot of this.searches.values()) {
      if (snapshot.state === "running") {
        snapshot.state = "cancelled";
        snapshot.completedAt = new Date().toISOString();
      }
    }
    this.events.removeAllListeners();
  }

  private emitSearch(snapshot: DirectorySearchSnapshot): void {
    this.events.emit("directory-search-progress", snapshot);
  }

  /** Windows C:–Z: 根目录；只探测可访问性，断开的映射盘在超时后跳过。 */
  async listRoots(): Promise<DirectoryEntry[]> {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const probes = await Promise.allSettled(
      letters.split("").map(async (letter) => {
        const root = `${letter}:\\`;
        const result = await Promise.race([
          stat(root),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("ROOT_PROBE_TIMEOUT")), ROOT_PROBE_TIMEOUT_MS),
          ),
        ]);
        if (!result.isDirectory()) throw new Error("NOT_A_DIRECTORY");
        return {
          path: root,
          name: `${letter}:`,
          isDirectory: true,
          extension: "",
        };
      }),
    );
    const roots: DirectoryEntry[] = [];
    for (const probe of probes) {
      if (probe.status === "fulfilled") roots.push(probe.value);
    }
    return roots;
  }

  /** 展开目录下一层；目录内容按名称缓存，游标分页。 */
  async listDirectory(
    filename: string,
    options: ListDirectoryOptions = {},
  ): Promise<DirectoryPage> {
    const resolved = path.resolve(filename);
    if (this.indexClient) {
      this.watchDirectory(resolved);
      const cursor = Number.parseInt(options.cursor ?? "0", 10);
      const offset = options.offset ?? (Number.isFinite(cursor) ? cursor : 0);
      return this.indexClient.list(
        resolved,
        Math.max(0, offset),
        Math.max(1, Math.min(512, options.pageSize ?? 512)),
      );
    }
    let cached = this.directoryCache.get(resolved);
    if (!cached) {
      const dirents = await readdir(resolved, { withFileTypes: true });
      const entries = sortDirectory(
        dirents.map((dirent) =>
          entryFromDirent(resolved, dirent.name, dirent.isDirectory()),
        ),
      );
      const sequences = detectFileSequences(entries);
      for (const entry of entries) {
        entry.sequence = sequences.get(entry.path);
      }
      cached = { entries, metadataResolved: false };
      this.directoryCache.set(resolved, cached);
      void this.fillMetadataInBackground(resolved, cached);
    }
    const pageSize = Math.max(1, Math.min(10_000, options.pageSize ?? 500));
    const cursor = Number.parseInt(options.cursor ?? "0", 10);
    const start = Number.isFinite(cursor) ? Math.max(0, cursor) : 0;
    return {
      entries: cached.entries.slice(start, start + pageSize),
      total: cached.entries.length,
      nextCursor:
        start + pageSize < cached.entries.length
          ? String(start + pageSize)
          : null,
    };
  }

  /** 目录失效（删除/改名后）从缓存移除。 */
  invalidateDirectory(filename: string): void {
    const resolved = path.resolve(filename);
    this.directoryCache.delete(resolved);
    this.metadataJobs.delete(resolved);
    void this.indexClient?.invalidate(resolved);
  }

  resolveSelection(
    directoryPath: string,
    revision: string,
    excludedPaths: string[],
    offset: number,
    pageSize = 1_000,
  ): Promise<{ paths: string[]; nextOffset: number | null; total: number }> {
    if (!this.indexClient) throw new Error("DIRECTORY_INDEX_UNAVAILABLE");
    return this.indexClient.resolveSelection(
      path.resolve(directoryPath),
      revision,
      excludedPaths.map((item) => path.resolve(item)),
      offset,
      pageSize,
    );
  }

  resolveSearchSelection(
    searchId: string,
    revision: string,
    excludedPaths: string[],
    offset: number,
    pageSize = 1_000,
  ): Promise<{ paths: string[]; nextOffset: number | null; total: number }> {
    if (!this.indexClient) throw new Error("DIRECTORY_INDEX_UNAVAILABLE");
    return this.indexClient.resolveSearchSelection(
      searchId,
      revision,
      excludedPaths.map((item) => path.resolve(item)),
      offset,
      pageSize,
    );
  }

  locateEntry(
    directoryPath: string,
    entryPath: string,
    revision: string,
  ): Promise<number | null> {
    if (!this.indexClient) return Promise.resolve(null);
    return this.indexClient.locate(
      path.resolve(directoryPath),
      path.resolve(entryPath),
      revision,
    );
  }

  private watchDirectory(directory: string): void {
    if (this.watchedDirectory === directory) return;
    void this.watcher?.close();
    this.watchedDirectory = directory;
    this.watcher = watch(directory, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 50 },
    });
    this.watcher.on("all", () => {
      if (this.watcherTimer) clearTimeout(this.watcherTimer);
      this.watcherTimer = setTimeout(() => {
        this.watcherTimer = null;
        this.invalidateDirectory(directory);
        this.events.emit("directory-progress", {
          path: directory,
          revision: "",
          state: "invalidated",
        } satisfies DirectoryProgressSnapshot);
      }, 160);
    });
  }

  /**
   * 后台分批补齐 size/mtime/尺寸/时长。依赖这些字段的排序由渲染层在
   * metadataResolved 后一次性稳定排序。
   */
  private fillMetadataInBackground(
    directory: string,
    cached: { entries: DirectoryEntry[]; metadataResolved: boolean },
  ): Promise<void> {
    const existing = this.metadataJobs.get(directory);
    if (existing) return existing;
    const job = (async () => {
      const batchSize = 64;
      for (let offset = 0; offset < cached.entries.length; offset += batchSize) {
        const batch = cached.entries.slice(offset, offset + batchSize);
        await Promise.allSettled(
          batch.map(async (entry) => {
            try {
              const fileStat = await stat(entry.path);
              entry.size = fileStat.size;
              entry.mtimeMs = fileStat.mtimeMs;
            } catch {
              // 条目已消失，保留基础信息。
            }
          }),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        this.events.emit("directory-progress", {
          path: directory,
          revision: "",
          state: "metadata",
          entries: batch,
        } satisfies DirectoryProgressSnapshot);
      }
      cached.metadataResolved = true;
    })().finally(() => this.metadataJobs.delete(directory));
    this.metadataJobs.set(directory, job);
    return job;
  }

  /** 目录搜索结果快照（含流式追加的条目）。 */
  getSearch(id: string): DirectorySearchSnapshot | null {
    return this.searches.get(id) ?? null;
  }

  getSearchPage(
    id: string,
    options: { offset?: number; pageSize?: number } = {},
  ): Promise<DirectoryPage> {
    if (this.indexClient) {
      return this.indexClient.searchPage(
        id,
        Math.max(0, options.offset ?? 0),
        Math.max(1, Math.min(512, options.pageSize ?? 512)),
      );
    }
    const snapshot = this.searches.get(id);
    if (!snapshot) return Promise.reject(new Error("DIRECTORY_SEARCH_NOT_FOUND"));
    const offset = Math.max(0, options.offset ?? 0);
    const pageSize = Math.max(1, Math.min(512, options.pageSize ?? 512));
    const entries = snapshot.entries.slice(offset, offset + pageSize);
    return Promise.resolve({
      entries,
      total: snapshot.entries.length,
      totalFiles: snapshot.entries.length,
      offset,
      revision: snapshot.revision,
      scanState: snapshot.state === "completed" ? "complete" : "scanning",
      order: snapshot.state === "completed" ? "name" : "discovery",
      nextCursor:
        offset + entries.length < snapshot.entries.length
          ? String(offset + entries.length)
          : null,
    });
  }

  /**
   * 目录搜索：当前层结果立即返回，子目录结果流式追加；路径或关键词变化
   * 会先取消旧任务（每个搜索 id 独立，旧任务结果隔离）。
   */
  async startSearch(rootPath: string, query: string): Promise<string> {
    const resolved = path.resolve(rootPath);
    const normalized = query.trim().toLocaleLowerCase("en-US");
    const id = `search-${Date.now()}-${this.searchSequence++}`;
    const createdAt = new Date().toISOString();
    const snapshot: DirectorySearchSnapshot = {
      id,
      state: "running",
      rootPath: resolved,
      query,
      entries: [],
      processedDirectories: 0,
      totalDirectories: null,
      failedDirectories: [],
      createdAt,
      completedAt: null,
    };
    this.searches.set(id, snapshot);
    this.emitSearch({ ...snapshot });

    if (this.indexClient) {
      void this.indexClient.startSearch(id, resolved, query).then((workerSnapshot) => {
        this.searches.set(id, workerSnapshot);
        this.emitSearch(workerSnapshot);
      }).catch((error) => {
        const failed = this.searches.get(id);
        if (!failed) return;
        failed.state = "failed";
        failed.completedAt = new Date().toISOString();
        failed.failedDirectories.push({
          path: resolved,
          reason: error instanceof Error ? error.message : "SEARCH_FAILED",
        });
        this.emitSearch({ ...failed });
      });
    } else {
      void this.runSearch(id, resolved, normalized);
    }
    return id;
  }

  private async runSearch(
    id: string,
    root: string,
    query: string,
  ): Promise<void> {
    const matchName = (name: string) =>
      !query || name.toLocaleLowerCase("en-US").includes(query);
    const pending: string[] = [root];
    let offset = 0;
    try {
      while (offset < pending.length) {
        const current = this.searches.get(id);
        if (!current || current.state === "cancelled") return;
        const batch = pending.slice(offset, offset + 8);
        offset += batch.length;
        await Promise.all(
          batch.map(async (directory) => {
            try {
              const dirents = await readdir(directory, { withFileTypes: true });
              const matches: DirectoryEntry[] = [];
              for (const dirent of dirents) {
                const entry = entryFromDirent(
                  directory,
                  dirent.name,
                  dirent.isDirectory(),
                );
                if (entry.isDirectory) {
                  pending.push(entry.path);
                } else if (matchName(entry.name)) {
                  matches.push(entry);
                }
              }
              if (matches.length) {
                const currentSnapshot = this.searches.get(id);
                if (!currentSnapshot) return;
                currentSnapshot.entries.push(...matches);
                currentSnapshot.processedDirectories += 1;
                this.emitSearch({ ...currentSnapshot });
              } else {
                const currentSnapshot = this.searches.get(id);
                if (!currentSnapshot) return;
                currentSnapshot.processedDirectories += 1;
              }
            } catch (error) {
              const currentSnapshot = this.searches.get(id);
              if (!currentSnapshot) return;
              currentSnapshot.failedDirectories.push({
                path: directory,
                reason: error instanceof Error ? error.message : "EACCES",
              });
              currentSnapshot.processedDirectories += 1;
            }
          }),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const finished = this.searches.get(id);
      if (!finished || finished.state === "cancelled") return;
      finished.state = "completed";
      finished.totalDirectories = pending.length;
      finished.completedAt = new Date().toISOString();
      this.emitSearch({ ...finished });
    } catch (error) {
      const failed = this.searches.get(id);
      if (!failed) return;
      failed.state = "failed";
      failed.completedAt = new Date().toISOString();
      failed.failedDirectories.push({
        path: root,
        reason: error instanceof Error ? error.message : "SEARCH_FAILED",
      });
      this.emitSearch({ ...failed });
    }
  }

  cancelSearch(id: string): void {
    const snapshot = this.searches.get(id);
    if (!snapshot || snapshot.state === "completed") return;
    snapshot.state = "cancelled";
    snapshot.completedAt = new Date().toISOString();
    this.emitSearch({ ...snapshot });
    void this.indexClient?.cancelSearch(id);
  }

  /** 快速访问：本地目录或 NAS 路径，保存显示名、排序与展开状态。 */
  listQuickAccess(): QuickAccessEntry[] {
    return this.database.getSetting<QuickAccessEntry[]>(
      QUICK_ACCESS_KEY,
      [],
    );
  }

  addQuickAccess(filename: string, name?: string): QuickAccessEntry[] {
    const resolved = path.resolve(filename);
    const current = this.listQuickAccess();
    const existing = current.find((entry) => entry.path === resolved);
    let next: QuickAccessEntry[];
    if (existing) {
      next = current.map((entry) =>
        entry.id === existing.id
          ? { ...entry, name: name?.trim() || entry.name }
          : entry,
      );
    } else {
      const entry: QuickAccessEntry = {
        id: randomUUID(),
        path: resolved,
        name:
          name?.trim() ||
          (path.parse(resolved).root === resolved ? resolved : path.basename(resolved)),
        sortOrder: current.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1,
        expanded: false,
        createdAt: new Date().toISOString(),
      };
      next = [...current, entry].slice(-MAX_QUICK_ACCESS);
    }
    this.database.setSetting(QUICK_ACCESS_KEY, next);
    return next;
  }

  updateQuickAccess(
    id: string,
    patch: { name?: string; expanded?: boolean },
  ): QuickAccessEntry[] {
    const next = this.listQuickAccess().map((entry) =>
      entry.id === id
        ? {
            ...entry,
            name: patch.name?.trim() || entry.name,
            expanded: patch.expanded ?? entry.expanded,
          }
        : entry,
    );
    this.database.setSetting(QUICK_ACCESS_KEY, next);
    return next;
  }

  removeQuickAccess(id: string): QuickAccessEntry[] {
    const next = this.listQuickAccess().filter((entry) => entry.id !== id);
    this.database.setSetting(QUICK_ACCESS_KEY, next);
    return next;
  }
}
