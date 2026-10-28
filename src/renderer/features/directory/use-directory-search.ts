import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  DirectoryEntry,
  DirectorySearchSnapshot,
  SearchScope,
} from "../../../shared/contracts";
import { trimDirectoryPageCache } from "../../app/directory-page-cache";
import { useAppStore, type AppState } from "../../app/store";
import {
  DIRECTORY_PAGE_SIZE as directoryPageSize,
  MAXIMUM_CACHED_DIRECTORY_PAGES as maximumCachedPages,
} from "./directory-virtual-grid";

/**
 * 目录搜索状态与逻辑（自 DirectoryAssetPanel 抽出的搜索接缝）：
 * 查询词/作用域/建议列表、流式搜索进度订阅、runSearch/cancelSearch、
 * 粘贴绝对路径直接定位（locatePathInput），以及每标签查询/滚动位置持久化。
 * 搜索分页缓存（searchPages）与去重（searchPageRequestsRef）由本 hook 持有；
 * 面板继续负责搜索栏 JSX、目录分页加载与布局（currentViewportIndex）。
 */
export interface UseDirectorySearchParams {
  store: AppState;
  /** 格式筛选解析出的扩展名（同时作用于目录列表与搜索请求）。 */
  formatFilterExtensions: string[] | undefined;
  favoritesOnly: boolean;
  collapseImageSequences: boolean;
  selection: {
    clear(): void;
    selectOnly(path: string): void;
  };
  viewportRef: RefObject<HTMLDivElement | null>;
  pendingScrollTopRef: RefObject<number>;
  setLoadingMore: Dispatch<SetStateAction<boolean>>;
  /** 当前视口顶部对应的索引空间位置（面板布局计算，供分页缓存修剪）。 */
  currentViewportIndex(): number;
}

export function useDirectorySearch(params: UseDirectorySearchParams) {
  const {
    store,
    formatFilterExtensions,
    favoritesOnly,
    collapseImageSequences,
    selection,
    viewportRef,
    pendingScrollTopRef,
    setLoadingMore,
    currentViewportIndex,
  } = params;
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("current-directory");
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [searchId, setSearchId] = useState<string | null>(null);
  const activeSearchIdRef = useRef<string | null>(null);
  const [searchPages, setSearchPages] = useState<Map<number, DirectoryEntry[]>>(
    () => new Map(),
  );
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchRevision, setSearchRevision] = useState("");
  const [searchComplete, setSearchComplete] = useState(false);
  const [searchSnapshot, setSearchSnapshot] =
    useState<DirectorySearchSnapshot | null>(null);
  const searchPageRequestsRef = useRef(new Set<number>());
  const debounceRef = useRef<number | null>(null);

  // 搜索进度订阅：子目录结果流式追加。
  useEffect(() => {
    return window.refCanvas.filesystem.onSearchProgress((snapshot) => {
      setSearchSnapshot(snapshot);
      if (snapshot.id === searchId) {
        setSearchTotal(snapshot.totalFiles ?? snapshot.entries.length);
        setSearchRevision(snapshot.revision ?? "");
        setSearchComplete(snapshot.state === "completed");
        if (snapshot.state === "completed") {
          setSearchPages(new Map());
          searchPageRequestsRef.current.clear();
          void loadSearchPage(snapshot.id, 0);
        } else if (snapshot.entries.length) {
          setSearchPages((current) => {
            const next = new Map(current);
            next.set(0, snapshot.entries);
            return next;
          });
        }
      }
    });
  }, [searchId]);

  const runSearch = (
    value: string,
    favoritesFlag: boolean = favoritesOnly,
    scope: SearchScope = searchScope,
  ) => {
    selection.clear();
    if (searchId) {
      void window.refCanvas.filesystem.cancelSearch(searchId);
      setSearchId(null);
      setSearchPages(new Map());
      setSearchSnapshot(null);
    }
    if (!value.trim() || !store.directoryPath) return;
    void window.refCanvas.filesystem
      .startSearch(store.directoryPath, value.trim(), {
        ...(scope === "current-directory" ? {} : { scope }),
        collapseSequences: collapseImageSequences,
        extensions: formatFilterExtensions,
        favoritesOnly: favoritesFlag,
      })
      .then(async (id) => {
        activeSearchIdRef.current = id;
        setSearchId(id);
        const snapshot = await window.refCanvas.filesystem.getSearch(id);
        if (!snapshot) return;
        setSearchSnapshot(snapshot);
        setSearchTotal(snapshot.totalFiles ?? snapshot.entries.length);
        setSearchRevision(snapshot.revision ?? "");
        setSearchComplete(snapshot.state === "completed");
        setSearchPages(snapshot.entries.length ? new Map([[0, snapshot.entries]]) : new Map());
        void loadSearchPage(id, 0);
      });
  };

  /**
   * 查找输入支持直接定位：粘贴（或回车提交）一个绝对路径
   * （D:\work\refs 或 UNC）时打开该目录，而不是把它当作搜索关键词。
   * 粘贴的是文件路径时，打开所在目录并选中该文件（在目录首批条目中
   * 找得到才动作，避免无效路径误开目录）。
   * 路径无效（不存在）时静默放行，落回原有关键词搜索。
   */
  const locatePathInput = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!/^[A-Za-z]:[\\/]/.test(trimmed) && !/^\\\\[^\\]/.test(trimmed)) {
      return false;
    }
    // 去掉尾部分隔符；盘符根（D:\）保留一个分隔符。
    let target = trimmed.replace(/[\\/]+$/, "");
    if (/^[A-Za-z]:$/.test(target)) target += "\\";
    const pathKey = (candidate: string) =>
      candidate.replace(/\//g, "\\").replace(/\\\\+/g, "\\").toLowerCase();
    // 先用轻量 pathType 探测身份：目录直接打开；文件/不存在再按文件路径
    // 处理（探测所在目录并选中）。避免拿 listDirectory 探测文件路径而
    // 在主进程打出 ENOTDIR 错误日志。
    const resolveAsFile = () => {
      const lastSeparator = Math.max(
        target.lastIndexOf("\\"),
        target.lastIndexOf("/"),
      );
      if (lastSeparator < 0) return;
      let parent = target.slice(0, lastSeparator);
      if (/^[A-Za-z]:$/.test(parent)) parent += "\\";
      const wanted = pathKey(target);
      void window.refCanvas.filesystem
        .listDirectory(parent, { pageSize: 512 })
        .then((page) => {
          const match = page.entries.find(
            (entry) =>
              !entry.isDirectory && pathKey(entry.path) === wanted,
          );
          // 文件不在首批（超大目录）或不存在：不误开目录，落回搜索。
          if (!match) return;
          cancelSearch();
          void store.openDirectory(parent).then(() => {
            const loaded = useAppStore
              .getState()
              .directoryEntries.find(
                (entry) => pathKey(entry.path) === wanted,
              );
            const entry = loaded ?? match;
            store.selectDirectoryEntry(entry);
            selection.selectOnly(entry.path);
          });
        })
        .catch(() => undefined);
    };
    void window.refCanvas.filesystem
      .pathType(target)
      .then((kind) => {
        if (kind === "directory") {
          cancelSearch();
          void store.openDirectory(target);
          return;
        }
        resolveAsFile();
      })
      .catch(() => {
        // pathType 查询失败（权限等）视作非目录，沿用原文件探测逻辑。
        resolveAsFile();
      });
    return true;
  };

  const onQueryChange = (value: string, inputType?: string) => {
    setQuery(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (inputType === "insertFromPaste" && locatePathInput(value)) return;
    debounceRef.current = window.setTimeout(() => runSearch(value), 160);
  };

  /**
   * 回车提交。绝对路径直接定位（与粘贴同一条识别逻辑），
   * 其余情况立即执行关键词搜索，不等 debounce。
   * 必须清掉排队中的 debounce：否则回车定位后 160ms 还会冒一次搜索。
   */
  const submitQuery = (value: string) => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (locatePathInput(value)) return;
    const trimmed = value.trim();
    if (trimmed) void runSearch(trimmed);
  };

  const applySearchSuggestion = (value: string) => {
    setSearchSuggestionsOpen(false);
    onQueryChange(value);
  };

  const cancelSearch = () => {
    if (searchId) {
      void window.refCanvas.filesystem.cancelSearch(searchId);
    }
    setSearchId(null);
    activeSearchIdRef.current = null;
    setSearchPages(new Map());
    setSearchTotal(0);
    setSearchRevision("");
    setSearchComplete(false);
    setSearchSnapshot(null);
    setQuery("");
    selection.clear();
  };

  // FND-002 §5.2：每标签独立保存查询与滚动位置。
  // 切换标签/目录时从 BrowserTabState 恢复；变更时写回（滚动节流）。
  const activeTab = store.browserTabs.find((tab) => tab.id === store.activeTabId);

  useEffect(() => {
    if (!activeTab || activeTab.kind !== "directory") return;
    // A board-to-directory reveal owns the initial scroll position. Restoring
    // the tab's previous offset (including the delayed 60 ms retry) would move
    // the newly selected target back out of view.
    if (store.directoryRevealRequest) return;
    if (activeTab.query) {
      setQuery(activeTab.query);
      void window.refCanvas.filesystem
        .startSearch(store.directoryPath ?? "", activeTab.query, {
          ...(searchScope === "current-directory" ? {} : { scope: searchScope }),
          collapseSequences: collapseImageSequences,
          extensions: formatFilterExtensions,
          favoritesOnly,
        })
        .then((id) => {
          activeSearchIdRef.current = id;
          setSearchId(id);
        })
        .catch(() => undefined);
    }
    const restoreScroll = () => {
      const node = viewportRef.current;
      if (node && activeTab.scrollOffset > 0) {
        node.scrollTop = activeTab.scrollOffset;
        pendingScrollTopRef.current = activeTab.scrollOffset;
      }
    };
    restoreScroll();
    const timer = window.setTimeout(restoreScroll, 60);
    return () => window.clearTimeout(timer);
  }, [store.activeTabId, store.directoryPath]);

  useEffect(() => {
    if (!activeTab || activeTab.kind !== "directory") return;
    if (activeTab.query === query) return;
    store.updateActiveBrowserTab({ query });
  }, [query]);

  // 滚动写回：rAF 节流到标签状态（避免每次 scroll 都触发 store 更新）。
  useEffect(() => {
    if (!activeTab || activeTab.kind !== "directory") return;
    const node = viewportRef.current;
    if (!node) return;
    let frame: number | null = null;
    const write = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const top = Math.round(node.scrollTop);
        if (Math.abs(top - (activeTab.scrollOffset ?? 0)) >= 8) {
          store.updateActiveBrowserTab({ scrollOffset: top });
        }
      });
    };
    node.addEventListener("scroll", write, { passive: true });
    return () => {
      node.removeEventListener("scroll", write);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [store.activeTabId, store.directoryPath]);

  async function loadSearchPage(id: string, offset: number) {
    if (
      !window.refCanvas.filesystem.getSearchPage ||
      searchPageRequestsRef.current.has(offset)
    ) return;
    searchPageRequestsRef.current.add(offset);
    setLoadingMore(true);
    try {
      const page = await window.refCanvas.filesystem.getSearchPage(id, {
        pageSize: directoryPageSize,
        offset,
      });
      if (activeSearchIdRef.current !== id) return;
      setSearchTotal(page.totalFiles ?? page.total);
      setSearchRevision(page.revision ?? "");
      setSearchComplete(page.scanState === "complete");
      setSearchPages((current) => {
        const next = new Map(current);
        next.set(offset, page.entries);
        const currentOffset = Math.floor(
          currentViewportIndex() / directoryPageSize,
        ) * directoryPageSize;
        return trimDirectoryPageCache(next, currentOffset, maximumCachedPages);
      });
    } finally {
      searchPageRequestsRef.current.delete(offset);
      setLoadingMore(false);
    }
  }

  return {
    query,
    searchScope,
    setSearchScope,
    searchSuggestionsOpen,
    setSearchSuggestionsOpen,
    searchId,
    searchPages,
    setSearchPages,
    searchTotal,
    searchRevision,
    searchComplete,
    searchSnapshot,
    runSearch,
    onQueryChange,
    submitQuery,
    applySearchSuggestion,
    cancelSearch,
    locatePathInput,
    loadSearchPage,
  };
}
