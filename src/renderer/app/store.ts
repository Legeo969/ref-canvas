import { create } from "zustand";
import type {
  AssetColorLabel,
  AssetKind,
  AssetRecord,
  AssetSearchInput,
  AssetSortKey,
  BatchAssetPatch,
  BoardDocumentV3,
  ImportOptions,
  LibraryPreferences,
  MaterializeOptions,
  SavedView,
  SelectionScope,
  SortDirection,
} from "../../shared/contracts";
import {
  navigationStateForCollections,
  readDurableNavigationState,
  updateNavigationState,
} from "./navigation-state";
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
export {
  ASSET_PAGE_SIZE,
  MAX_RESIDENT_ASSET_PAGES,
} from "../features/library/query-window";

interface AppState
  extends LibraryQuerySliceState,
    DirectorySliceState,
    BoardSliceState,
    PreferencesSliceState {
  initialize(): Promise<void>;
  currentSearch(cursor?: string): AssetSearchInput;
  reloadAssets(): Promise<void>;
  ensureAssetRange(startIndex: number, endIndex: number): Promise<void>;
  assetAt(index: number): AssetRecord | null;
  loadMore(): Promise<void>;
  setQuery(query: string): void;
  setTagFilter(name: string | null): void;
  setKindFilter(kind: AssetKind | "all"): void;
  setCollectionFilter(id: string | null): void;
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
  importAssets(mode: "files" | "folder"): Promise<void>;
  importPaths(paths: string[]): Promise<void>;
  importPathsWithOptions(paths: string[], options: ImportOptions): Promise<void>;
  cancelImport(): Promise<void>;
  addWatchFolder(): Promise<void>;
  relinkAsset(id: string, mode: "pick" | "search"): Promise<void>;
  removeFromLibrarySelection(): Promise<void>;
  refreshLibraries(): Promise<void>;
  createLibrary(options: { name: string; directory: string }): Promise<void>;
  switchLibrary(id: string): Promise<void>;
  openLibrary(directory: string): Promise<void>;
  createCollection(title: string, parentId?: string | null): Promise<void>;
  updateCollection(
    id: string,
    patch: { title?: string; parentId?: string | null; sortOrder?: number },
  ): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  addAssetsToCollection(
    ids: string[],
    collectionId: string,
    removeFromCollectionId?: string,
  ): Promise<void>;
  addToCollection(assetId: string, collectionId: string): Promise<void>;
  removeFromCollection(assetId: string, collectionId: string): Promise<void>;
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
  setFolderLock(id: string, password: string | null): Promise<void>;
  unlockFolder(id: string, password: string): Promise<boolean>;
  updateTagMeta(
    id: string,
    patch: { name?: string; alias?: string | null; shortcutKey?: string | null },
  ): Promise<void>;
  refreshDuplicates(): Promise<void>;
  mergeDuplicates(keepId: string, removeIds: string[]): Promise<void>;
  saveBoard(document: BoardDocumentV3): Promise<void>;
  createBoard(title: string): Promise<void>;
  renameBoard(id: string, title: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  switchBoard(id: string): Promise<void>;
  toggleFocusMode(): void;
  /** 切换到本地目录浏览（不产生素材数据库记录）。 */
  openDirectory(path: string): Promise<void>;
  /** 目录历史后退一步（不修改历史列表）。 */
  goBackDirectory(): Promise<void>;
  /** 目录历史前进一步（不修改历史列表）。 */
  goForwardDirectory(): Promise<void>;
  goUpDirectory(): Promise<void>;
  reloadDirectory(): Promise<void>;
  /** 目录树导入：目录 → 嵌套文件夹（可指定落点文件夹与层级模式）。 */
  importDirectoryTree(
    path: string,
    options?: {
      /** 层级模式（默认 collections 保留层级）。 */
      hierarchyMode?: "collections" | "flat";
      /** 树整体嵌套到该文件夹下（默认为资料库根）。 */
      parentFolderId?: string | null;
    },
  ): Promise<void>;
  /** 批量将未入库文件按需入库并加入文件夹（同路径复用 assetId）。 */
  materializeEntriesToCollection(
    paths: string[],
    collectionId: string,
  ): Promise<void>;
  /** 批量按需入库（不指定文件夹）。 */
  materializeEntries(paths: string[]): Promise<void>;
  /** 批量按需入库并打标签。 */
  materializeEntriesWithTags(paths: string[], tags: string[]): Promise<void>;
  /** 批量移入 Windows 回收站。 */
  trashEntries(paths: string[]): Promise<void>;
  refreshQuickAccess(): Promise<void>;
  addQuickAccess(path: string, name?: string): Promise<void>;
  removeQuickAccess(id: string): Promise<void>;
  setDirectoryExpanded(id: string, expanded: boolean): Promise<void>;
  /** 未入库文件按需入库（同路径复用 assetId）。 */
  materializeEntry(path: string, options?: MaterializeOptions): Promise<void>;
}

function selectionState(
  scope: SelectionScope,
  assets: AssetRecord[],
): Pick<
  AppState,
  | "selectedIds"
  | "allMatchingSelected"
  | "excludedIds"
  | "selectedAsset"
  | "selectionAnchorId"
> {
  if (scope.mode === "query") {
    return {
      selectedIds: new Set(),
      allMatchingSelected: true,
      excludedIds: new Set(scope.excludedIds),
      selectedAsset: null,
      selectionAnchorId: null,
    };
  }
  const ids = new Set(scope.ids);
  return {
    selectedIds: ids,
    allMatchingSelected: false,
    excludedIds: new Set(),
    selectedAsset: assets.find((asset) => ids.has(asset.id)) ?? null,
    selectionAnchorId: scope.ids[0] ?? null,
  };
}

let navigationHydrated = false;
let assetQueryRevision = 0;
let libraryRefreshTimer: number | null = null;
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
  set({ directoryPath: target, directoryLoading: true });
  try {
    await window.refCanvas.filesystem.setObservedDirectory(target);
    const page = await window.refCanvas.filesystem.listDirectory(target, {
      pageSize: 512,
    });
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
  } catch (error) {
    throw error;
  } finally {
    set({ directoryLoading: false });
  }
}
let lastNavigationSignature = "";

export const useAppStore = create<AppState>((set, get) => ({
  ...createLibraryQuerySliceState(),
  ...createDirectorySliceState(),
  ...createBoardSliceState(),
  ...createPreferencesSliceState(),

  initialize: async () => {
    const [boards, collections, tags, tagGroups, savedViews, libraries, currentLibrary, preferences] = await Promise.all([
      window.refCanvas.boards.list(),
      window.refCanvas.library.listCollections(),
      window.refCanvas.library.listTags(),
      window.refCanvas.library.listTagGroups(),
      window.refCanvas.library.listSavedViews(),
      window.refCanvas.libraries.list(),
      window.refCanvas.libraries.current(),
      window.refCanvas.library.getPreferences(),
    ]);
    const navigation = navigationStateForCollections(
      await readDurableNavigationState(),
      new Set(collections.map((collection) => collection.id)),
    );
    const activeBoard = boards[0] ?? null;
    const loaded = activeBoard
      ? await window.refCanvas.boards.load(activeBoard.id)
      : null;
    // 上报主窗口当前白板（boards:open-window 去重聚焦依据）。
    void window.refCanvas.boards.setActive(activeBoard?.id ?? null);
    const unsubscribeImport = window.refCanvas.library.onImportProgress((importJob) => {
      set({
        importJob,
        importing: !["completed", "cancelled", "failed"].includes(importJob.state),
      });
      if (importJob.state === "completed") {
        void Promise.all([
          get().reloadAssets(),
          window.refCanvas.library
            .listCollections()
            .then((nextCollections) => set({ collections: nextCollections })),
        ]);
      }
    });
    const unsubscribeLibrary = window.refCanvas.library.onLibraryChanged(() => {
      if (libraryRefreshTimer !== null) window.clearTimeout(libraryRefreshTimer);
      libraryRefreshTimer = window.setTimeout(() => {
        libraryRefreshTimer = null;
        void Promise.all([
          get().reloadAssets(),
          window.refCanvas.library
            .listCollections()
            .then((nextCollections) => set({ collections: nextCollections })),
        ]);
      }, 80);
    });
    window.addEventListener(
      "beforeunload",
      () => {
        unsubscribeImport();
        unsubscribeLibrary();
        if (libraryRefreshTimer !== null) window.clearTimeout(libraryRefreshTimer);
      },
      { once: true },
    );
    navigationHydrated = true;
    set({
      boards,
      collections,
      tags,
      tagGroups,
      savedViews,
      libraries,
      currentLibrary,
      preferences,
      navigationSource: navigation.navigationSource,
      directoryPath: navigation.directoryPath,
      directoryHistoryIndex: navigation.directoryHistoryIndex ?? 0,
      activeBoard,
      boardDocument: loaded?.document ?? null,
      query: navigation.query,
      kindFilter: navigation.kindFilter,
      collectionFilter: navigation.collectionFilter,
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
    if (navigation.visualColor) {
      void window.refCanvas.library.startSimilarityIndex();
    }
    await get().reloadAssets();
    set({ loading: false });
    if (navigation.navigationSource === "directory" && navigation.directoryPath) {
      await get().openDirectory(navigation.directoryPath);
    }
    await get().refreshQuickAccess();
    await window.refCanvas.system.markRendererInteractive();
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
      collectionId: state.collectionFilter ?? undefined,
      includeSubcollections: state.preferences.includeSubfolderAssets,
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
    set({ query, navigationSource: "library" });
    window.setTimeout(() => {
      if (get().query === query) void get().reloadAssets();
    }, 160);
  },

  setTagFilter: (name) => {
    set({
      query: name ? `#${name}` : "",
      collectionFilter: null,
      linkStateFilter: "all",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  setKindFilter: (kindFilter) => {
    set({
      kindFilter,
      collectionFilter: null,
      linkStateFilter: "all",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  setCollectionFilter: (collectionFilter) => {
    set({
      collectionFilter,
      kindFilter: "all",
      linkStateFilter: "all",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  showMissingAssets: () => {
    set({
      linkStateFilter: "missing",
      kindFilter: "all",
      collectionFilter: null,
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  showTrash: () => {
    set({
      lifecycleFilter: "trashed",
      kindFilter: "all",
      linkStateFilter: "all",
      collectionFilter: null,
      favoriteFilter: undefined,
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
      collectionFilter: null,
      navigationSource: "library",
    });
    void get().reloadAssets();
  },

  setRatingFilter: (ratingFilter) => {
    set({ ratingFilter, navigationSource: "library" });
    void get().reloadAssets();
  },

  setColorFilter: (colorFilter) => {
    set({ colorFilter, navigationSource: "library" });
    void get().reloadAssets();
  },

  setVisualColor: (visualColor) => {
    set({ visualColor, navigationSource: "library" });
    if (visualColor) {
      void window.refCanvas.library.startSimilarityIndex();
    }
    void get().reloadAssets();
  },

  setVisualColorTolerance: (visualColorTolerance) => {
    set({ visualColorTolerance, navigationSource: "library" });
    if (get().visualColor) void get().reloadAssets();
  },

  setAdvancedFilters: (filters) => {
    set({ ...filters, navigationSource: "library" });
    void get().reloadAssets();
  },

  setSort: (sort, direction) => {
    set({ sort, direction, navigationSource: "library" });
    void get().reloadAssets();
  },

  selectAsset: (selectedAsset) => set({ selectedAsset }),

  selectAssetInGrid: (id, mode) => {
    const state = get();
    if (
      mode === "replace" &&
      !state.allMatchingSelected &&
      state.selectedIds.size === 1 &&
      state.selectedIds.has(id) &&
      state.selectedAsset?.id === id
    ) {
      return;
    }
    if (state.allMatchingSelected && mode === "toggle") {
      const excludedIds = new Set(state.excludedIds);
      if (excludedIds.has(id)) excludedIds.delete(id);
      else excludedIds.add(id);
      set({
        excludedIds,
        selectedAsset: state.assets.find((asset) => asset.id === id) ?? null,
      });
      return;
    }
    const next = new Set(state.selectedIds);
    if (mode === "replace") {
      next.clear();
      next.add(id);
    } else if (mode === "toggle") {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      const anchorIndex = state.assets.findIndex(
        (asset) => asset.id === state.selectionAnchorId,
      );
      const targetIndex = state.assets.findIndex((asset) => asset.id === id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        next.clear();
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        for (const asset of state.assets.slice(start, end + 1)) next.add(asset.id);
      } else {
        next.add(id);
      }
    }
    set({
      selectedIds: next,
      allMatchingSelected: false,
      excludedIds: new Set(),
      selectionAnchorId: mode === "range" ? state.selectionAnchorId : id,
      selectedAsset: state.assets.find((asset) => asset.id === id) ?? null,
    });
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
    const [collections, tags] = await Promise.all([
      window.refCanvas.library.listCollections(),
      window.refCanvas.library.listTags(),
    ]);
    set({ collections, tags });
    await get().reloadAssets();
    set(selectionState(scope, get().assets));
  },

  batchRename: async (pattern) => {
    const scope = get().selectionScope();
    await window.refCanvas.library.batchRename(scope, pattern);
    await get().reloadAssets();
    set(selectionState(scope, get().assets));
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

  importAssets: async (mode) => {
    set({ importing: true });
    try {
      await window.refCanvas.library.pickAndImport(mode);
      const collections = await window.refCanvas.library.listCollections();
      set({ collections });
      await get().reloadAssets();
    } finally {
      set({ importing: false });
    }
  },

  importPaths: async (paths) => {
    if (!paths.length) return;
    const importJob = await window.refCanvas.library.startImport(paths);
    set({ importJob, importing: true });
  },

  importPathsWithOptions: async (paths, options) => {
    if (!paths.length) return;
    const importJob = await window.refCanvas.library.startImport(paths, options);
    set({ importJob, importing: true });
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

  refreshLibraries: async () => {
    const [libraries, currentLibrary] = await Promise.all([
      window.refCanvas.libraries.list(),
      window.refCanvas.libraries.current(),
    ]);
    set({ libraries, currentLibrary });
  },

  createLibrary: async (options) => {
    await window.refCanvas.libraries.create(options);
    // Switching libraries rebinds the backend and reloads the renderer.
    await get().refreshLibraries();
  },

  switchLibrary: async (id) => {
    await window.refCanvas.libraries.switchTo(id);
    await get().refreshLibraries();
  },

  openLibrary: async (directory) => {
    await window.refCanvas.libraries.open(directory);
    await get().refreshLibraries();
  },

  addWatchFolder: async () => {
    set({ importing: true });
    try {
      await window.refCanvas.library.addWatchFolder();
      const collections = await window.refCanvas.library.listCollections();
      set({ collections });
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

  createCollection: async (title, parentId = null) => {
    const collection = await window.refCanvas.library.createCollection(title, parentId);
    const collections = await window.refCanvas.library.listCollections();
    set({ collections, collectionFilter: collection.id });
    await get().reloadAssets();
  },

  updateCollection: async (id, patch) => {
    await window.refCanvas.library.updateCollection(id, patch);
    const collections = await window.refCanvas.library.listCollections();
    set({ collections });
  },

  deleteCollection: async (id) => {
    const deletedIds = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const collection of get().collections) {
        if (
          collection.parentId &&
          deletedIds.has(collection.parentId) &&
          !deletedIds.has(collection.id)
        ) {
          deletedIds.add(collection.id);
          changed = true;
        }
      }
    }
    await window.refCanvas.library.deleteCollection(id);
    const collectionFilter =
      get().collectionFilter && deletedIds.has(get().collectionFilter!)
        ? null
        : get().collectionFilter;
    const collections = await window.refCanvas.library.listCollections();
    set({ collections, collectionFilter });
    await get().reloadAssets();
  },

  addAssetsToCollection: async (ids, collectionId, removeFromCollectionId) => {
    if (!ids.length) return;
    await window.refCanvas.library.batchUpdate(
      { mode: "ids", ids },
      {
        addCollectionId: collectionId,
        removeCollectionId: removeFromCollectionId,
      },
    );
    const collections = await window.refCanvas.library.listCollections();
    set({ collections });
    if (removeFromCollectionId === get().collectionFilter) {
      await get().reloadAssets();
    }
  },

  addToCollection: async (assetId, collectionId) => {
    const updated = await window.refCanvas.library.addToCollection(assetId, collectionId);
    assetWindow.replace(updated);
    const collections = await window.refCanvas.library.listCollections();
    set((state) => ({
      collections,
      assets: state.assets.map((asset) => asset.id === assetId ? updated : asset),
      selectedAsset: state.selectedAsset?.id === assetId ? updated : state.selectedAsset,
    }));
  },

  removeFromCollection: async (assetId, collectionId) => {
    const updated = await window.refCanvas.library.removeFromCollection(
      assetId,
      collectionId,
    );
    assetWindow.replace(updated);
    const collections = await window.refCanvas.library.listCollections();
    set((state) => ({
      collections,
      assets: state.assets.map((asset) => asset.id === assetId ? updated : asset),
      selectedAsset: state.selectedAsset?.id === assetId ? updated : state.selectedAsset,
    }));
    if (get().collectionFilter === collectionId) await get().reloadAssets();
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
      collectionFilter: view.search.collectionId ?? null,
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
    const previous = get().preferences;
    const preferences = await window.refCanvas.library.setPreferences(prefs);
    set({ preferences });
    if (
      previous.includeSubfolderAssets !== preferences.includeSubfolderAssets &&
      get().collectionFilter
    ) {
      await get().reloadAssets();
    }
  },

  setFolderLock: async (id, password) => {
    await window.refCanvas.library.setFolderLock(id, password);
    const collections = await window.refCanvas.library.listCollections();
    set({ collections });
  },

  unlockFolder: async (id, password) => {
    const unlocked = await window.refCanvas.library.unlockFolder(id, password);
    if (unlocked) {
      const collections = await window.refCanvas.library.listCollections();
      set({ collections });
    }
    return unlocked;
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

  saveBoard: async (document) => {
    const board = get().activeBoard;
    if (!board) return;
    const summary = await window.refCanvas.boards.save(board.id, document);
    set((state) => ({
      boardDocument: document,
      activeBoard: summary,
      boards: state.boards.map((item) => item.id === summary.id ? summary : item),
    }));
  },

  createBoard: async (title) => {
    const current = get();
    if (current.activeBoard && current.boardDocument) {
      await window.refCanvas.boards.save(current.activeBoard.id, current.boardDocument);
    }
    const summary = await window.refCanvas.boards.create(title);
    const loaded = await window.refCanvas.boards.load(summary.id);
    void window.refCanvas.boards.setActive(summary.id);
    set((state) => ({
      boards: [summary, ...state.boards],
      activeBoard: summary,
      boardDocument: loaded?.document ?? null,
      selectedAsset: null,
    }));
  },

  renameBoard: async (id, title) => {
    const summary = await window.refCanvas.boards.rename(id, title);
    set((state) => ({
      boards: state.boards.map((board) => board.id === id ? summary : board),
      activeBoard: state.activeBoard?.id === id ? summary : state.activeBoard,
    }));
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
    void window.refCanvas.boards.setActive(loaded?.summary?.id ?? null);
    set({
      boards,
      activeBoard: loaded?.summary ?? null,
      boardDocument: loaded?.document ?? null,
      selectedAsset: null,
    });
  },

  switchBoard: async (id) => {
    const current = get();
    if (current.activeBoard?.id === id) return;
    if (current.activeBoard && current.boardDocument) {
      await window.refCanvas.boards.save(current.activeBoard.id, current.boardDocument);
    }
    const loaded = await window.refCanvas.boards.load(id);
    if (!loaded) return;
    void window.refCanvas.boards.touch(id);
    void window.refCanvas.boards.setActive(id);
    set({
      activeBoard: loaded.summary,
      boardDocument: loaded.document,
      selectedAsset: null,
    });
  },

  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),

  openDirectory: async (path) => {
    const previous = get().directoryPath;
    set({
      navigationSource: "directory",
      directoryPath: path,
      directoryLoading: true,
      selectedIds: new Set(),
      allMatchingSelected: false,
      excludedIds: new Set(),
      selectedAsset: null,
    });
    try {
      await window.refCanvas.filesystem.setObservedDirectory(path);
      const page = await window.refCanvas.filesystem.listDirectory(path, {
        pageSize: 512,
      });
      set({
        directoryEntries: page.entries,
        directoryTotal: page.total,
      });
      const history = previous
        ? [path, ...get().directoryHistory.filter((item) => item !== path)].slice(0, 60)
        : [path];
      updateNavigationState({
        navigationSource: "directory",
        directoryPath: path,
        directoryHistory: history,
        directoryHistoryIndex: 0,
      });
      set({ directoryHistory: history, directoryHistoryIndex: 0 });
    } catch (error) {
      await window.refCanvas.filesystem
        .setObservedDirectory(previous)
        .catch(() => undefined);
      set({ directoryPath: previous, directoryEntries: [], directoryTotal: 0 });
      throw error;
    } finally {
      set({ directoryLoading: false });
    }
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
    const parent = current
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .slice(0, -1)
      .join("\\") || null;
    if (!parent) return;
    await get().openDirectory(parent);
  },

  reloadDirectory: async () => {
    const current = get().directoryPath;
    if (!current) return;
    const index = get().directoryHistoryIndex;
    await moveDirectoryCursor(set, current, index);
  },

  importDirectoryTree: async (path, options) => {
    const job = await window.refCanvas.library.startImport([path], {
      storageMode: "library-default",
      hierarchyMode: options?.hierarchyMode ?? "collections",
      parentFolderId: options?.parentFolderId ?? null,
    });
    set({ importJob: job, importing: true });
  },

  materializeEntriesToCollection: async (paths, collectionId) => {
    const results = await Promise.allSettled(
      paths.map((entryPath) =>
        window.refCanvas.filesystem.materialize(entryPath, {
          storageMode: "library-default",
          collectionIds: [collectionId],
        }),
      ),
    );
    if (paths.length === 1 && results[0]?.status === "rejected") {
      throw results[0].reason;
    }
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) {
      const collections = await window.refCanvas.library.listCollections();
      set({ collections });
    }
    await get().reloadAssets();
    const collections = await window.refCanvas.library.listCollections();
    set({ collections });
  },

  /** 批量按需入库（不指定文件夹），失败容错；单条失败时抛错。 */
  materializeEntries: async (paths) => {
    const results = await Promise.allSettled(
      paths.map((entryPath) =>
        window.refCanvas.filesystem.materialize(entryPath, {
          storageMode: "library-default",
        }),
      ),
    );
    if (paths.length === 1 && results[0]?.status === "rejected") {
      throw results[0].reason;
    }
    await get().reloadAssets();
    const collections = await window.refCanvas.library.listCollections();
    set({ collections });
  },

  /** 批量按需入库并打标签（逗号分隔文本转数组）。 */
  materializeEntriesWithTags: async (paths, tags) => {
    const results = await Promise.allSettled(
      paths.map((entryPath) =>
        window.refCanvas.filesystem.materialize(entryPath, {
          storageMode: "library-default",
          tags,
        }),
      ),
    );
    if (paths.length === 1 && results[0]?.status === "rejected") {
      throw results[0].reason;
    }
    await get().reloadAssets();
    const collections = await window.refCanvas.library.listCollections();
    set({ collections });
  },

  /** 批量移入 Windows 回收站并刷新目录视图。 */
  trashEntries: async (paths) => {
    await window.refCanvas.filesystem.trash(paths);
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

  materializeEntry: async (path, options) => {
    await window.refCanvas.filesystem.materialize(path, options);
    const search = get().currentSearch();
    if (!search.collectionId && !search.query) {
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
    collectionFilter: state.collectionFilter,
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
