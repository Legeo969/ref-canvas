import { create } from "zustand";
import type {
  AssetRecord,
  AssetSearchInput,
  BoardDocumentV3,
  BoardSummary,
  DirectoryEntry,
  LibraryPreferences,
  ReferenceCollection,
  ReferenceCollectionItem,
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
import { translate } from "./i18n";
import { importJobState } from "../features/library/import-job-model";
import { runWithDirectoryWriteAccess } from "./directory-write-access";
import {
  renamedBoardState,
  savedBoardState,
} from "../features/board/board-state-model";
export { ASSET_PAGE_SIZE } from "../features/library/query-window";

function prependRecentBoard(
  recentBoards: BoardSummary[],
  board: BoardSummary,
): BoardSummary[] {
  return [
    { ...board, lastOpenedAt: new Date().toISOString() },
    ...recentBoards.filter((item) => item.id !== board.id),
  ].slice(0, 10);
}

export interface AppState
  extends LibraryQuerySliceState,
    DirectorySliceState,
    BoardSliceState,
    PreferencesSliceState {
  workspaceMode: "directory" | "board" | "match";
  initialize(): Promise<void>;
  reloadAssets(): Promise<void>;
  selectAsset(asset: AssetRecord | null): void;
  locateAssetInLibrary(asset: AssetRecord): Promise<void>;
  completeDirectoryReveal(id: number): void;
  setTags(assetId: string, tags: string[]): Promise<void>;
  setPreferences(prefs: Partial<LibraryPreferences>): Promise<void>;
  saveBoard(document: BoardDocumentV3, revision: number): Promise<BoardSummary>;
  createBoard(title: string): Promise<void>;
  refreshBoards(): Promise<void>;
  renameBoard(id: string, title: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  switchBoard(id: string): Promise<void>;
  /** 返回本次新增的资产记录（浏览器捕获据其回写来源元数据）。 */
  addDirectoryEntriesToBoard(paths: string[]): Promise<AssetRecord[]>;
  consumePendingBoardAssets(ids: string[]): void;
  showDirectoryWorkspace(): void;
  /** 参考图仿色工作区：可带一个源画面路径（从预览的 LUT 菜单进来时）。 */
  showMatchWorkspace(sourcePath?: string): void;
  matchSourcePath: string | null;
  toggleFocusMode(): void;
  /** 引用集合（FND-003 §6.3）：打开集合视图；null 关闭。 */
  activeCollectionId: string | null;
  /** 浏览器扩展捕获自动归档的目标集合 id（失效时按名重建）。 */
  webCaptureCollectionId: string | null;
  collections: ReferenceCollection[];
  collectionTree: Record<string, ReferenceCollection[]>;
  collectionItems: Record<string, ReferenceCollectionItem[]>;
  openCollection(id: string): void;
  openCollectionInNewTab(id: string, name: string): Promise<void>;
  closeCollection(): void;
  /** 重新拉取集合树与展开/活动集合条目（FND-003）。 */
  refreshCollections(): Promise<void>;
  /**
   * 浏览器扩展捕获归档：把捕获文件加入（必要时创建）「网页捕获」集合，
   * 给捕获一个可发现、可导出的家。失败只告警，不影响捕获主流程。
   */
  addBrowserCaptureToCollection(filePath: string): Promise<void>;
  /** 认领捕获：复制进用户目录并重链资产/集合引用，失败弹窗报告。 */
  adoptCaptures(paths: string[], targetDirectory: string): Promise<void>;
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
  selectDirectoryEntry(entry: DirectoryEntry | null): void;
  /** 目录历史后退一步（不修改历史列表）。 */
  goBackDirectory(): Promise<void>;
  /** 目录历史前进一步（不修改历史列表）。 */
  goForwardDirectory(): Promise<void>;
  reloadDirectory(): Promise<void>;
  /** 批量按需建立本地索引并打标签。 */
  materializeEntriesWithTags(paths: string[], tags: string[]): Promise<void>;
  /** 批量移入 Windows 回收站。 */
  trashEntries(paths: string[]): Promise<boolean>;
  refreshQuickAccess(): Promise<void>;
  addQuickAccess(path: string, name?: string): Promise<void>;
  removeQuickAccess(id: string): Promise<void>;
  setDirectoryExpanded(id: string, expanded: boolean): Promise<void>;
}

let navigationHydrated = false;
let assetQueryRevision = 0;
let directoryRevealRequestId = 0;

/** 路径规范化（大小写与分隔符；Windows 不区分大小写）。 */
function normalizeDirectoryPath(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLocaleLowerCase("en-US");
}

function isDriveRootPath(value: string): boolean {
  return /^[a-z]:[\\/]*$/i.test(value.trim());
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

/**
 * 素材池查询恒为默认视图：旧库筛选 UI 已移除，store.assets 仅作为
 * BoardCanvas 的资产查找池，不再承载任何筛选语义。
 */
const DEFAULT_ASSET_SEARCH: AssetSearchInput = {
  kind: "all",
  linkState: "all",
  lifecycle: "active",
  sort: "createdAt",
  direction: "desc",
  pageSize: ASSET_PAGE_SIZE,
};

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
let initializationPromise: Promise<void> | null = null;

/**
 * 导航类状态变更（打开目录、切换标签、打开集合）不能把用户从参考图仿色
 * 踢回磁盘工作区：他往往正在为工具挑下一张素材。只有显式点「磁盘」标签
 * （showDirectoryWorkspace）才真正切走。
 */
function navigationWorkspace(
  state: Pick<AppState, "workspaceMode" | "matchSourcePath">,
): { workspaceMode: "directory" | "match"; matchSourcePath: string | null } {
  return state.workspaceMode === "match"
    ? { workspaceMode: "match", matchSourcePath: state.matchSourcePath }
    : { workspaceMode: "directory", matchSourcePath: null };
}

export const useAppStore = create<AppState>((set, get) => ({
  ...createLibraryQuerySliceState(),
  ...createDirectorySliceState(),
  ...createBoardSliceState(),
  ...createPreferencesSliceState(),
  workspaceMode: "directory",

  matchSourcePath: null,

  initialize: async () => {
    if (initializationPromise) return initializationPromise;
    const run = (async () => {
    const [
      boards,
      recentBoards,
      appInfo,
      preferences,
      quickAccess,
      roots,
      mounts,
    ] = await Promise.all([
      window.refCanvas.boards.list(),
      Promise.resolve(window.refCanvas.boards.recent?.()).then((value) => value ?? []).catch(() => []),
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
      recentBoards,
      currentLibraryRoot: appInfo.libraryPath,
      currentLibraryName: appInfo.libraryName,
      preferences,
      workspaceMode: "directory",

      matchSourcePath: null,
      browserTabs: navigationV3.tabs,
      activeTabId: navigationV3.activeTabId ?? navigationV3.tabs[0]?.id ?? "",
      navigationSource: "directory",
      directoryPath: navigation.directoryPath,
      quickAccess,
      directoryHistoryIndex: navigation.directoryHistoryIndex ?? 0,
      activeBoard,
      boardDocument: loaded?.document ?? null,
    });
    // Core workspace state is ready. Do not keep the whole renderer behind the
    // loading screen while a large library or drive root performs its first
    // page scan; those panels already expose their own loading states.
    set({ loading: false });
    await window.refCanvas.system.markRendererInteractive().catch(() => undefined);
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
    // Opening a drive root automatically starts a potentially huge recursive
    // directory index scan; wait for the user to choose it explicitly.
    const candidates = startupDirectoryCandidates({
      rememberedPath,
      mounts,
      roots,
      quickAccess,
    }).filter((candidate) => !isDriveRootPath(candidate));
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

        matchSourcePath: null,
        navigationSource: "directory",
        directoryPath: null,
      });
      updateNavigationState({
        navigationSource: "directory",
        directoryPath: null,
      });
    }
    })();
    initializationPromise = run;
    try {
      await run;
    } catch (error) {
      initializationPromise = null;
      throw error;
    }
  },

  reloadAssets: async () => {
    const revision = ++assetQueryRevision;
    assetWindow.clear();
    const page = await window.refCanvas.library.searchWindow({
      query: DEFAULT_ASSET_SEARCH,
      offset: 0,
      pageSize: ASSET_PAGE_SIZE,
      includeTotal: true,
    });
    if (revision !== assetQueryRevision) return;
    set({
      assets: assetWindow.set(0, page.items).assets,
      selectedAsset: null,
    });
  },

  selectAsset: (selectedAsset) => set({ selectedAsset }),

  locateAssetInLibrary: async (asset) => {
    const separator = Math.max(asset.path.lastIndexOf("\\"), asset.path.lastIndexOf("/"));
    if (separator < 0) throw new Error("ASSET_PATH_INVALID");
    const directory = asset.path.slice(0, separator);
    await get().openDirectory(directory);
    set({
      ...navigationWorkspace(get()),
      navigationSource: "directory",
      focusMode: false,
      activeCollectionId: null,
      selectedDirectoryEntry: null,
      directoryRevealRequest: {
        id: ++directoryRevealRequestId,
        path: asset.path,
      },
    });
  },

  completeDirectoryReveal: (id) =>
    set((state) =>
      state.directoryRevealRequest?.id === id
        ? { directoryRevealRequest: null }
        : {},
    ),

  setTags: async (assetId, tags) => {
    const updated = await window.refCanvas.library.setTags(assetId, tags);
    assetWindow.replace(updated);
    set((state) => ({
      assets: state.assets.map((asset) => asset.id === assetId ? updated : asset),
      selectedAsset: state.selectedAsset?.id === assetId ? updated : state.selectedAsset,
    }));
  },

  setPreferences: async (prefs) => {
    const preferences = await window.refCanvas.library.setPreferences(prefs);
    set({ preferences });
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
    await window.refCanvas.boards.touch?.(summary.id);
    const loaded = await window.refCanvas.boards.load(summary.id);
    set((state) => ({
      boards: [summary, ...state.boards],
      recentBoards: prependRecentBoard(state.recentBoards, summary),
      activeBoard: summary,
      boardDocument: loaded?.document ?? null,
      selectedAsset: null,
      workspaceMode: "board",
    }));
  },

  /** 重拉白板列表（项目导入后由 titlebar 调用）。 */
  refreshBoards: async () => {
    const boards = await window.refCanvas.boards.list().catch(() => []);
    set((state) => ({ boards: boards.length ? boards : state.boards }));
  },

  renameBoard: async (id, title) => {
    const summary = await window.refCanvas.boards.rename(id, title);
    set((state) => ({
      ...renamedBoardState(state.boards, state.activeBoard, summary),
      recentBoards: state.recentBoards.map((board) =>
        board.id === id ? { ...board, ...summary } : board,
      ),
    }));
  },

  deleteBoard: async (id) => {
    await window.refCanvas.boards.delete(id);
    const boards = get().boards.filter((board) => board.id !== id);
    if (get().activeBoard?.id !== id) {
      set((state) => ({
        boards,
        recentBoards: state.recentBoards.filter((board) => board.id !== id),
      }));
      return;
    }
    const loaded = boards[0]
      ? await window.refCanvas.boards.load(boards[0].id)
      : null;
    set((state) => ({
      boards,
      recentBoards: state.recentBoards.filter((board) => board.id !== id),
      activeBoard: loaded?.summary ?? null,
      boardDocument: loaded?.document ?? null,
      selectedAsset: null,
    }));
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
    set((state) => ({
      activeBoard: loaded.summary,
      boardDocument: loaded.document,
      selectedAsset: null,
      workspaceMode: "board",
      recentBoards: prependRecentBoard(state.recentBoards, loaded.summary),
    }));
  },

  addDirectoryEntriesToBoard: async (paths) => {
    const uniquePaths = [...new Set(paths)];
    if (!uniquePaths.length) return [];
    // Windows 下刚落盘的捕获文件可能被杀毒/索引服务短暂加锁（EBUSY），
    // 首次指纹读取会失败：短退避重试，最多 3 次。
    const materializeWithRetry = async (entryPath: string) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await window.refCanvas.filesystem.materialize(entryPath);
        } catch (error) {
          const code = (error as { message?: string })?.message ?? "";
          const transient = /EBUSY|EPERM/.test(code);
          if (attempt >= 2 || !transient) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
    };
    const materialized = await Promise.all(
      uniquePaths.map((entryPath) => materializeWithRetry(entryPath)),
    );
    if (!get().activeBoard) {
      const titles = new Set(get().boards.map((board) => board.title));
      let index = 1;
      let title: string;
      do {
        title = translate("workspace.boardDefault").replace("{number}", String(index).padStart(2, "0"));
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
    return addedAssets;
  },

  consumePendingBoardAssets: (ids) => {
    const consumed = new Set(ids);
    set((state) => ({
      pendingBoardAssetIds: state.pendingBoardAssetIds.filter(
        (id) => !consumed.has(id),
      ),
    }));
  },

  /**
   * 进参考图仿色工作区。
   *
   * 它是一个顶级工作区（和“磁盘/参考板”并列），不是预览里的浮层：
   * 面板要同时放画面、示波器和一整套参数，托盘里已经没有位置。
   */
  showMatchWorkspace: (sourcePath) => {
    set({
      workspaceMode: "match",
      focusMode: false,
      ...(sourcePath ? { matchSourcePath: sourcePath } : {}),
    });
  },

  showDirectoryWorkspace: () => {
    const state = get();
    set({
      workspaceMode: "directory",

      matchSourcePath: null,
      navigationSource: "directory",
      focusMode: false,
      activeCollectionId: null,
      selectedDirectoryEntry: null,
    });

    // Switching back from a board can leave the renderer with no active path
    // while a directory tab or the previous history still has a usable one.
    // Restore that path so the disk workspace does not unexpectedly render an
    // empty panel after a normal workspace switch.
    const activeTab = state.browserTabs.find((tab) => tab.id === state.activeTabId);
    const activeDirectoryTab =
      activeTab?.kind === "directory" && activeTab.targetId !== "browser://empty"
        ? activeTab
        : undefined;
    if (state.directoryPath && activeDirectoryTab) return;
    const directoryTab =
      activeDirectoryTab ??
      state.browserTabs.find(
        (tab) => tab.kind === "directory" && tab.targetId !== "browser://empty",
      );
    const historyPath = state.directoryHistory[state.directoryHistoryIndex];
    const fallbackPath = directoryTab?.targetId ?? state.directoryPath ?? historyPath;
    if (fallbackPath) void get().openDirectory(fallbackPath).catch(() => undefined);
  },

  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),

  activeCollectionId: null,
  webCaptureCollectionId: null,
  collections: [],
  collectionTree: {},
  collectionItems: {},
  browserTabs: [],
  activeTabId: "",

  openCollection: (id) => {
    set({
      ...navigationWorkspace(get()),
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

  addBrowserCaptureToCollection: async (filePath) => {
    try {
      const title = translate("collections.webCaptures");
      const collections = await window.refCanvas.collections.list();
      // 优先用上次记住的 id（用户改过集合名也不重复建）；id 失效再按名找。
      const rememberedId = get().webCaptureCollectionId;
      const existing =
        (rememberedId
          ? collections.find((collection) => collection.id === rememberedId)
          : undefined) ??
        collections.find((collection) => collection.name === title);
      const target =
        existing ??
        (await window.refCanvas.collections.create({ name: title }));
      set({ webCaptureCollectionId: target.id });
      await window.refCanvas.collections.addPaths(target.id, [filePath]);
    } catch (error) {
      console.warn("CAPTURE_COLLECTION_ARCHIVE_FAILED", error);
    }
  },

  adoptCaptures: async (paths, targetDirectory) => {
    const report = await window.refCanvas.libraries.adoptCaptures(
      paths,
      targetDirectory,
    );
    await Promise.all([get().refreshCollections(), get().reloadAssets()]);
    if (report.failed.length) {
      window.alert(
        translate("collections.adoptFailedCount")
          .replace("{count}", String(report.failed.length))
          .replace("{reason}", report.failed[0].reason),
      );
    }
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
      ...navigationWorkspace(get()),
      navigationSource: "directory",
      focusMode: false,
      activeCollectionId: null,
      directoryPath: path,
      directoryLoading: true,
      selectedAsset: null,
      selectedDirectoryEntry: null,
      directoryRevealRequest: null,
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
    if (state.activeTabId === id) {
      const active = state.browserTabs.find((tab) => tab.id === id);
      // The board workspace keeps the last browser tab selected. Clicking
      // that same directory in the sidebar must still return to disk mode.
      if (
        active?.kind === "directory" &&
        active.targetId !== "browser://empty"
      ) {
        const currentPath = get().directoryPath;
        if (
          !currentPath ||
          normalizeDirectoryPath(currentPath) !== normalizeDirectoryPath(active.targetId)
        ) {
          const restoredHistory = [
            ...active.forwardStack,
            active.targetId,
            ...active.backStack,
          ];
          await get().loadDirectoryState(
            active.targetId,
            restoredHistory.length ? restoredHistory : [active.targetId],
            active.forwardStack.length,
          );
          return;
        }
        set({
          ...navigationWorkspace(get()),
          navigationSource: "directory",
          focusMode: false,
          activeCollectionId: null,
          selectedDirectoryEntry: null,
        });
      }
      return;
    }
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
        ...navigationWorkspace(get()),
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
    const nextTabs = remaining.length > 0 ? remaining : [createBrowserTab("directory", "browser://empty", translate("browser.empty"))];
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

  reloadDirectory: async () => {
    const current = get().directoryPath;
    if (!current) return;
    const index = get().directoryHistoryIndex;
    await moveDirectoryCursor(set, current, index);
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
    const result = directoryPath
      ? await runWithDirectoryWriteAccess(directoryPath, () =>
          window.refCanvas.filesystem.trash(
            paths,
            page?.revision
              ? { directoryPath, revision: page.revision }
              : undefined,
          ),
        )
      : { completed: true, value: await window.refCanvas.filesystem.trash(paths) };
    if (!result.completed) return false;
    await get().reloadDirectory();
    return true;
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
}));

useAppStore.subscribe((state) => {
  if (!navigationHydrated) return;
  const navigation = {
    navigationSource: state.navigationSource,
    directoryPath: state.directoryPath,
  };
  const signature = JSON.stringify(navigation);
  if (signature === lastNavigationSignature) return;
  lastNavigationSignature = signature;
  updateNavigationState(navigation);
});
