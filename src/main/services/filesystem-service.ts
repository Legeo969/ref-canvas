import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { watch as watchNative, type FSWatcher, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AssetSearchInput,
  DirectoryEntry,
  DirectoryPage,
  DirectoryProgressSnapshot,
  DirectorySearchSnapshot,
  QuickAccessEntry,
} from "../../shared/contracts";
import { parseAssetSearchQuery } from "../../shared/search-query";
import type { RefCanvasDatabase } from "../persistence/database";
import { detectFileSequences } from "../../shared/file-sequence";
import type { DirectoryIndexClient } from "../platform/directory-index-client";
import { isProtectedSystemDirectory } from "../../shared/system-directory-filter";
import { LruCache } from "../../shared/lru-cache";
import { MAX_RETAINED_DIRECTORY_SEARCHES } from "../../shared/directory-search-retention";

const QUICK_ACCESS_KEY = "quickAccessEntries";
const MAX_QUICK_ACCESS = 64;
const ROOT_PROBE_TIMEOUT_MS = 250;
export const MAX_DIRECTORY_CACHE_ENTRIES = 8;
/** 「只看收藏」视图的伪 revision：收藏枚举实时取自数据库，无需扫描校验。 */
const FAVORITES_ONLY_REVISION = "favorites";

export interface ListDirectoryOptions {
  cursor?: string;
  offset?: number;
  pageSize?: number;
  /** 阶段 5 §10.1：Folder flattening 深度（0 = 关闭；1/2 = 展开层级）。 */
  flattenDepth?: number;
  /** 阶段 5 §10.1：显示隐藏文件（以 . 开头）。 */
  showHidden?: boolean;
  /** 把连续图片帧折叠成一个序列条目；默认开启。 */
  collapseSequences?: boolean;
  /** 只过滤文件扩展名；普通目录视图保留目录，flatten 视图只返回素材。 */
  extensions?: string[];
  /** 只看收藏素材（按素材库 favorite 标记过滤；文件夹一并隐藏）。 */
  favoritesOnly?: boolean;
}

type DirectoryWatcherFactory = (
  directory: string,
  listener: () => void,
) => FSWatcher;

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

function collapseSequenceEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return entries.filter(
    (entry) =>
      !entry.sequence || entry.sequence.frame === entry.sequence.startFrame,
  );
}

function filterExtensions(
  entries: DirectoryEntry[],
  extensions?: string[],
): DirectoryEntry[] {
  if (!extensions?.length) return entries;
  const allowed = new Set(
    extensions.map((extension) => extension.replace(/^\./, "").toLowerCase()),
  );
  return entries.filter((entry) => entry.isDirectory || allowed.has(entry.extension));
}

/** 与数据库 path_key 同规则归一化（大小写不敏感比较）。 */
function favoritePathKey(filename: string): string {
  return path.normalize(filename).toLocaleLowerCase("en-US");
}

/** 收藏子树范围前缀：根目录（d:\）归一化后已带分隔符，不得重复拼接，
 * 否则根目录下任何收藏都匹配不到（「只看收藏」在磁盘根目录显示为空）。 */
function favoriteScopePrefix(scopeKey: string): string {
  return scopeKey.endsWith(path.sep) ? scopeKey : `${scopeKey}${path.sep}`;
}

function isStructuredAssetSearch(query: string): boolean {
  const input = parseAssetSearchQuery(query).input;
  return Object.keys(input).some((key) => key !== "query");
}

/** 只保留已收藏的素材条目（文件夹一并隐藏）。 */
function filterFavorites(
  entries: DirectoryEntry[],
  favoriteKeys: Set<string>,
): DirectoryEntry[] {
  return entries.filter(
    (entry) => !entry.isDirectory && favoriteKeys.has(favoritePathKey(entry.path)),
  );
}

/**
 * 预览式本地目录浏览服务：浏览不产生任何素材数据库记录；未入库文件
 * 通过 materialize 按需入库。所有路径以参数传入，不接触数据库素材表。
 */
export class FilesystemService {
  private readonly events = new EventEmitter();
  private readonly directoryCache = new LruCache<
    string,
    { entries: DirectoryEntry[]; metadataResolved: boolean }
  >(MAX_DIRECTORY_CACHE_ENTRIES);
  private readonly metadataJobs = new Map<string, Promise<void>>();
  private readonly searches = new Map<string, DirectorySearchSnapshot>();
  private searchSequence = 0;
  private readonly indexClient: DirectoryIndexClient | null;
  private readonly unsubscribeIndex: (() => void) | null;
  private readonly unsubscribeSearchIndex: (() => void) | null;
  private observer: FSWatcher | null = null;
  private observedDirectory: string | null = null;
  private observedMtimeMs: number | null = null;
  private observerDebounceTimer: NodeJS.Timeout | null = null;
  private observerPollTimer: NodeJS.Timeout | null = null;
  private observerGeneration = 0;
  private readonly watcherFactory: DirectoryWatcherFactory;
  private readonly statDirectory: (directory: string) => Promise<Stats>;
  private readonly observerPollIntervalMs: number;
  /** 无系统回收站环境（测试/降级）时使用的内部回收站目录。 */
  readonly fallbackTrashRoot: string;

  constructor(
    private readonly database: RefCanvasDatabase,
    options: {
      trashRoot?: string;
      fallbackTrashRoot?: string;
      indexClient?: DirectoryIndexClient;
      watcherFactory?: DirectoryWatcherFactory;
      statDirectory?: (directory: string) => Promise<Stats>;
      observerPollIntervalMs?: number;
    } = {},
  ) {
    this.fallbackTrashRoot =
      options.fallbackTrashRoot ?? options.trashRoot ?? "trash";
    this.indexClient = options.indexClient ?? null;
    this.watcherFactory = options.watcherFactory ?? ((directory, listener) =>
      watchNative(directory, { recursive: false }, listener));
    this.statDirectory = options.statDirectory ?? stat;
    this.observerPollIntervalMs = options.observerPollIntervalMs ?? 5_000;
    this.unsubscribeIndex = this.indexClient
      ? this.indexClient.onProgress((snapshot) =>
          this.events.emit("directory-progress", snapshot),
        )
      : null;
    this.unsubscribeSearchIndex = this.indexClient
      ? this.indexClient.onSearchProgress((snapshot) => {
          this.searches.set(snapshot.id, snapshot);
          this.emitSearch(snapshot);
          this.trimCompletedSearches();
        })
      : null;
  }

  onDirectoryProgress(
    listener: (snapshot: DirectoryProgressSnapshot) => void,
  ): () => void {
    this.events.on("directory-progress", listener);
    return () => this.events.off("directory-progress", listener);
  }  onSearchProgress(
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
    this.observerGeneration += 1;
    this.stopObservingDirectory();
    this.directoryCache.clear();
    this.metadataJobs.clear();
    for (const snapshot of this.searches.values()) {
      if (snapshot.state === "running") {
        snapshot.state = "cancelled";
        snapshot.completedAt = new Date().toISOString();
      }
    }
    this.searches.clear();
    this.events.removeAllListeners();
  }

  private trimCompletedSearches(): void {
    if (this.searches.size <= MAX_RETAINED_DIRECTORY_SEARCHES) return;
    for (const [id, snapshot] of this.searches) {
      if (snapshot.state === "running") continue;
      this.searches.delete(id);
      if (this.searches.size <= MAX_RETAINED_DIRECTORY_SEARCHES) return;
    }
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

  /**
   * 轻量路径类型探测（目录/文件/不存在）。renderer 用它在打开目录前
   * 判断目标身份，避免拿 listDirectory 对文件路径探测而抛 ENOTDIR。
   */
  async pathType(filename: string): Promise<"directory" | "file" | "missing"> {
    const resolved = path.resolve(filename);
    const info = await stat(resolved).catch(() => null);
    if (!info) return "missing";
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
    return "missing";
  }

  /**
   * 收藏过滤：把素材库收藏路径裁剪到当前浏览范围（归一化后返回）。
   * recursive=true（flatten/搜索）取整个子树；否则只取目录直接子项。
   */
  private favoritePathsFor(
    directoryPath: string,
    recursive: boolean,
  ): string[] {
    const scopeKey = favoritePathKey(path.resolve(directoryPath));
    const prefix = favoriteScopePrefix(scopeKey);
    return this.database
      .getFavoriteAssetPaths()
      .map(favoritePathKey)
      .filter((key) =>
        recursive
          ? key.startsWith(prefix)
          : path.dirname(key) === scopeKey,
      );
  }

  /** 当前目录子树下全部收藏素材的原始路径（大小写不敏感比较）。 */
  private favoriteAssetPathsUnder(directoryPath: string): string[] {
    const prefix = favoriteScopePrefix(
      favoritePathKey(path.resolve(directoryPath)),
    );
    return this.database
      .getFavoriteAssetPaths()
      .filter((assetPath) =>
        favoritePathKey(assetPath).startsWith(prefix),
      );
  }

  /**
   * 只看收藏：直接从素材库收藏集枚举当前目录子树（递归），根目录与任意
   * 层级一致——收藏在子文件夹里也能在父目录显示，与搜索/flatten 的
   * recursive 语义对齐；文件夹一律隐藏。
   */
  private async listFavoriteEntries(
    directoryPath: string,
    showHidden: boolean,
    collapseSequences: boolean,
    extensions?: string[],
    pageSize = 500,
    cursor?: string,
    offset?: number,
  ): Promise<DirectoryPage> {
    const entries: DirectoryEntry[] = this.favoriteAssetPathsUnder(directoryPath)
      .filter((assetPath) => {
        const name = path.basename(assetPath);
        return showHidden || !name.startsWith(".");
      })
      .map((assetPath) => ({
        path: assetPath,
        name: path.basename(assetPath),
        isDirectory: false,
        extension: extensionFor(path.basename(assetPath), false),
        favorite: true,
      }));
    let visible = sortDirectory(entries);
    visible = filterExtensions(visible, extensions);
    if (collapseSequences) {
      const sequences = detectFileSequences(visible);
      for (const entry of visible) {
        entry.sequence = sequences.get(entry.path);
      }
      visible = collapseSequenceEntries(visible);
    }
    const start = (() => {
      const cursorNumber = Number.parseInt(cursor ?? "0", 10);
      if (Number.isFinite(cursorNumber)) return Math.max(0, cursorNumber);
      return Math.max(0, offset ?? 0);
    })();
    const pageSizeClamped = Math.max(1, Math.min(10_000, pageSize));
    return {
      entries: visible.slice(start, start + pageSizeClamped),
      total: visible.length,
      // 收藏枚举来自数据库、一次即完整：标记扫描完成并给出稳定
      // revision，让渲染端的「全选/跨页批量」门槛（scanComplete &&
      // revision）可通过；resolveSelection/locate 的收藏分支不校验
      // revision，伪值仅用于放行。
      totalFiles: visible.length,
      revision: FAVORITES_ONLY_REVISION,
      scanState: "complete",
      nextCursor:
        start + pageSizeClamped < visible.length
          ? String(start + pageSizeClamped)
          : null,
    };
  }

  /** 展开目录下一层；目录内容按名称缓存，游标分页。 */
  async listDirectory(
    filename: string,
    options: ListDirectoryOptions = {},
  ): Promise<DirectoryPage> {
    const resolved = path.resolve(filename);
    const showHidden = options.showHidden ?? false;
    const collapseSequences = options.collapseSequences ?? true;
    const flattenDepth = Math.max(0, Math.min(8, options.flattenDepth ?? 0));
    if (options.favoritesOnly) {
      return this.listFavoriteEntries(
        resolved,
        showHidden,
        collapseSequences,
        options.extensions,
        options.pageSize,
        options.cursor,
        options.offset,
      );
    }
    if (flattenDepth > 0) {
      // §10.1：flatten 用递归 readdir 汇总素材（深度受限），目录只参与遍历。
      const flattened = await this.listFlattened(
        resolved,
        flattenDepth,
        showHidden,
        0,
      );
      const entries = collapseSequences
        ? collapseSequenceEntries(flattened)
        : flattened;
      const filtered = filterExtensions(entries, options.extensions);
      const favoriteKeys = options.favoritesOnly
        ? new Set(this.favoritePathsFor(resolved, true))
        : null;
      const scoped = favoriteKeys
        ? filterFavorites(filtered, favoriteKeys)
        : filtered;
      const pageSize = Math.max(1, Math.min(10_000, options.pageSize ?? 500));
      const cursor = Number.parseInt(
        options.cursor ?? String(options.offset ?? 0),
        10,
      );
      const start = Number.isFinite(cursor) ? Math.max(0, cursor) : 0;
      return {
        entries: scoped.slice(start, start + pageSize),
        total: scoped.length,
        nextCursor:
          start + pageSize < scoped.length ? String(start + pageSize) : null,
      };
    }
    // 路径必须是目录：文件/不存在直接以明确错误拒绝，避免 worker opendir
    // 抛 ENOTDIR，也避免给文件路径建扫描索引。
    const targetInfo = await stat(resolved).catch(() => null);
    if (!targetInfo?.isDirectory()) {
      throw new Error(`NOT_A_DIRECTORY: ${resolved}`);
    }
    if (this.indexClient) {
      const cursor = Number.parseInt(options.cursor ?? "0", 10);
      const offset = options.offset ?? (Number.isFinite(cursor) ? cursor : 0);
      const page = await this.indexClient.list(
        resolved,
        Math.max(0, offset),
        Math.max(1, Math.min(512, options.pageSize ?? 512)),
        collapseSequences,
        options.extensions,
        options.favoritesOnly,
        options.favoritesOnly
          ? this.favoritePathsFor(resolved, false)
          : undefined,
      );
      // Windows 保护目录永不进入素材浏览；隐藏文件仍由用户设置控制。
      return {
        ...page,
        entries: page.entries.filter((entry) =>
          !isProtectedSystemDirectory(entry.name, entry.isDirectory) &&
          (showHidden || !entry.name.startsWith(".")),
        ),
      };
    }
    let cached = this.directoryCache.get(resolved);
    if (!cached) {
      const dirents = await readdir(resolved, { withFileTypes: true });
      const entries = sortDirectory(
        dirents
          .filter((dirent) => !isProtectedSystemDirectory(dirent.name, dirent.isDirectory()))
          .map((dirent) =>
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
    let entries = collapseSequences
      ? collapseSequenceEntries(cached.entries)
      : cached.entries;
    if (!showHidden) entries = entries.filter((entry) => !entry.name.startsWith("."));
    entries = filterExtensions(entries, options.extensions);
    if (options.favoritesOnly) {
      entries = filterFavorites(
        entries,
        new Set(this.favoritePathsFor(resolved, false)),
      );
    }
    return {
      entries: entries.slice(start, start + pageSize),
      total: entries.length,
      nextCursor:
        start + pageSize < entries.length ? String(start + pageSize) : null,
    };
  }

  /**
   * §10.1 Folder flattening：递归展开子目录并汇总素材。
   * 目录只用于继续遍历，不进入结果；素材带 depth 供 UI 标识来源层级。
   */
  private async listFlattened(
    directory: string,
    maxDepth: number,
    showHidden: boolean,
    depth: number,
  ): Promise<DirectoryEntry[]> {
    let dirents: Array<{ name: string; isDirectory: boolean }>;
    try {
      const raw = await readdir(directory, { withFileTypes: true });
      dirents = raw.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return [];
    }
    const sorted = dirents
      .filter((entry) =>
        !isProtectedSystemDirectory(entry.name, entry.isDirectory) &&
        (showHidden || !entry.name.startsWith(".")),
      )
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      });
    const result: DirectoryEntry[] = [];
    const subdirectories: Array<{ name: string; isDirectory: boolean }> = [];
    for (const entry of sorted) {
      if (entry.isDirectory) {
        if (depth < maxDepth) {
          subdirectories.push(entry);
        }
        continue;
      }
      result.push({
        path: path.join(directory, entry.name),
        name: entry.name,
        isDirectory: false,
        extension: extensionFor(entry.name, false),
        depth,
      });
    }
    for (const entry of subdirectories) {
      const nested = await this.listFlattened(
        path.join(directory, entry.name),
        maxDepth,
        showHidden,
        depth + 1,
      );
      result.push(...nested);
    }
    return result;
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
    extensions?: string[],
    favoritesOnly?: boolean,
  ): Promise<{ paths: string[]; nextOffset: number | null; total: number }> {
    if (favoritesOnly) {
      // 只看收藏视图由素材库收藏集枚举（递归）：批量选择用同一数据源，
      // 与列表展示保持一致（worker 目录扫描不含子目录收藏）。
      const excluded = new Set(excludedPaths.map((item) => path.resolve(item)));
      const allowed = extensions?.length ? new Set(extensions) : null;
      const candidates = this.favoriteAssetPathsUnder(path.resolve(directoryPath))
        .filter((candidate) => {
          if (excluded.has(candidate)) return false;
          if (!allowed) return true;
          return allowed.has(extensionFor(path.basename(candidate), false));
        })
        .sort((left, right) =>
          path.basename(left).localeCompare(path.basename(right), "zh-CN"),
        );
      const start = Math.max(0, offset);
      const slice = candidates.slice(start, start + pageSize);
      return Promise.resolve({
        paths: slice,
        nextOffset:
          start + slice.length < candidates.length ? start + slice.length : null,
        total: candidates.length,
      });
    }
    if (!this.indexClient) throw new Error("DIRECTORY_INDEX_UNAVAILABLE");
    return this.indexClient.resolveSelection(
      path.resolve(directoryPath),
      revision,
      excludedPaths.map((item) => path.resolve(item)),
      offset,
      pageSize,
      extensions,
      favoritesOnly,
      favoritesOnly
        ? this.favoritePathsFor(path.resolve(directoryPath), false)
        : undefined,
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

  async locateEntry(
    directoryPath: string,
    entryPath: string,
    revision: string,
    options: {
      collapseSequences?: boolean;
      extensions?: string[];
      favoritesOnly?: boolean;
      flattenDepth?: number;
      showHidden?: boolean;
    } = {},
  ): Promise<number | null> {
    const flattenDepth = Math.max(0, Math.min(8, options.flattenDepth ?? 0));
    if (flattenDepth > 0) {
      let candidates = await this.listFlattened(
        path.resolve(directoryPath),
        flattenDepth,
        options.showHidden ?? false,
        0,
      );
      candidates = filterExtensions(candidates, options.extensions);
      if (options.collapseSequences !== false) {
        const sequences = detectFileSequences(candidates);
        for (const entry of candidates) entry.sequence = sequences.get(entry.path);
        candidates = collapseSequenceEntries(candidates);
      }
      const wanted = path.resolve(entryPath);
      const index = candidates.findIndex((entry) =>
        process.platform === "win32"
          ? entry.path.toLocaleLowerCase("en-US") === wanted.toLocaleLowerCase("en-US")
          : entry.path === wanted,
      );
      return index >= 0 ? index : null;
    }
    if (options.favoritesOnly) {
      // 只看收藏视图：位置基于收藏集枚举（与 listFavoriteEntries 同一排序）。
      let candidates: DirectoryEntry[] = this.favoriteAssetPathsUnder(path.resolve(directoryPath))
        .map((assetPath) => ({
          path: assetPath,
          name: path.basename(assetPath),
          isDirectory: false,
          extension: extensionFor(path.basename(assetPath), false),
        }));
      candidates = filterExtensions(candidates, options.extensions);
      if (options.collapseSequences !== false) {
        const sequences = detectFileSequences(candidates);
        for (const entry of candidates) entry.sequence = sequences.get(entry.path);
        candidates = collapseSequenceEntries(candidates);
      }
      candidates = sortDirectory(candidates);
      const wanted = path.resolve(entryPath);
      const index = candidates.findIndex((entry) =>
        process.platform === "win32"
          ? entry.path.toLocaleLowerCase("en-US") === wanted.toLocaleLowerCase("en-US")
          : entry.path === wanted,
      );
      return index >= 0 ? index : null;
    }
    if (!this.indexClient) {
      const wanted = path.resolve(entryPath);
      let offset = 0;
      while (true) {
        const page = await this.listDirectory(directoryPath, {
          offset,
          pageSize: 10_000,
          collapseSequences: options.collapseSequences,
          extensions: options.extensions,
        });
        const localIndex = page.entries.findIndex((entry) =>
          process.platform === "win32"
            ? entry.path.toLocaleLowerCase("en-US") === wanted.toLocaleLowerCase("en-US")
            : entry.path === wanted,
        );
        if (localIndex >= 0) return offset + localIndex;
        if (!page.nextCursor) return null;
        offset = Number.parseInt(page.nextCursor, 10);
        if (!Number.isFinite(offset)) return null;
      }
    }
    return this.indexClient.locate(
      path.resolve(directoryPath),
      path.resolve(entryPath),
      revision,
      options.collapseSequences,
      options.extensions,
      options.favoritesOnly,
      options.favoritesOnly
        ? this.favoritePathsFor(path.resolve(directoryPath), false)
        : undefined,
    );
  }

  /**
   * 破坏性操作前的 scan revision 校验（计划 §8.2）：目录扫描已过期则抛
   * DIRECTORY_REVISION_CHANGED，拒绝基于陈旧快照的 create/copy/move/trash。
   */
  async validateRevision(directoryPath: string, revision: string): Promise<void> {
    const resolved = path.resolve(directoryPath);
    if (!this.indexClient) {
      // 无 index worker 时退化为目录存在性检查。
      await stat(resolved);
      return;
    }
    // locate 会校验 scan 状态与 revision；entry 自身命中与否不影响校验结果。
    await this.indexClient.locate(resolved, resolved, revision);
  }

  async setObservedDirectory(filename: string | null): Promise<void> {
    const directory = filename === null ? null : path.resolve(filename);
    if (directory === this.observedDirectory && this.observer) return;
    const generation = ++this.observerGeneration;
    this.stopObservingDirectory();
    if (directory === null) return;
    this.observedDirectory = directory;
    const observedMtimeMs = await this.statDirectory(directory)
      .then((info) => info.mtimeMs)
      .catch(() => null);
    if (
      generation !== this.observerGeneration ||
      this.observedDirectory !== directory
    ) {
      return;
    }
    this.observedMtimeMs = observedMtimeMs;
    try {
      const observer = this.watcherFactory(directory, () =>
        this.scheduleObservedInvalidation(directory));
      this.observer = observer;
      observer.on("error", () => {
        if (this.observer !== observer || this.observedDirectory !== directory) return;
        this.startObserverPolling(directory);
      });
    } catch {
      this.startObserverPolling(directory);
    }
  }

  private stopObservingDirectory(): void {
    this.observer?.close();
    this.observer = null;
    if (this.observerDebounceTimer) clearTimeout(this.observerDebounceTimer);
    if (this.observerPollTimer) clearInterval(this.observerPollTimer);
    this.observerDebounceTimer = null;
    this.observerPollTimer = null;
    this.observedDirectory = null;
    this.observedMtimeMs = null;
  }

  private startObserverPolling(directory: string): void {
    this.observer?.close();
    this.observer = null;
    if (this.observerPollTimer) clearInterval(this.observerPollTimer);
    this.observerPollTimer = setInterval(() => {
      if (this.observedDirectory !== directory) return;
      void this.statDirectory(directory)
        .then((info) => {
          if (this.observedMtimeMs === null) {
            this.observedMtimeMs = info.mtimeMs;
            this.scheduleObservedInvalidation(directory);
            return;
          }
          if (info.mtimeMs === this.observedMtimeMs) return;
          this.observedMtimeMs = info.mtimeMs;
          this.scheduleObservedInvalidation(directory);
        })
        .catch(() => this.scheduleObservedInvalidation(directory));
    }, this.observerPollIntervalMs);
    this.observerPollTimer.unref();
  }

  private scheduleObservedInvalidation(directory: string): void {
    if (this.observedDirectory !== directory) return;
    if (this.observerDebounceTimer) clearTimeout(this.observerDebounceTimer);
    this.observerDebounceTimer = setTimeout(() => {
      this.observerDebounceTimer = null;
      if (this.observedDirectory !== directory) return;
      this.invalidateDirectory(directory);
      this.events.emit("directory-progress", {
        path: directory,
        revision: "",
        state: "invalidated",
      } satisfies DirectoryProgressSnapshot);
    }, 160);
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
    const snapshot = this.searches.get(id);
    const structuredSearch = snapshot ? isStructuredAssetSearch(snapshot.query) : false;
    const workerSearch = (snapshot?.rootPaths?.length ?? 1) === 1;
    if (this.indexClient && !structuredSearch && workerSearch) {
      return this.indexClient.searchPage(
        id,
        Math.max(0, options.offset ?? 0),
        Math.max(1, Math.min(512, options.pageSize ?? 512)),
      );
    }
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
  async startSearch(
    rootPath: string,
    query: string,
    options: {
      rootPaths?: string[];
      collapseSequences?: boolean;
      extensions?: string[];
      favoritesOnly?: boolean;
    } = {},
  ): Promise<string> {
    const roots = [...new Set((options.rootPaths?.length ? options.rootPaths : [rootPath])
      .map((root) => path.resolve(root)))];
    const resolved = roots[0];
    const normalized = query.trim().toLocaleLowerCase("en-US");
    const extensions = options.extensions?.map((extension) =>
      extension.replace(/^\./, "").toLowerCase(),
    );
    const favorites = options.favoritesOnly
      ? new Set(roots.flatMap((root) => this.favoritePathsFor(root, true)))
      : null;
    const id = `search-${Date.now()}-${this.searchSequence++}`;
    const createdAt = new Date().toISOString();
    const snapshot: DirectorySearchSnapshot = {
      id,
      state: "running",
      rootPath: resolved,
      rootPaths: roots,
      query,
      entries: [],
      processedDirectories: 0,
      totalDirectories: null,
      failedDirectories: [],
      createdAt,
      completedAt: null,
    };
    this.searches.set(id, snapshot);
    this.trimCompletedSearches();
    this.emitSearch({ ...snapshot });

    const parsedQuery = parseAssetSearchQuery(query);
    if (isStructuredAssetSearch(query)) {
      void this.runIndexedSearch(id, roots, parsedQuery.input, extensions, favorites);
      return id;
    }

    if (this.indexClient && roots.length === 1) {
      void this.indexClient
        .startSearch(
          id,
          resolved,
          query,
          options.collapseSequences,
          extensions,
          options.favoritesOnly,
          favorites ? [...favorites] : undefined,
        )
        .then((workerSnapshot) => {
          this.searches.set(id, workerSnapshot);
          this.emitSearch(workerSnapshot);
          this.trimCompletedSearches();
        })
        .catch((error) => {
          const failed = this.searches.get(id);
          if (!failed) return;
          failed.state = "failed";
          failed.completedAt = new Date().toISOString();
          failed.failedDirectories.push({
            path: resolved,
            reason: error instanceof Error ? error.message : "SEARCH_FAILED",
          });
          this.emitSearch({ ...failed });
          this.trimCompletedSearches();
        });
    } else {
      void this.runSearch(id, roots, normalized, extensions, favorites);
    }
    return id;
  }

  private async runIndexedSearch(
    id: string,
    roots: string[],
    input: AssetSearchInput,
    extensions?: string[],
    favorites?: Set<string> | null,
  ): Promise<void> {
    const pageSize = 500;
    const entries: DirectoryEntry[] = [];
    const seen = new Set<string>();
    try {
      for (const root of roots) {
        let offset = 0;
        let total = 0;
        do {
          const current = this.searches.get(id);
          if (!current || current.state === "cancelled") return;
          const page = this.database.searchAssetWindow({
            query: { ...input, lifecycle: "active", pathContains: root },
            offset,
            pageSize,
            includeTotal: offset === 0,
          });
          if (offset === 0) total = page.total ?? page.items.length;
          for (const asset of page.items) {
            const relative = path.relative(root, asset.path);
            if (
              !relative ||
              relative.startsWith("..") ||
              path.isAbsolute(relative) ||
              seen.has(favoritePathKey(asset.path))
            ) continue;
            if (
              input.pathContains &&
              !asset.path.toLocaleLowerCase("en-US").includes(
                input.pathContains.toLocaleLowerCase("en-US"),
              )
            ) continue;
            if (extensions?.length && !extensions.includes(asset.extension)) continue;
            if (favorites && !favorites.has(favoritePathKey(asset.path))) continue;
            seen.add(favoritePathKey(asset.path));
            entries.push({
              path: asset.path,
              name: path.basename(asset.path),
              isDirectory: false,
              extension: asset.extension,
              size: asset.size,
              mtimeMs: asset.mtimeMs,
              tags: asset.tags,
            });
          }
          offset += page.items.length;
          if (page.items.length === 0) break;
          await new Promise<void>((resolve) => setImmediate(resolve));
        } while (offset < total);
      }
      const finished = this.searches.get(id);
      if (!finished || finished.state === "cancelled") return;
      finished.entries = entries.sort((left, right) =>
        left.name.localeCompare(right.name, "zh-CN"),
      );
      finished.state = "completed";
      finished.processedDirectories = roots.length;
      finished.totalDirectories = roots.length;
      finished.totalFiles = finished.entries.length;
      finished.revision = `indexed-${Date.now()}`;
      finished.completedAt = new Date().toISOString();
      this.emitSearch({ ...finished });
      this.trimCompletedSearches();
    } catch (error) {
      const failed = this.searches.get(id);
      if (!failed) return;
      failed.state = "failed";
      failed.completedAt = new Date().toISOString();
      failed.failedDirectories.push({
        path: roots.join(path.delimiter),
        reason: error instanceof Error ? error.message : "INDEXED_SEARCH_FAILED",
      });
      this.emitSearch({ ...failed });
      this.trimCompletedSearches();
    }
  }

  private async runSearch(
    id: string,
    roots: string[],
    query: string,
    extensions?: string[],
    favorites?: Set<string> | null,
  ): Promise<void> {
    const matchPath = (entryPath: string) =>
      !query ||
      entryPath.toLocaleLowerCase("en-US").includes(query);
    const allowedExtensions = extensions?.length ? new Set(extensions) : null;
    const pending: string[] = [...roots];
    const seenFiles = new Set<string>();
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
                  if (!isProtectedSystemDirectory(entry.name, true)) pending.push(entry.path);
                } else if (matchPath(entry.path) &&
                  (!allowedExtensions || allowedExtensions.has(entry.extension)) &&
                  (!favorites || favorites.has(favoritePathKey(entry.path))) &&
                  !seenFiles.has(favoritePathKey(entry.path))) {
                  seenFiles.add(favoritePathKey(entry.path));
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
      this.trimCompletedSearches();
    } catch (error) {
      const failed = this.searches.get(id);
      if (!failed) return;
      failed.state = "failed";
      failed.completedAt = new Date().toISOString();
      failed.failedDirectories.push({
        path: roots.join(path.delimiter),
        reason: error instanceof Error ? error.message : "SEARCH_FAILED",
      });
      this.emitSearch({ ...failed });
      this.trimCompletedSearches();
    }
  }

  cancelSearch(id: string): void {
    const snapshot = this.searches.get(id);
    if (!snapshot || snapshot.state === "completed") return;
    snapshot.state = "cancelled";
    snapshot.completedAt = new Date().toISOString();
    this.emitSearch({ ...snapshot });
    this.trimCompletedSearches();
    if (
      !isStructuredAssetSearch(snapshot.query) &&
      (snapshot.rootPaths?.length ?? 1) === 1
    ) {
      void this.indexClient?.cancelSearch(id);
    }
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
