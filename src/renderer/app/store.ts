import { create } from "zustand";
import type {
  AssetColorLabel,
  AssetKind,
  AssetRecord,
  AssetSearchInput,
  AssetSortKey,
  BatchAssetPatch,
  BoardDocumentV3,
  BoardSummary,
  DirectoryEntry,
  LibraryPreferences,
  ReferenceCollection,
  ReferenceCollectionItem,
  SavedView,
  SelectionScope,
  SortDirection,
} from "../../shared/contracts";
import { readDurableNavigationState, updateNavigationState } from "./navigation-state";
import {
  readDurableNavigationStateV3,
  updateNavigationStateV3,
  createBrowserTab,
  type BrowserTabState,
  type NavigationStateV3,
} from "./navigation-v3";
import {
  isPathInsideMount,
  startupDirectoryCandidates,
} from "./startup-navigation";
import {
  ASSET_PAGE_SIZE,
  AssetQueryWindow,
} from "../features/library/query-window";
import {
  createLibraryQuerySliceState,
  type LibraryQuerySliceState,
} from "../features/library/library-query-slice";
import {
  createDirectorySliceState,
  type DirectorySliceState,
} from "../features/directory/directory-slice";
import {
  createBoardSliceState,
  type BoardSliceState,
} from "../features/board/board-slice";
import {
  createPreferencesSliceState,
  type PreferencesSliceState,
} from "../features/preferences/preferences-slice";
import {
  selectAssetId,
  selectionStateFromScope,
} from "../features/library/selection-model";
import { importJobState } from "../features/library/import-job-model";
import {
  renamedBoardState,
  savedBoardState,
} from "../features/board/board-state-model";
export {
  ASSET_PAGE_SIZE,
  MAX_RESIDENT_ASSET_PAGES,
} from "../features/library/query-window";

interface AppState
  extends LibraryQuerySliceState,
    DirectorySliceState,
    BoardSliceState,
    PreferencesSliceState {
  workspaceMode: "directory" | "board";
  initialize(): Promise<void>;
  currentSearch(cursor?: string): AssetSearchInput;
  reloadAssets(): Promise<void>;
  ensureAssetRange(startIndex: number, endIndex: number): Promise<void>;
  assetAt(index: number): AssetRecord | null;
  loadMore(): Promise<void>;
  setQuery(query: string): void;
  setTagFilter(name: string | null): void;
  setKindFilter(kind: AssetKind | "all"): void;
  showMissingAssets(): void;
  showTrash(): void;
  showFavorites(): void;
  setRatingFilter(rating: number): void;
  setColorFilter(color: AssetColorLabel): void;
  setVisualColor(color: string | null): void;
  setVisualColorTolerance(tolerance: number): void;
  setAdvancedFilters(filters: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    minSize?: number;
    maxSize?: number;
    minDuration?: number;
    maxDuration?: number;
    extension?: string;
    orientation?: "landscape" | "portrait" | "square";
    createdAfter?: string;
    createdBefore?: string;
    modifiedAfter?: string;
    modifiedBefore?: string;
  }): void;
  setSort(sort: AssetSortKey, direction: SortDirection): void;
  selectAsset(asset: AssetRecord | null): void;
  locateAssetInLibrary(asset: AssetRecord): Promise<void>;
  selectAssetInGrid(id: string, mode: "replace" | "toggle" | "range"): void;
  selectAllMatching(): void;
  clearSelection(): void;
  selectionScope(): SelectionScope;
  batchUpdate(patch: BatchAssetPatch): Promise<void>;
  batchRename(pattern: string): Promise<void>;
  trashSelection(): Promise<void>;
  restoreSelection(): Promise<void>;
  purgeSelection(): Promise<void>;
  forgetTrashSelection(): Promise<void>;
  importPaths(paths: string[]): Promise<void>;
  cancelImport(): Promise<void>;
  addWatchFolder(): Promise<void>;
  relinkAsset(id: string, mode: "pick" | "search"): Promise<void>;
  removeFromLibrarySelection(): Promise<void>;
  setTags(assetId: string, tags: string[]): Promise<void>;
  createTagGroup(title: string): Promise<void>;
  renameTagGroup(id: string, title: string): Promise<void>;
  deleteTagGroup(id: string): Promise<void>;
  moveTagToGroup(id: string, groupId: string | null): Promise<void>;
  renameTag(id: string, name: string): Promise<void>;
  deleteTag(id: string): Promise<void>;
  updateAsset(
    id: string,
    patch: {
      title?: string;
      notes?: string;
      favorite?: boolean;
      rating?: number;
      colorLabel?: AssetColorLabel;
    },
  ): Promise<void>;
  saveCurrentView(title: string): Promise<void>;
  applySavedView(view: SavedView): void;
  updateSavedView(id: string, patch: { title?: string; search?: AssetSearchInput }): Promise<void>;
  duplicateSavedView(id: string): Promise<void>;
  deleteSavedView(id: string): Promise<void>;
  setPreferences(prefs: Partial<LibraryPreferences>): Promise<void>;
  updateTagMeta(
    id: string,
    patch: { name?: string; alias?: string | null; shortcutKey?: string | null },
  ): Promise<void>;
  refreshDuplicates(): Promise<void>;
  mergeDuplicates(keepId: string, removeIds: string[]): Promise<void>;
  saveBoard(document: BoardDocumentV3, revision: number): Promise<BoardSummary>;
  createBoard(title: string): Promise<void>;
  renameBoard(id: string, title: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  switchBoard(id: string): Promise<void>;
  addDirectoryEntriesToBoard(paths: string[]): Promise<void>;
  consumePendingBoardAssets(ids: string[]): void;
  showDirectoryWorkspace(): void;
  toggleFocusMode(): void;
  /** 引用集合（FND-003 §6.3）：打开集合视图；null 关闭。 */
  activeCollectionId: string | null;
  collections: ReferenceCollection[];
  collectionTree: Record<string, ReferenceCollection[]>;
  collectionItems: Record<string, ReferenceCollectionItem[]>;
  openCollection(id: string): void;
  openCollectionInNewTab(id: string, name: string): Promise<void>;
  closeCollection(): void;
  /** 重新拉取集合树与展开/活动集合条目（FND-003）。 */
  refreshCollections(): Promise<void>;
  /** 切换到本地目录浏览（不产生素材数据库记录）。 */
  openDirectory(path: string): Promise<void>;
  /** 在新标签打开目录（不修改来源标签历史；FND-002 §5.2）。 */
  openDirectoryInNewTab(path: string): Promise<void>;
  /** 浏览器标签（FND-002）：新建/关闭/切换/重排 + 活动标签状态保存恢复。 */
  browserTabs: BrowserTabState[];
  activeTabId: string;
  createBrowserTabForPath(path: string): Promise<void>;
  closeBrowserTab(id: string): Promise<void>;
  switchBrowserTab(id: string): Promise<void>;
  reorderBrowserTab(sourceId: string, targetId: string): void;
  /** 更新活动标签的持久字段（query 等）。 */
  updateActiveBrowserTab(patch: Partial<BrowserTabState>): void;
  /** 内部：加载目录并恢复指定历史（不修改标签栈）。 */
  loadDirectoryState(path: string, history: string[], historyIndex: number): Promise<void>;
  /** 挂载移除后清理该根下的当前目录、选择与历史。 */
  clearRemovedMount(path: string): void;
  selectDirectoryEntry(entry: DirectoryEntry | null): void;
  /** 目录历史后退一步（不修改历史列表）。 */
  goBackDirectory(): Promise<void>;
  /** 目录历史前进一步（不修改历史列表）。 */
  goForwardDirectory(): Promise<void>;
  goUpDirectory(): Promise<void>;
  reloadDirectory(): Promise<void>;
  /** 批量按需建立本地索引（不指定文件夹）。 */
  materializeEntries(paths: string[]): Promise<void>;
  /** 批量按需建立本地索引并打标签。 */
  materializeEntriesWithTags(paths: string[], tags: string[]): Promise<void>;
  /** 批量移入 Windows 回收站。 */
  trashEntries(paths: string[]): Promise<void>;
  refreshQuickAccess(): Promise<void>;
  addQuickAccess(path: string, name?: string): Promise<void>;
  removeQuickAccess(id: string): Promise<void>;
  setDirectoryExpanded(id: string, expanded: boolean): Promise<void>;
  /** 未索引文件按需建立索引（同路径复用 assetId）。 */
  materializeEntry(path: string): Promise<void>;
}

let navigationHydrated = false;
let assetQueryRevision = 0;

/** 路径规范化（大小写与分隔符；Windows 不区分大小写）。 */
function normalizeDirectoryPath(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLocaleLowerCase("en-US");
}

/** 标签标题：路径最后一段。 */
function titleFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** 持久化 V3 标签（local + durable，不阻塞浏览）。 */
function persistV3Tabs(tabs: BrowserTabState[], activeTabId: string): void {
  const state: NavigationStateV3 = {
    schemaVersion: 3,
    activeWorkspace: "browser",
    activeTabId,
    tabs,
  };
  updateNavigationStateV3(state);
}
let libraryRefreshTimer: number | null = null;
let directoryOpenGeneration = 0;
const assetWindow = new AssetQueryWindow();
const pendingAssetPages = new Map<number, Promise<void>>();

/** zustand set 的形状（v5 未公开导出该类型，按内部签名声明）。 */
type AppStateSet = {
  (
    partial:
      | AppState
      | Partial<AppState>
      | ((state: AppState) => AppState | Partial<AppState>),
    replace?: false,
  ): void;
  (state: AppState | ((state: AppState) => AppState), replace: true): void;
};

/**
 * 在同一条目录历史中移动游标：载入目标目录但不改写历史列表，
 * 仅持久化目录路径与游标（后退/前进/刷新共用）。
 */
async function moveDirectoryCursor(
  set: AppStateSet,
  target: string,
  index: number,
): Promise<void> {
  const generation = ++directoryOpenGeneration;
  set({
    directoryPath: target,
    directoryLoading: true,
    selectedDirectoryEntry: null,
  });
  try {
    const page = await window.refCanvas.filesystem.listDirectory(target, {
      pageSize: 512,
    });
    if (generation !== directoryOpenGeneration) return;
    set({
      directoryEntries: page.entries,
      directoryTotal: page.total,
      directoryHistoryIndex: index,
    });
    updateNavigationState({
      navigationSource: "directory",
      directoryPath: target,
      directoryHistoryIndex: index,
    });
  } finally {
    if (generation === directoryOpenGeneration) {
      set({ directoryLoading: false });
    }
  }
}
let lastNavigationSignature = "";

export const useAppStore = create<AppState>((set, get) => ({
  ...createLibraryQuerySliceState(),
  ...createDirectorySliceState(),
  ...createBoardSliceState(),
  ...createPreferencesSliceState(),
  workspaceMode: "directory",

  initialize: async () => {
    const [
      boards,
      tags,
      tagGroups,
      savedViews,
      appInfo,
      preferences,
      quickAccess,
      roots,
      mounts,
    ] = await Promise.all([
      window.refCanvas.boards.list(),
      window.refCanvas.library.listTags(),
      window.refCanvas.library.listTagGroups(),
      window.refCanvas.library.listSavedViews(),
      window.refCanvas.system.getAppInfo(),
      window.refCanvas.library.getPreferences(),
      window.refCanvas.filesystem.listQuickAccess().catch(() => []),
      window.refCanvas.filesystem.listRoots().catch(() => []),
      window.refCanvas.mounts.list().catch(() => []),
    ]);
    const navigation = await readDurableNavigationState();
    // V3 多标签导航（FND-002 §5.2）：V2 自动迁移为一个 directory tab。
    const navigationV3 = await readDurableNavigationStateV3(() => navigation);
    const activeBoard = boards[0] ?? null;
    const loaded = activeBoard
      ? await window.refCanvas.boards.load(activeBoard.id)
      : null;
    const unsubscribeImport = window.refCanvas.library.onImportProgress((importJob) => {
      set(importJobState(importJob));
      if (importJob.state === "completed") {
          void get().reloadAssets();
      }
    });
    const unsubscribeCollections =
      window.refCanvas.collections?.onChanged?.(() => {
        void get().refreshCollections();
      });
    const unsubscribeLibrary = window.refCanvas.library.onLibraryChanged(() => {
      if (libraryRefreshTimer !== null) window.clearTimeout(libraryRefreshTimer);
      libraryRefreshTimer = window.setTimeout(() => {
        libraryRefreshTimer = null;
        void get().reloadAssets();
      }, 80);
    });
    const unsubscribeOpenDirectoryTab =
      window.refCanvas.system?.onOpenDirectoryTab?.((directoryPath) => {
        void get().openDirectoryInNewTab(directoryPath).catch(() => undefined);
      });
    window.addEventListener(
      "beforeunload",
      () => {
        unsubscribeImport();
        unsubscribeCollections?.();
        unsubscribeLibrary();
        unsubscribeOpenDirectoryTab?.();
        if (libraryRefreshTimer !== null) window.clearTimeout(libraryRefreshTimer);
      },
      { once: true },
    );
    navigationHydrated = true;
    set({
      boards,
      tags,
      tagGroups,
      savedViews,
      currentLibraryRoot: appInfo.libraryPath,
      currentLibraryName: appInfo.libraryName,
      preferences,
      workspaceMode: "directory",
      browserTabs: navigationV3.tabs,
      activeTabId: navigationV3.activeTabId ?? navigationV3.tabs[0]?.id ?? "",
      navigationSource: "directory",
      directoryPath: navigation.directoryPath,
      quickAccess,
      directoryHistoryIndex: navigation.directoryHistoryIndex ?? 0,
      activeBoard,
      boardDocument: loaded?.document ?? null,
      query: navigation.query,
      kindFilter: navigation.kindFilter,
      linkStateFilter: navigation.linkStateFilter,
      lifecycleFilter: navigation.lifecycleFilter,
      favoriteFilter: navigation.favoriteFilter,
      ratingFilter: navigation.ratingFilter,
      colorFilter: navigation.colorFilter,
      visualColor: navigation.visualColor,
      visualColorTolerance: navigation.visualColorTolerance,
      minWidth: navigation.minWidth,
      maxWidth: navigation.maxWidth,
      minHeight: navigation.minHeight,
      maxHeight: navigation.maxHeight,
      minSize: navigation.minSize,
      maxSize: navigation.maxSize,
      minDuration: navigation.minDuration,
      maxDuration: navigation.maxDuration,
      extension: navigation.extension,
      orientation: navigation.orientation,
      createdAfter: navigation.createdAfter,
      createdBefore: navigation.createdBefore,
      modifiedAfter: navigation.modifiedAfter,
      modifiedBefore: navigation.modifiedBefore,
      sort: navigation.sort,
      direction: navigation.direction,
    });
    // Core workspace state is ready. Do not keep the whole renderer behind the
    // loading screen while a large library or drive root performs its first
    // page scan; those panels already expose their own loading states.
    set({ loading: false });
    await window.refCanvas.system.markRendererInteractive().catch(() => undefined);
    if (navigation.visualColor) {
      void window.refCanvas.library.startSimilarityIndex();
    }
    void get().refreshCollections().catch(() => undefined);
    await get().reloadAssets();
    // V3：优先恢复活动标签的目录；无标签目录时回退 V2 记忆路径。
    const activeTab = navigationV3.tabs.find(
      (tab) => tab.id === navigationV3.activeTabId,
    );
    const rememberedPath =
      activeTab?.kind === "directory" &&
      activeTab.targetId &&
      activeTab.targetId !== "browser://empty"
        ? activeTab.targetId
        : navigation.directoryPath;
    const candidates = startupDirectoryCandidates({
      rememberedPath,
      mounts,
      roots,
      quickAccess,
    });
    let directoryOpened = false;
    for (const candidate of candidates) {
      try {
        await get().openDirectory(candidate);
        directoryOpened = true;
        break;
      } catch {
        // Try the next user-visible disk location.
      }
    }
    if (!directoryOpened) {
      set({
        workspaceMode: "directory",
        navigationSource: "directory",
        directoryPath: null,
      });
      updateNavigationState({
        navigationSource: "directory",
        directoryPath: null,
      });
    }
  },

  currentSearch: (cursor) => {
    const state = get();
    const tagQuery = state.query.startsWith("#")
      ? state.query.slice(1).trim()
      : "";
    return {
      query: tagQuery ? undefined : state.query || undefined,
      tag: tagQuery || undefined,
      kind: state.kindFilter,
      linkState: state.linkStateFilter,
      lifecycle: state.lifecycleFilter,
      favorite: state.favoriteFilter,
      ratingMin: state.ratingFilter || undefined,
      colorLabel: state.colorFilter === "none" ? undefined : state.colorFilter,
      dominantColor: state.visualColor ?? undefined,
      colorTolerance: state.visualColor
        ? state.visualColorTolerance
        : undefined,
      minWidth: state.minWidth,
      maxWidth: state.maxWidth,
      minHeight: state.minHeight,
      maxHeight: state.maxHeight,
      minSize: state.minSize,
      maxSize: state.maxSize,
      minDuration: state.minDuration,
      maxDuration: state.maxDuration,
      extension: state.extension,
      orientation: state.orientation,
      createdAfter: state.createdAfter,
      createdBefore: state.createdBefore,
      modifiedAfter: state.modifiedAfter,
      modifiedBefore: state.modifiedBefore,
      sort: state.sort,
      direction: state.direction,
      pageSize: ASSET_PAGE_SIZE,
      cursor,
    };
  },

  reloadAssets: async () => {
    const revision = ++assetQueryRevision;
    assetWindow.clear();
    pendingAssetPages.clear();
    const search = get().currentSearch();
    const [page, stats] = await Promise.all([
      window.refCanvas.library.searchWindow({
        query: search,
        offset: 0,
        pageSize: ASSET_PAGE_SIZE,
        includeTotal: true,
      }),
      window.refCanvas.library.stats(),
    ]);
    if (revision !== assetQueryRevision) return;
    const windowState = assetWindow.set(0, page.items);
    const totalAssets = page.total ?? page.items.length;
    set({
      ...windowState,
      totalAssets,
      nextCursor: page.items.length < totalAssets ? "window" : null,
      stats,
      selectedAsset: null,
      selectedIds: new Set(),
      allMatchingSelected: false,
      excludedIds: new Set(),
      selectionAnchorId: null,
    });
  },

  ensureAssetRange: async (startIndex, endIndex) => {
    const state = get();
    if (state.totalAssets <= 0) return;
    const start = Math.max(0, Math.min(startIndex, state.totalAssets - 1));
    const end = Math.max(start, Math.min(endIndex, state.totalAssets - 1));
    const firstPage = Math.floor(start / ASSET_PAGE_SIZE);
    const lastPage = Math.floor(end / ASSET_PAGE_SIZE);
    const revision = assetQueryRevision;
    const requests: Promise<void>[] = [];
    for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
      if (assetWindow.has(pageIndex)) continue;
      let request = pendingAssetPages.get(pageIndex);
      if (!request) {
        request = (async () => {
          const page = await window.refCanvas.library.searchWindow({
            query: get().currentSearch(),
            offset: pageIndex * ASSET_PAGE_SIZE,
            pageSize: ASSET_PAGE_SIZE,
            includeTotal: false,
          });
          if (revision !== assetQueryRevision) return;
          const windowState = assetWindow.set(pageIndex, page.items);
          const current = get();
          set({
            ...windowState,
            nextCursor:
              windowState.assetWindowOffset + windowState.assets.length <
              current.totalAssets
                ? "window"
                : null,
          });
        })().finally(() => pendingAssetPages.delete(pageIndex));
        pendingAssetPages.set(pageIndex, request);
      }
      requests.push(request);
    }
    if (!requests.length) return;
    set({ loadingMore: true });
    try {
      await Promise.all(requests);
    } finally {
      if (revision === assetQueryRevision) set({ loadingMore: false });
    }
  },

  assetAt: (index) => {
    const state = get();
    return state.assets[index - state.assetWindowOffset] ?? null;
  },

  loadMore: async () => {
    const state = get();
    const nextIndex = state.assetWindowOffset + state.assets.length;
    if (nextIndex >= state.totalAssets) return;
    await state.ensureAssetRange(nextIndex, nextIndex + ASSET_PAGE_SIZE - 1);
  },

  setQuery: (query) => {
    set({
      query,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    window.setTimeout(() => {
      if (get().query === query) void get().reloadAssets();
    }, 160);
  },

  setTagFilter: (name) => {
    set({
      query: name ? `#${name}` : "",
      linkStateFilter: "all",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      workspaceMode: "directory",
      focusMode: false,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  setKindFilter: (kindFilter) => {
    set({
      kindFilter,
      linkStateFilter: "all",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      workspaceMode: "directory",
      focusMode: false,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  showMissingAssets: () => {
    set({
      linkStateFilter: "missing",
      kindFilter: "all",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      workspaceMode: "directory",
      focusMode: false,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  showTrash: () => {
    set({
      lifecycleFilter: "trashed",
      kindFilter: "all",
      linkStateFilter: "all",
      favoriteFilter: undefined,
      workspaceMode: "directory",
      focusMode: false,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  showFavorites: () => {
    set({
      lifecycleFilter: "active",
      kindFilter: "all",
      favoriteFilter: true,
      linkStateFilter: "all",
      workspaceMode: "directory",
      focusMode: false,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  setRatingFilter: (ratingFilter) => {
    set({
      ratingFilter,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    void get().reloadAssets();
  },

  setColorFilter: (colorFilter) => {
    set({
      colorFilter,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    void get().reloadAssets();
  },

  setVisualColor: (visualColor) => {
    set({
      visualColor,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    if (visualColor) {
      void window.refCanvas.library.startSimilarityIndex();
    }
    void get().reloadAssets();
  },

  setVisualColorTolerance: (visualColorTolerance) => {
    set({
      visualColorTolerance,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    if (get().visualColor) void get().reloadAssets();
  },

  setAdvancedFilters: (filters) => {
    set({
      ...filters,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    void get().reloadAssets();
  },

  setSort: (sort, direction) => {
    set({
      sort,
      direction,
      workspaceMode: "directory",
      navigationSource: "library",
      focusMode: false,
    });
    void get().reloadAssets();
  },

  selectAsset: (selectedAsset) => set({ selectedAsset }),

  locateAssetInLibrary: async (asset) => {
    const separator = Math.max(asset.path.lastIndexOf("\\"), asset.path.lastIndexOf("/"));
    if (separator < 0) return;
    const directory = asset.path.slice(0, separator);
    await get().openDirectory(directory);
    const entry = get().directoryEntries.find((item) => item.path === asset.path) ?? null;
    set({ selectedDirectoryEntry: entry });
  },

  selectAssetInGrid: (id, mode) => {
    const state = get();
    const next = selectAssetId(state, id, mode);
    if (next) set(next);
  },

  selectAllMatching: () =>
    set({
      allMatchingSelected: true,
      selectedIds: new Set(),
      excludedIds: new Set(),
      selectedAsset: null,
    }),

  clearSelection: () =>
    set({
      allMatchingSelected: false,
      selectedIds: new Set(),
      excludedIds: new Set(),
      selectedAsset: null,
      selectionAnchorId: null,
    }),

  selectionScope: () => {
    const state = get();
    return state.allMatchingSelected
      ? {
          mode: "query",
          query: state.currentSearch(),
          excludedIds: [...state.excludedIds],
        }
      : { mode: "ids", ids: [...state.selectedIds] };
  },

  batchUpdate: async (patch) => {
    const scope = get().selectionScope();
    await window.refCanvas.library.batchUpdate(scope, patch);
    set({ tags: await window.refCanvas.library.listTags() });
    await get().reloadAssets();
    set(selectionStateFromScope(scope, get().assets));
  },

  batchRename: async (pattern) => {
    const scope = get().selectionScope();
    await window.refCanvas.library.batchRename(scope, pattern);
    await get().reloadAssets();
    set(selectionStateFromScope(scope, get().assets));
  },

  trashSelection: async () => {
    await window.refCanvas.library.trash(get().selectionScope());
    await get().reloadAssets();
  },

  restoreSelection: async () => {
    const ids = [...get().selectedIds];
    if (ids.length) await window.refCanvas.library.restore(ids);
    await get().reloadAssets();
  },

  purgeSelection: async () => {
    const ids = [...get().selectedIds];
    if (ids.length) await window.refCanvas.library.purge(ids);
    await get().reloadAssets();
  },

  forgetTrashSelection: async () => {
    const ids = [...get().selectedIds];
    if (ids.length) await window.refCanvas.library.forgetTrash(ids);
    await get().reloadAssets();
  },

  importPaths: async (paths) => {
    if (!paths.length) return;
    const importJob = await window.refCanvas.library.startImport(paths);
    set(importJobState(importJob));
  },

  cancelImport: async () => {
    const job = get().importJob;
    if (job) await window.refCanvas.library.cancelImport(job.id);
  },

  removeFromLibrarySelection: async () => {
    const scope = get().selectionScope();
    await window.refCanvas.library.removeFromLibrary(scope);
    await get().reloadAssets();
  },

  addWatchFolder: async () => {
    set({ importing: true });
    try {
      await window.refCanvas.library.addWatchFolder();
      await get().reloadAssets();
    } finally {
      set({ importing: false });
    }
  },

  relinkAsset: async (id, mode) => {
    const updated =
      mode === "pick"
        ? await window.refCanvas.library.pickAndRelink(id)
        : (await window.refCanvas.library.searchAndRelink(id))?.asset;
    if (!updated) return;
    assetWindow.replace(updated);
    set((state) => ({
      assets: state.assets.map((asset) => asset.id === id ? updated : asset),
      selectedAsset: state.selectedAsset?.id === id ? updated : state.selectedAsset,
    }));
  },

  setTags: async (assetId, tags) => {
    const updated = await window.refCanvas.library.setTags(assetId, tags);
    assetWindow.replace(updated);
    const nextTags = await window.refCanvas.library.listTags();
    set((state) => ({
      tags: nextTags,
      assets: state.assets.map((asset) => asset.id === assetId ? updated : asset),
      selectedAsset: state.selectedAsset?.id === assetId ? updated : state.selectedAsset,
    }));
  },

  createTagGroup: async (title) => {
    await window.refCanvas.library.createTagGroup(title);
    set({ tagGroups: await window.refCanvas.library.listTagGroups() });
  },

  renameTagGroup: async (id, title) => {
    await window.refCanvas.library.renameTagGroup(id, title);
    set({ tagGroups: await window.refCanvas.library.listTagGroups() });
  },

  deleteTagGroup: async (id) => {
    await window.refCanvas.library.deleteTagGroup(id);
    set({ tagGroups: await window.refCanvas.library.listTagGroups() });
  },

  moveTagToGroup: async (id, groupId) => {
    await window.refCanvas.library.moveTagToGroup(id, groupId);
    const [tags, tagGroups] = await Promise.all([
      window.refCanvas.library.listTags(),
      window.refCanvas.library.listTagGroups(),
    ]);
    set({ tags, tagGroups });
  },

  renameTag: async (id, name) => {
    const current = get().tags.find((tag) => tag.id === id);
    await window.refCanvas.library.renameTag(id, name);
    const tags = await window.refCanvas.library.listTags();
    set({
      tags,
      query: current && get().query === `#${current.name}` ? `#${name}` : get().query,
    });
    if (current && get().query === `#${name}`) await get().reloadAssets();
  },

  deleteTag: async (id) => {
    const current = get().tags.find((tag) => tag.id === id);
    await window.refCanvas.library.deleteTag(id);
    const [tags, tagGroups] = await Promise.all([
      window.refCanvas.library.listTags(),
      window.refCanvas.library.listTagGroups(),
    ]);
    const wasActive = current && get().query === `#${current.name}`;
    set({ tags, tagGroups, query: wasActive ? "" : get().query });
    await get().reloadAssets();
  },

  updateAsset: async (id, patch) => {
    const updated = await window.refCanvas.library.update(id, patch);
    assetWindow.replace(updated);
    set((state) => ({
      assets: state.assets.map((asset) => asset.id === id ? updated : asset),
      selectedAsset: state.selectedAsset?.id === id ? updated : state.selectedAsset,
    }));
  },

  saveCurrentView: async (title) => {
    const view = await window.refCanvas.library.saveView(title, get().currentSearch());
    set((state) => ({ savedViews: [view, ...state.savedViews] }));
  },

  applySavedView: (view) => {
    set({
      query: view.search.query ?? (view.search.tag ? `#${view.search.tag}` : ""),
      kindFilter: view.search.kind ?? "all",
      linkStateFilter: view.search.linkState ?? "all",
      lifecycleFilter: view.search.lifecycle === "trashed" ? "trashed" : "active",
      favoriteFilter: view.search.favorite,
      ratingFilter: view.search.ratingMin ?? 0,
      colorFilter: view.search.colorLabel ?? "none",
      visualColor: view.search.dominantColor ?? null,
      visualColorTolerance: view.search.colorTolerance ?? 25,
      minWidth: view.search.minWidth,
      maxWidth: view.search.maxWidth,
      minHeight: view.search.minHeight,
      maxHeight: view.search.maxHeight,
      minSize: view.search.minSize,
      maxSize: view.search.maxSize,
      minDuration: view.search.minDuration,
      maxDuration: view.search.maxDuration,
      extension: view.search.extension,
      orientation: view.search.orientation,
      createdAfter: view.search.createdAfter,
      createdBefore: view.search.createdBefore,
      modifiedAfter: view.search.modifiedAfter,
      modifiedBefore: view.search.modifiedBefore,
      sort: view.search.sort ?? "createdAt",
      direction: view.search.direction ?? "desc",
      workspaceMode: "directory",
      focusMode: false,
      navigationSource: "library",
    });
    if (view.search.dominantColor) {
      void window.refCanvas.library.startSimilarityIndex();
    }
    void get().reloadAssets();
  },

  deleteSavedView: async (id) => {
    await window.refCanvas.library.deleteSavedView(id);
    set((state) => ({ savedViews: state.savedViews.filter((view) => view.id !== id) }));
  },

  updateSavedView: async (id, patch) => {
    const updated = await window.refCanvas.library.updateSavedView(id, patch);
    set((state) => ({
      savedViews: state.savedViews.map((view) => (view.id === id ? updated : view)),
    }));
  },

  duplicateSavedView: async (id) => {
    const copy = await window.refCanvas.library.duplicateSavedView(id);
    set((state) => ({ savedViews: [...state.savedViews, copy] }));
  },

  setPreferences: async (prefs) => {
    const preferences = await window.refCanvas.library.setPreferences(prefs);
    set({ preferences });
  },

  updateTagMeta: async (id, patch) => {
    const updated = await window.refCanvas.library.updateTagMeta(id, patch);
    set((state) => ({
      tags: state.tags.map((tag) => (tag.id === id ? updated : tag)),
    }));
  },

  refreshDuplicates: async () => {
    const duplicates = await window.refCanvas.library.listDuplicates();
    const stats = await window.refCanvas.library.stats();
    set({ duplicates, stats });
  },

  mergeDuplicates: async (keepId, removeIds) => {
    await window.refCanvas.library.mergeDuplicates(keepId, removeIds);
    await Promise.all([get().reloadAssets(), get().refreshDuplicates()]);
  },

  saveBoard: async (document, revision) => {
    const board = get().activeBoard;
    if (!board) throw new Error("BOARD_NOT_FOUND");
    const summary = await window.refCanvas.boards.save(
      board.id,
      document,
      revision,
    );
    set((state) => savedBoardState(state.boards, summary, document));
    return summary;
  },

  createBoard: async (title) => {
    const current = get();
    if (current.activeBoard && current.boardDocument) {
      await window.refCanvas.boards.save(
        current.activeBoard.id,
        current.boardDocument,
        current.activeBoard.revision,
      );
    }
    const summary = await window.refCanvas.boards.create(title);
    const loaded = await window.refCanvas.boards.load(summary.id);
    set((state) => ({
      boards: [summary, ...state.boards],
      activeBoard: summary,
      boardDocument: loaded?.document ?? null,
      selectedAsset: null,
      workspaceMode: "board",
    }));
  },

  renameBoard: async (id, title) => {
    const summary = await window.refCanvas.boards.rename(id, title);
    set((state) => renamedBoardState(state.boards, state.activeBoard, summary));
  },

  deleteBoard: async (id) => {
    await window.refCanvas.boards.delete(id);
    const boards = get().boards.filter((board) => board.id !== id);
    if (get().activeBoard?.id !== id) {
      set({ boards });
      return;
    }
    const loaded = boards[0]
      ? await window.refCanvas.boards.load(boards[0].id)
      : null;
    set({
      boards,
      activeBoard: loaded?.summary ?? null,
      boardDocument: loaded?.document ?? null,
      selectedAsset: null,
    });
  },

  switchBoard: async (id) => {
    const current = get();
    if (current.activeBoard?.id === id) {
      set({ workspaceMode: "board" });
      return;
    }
    if (current.activeBoard && current.boardDocument) {
      await window.refCanvas.boards.save(
        current.activeBoard.id,
        current.boardDocument,
        current.activeBoard.revision,
      );
    }
    const loaded = await window.refCanvas.boards.load(id);
    if (!loaded) return;
    void window.refCanvas.boards.touch(id);
    set({
      activeBoard: loaded.summary,
      boardDocument: loaded.document,
      selectedAsset: null,
      workspaceMode: "board",
    });
  },

  addDirectoryEntriesToBoard: async (paths) => {
    const uniquePaths = [...new Set(paths)];
    if (!uniquePaths.length) return;
    const materialized = await Promise.all(
      uniquePaths.map((entryPath) =>
        window.refCanvas.filesystem.materialize(entryPath),
      ),
    );
    if (!get().activeBoard) {
      const titles = new Set(get().boards.map((board) => board.title));
      let index = 1;
      let title: string;
      do {
        title = `参考板 ${String(index).padStart(2, "0")}`;
        index += 1;
      } while (titles.has(title));
      await get().createBoard(title);
    }
    const addedAssets = materialized.map((result) => result.asset);
    set((state) => {
      const assets = new Map(state.assets.map((asset) => [asset.id, asset]));
      for (const asset of addedAssets) assets.set(asset.id, asset);
      return {
        assets: [...assets.values()],
        pendingBoardAssetIds: [
          ...new Set([
            ...state.pendingBoardAssetIds,
            ...addedAssets.map((asset) => asset.id),
          ]),
        ],
        workspaceMode: "board",
      };
    });
  },

  consumePendingBoardAssets: (ids) => {
    const consumed = new Set(ids);
    set((state) => ({
      pendingBoardAssetIds: state.pendingBoardAssetIds.filter(
        (id) => !consumed.has(id),
      ),
    }));
  },

  showDirectoryWorkspace: () =>
    set({
      workspaceMode: "directory",
      navigationSource: "directory",
      focusMode: false,
    }),

  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),

  activeCollectionId: null,
  collections: [],
  collectionTree: {},
  collectionItems: {},
  browserTabs: [],
  activeTabId: "",

  openCollection: (id) => {
    set({
      workspaceMode: "directory",
      navigationSource: "directory",
      focusMode: false,
      activeCollectionId: id,
    });
    get().refreshCollections();
  },

  openCollectionInNewTab: async (id, name) => {
    const tab = createBrowserTab("collection", id, name);
    set((state) => ({ browserTabs: [...state.browserTabs, tab] }));
    await get().switchBrowserTab(tab.id);
  },

  closeCollection: () => set({ activeCollectionId: null }),

  refreshCollections: async () => {
    const previousActive = get().activeCollectionId;
    const [collections, items] = await Promise.all([
      window.refCanvas.collections.list(),
      previousActive
        ? window.refCanvas.collections.listItems(previousActive).catch(() => [])
        : Promise.resolve<ReferenceCollectionItem[]>([]),
    ]);
    const collectionTree: Record<string, ReferenceCollection[]> = {};
    for (const collection of collections) {
      const parentId = collection.parentId ?? "";
      (collectionTree[parentId] ??= []).push(collection);
    }
    const currentActive = get().activeCollectionId;
    set((state) => ({
      collections,
      collectionTree,
      collectionItems:
        currentActive === previousActive && currentActive !== null
          ? { ...state.collectionItems, [currentActive]: items }
          : currentActive !== null
            ? { [currentActive]: state.collectionItems[currentActive] ?? [] }
            : {},
    }));
  },

  selectDirectoryEntry: (selectedDirectoryEntry) =>
    set({ selectedDirectoryEntry }),

  clearRemovedMount: (mountPath) => {
    const state = get();
    const currentRemoved = Boolean(
      state.directoryPath &&
        isPathInsideMount(state.directoryPath, mountPath),
    );
    const history = state.directoryHistory.filter(
      (entry) => !isPathInsideMount(entry, mountPath),
    );
    const currentIndex = state.directoryPath
      ? history.indexOf(state.directoryPath)
      : -1;
    const directoryHistoryIndex = currentIndex >= 0 ? currentIndex : 0;
    if (currentRemoved) directoryOpenGeneration += 1;
    set({
      ...(currentRemoved
        ? {
            directoryPath: null,
            directoryEntries: [],
            directoryTotal: 0,
            directoryLoading: false,
            selectedDirectoryEntry: null,
          }
        : {}),
      directoryHistory: history,
      directoryHistoryIndex,
    });
    updateNavigationState({
      directoryPath: currentRemoved ? null : state.directoryPath,
      directoryHistory: history,
      directoryHistoryIndex,
    });
  },

  openDirectory: async (path) => {
    const normalized = normalizeDirectoryPath(path);
    // 已在某个标签打开 → 直接切换到该标签（不修改来源标签历史）。
    const existing = get().browserTabs.find(
      (tab) => tab.kind === "directory" && normalizeDirectoryPath(tab.targetId) === normalized,
    );
    if (existing) {
      // A collection can be shown over the directory tab that was active when
      // it opened. Clicking that directory again must still leave collection mode.
      if (get().activeCollectionId !== null && existing.id === get().activeTabId) {
        set({ activeCollectionId: null, selectedDirectoryEntry: null });
        return;
      }
      await get().switchBrowserTab(existing.id);
      return;
    }
    const previous = get().directoryPath;
    const history = previous
      ? [path, ...get().directoryHistory.filter((item) => normalizeDirectoryPath(item) !== normalized)].slice(0, 60)
      : [path];
    await get().loadDirectoryState(path, history, 0);
    get().updateActiveBrowserTab({ targetId: path, title: titleFromPath(path) });
  },

  openDirectoryInNewTab: async (path) => {
    await get().createBrowserTabForPath(path);
  },

  createBrowserTabForPath: async (path) => {
    const tab = createBrowserTab("directory", path, titleFromPath(path));
    set((state) => ({ browserTabs: [...state.browserTabs, tab] }));
    await get().switchBrowserTab(tab.id);
  },

  /** 内部：加载目录并恢复指定历史（不修改标签栈）。 */
  loadDirectoryState: async (path, history, historyIndex) => {
    const generation = ++directoryOpenGeneration;
    set({
      workspaceMode: "directory",
      navigationSource: "directory",
      focusMode: false,
      directoryPath: path,
      directoryLoading: true,
      selectedIds: new Set(),
      allMatchingSelected: false,
      excludedIds: new Set(),
      selectedAsset: null,
      selectedDirectoryEntry: null,
    });
    try {
      const page = await window.refCanvas.filesystem.listDirectory(path, {
        pageSize: 512,
      });
      if (generation !== directoryOpenGeneration || get().directoryPath !== path) return;
      set({
        directoryEntries: page.entries,
        directoryTotal: page.total,
        directoryHistory: history,
        directoryHistoryIndex: historyIndex,
      });
      updateNavigationState({
        navigationSource: "directory",
        directoryPath: path,
        directoryHistory: history,
        directoryHistoryIndex: historyIndex,
      });
    } catch (error) {
      if (generation !== directoryOpenGeneration) return;
      set({ directoryPath: null, directoryEntries: [], directoryTotal: 0 });
      throw error;
    } finally {
      if (generation === directoryOpenGeneration) {
        set({ directoryLoading: false });
      }
    }
  },

  switchBrowserTab: async (id) => {
    const state = get();
    if (state.activeTabId === id) return;
    // 保存当前标签状态。
    const current = state.directoryPath;
    const history = state.directoryHistory;
    const index = state.directoryHistoryIndex;
    const savedTabs = state.browserTabs.map((tab) =>
      tab.id === state.activeTabId
        ? {
            ...tab,
            ...(current
              ? {
                  targetId: current,
                  title: titleFromPath(current),
                  backStack: history.slice(index + 1),
                  forwardStack: history.slice(0, index),
                }
              : {}),
          }
        : tab,
    );
    const target = savedTabs.find((tab) => tab.id === id);
    if (!target) return;
    const nextTabs = savedTabs.map((tab) =>
      tab.id === id
        ? {
            ...tab,
            backStack: [],
            forwardStack: [],
          }
        : tab,
    );
    set({ browserTabs: nextTabs, activeTabId: id });
    persistV3Tabs(nextTabs, id);
    if (target.kind === "collection" && target.targetId) {
      // 集合标签：切换到对应集合视图（集合引用不依赖目录路径）。
      set({
        workspaceMode: "directory",
        navigationSource: "directory",
        focusMode: false,
        directoryPath: null,
        activeCollectionId: target.targetId,
      });
      get().refreshCollections();
      return;
    }
    if (target.kind === "directory" && target.targetId) {
      // 目录标签：清除集合视图。
      if (state.activeCollectionId !== null) {
        set({ activeCollectionId: null });
      }
      const restoredHistory = [...target.forwardStack, target.targetId, ...target.backStack];
      await get().loadDirectoryState(
        target.targetId,
        restoredHistory.length ? restoredHistory : [target.targetId],
        target.forwardStack.length,
      );
    }
  },

  closeBrowserTab: async (id) => {
    const state = get();
    const index = state.browserTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const remaining = state.browserTabs.filter((tab) => tab.id !== id);
    const nextTabs = remaining.length > 0 ? remaining : [createBrowserTab("directory", "browser://empty", "浏览")];
    const wasActive = state.activeTabId === id;
    const nextActiveId = wasActive
      ? nextTabs[Math.min(index, nextTabs.length - 1)].id
      : state.activeTabId;
    set({ browserTabs: nextTabs, activeTabId: nextActiveId });
    persistV3Tabs(nextTabs, nextActiveId);
    if (wasActive) {
      const active = nextTabs.find((tab) => tab.id === nextActiveId);
      if (active?.kind === "collection" && active.targetId) {
        set({ activeCollectionId: active.targetId });
        get().refreshCollections();
      } else if (active?.kind === "directory" && active.targetId && active.targetId !== "browser://empty") {
        await get().loadDirectoryState(active.targetId, [active.targetId], 0);
      } else {
        set({ directoryPath: null, directoryEntries: [], directoryTotal: 0, activeCollectionId: null });
      }
    }
  },

  reorderBrowserTab: (sourceId, targetId) => {
    const state = get();
    const sourceIndex = state.browserTabs.findIndex((tab) => tab.id === sourceId);
    const targetIndex = state.browserTabs.findIndex((tab) => tab.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextTabs = [...state.browserTabs];
    const [moved] = nextTabs.splice(sourceIndex, 1);
    nextTabs.splice(targetIndex, 0, moved);
    set({ browserTabs: nextTabs });
    persistV3Tabs(nextTabs, state.activeTabId);
  },

  updateActiveBrowserTab: (patch) => {
    const state = get();
    if (!state.activeTabId) return;
    const nextTabs = state.browserTabs.map((tab) =>
      tab.id === state.activeTabId ? { ...tab, ...patch } : tab,
    );
    set({ browserTabs: nextTabs });
    persistV3Tabs(nextTabs, state.activeTabId);
  },

  goBackDirectory: async () => {
    const { directoryHistory, directoryHistoryIndex } = get();
    const nextIndex = directoryHistoryIndex + 1;
    const target = directoryHistory[nextIndex];
    if (!target) return;
    await moveDirectoryCursor(set, target, nextIndex);
  },

  goForwardDirectory: async () => {
    const { directoryHistory, directoryHistoryIndex } = get();
    const nextIndex = directoryHistoryIndex - 1;
    const target = directoryHistory[nextIndex];
    if (nextIndex < 0 || !target) return;
    await moveDirectoryCursor(set, target, nextIndex);
  },

  goUpDirectory: async () => {
    const current = get().directoryPath;
    if (!current) return;
    const mounts = await window.refCanvas.mounts.list();
    const roots = await window.refCanvas.filesystem.listRoots();
    const allowedRoots = [
      ...roots.map((root) => root.path),
      ...mounts
        .filter((item) => item.state === "online")
        .map((item) => item.path),
    ];
    const root = allowedRoots.find((item) => isPathInsideMount(current, item));
    if (!root) return;
    const normalizedCurrent = current.replace(/[\\/]+$/, "");
    const normalizedMount = root.replace(/[\\/]+$/, "");
    if (
      normalizedCurrent.toLocaleLowerCase("en-US") ===
      normalizedMount.toLocaleLowerCase("en-US")
    ) {
      return;
    }
    const separator = Math.max(
      normalizedCurrent.lastIndexOf("\\"),
      normalizedCurrent.lastIndexOf("/"),
    );
    if (separator < 0) return;
    let parent = normalizedCurrent.slice(0, separator);
    if (/^[A-Za-z]:$/.test(parent)) parent += "\\";
    if (!isPathInsideMount(parent, root)) return;
    await get().openDirectory(parent);
  },

  reloadDirectory: async () => {
    const current = get().directoryPath;
    if (!current) return;
    const index = get().directoryHistoryIndex;
    await moveDirectoryCursor(set, current, index);
  },

  /** 批量按需建立本地索引（不指定文件夹），失败容错；单条失败时抛错。 */
  materializeEntries: async (paths) => {
    const results = await Promise.allSettled(
      paths.map((entryPath) => window.refCanvas.filesystem.materialize(entryPath)),
    );
    if (paths.length === 1 && results[0]?.status === "rejected") {
      throw results[0].reason;
    }
    await get().reloadAssets();
  },

  /** 批量按需建立本地索引并打标签（逗号分隔文本转数组）。 */
  materializeEntriesWithTags: async (paths, tags) => {
    const results = await Promise.allSettled(
      paths.map((entryPath) =>
        window.refCanvas.filesystem.materialize(entryPath).then(({ asset }) =>
          window.refCanvas.library.setTags(asset.id, tags),
        ),
      ),
    );
    if (paths.length === 1 && results[0]?.status === "rejected") {
      throw results[0].reason;
    }
    await get().reloadAssets();
  },

  /** 批量移入 Windows 回收站并刷新目录视图。 */
  trashEntries: async (paths) => {
    const directoryPath = get().directoryPath;
    const page = directoryPath
      ? await window.refCanvas.filesystem.listDirectory(directoryPath, {
          pageSize: 1,
        })
      : null;
    await window.refCanvas.filesystem.trash(
      paths,
      directoryPath && page?.revision
        ? { directoryPath, revision: page.revision }
        : undefined,
    );
    await get().reloadDirectory();
  },

  refreshQuickAccess: async () => {
    const quickAccess = await window.refCanvas.filesystem.listQuickAccess();
    set({ quickAccess });
  },

  addQuickAccess: async (path, name) => {
    await window.refCanvas.filesystem.addQuickAccess(path, name);
    await get().refreshQuickAccess();
  },

  removeQuickAccess: async (id) => {
    await window.refCanvas.filesystem.removeQuickAccess(id);
    await get().refreshQuickAccess();
  },

  setDirectoryExpanded: async (id, expanded) => {
    await window.refCanvas.filesystem.updateQuickAccess(id, { expanded });
    await get().refreshQuickAccess();
  },

  materializeEntry: async (path) => {
    await window.refCanvas.filesystem.materialize(path);
    const search = get().currentSearch();
    if (!search.query) {
      await get().reloadAssets();
    }
  },
}));

useAppStore.subscribe((state) => {
  if (!navigationHydrated) return;
  const navigation = {
    navigationSource: state.navigationSource,
    directoryPath: state.directoryPath,
    query: state.query,
    kindFilter: state.kindFilter,
    linkStateFilter: state.linkStateFilter,
    lifecycleFilter: state.lifecycleFilter,
    favoriteFilter: state.favoriteFilter,
    ratingFilter: state.ratingFilter,
    colorFilter: state.colorFilter,
    visualColor: state.visualColor,
    visualColorTolerance: state.visualColorTolerance,
    minWidth: state.minWidth,
    maxWidth: state.maxWidth,
    minHeight: state.minHeight,
    maxHeight: state.maxHeight,
    minSize: state.minSize,
    maxSize: state.maxSize,
    minDuration: state.minDuration,
    maxDuration: state.maxDuration,
    extension: state.extension,
    orientation: state.orientation,
    createdAfter: state.createdAfter,
    createdBefore: state.createdBefore,
    modifiedAfter: state.modifiedAfter,
    modifiedBefore: state.modifiedBefore,
    sort: state.sort,
    direction: state.direction,
  };
  const signature = JSON.stringify(navigation);
  if (signature === lastNavigationSignature) return;
  lastNavigationSignature = signature;
  updateNavigationState(navigation);
});
