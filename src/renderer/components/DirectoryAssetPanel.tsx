import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Eye,
  Film,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  Scissors,
  Settings2,
  Shrink,
  SquareArrowOutUpRight,
  Star,
  Tags,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  DirectoryBatchAction,
  DirectoryBatchSnapshot,
  DirectoryEntry,
  DirectorySearchSnapshot,
  FoundFormatGroupId,
  RegisteredScript,
  SequenceGroupInfo,
} from "../../shared/contracts";
import {
  assetGridNavigationTarget,
  type AssetGridNavigationKey,
} from "../app/asset-grid-navigation";
import { formatBytes } from "../app/format-bytes";
import {
  getDirectoryClipboard,
  setDirectoryClipboard,
  subscribeDirectoryClipboard,
} from "../app/directory-clipboard";
import { trimDirectoryPageCache } from "../app/directory-page-cache";
import { directoryBreadcrumb } from "../app/folder-navigation";
import {
  flattenDepthPreferencePatch,
  useFoundSettings,
} from "../app/found-settings";
import { useAppStore } from "../app/store";
import { translate } from "../app/i18n";
import { useDialog } from "./DialogProvider";
import { DirectoryQuickPreview } from "./DirectoryQuickPreview";
import { HighlightedText } from "./HighlightedText";
import {
  SequenceCard,
  SequencePreviewDialog,
} from "./SequencePreview";
import { useRetryingPreviewUrl } from "./useRetryingPreviewUrl";
import {
  calculateDirectoryVirtualWindow,
  DIRECTORY_CARD_WIDTH as cardWidth,
  DIRECTORY_GRID_GAP as gap,
  DIRECTORY_PAGE_SIZE as directoryPageSize,
  DIRECTORY_ROW_HEIGHT as rowHeight,
  indexDirectoryPages,
  MAXIMUM_CACHED_DIRECTORY_PAGES as maximumCachedPages,
  visibleDirectoryWindow,
} from "../features/directory/directory-virtual-grid";
import { useDirectorySelection } from "../features/directory/use-directory-selection";
import {
  DirectoryPreviewCoordinator,
} from "../features/directory/directory-preview-coordinator";
import { resolveDirectorySelectionScope } from "../features/directory/directory-query-model";
import { DirectoryBatchToolbar } from "./directory/DirectoryBatchToolbar";

type DirectoryFormatFilter = "all" | FoundFormatGroupId | "other";

/** 目录条目拖拽 MIME：携带 {path, isDirectory}，由 Sidebar 文件夹行消费。 */
export const DIRECTORY_ENTRY_MIME = "application/x-refcanvas-directory-entry";

/** 文件所在目录（renderer 不依赖 node:path）。 */
function dirnameOf(filename: string): string {
  const index = filename.lastIndexOf("\\");
  const alt = filename.lastIndexOf("/");
  const cut = Math.max(index, alt);
  return cut <= 0 ? filename : filename.slice(0, cut);
}

function normalizeQuickAccessPath(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

/** Stable origin-folder color used by recursive/flattened browsing. */
export function directoryGroupColor(filename: string): string {
  const directory = dirnameOf(filename).toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < directory.length; index += 1) {
    hash ^= directory.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `hsl(${Math.abs(hash) % 360} 58% 58%)`;
}

interface DirectoryCardProps {
  entry: DirectoryEntry;
  tags?: string[];
  selected: boolean;
  query: string;
  onEnter(): void;
  onSelect(event: React.MouseEvent): void;
  onPreview(): void;
  onDragOut(): void;
  /** 阶段 5：文件夹打开方式（single = 单击进入，double = 双击进入）。 */
  folderClickMode: "single" | "double";
  /** 阶段 5：flatten 视图下显示相对路径（子目录条目）。 */
  displayName?: string;
  priority: "visible" | "overscan";
}

/** 未索引文件的预览/操作卡片（目录模式下复用虚拟网格布局）。 */
function DirectoryCard({
  entry,
  tags,
  selected,
  query,
  onEnter,
  onSelect,
  onPreview,
  onDragOut,
  priority,
  folderClickMode,
  displayName,
}: DirectoryCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  useEffect(() => {
    setThumbnailUrl(null);
    if (entry.isDirectory) return;
    const request = window.refCanvas.filesystem.previewToken?.(entry.path);
    if (!request) return;
    let cancelled = false;
    void request
      .then((token) => {
        if (!cancelled) {
          setThumbnailUrl(`refbrowse://thumbnail/${token}?priority=${priority}`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.isDirectory, entry.extension, priority]);

  const preview = useRetryingPreviewUrl(thumbnailUrl);
  const canPreview = !entry.isDirectory && preview.url && preview.status !== "failed";

  return (
    <button
      className={`asset-card directory-card ${selected ? "selected" : ""}`}
      aria-busy={preview.status === "loading" || preview.status === "waiting"}
      onClick={(event) => {
        if (preview.status === "failed") preview.retry();
        if (entry.isDirectory && folderClickMode === "single") onEnter();
        else onSelect(event);
      }}
      onDoubleClick={() => {
        if (entry.isDirectory && folderClickMode === "double") onEnter();
        else if (!entry.isDirectory) onPreview();
      }}
      draggable
      onDragStart={(event) => {
        if (event.altKey && !entry.isDirectory) {
          event.preventDefault();
          onDragOut();
          return;
        }
        // 文件/文件夹均可拖入侧栏：文件建立索引引用，文件夹进入目录浏览。
        event.dataTransfer.setData(
          DIRECTORY_ENTRY_MIME,
          JSON.stringify({ path: entry.path, isDirectory: entry.isDirectory }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="asset-preview">
        {canPreview ? (
          <img
            className={preview.status === "ready" ? "" : "preview-image-pending"}
            src={preview.url!}
            alt=""
            draggable={false}
            onLoad={preview.markReady}
            onError={preview.markError}
          />
        ) : entry.isDirectory ? (
          <span className="asset-placeholder">
            <FolderOpen size={28} strokeWidth={1.35} />
            <span>文件夹</span>
          </span>
        ) : (
          <span className="asset-placeholder">
            {preview.status === "failed" ? <RefreshCw size={24} /> : null}
            <span>
              {preview.status === "failed"
                ? "点击重试预览"
                : entry.extension.toUpperCase() || "FILE"}
            </span>
          </span>
        )}
        {(preview.status === "loading" || preview.status === "waiting") && (
          <span className="preview-cache-loading" role="status">
            <RefreshCw size={15} />
            {preview.status === "waiting" ? "正在等待预览…" : "正在生成预览…"}
          </span>
        )}
        {selected && !entry.isDirectory && (
          <span className="selection-badge">
            <Check size={13} />
          </span>
        )}
        {!entry.isDirectory && (entry.favorite || (entry.rating ?? 0) > 0) && (
          <span className="directory-metadata-badges" aria-label="素材元数据">
            {entry.favorite && (
              <span title="已收藏">
                <Star size={12} fill="currentColor" />
              </span>
            )}
            {(entry.rating ?? 0) > 0 && (
              <span className="directory-rating-badge" title={`${entry.rating} 星`}>
                {entry.rating}
              </span>
            )}
          </span>
        )}
        {tags && tags.length > 0 && (
          <span className="directory-tag-badge" title={tags.join(", ")}>
            #{tags[0]}{tags.length > 1 ? ` +${tags.length - 1}` : ""}
          </span>
        )}
      </span>
      <span className="asset-title" title={entry.path}>
        <HighlightedText text={displayName ?? entry.name} query={query} />
      </span>
      <span className="asset-meta">
        {entry.isDirectory ? "目录" : formatBytes(entry.size, "…")}
      </span>
    </button>
  );
}

/** 目录模式素材区：虚拟网格 + 顶部目录搜索（流式/可取消）+ 导航/预览。 */
export function DirectoryAssetPanel() {
  const store = useAppStore();
  const foundSettings = useFoundSettings();
  const dialog = useDialog();
  // 阶段 5 §10.5：已注册脚本（右键菜单运行；信任校验在主进程）。
  const [registeredScripts, setRegisteredScripts] = useState<RegisteredScript[]>([]);
  useEffect(() => {
    let cancelled = false;
    try {
      void window.refCanvas.scripts
        .list()
        .then((scripts) => {
          if (!cancelled) setRegisteredScripts(scripts);
        })
        .catch(() => undefined);
    } catch {
      // 测试或受限环境没有 scripts API：不显示脚本菜单。
    }
    return () => {
      cancelled = true;
    };
  }, []);
  // 阶段 5 §10.1：当前目录 flatten 深度（每文件夹记忆 > 默认值）。
  const currentFlattenDepth =
    (store.directoryPath
      ? foundSettings.flattenPerFolder[store.directoryPath]
      : undefined) ?? foundSettings.defaultFlattenDepth;
  const setFlattenDepth = async (depth: number) => {
    if (!store.directoryPath) return;
    const next = await window.refCanvas.system.setPreferences({
      ...flattenDepthPreferencePatch(store.directoryPath, depth),
    });
    window.dispatchEvent(
      new CustomEvent("refcanvas:found-settings", {
        detail: next.foundSettings,
      }),
    );
  };
  const setSequenceCollapsing = async (collapseImageSequences: boolean) => {
    const next = await window.refCanvas.system.setPreferences({
      foundSettings: { collapseImageSequences },
    });
    window.dispatchEvent(
      new CustomEvent("refcanvas:found-settings", {
        detail: next.foundSettings,
      }),
    );
  };
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<DirectoryFormatFilter>("all");
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
  const [contextMenu, setContextMenu] = useState<{
    entry: DirectoryEntry;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewport, setViewport] = useState({ width: 340, height: 600, top: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const [directoryPages, setDirectoryPages] = useState<Map<number, DirectoryEntry[]>>(
    () => new Map(),
  );
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const pageRequestsRef = useRef(new Set<number>());
  const searchPageRequestsRef = useRef(new Set<number>());
  const indexedEntriesRef = useRef(new Map<number, DirectoryEntry>());
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  // 选择模型：多选（Ctrl/Shift/Ctrl+A）供批量与即时预览共用。
  const directorySelection = useDirectorySelection();
  const {
    selectedPaths,
    allMatchingSelected,
    excludedPaths,
    anchor: selectionAnchor,
  } = directorySelection.state;
  const [directoryRevision, setDirectoryRevision] = useState("");
  const [directoryFileTotal, setDirectoryFileTotal] = useState(0);
  const [directoryScanComplete, setDirectoryScanComplete] = useState(false);
  const [batchJob, setBatchJob] = useState<DirectoryBatchSnapshot | null>(null);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  const shortcutNoticeTimerRef = useRef<number | null>(null);
  const [previewCoordinator] = useState(() => new DirectoryPreviewCoordinator());
  const previewSnapshot = useSyncExternalStore(
    previewCoordinator.subscribe,
    previewCoordinator.getSnapshot,
    previewCoordinator.getSnapshot,
  );
  const previewPath = previewSnapshot.path;
  useEffect(() => () => previewCoordinator.dispose(), [previewCoordinator]);
  // 图片序列：目录级检测结果（按首帧路径索引）与预览对话框。
  const [sequenceGroups, setSequenceGroups] = useState<Map<string, SequenceGroupInfo>>(
    () => new Map(),
  );
  const [sequencePreview, setSequencePreview] =
    useState<SequenceGroupInfo | null>(null);
  const sequenceTokenCacheRef = useRef(new Map<string, string>());
  const formatFilterExtensions = useMemo(() => {
    if (formatFilter === "all") return undefined;
    if (formatFilter === "other") return foundSettings.formatWhitelist;
    return foundSettings.formatGroups.find((group) => group.id === formatFilter)?.extensions ?? [];
  }, [formatFilter, foundSettings.formatGroups, foundSettings.formatWhitelist]);

  const updateEntryTags = (paths: string[], tags: string[]) => {
    const pathSet = new Set(paths);
    const patchPages = (pages: Map<number, DirectoryEntry[]>) => {
      const next = new Map(pages);
      for (const [offset, page] of next) {
        next.set(
          offset,
          page.map((entry) =>
            pathSet.has(entry.path) ? { ...entry, tags: [...tags] } : entry,
          ),
        );
      }
      return next;
    };
    setDirectoryPages(patchPages);
    setSearchPages(patchPages);
    const selected = store.selectedDirectoryEntry;
    if (selected && pathSet.has(selected.path)) {
      store.selectDirectoryEntry({ ...selected, tags: [...tags] });
    }
  };

  const updateEntryMetadata = (
    path: string,
    metadata: { favorite: boolean; rating: number },
  ) => {
    const patchPages = (pages: Map<number, DirectoryEntry[]>) => {
      const next = new Map(pages);
      for (const [offset, page] of next) {
        next.set(
          offset,
          page.map((entry) =>
            entry.path === path ? { ...entry, ...metadata } : entry,
          ),
        );
      }
      return next;
    };
    setDirectoryPages(patchPages);
    setSearchPages(patchPages);
    const selected = store.selectedDirectoryEntry;
    if (selected?.path === path) {
      store.selectDirectoryEntry({ ...selected, ...metadata });
    }
  };

  const showShortcutNotice = (message: string) => {
    setShortcutNotice(message);
    if (shortcutNoticeTimerRef.current !== null) {
      window.clearTimeout(shortcutNoticeTimerRef.current);
    }
    shortcutNoticeTimerRef.current = window.setTimeout(() => {
      shortcutNoticeTimerRef.current = null;
      setShortcutNotice(null);
    }, 1600);
  };

  useEffect(
    () => () => {
      if (shortcutNoticeTimerRef.current !== null) {
        window.clearTimeout(shortcutNoticeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const path = previewPath ?? selectionAnchor;
    if (!path || !window.refCanvas.library?.getByPath) return;
    let cancelled = false;
    void window.refCanvas.library.getByPath(path).then((asset) => {
      if (!cancelled && asset) {
        updateEntryMetadata(path, {
          favorite: asset.favorite,
          rating: asset.rating,
        });
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [previewPath, selectionAnchor]);

  // 目录切换时重新检测序列（全目录一次，含缺帧与 FPS 推断）。
  useEffect(() => {
    setSequenceGroups(new Map());
    setSequencePreview(null);
    sequenceTokenCacheRef.current.clear();
    if (
      !foundSettings.collapseImageSequences ||
      !store.directoryPath ||
      !window.refCanvas.sequences?.detect
    ) return;
    let cancelled = false;
    void window.refCanvas.sequences
      .detect(store.directoryPath)
      .then((groups) => {
        if (cancelled) return;
        setSequenceGroups(new Map(groups.map((group) => [group.files[0], group])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [foundSettings.collapseImageSequences, store.directoryPath]);

  // 帧路径 → 所属序列；目录页已折叠为首帧条目。
  const sequenceIndex = useMemo(() => {
    const byPath = new Map<string, SequenceGroupInfo>();
    for (const group of sequenceGroups.values()) {
      group.files.forEach((file) => {
        byPath.set(file, group);
      });
    }
    return { byPath };
  }, [sequenceGroups]);
  // 剪贴板（React 可观察：订阅模块级状态以触发粘贴条渲染）。
  const [clipboardVersion, setClipboardVersion] = useState(0);

  useEffect(() => {
    return subscribeDirectoryClipboard(() => setClipboardVersion((value) => value + 1));
  }, []);

  const searching = searchSnapshot?.state === "running";

  // Dismiss the context menu on Escape as well as the click-out overlay,
  // matching AssetPanel's context menu so keyboard users can close it.
  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const gutter = 8;
    const x = Math.max(gutter, Math.min(contextMenu.x, window.innerWidth - rect.width - gutter));
    const y = Math.max(gutter, Math.min(contextMenu.y, window.innerHeight - rect.height - gutter));
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((current) => current ? { ...current, x, y } : current);
    }
  }, [contextMenu]);

  // 目录内容与搜索结果分别维护；搜索结果优先展示。
  useEffect(() => {
    setDirectoryPages(
      store.directoryEntries.length
        ? new Map([[0, store.directoryEntries]])
        : new Map(),
    );
    setDirectoryTotal(store.directoryTotal);
    setDirectoryRevision("");
    setDirectoryFileTotal(
      store.directoryEntries.filter((entry) => !entry.isDirectory).length,
    );
    setDirectoryScanComplete(false);
    directorySelection.clear();
    pageRequestsRef.current.clear();
    if (store.directoryPath) {
      void loadDirectoryPage(0);
    }
  }, [
    currentFlattenDepth,
    foundSettings.collapseImageSequences,
    foundSettings.showHiddenFiles,
    formatFilter,
    formatFilterExtensions,
    store.directoryEntries,
    store.directoryPath,
    store.directoryTotal,
  ]);

  useEffect(() => {
    return window.refCanvas.filesystem.onDirectoryProgress?.((snapshot) => {
      if (snapshot.path !== store.directoryPath) return;
      if (snapshot.discovered !== undefined) {
        setDirectoryTotal(snapshot.discovered);
      }
      if (snapshot.totalFiles !== undefined) {
        setDirectoryFileTotal(snapshot.totalFiles);
      }
      if (snapshot.revision) setDirectoryRevision(snapshot.revision);
      if (snapshot.state === "metadata" && snapshot.entries?.length) {
        const patches = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
        setDirectoryPages((current) => {
          const next = new Map(current);
          for (const [offset, page] of next) {
            let changed = false;
            const updated = page.map((entry) => {
              const patch = patches.get(entry.path);
              if (!patch) return entry;
              changed = true;
              return { ...entry, ...patch };
            });
            if (changed) next.set(offset, updated);
          }
          return next;
        });
      }
      if (snapshot.state === "reset" || snapshot.state === "invalidated") {
        setDirectoryScanComplete(snapshot.state === "reset");
        directorySelection.clear();
        const topIndex = Math.max(
          0,
          Math.floor(viewport.top / rowHeight) * Math.max(1, Math.floor(
            (viewport.width + gap) / (cardWidth + gap),
          )),
        );
        const offset = Math.floor(topIndex / directoryPageSize) * directoryPageSize;
        const anchorPath = indexedEntriesRef.current.get(topIndex)?.path ?? null;
        setDirectoryPages(new Map());
        pageRequestsRef.current.clear();
        if (
          snapshot.state === "reset" &&
          anchorPath &&
          snapshot.revision &&
          window.refCanvas.filesystem.locateEntry
        ) {
          void window.refCanvas.filesystem
            .locateEntry(store.directoryPath!, anchorPath, snapshot.revision)
            .then((index) => {
              const nextIndex = index ?? topIndex;
              const nextOffset = Math.floor(nextIndex / directoryPageSize) * directoryPageSize;
              if (viewportRef.current) {
                viewportRef.current.scrollTop = Math.floor(nextIndex / Math.max(1, Math.floor(
                  (viewport.width + gap) / (cardWidth + gap),
                ))) * rowHeight;
              }
              void loadDirectoryPage(nextOffset);
            })
            .catch(() => void loadDirectoryPage(offset));
        } else {
          void loadDirectoryPage(offset);
        }
      }
    });
  }, [store.directoryPath, viewport.top, viewport.width]);

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

  useEffect(() => {
    return window.refCanvas.filesystem.onBatchProgress?.((snapshot) => {
      if (batchJob?.id === snapshot.id) setBatchJob(snapshot);
    });
  }, [batchJob?.id]);

  const runSearch = (value: string) => {
    directorySelection.clear();
    if (searchId) {
      void window.refCanvas.filesystem.cancelSearch(searchId);
      setSearchId(null);
      setSearchPages(new Map());
      setSearchSnapshot(null);
    }
    if (!value.trim() || !store.directoryPath) return;
    void window.refCanvas.filesystem
      .startSearch(store.directoryPath, value.trim(), {
        collapseSequences: foundSettings.collapseImageSequences,
        extensions: formatFilterExtensions,
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

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(value), 160);
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
    directorySelection.clear();
  };

  // FND-002 §5.2：每标签独立保存查询与滚动位置。
  // 切换标签/目录时从 BrowserTabState 恢复；变更时写回（滚动节流）。
  const activeTab = store.browserTabs.find((tab) => tab.id === store.activeTabId);

  useEffect(() => {
    if (!activeTab || activeTab.kind !== "directory") return;
    if (activeTab.query) {
      setQuery(activeTab.query);
      void window.refCanvas.filesystem
        .startSearch(store.directoryPath ?? "", activeTab.query, {
          collapseSequences: foundSettings.collapseImageSequences,
          extensions: formatFilterExtensions,
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

  const directoryEntries = useMemo(
    () => [...directoryPages.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, page]) => page),
    [directoryPages],
  );
  const searchEntries = useMemo(
    () => [...searchPages.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, page]) => page),
    [searchPages],
  );
  const entries = searchId ? searchEntries : directoryEntries;
  const hiddenSequencePaths = useMemo(() => {
    const hidden = new Set<string>();
    if (!foundSettings.collapseImageSequences) return hidden;
    for (const group of sequenceGroups.values()) {
      group.files.slice(1).forEach((filename) => hidden.add(filename));
    }
    return hidden;
  }, [foundSettings.collapseImageSequences, sequenceGroups]);
  const collapseLoadedSequences = foundSettings.collapseImageSequences &&
    entries.some((entry) => hiddenSequencePaths.has(entry.path));
  const visibleEntries = collapseLoadedSequences
    ? entries.filter((entry) => !hiddenSequencePaths.has(entry.path))
    : entries;
  const files = visibleEntries.filter((entry) => !entry.isDirectory);
  const selectedCount = allMatchingSelected
    ? Math.max(
        0,
        (searchId ? searchTotal : directoryFileTotal) - excludedPaths.size,
      )
    : selectedPaths.size;
  const selectedVideoPaths = useMemo(
    () => files
      .filter((entry) => selectedPaths.has(entry.path) && /^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i.test(entry.extension))
      .map((entry) => entry.path),
    [files, selectedPaths],
  );

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const updateViewport = (width: number, height: number) => {
      setViewport((current) => ({
        width,
        height,
        top: node.scrollTop || current.top,
      }));
    };
    updateViewport(node.clientWidth, node.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      updateViewport(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [entries.length === 0]);

  const totalEntries = Math.max(
    0,
    (searchId ? searchTotal : directoryTotal) -
      (collapseLoadedSequences ? hiddenSequencePaths.size : 0),
  );
  const virtualWindow = calculateDirectoryVirtualWindow({
    width: viewport.width,
    height: viewport.height,
    scrollTop: viewport.top,
    total: totalEntries,
  });
  const {
    columns,
    rowCount,
    startRow,
    endRow,
    firstVisibleRow,
    lastVisibleRow,
  } = virtualWindow;
  const indexedEntries = useMemo(() => {
    return indexDirectoryPages(directoryPages);
  }, [directoryPages]);
  const indexedSearchEntries = useMemo(() => {
    return indexDirectoryPages(searchPages);
  }, [searchPages]);
  const activeIndexedEntries = useMemo(() => {
    const source = searchId ? indexedSearchEntries : indexedEntries;
    if (!collapseLoadedSequences) return source;
    const collapsed = [...source.entries()]
      .sort(([left], [right]) => left - right)
      .filter(([, entry]) => !hiddenSequencePaths.has(entry.path));
    return new Map(
      collapsed.map(([, entry], index) => [index, entry]),
    );
  }, [
    collapseLoadedSequences,
    hiddenSequencePaths,
    indexedEntries,
    indexedSearchEntries,
    searchId,
  ]);
  useEffect(() => {
    indexedEntriesRef.current = activeIndexedEntries;
  }, [activeIndexedEntries]);
  const visible = useMemo(() => {
    return visibleDirectoryWindow(activeIndexedEntries, virtualWindow);
  }, [activeIndexedEntries, virtualWindow]);

  useEffect(() => {
    if (
      !store.directoryPath ||
      !totalEntries ||
      !window.refCanvas.filesystem.listDirectory
    ) return;
    const first = Math.floor((startRow * columns) / directoryPageSize) * directoryPageSize;
    const last = Math.floor(
      Math.max(0, endRow * columns - 1) / directoryPageSize,
    ) * directoryPageSize;
    for (let offset = first; offset <= last; offset += directoryPageSize) {
      if (searchId) {
        if (!searchPages.has(offset)) void loadSearchPage(searchId, offset);
      } else if (!directoryPages.has(offset)) {
        void loadDirectoryPage(offset);
      }
    }
  }, [columns, directoryPages, endRow, searchId, searchPages, startRow, store.directoryPath, totalEntries]);

  useEffect(() => {
    if (
      !store.directoryPath ||
      !window.refCanvas.filesystem.listDirectory
    ) return;
    const prefetchRows = Math.max(1, Math.ceil(viewport.height / rowHeight) * 2);
    const start = Math.max(0, (firstVisibleRow - prefetchRows) * columns);
    const end = Math.min(totalEntries, (lastVisibleRow + prefetchRows) * columns);
    const firstPage = Math.floor(start / directoryPageSize) * directoryPageSize;
    const lastPage = Math.floor(Math.max(0, end - 1) / directoryPageSize) * directoryPageSize;
    for (let offset = firstPage; offset <= lastPage; offset += directoryPageSize) {
      if (searchId) {
        if (!searchPages.has(offset)) void loadSearchPage(searchId, offset);
      } else if (!directoryPages.has(offset)) {
        void loadDirectoryPage(offset);
      }
    }
    const paths: string[] = [];
    for (let index = start; index < end && paths.length < 256; index += 1) {
      const entry = activeIndexedEntries.get(index);
      if (entry && !entry.isDirectory) paths.push(entry.path);
    }
    if (!paths.length || !window.refCanvas.filesystem.previewTokens) return;
    const controller = new AbortController();
    void window.refCanvas.filesystem.previewTokens(paths).then((tokens) => {
      if (controller.signal.aborted) return;
      for (const item of tokens) {
        void fetch(`refbrowse://thumbnail/${item.token}?priority=prefetch`, {
          signal: controller.signal,
        }).catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [activeIndexedEntries, columns, directoryPages, firstVisibleRow, lastVisibleRow, searchId, searchPages, store.directoryPath, totalEntries, viewport.height]);

  const crumbs = directoryBreadcrumb(store.directoryPath);
  const canGoBack =
    store.directoryHistoryIndex < store.directoryHistory.length - 1;
  const canGoForward = store.directoryHistoryIndex > 0;

  useEffect(() => previewCoordinator.syncEntries(visibleEntries), [previewCoordinator, visibleEntries]);
  const previewEntry = previewSnapshot.entry;

  const selectEntry = (entry: DirectoryEntry, event: React.MouseEvent) => {
    store.selectDirectoryEntry(entry);
    directorySelection.click(
      files.map((item) => item.path),
      entry.path,
      event.ctrlKey || event.metaKey,
      event.shiftKey,
    );
  };

  const openPreview = (entry: DirectoryEntry) => {
    if (entry.isDirectory) return;
    store.selectDirectoryEntry(entry);
    previewCoordinator.open(entry);
    if (window.refCanvas.library?.getByPath) {
      void previewCoordinator.materialize((path) => window.refCanvas.library.getByPath(path));
    }
  };

  const toggleQuickAccess = async (entry: DirectoryEntry) => {
    if (!entry.isDirectory) return;
    const current = store.quickAccess.find(
      (item) => normalizeQuickAccessPath(item.path) === normalizeQuickAccessPath(entry.path),
    );
    if (current) await store.removeQuickAccess(current.id);
    else await store.addQuickAccess(entry.path, entry.name);
    setContextMenu(null);
  };

  const navigatePreview = (delta: number) => {
    const entry = previewCoordinator.adjacent(delta);
    if (entry) store.selectDirectoryEntry(entry);
  };

  const tagEntry = async (entry: DirectoryEntry) => {
    const indexed = await window.refCanvas.library.getByPath(entry.path);
    const values = await dialog.requestForm({
      title: "设置标签",
      description: "标签保存在本地索引中；留空保存可清除标签。",
      confirmLabel: "保存",
      fields: [
        {
          name: "tags",
          label: "标签（逗号分隔）",
          initialValue: indexed?.tags.join(", ") ?? "",
          maxLength: 500,
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const tags = values.tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const { asset } = await window.refCanvas.filesystem.materialize(entry.path);
    await store.setTags(asset.id, tags);
    updateEntryTags([entry.path], tags);
  };

  // 阶段 5 §10.4：Downscale naming（suffix/子目录/备份原文件三种模式）。
  const downscaleEntry = async (entry: DirectoryEntry) => {
    if (entry.isDirectory) return;
    const values = await dialog.requestForm({
      title: "Downscale",
      description: `模式：${foundSettings.downscaleMode === "suffix"
        ? `文件名追加 _${foundSettings.downscaleSuffix || "2k"}`
        : foundSettings.downscaleMode === "subdirectory"
          ? `输出到 ${foundSettings.downscaleSubdirectory || "downscaled"} 子目录`
          : "保持原名并备份原文件"}`,      confirmLabel: "开始",
      fields: [
        {
          name: "maxDimension",
          label: "最大边像素（64–16384）",
          required: true,
          maxLength: 6,
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const maxDimension = Math.max(
      64,
      Math.min(16_384, Number(values.maxDimension) || 2048),
    );
    if (foundSettings.downscaleMode === "backup") {
      // §10.4：backup 模式修改原路径，执行前展示源/备份/输出。
      const backupPath = `${entry.path.slice(0, -(entry.extension.length + 1))}.bak.${entry.extension}`;
      const confirmed = await dialog.requestConfirm({
        title: "备份并覆盖原文件？",
        description: `源：${entry.path}\n备份：${backupPath}\n输出：${entry.path}（覆盖）`,
        confirmLabel: "备份并 Downscale",
        danger: true,
      });
      if (!confirmed) return;
    }
    await window.refCanvas.media.downscale({
      paths: [entry.path],
      maxDimension,
      mode: foundSettings.downscaleMode,
    });
    await store.reloadDirectory();
  };

  // 阶段 5 §10.5：运行脚本（cwd = 条目所在目录；hash 变更由主进程拒绝）。
  const runScript = async (
    script: RegisteredScript,
    entry: DirectoryEntry,
  ) => {
    try {
      const result = await window.refCanvas.scripts.run({
        id: script.id,
        cwd: entry.isDirectory ? entry.path : dirnameOf(entry.path),
      });
      const summary = result.timedOut
        ? `${script.name}：超时终止`
        : `${script.name}：退出码 ${result.exitCode ?? "?"}（${result.durationMs}ms）`;
      await dialog.requestConfirm({
        title: summary,
        description:
          result.output.trim().slice(0, 4000) || "（无输出）",
        confirmLabel: "关闭",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "运行失败";
      if (message === "SCRIPT_HASH_CHANGED") {
        await dialog.requestConfirm({
          title: "脚本已被修改",
          description:
            "文件内容与注册时的 sha256 不一致，为安全起见已拒绝运行。请在设置中重新注册该脚本。",
          confirmLabel: "知道了",
        });
      } else {
        await dialog.requestConfirm({
          title: "脚本运行失败",
          description: message,
          confirmLabel: "关闭",
        });
      }
    }
  };

  const trashEntry = async (entry: DirectoryEntry) => {
    const confirmed = await dialog.requestConfirm({
      title: `删除“${entry.name}”？`,
      description:
        "文件会移入 Windows 回收站。若该文件已建立索引，记录将同步标记为断链。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.filesystem.trash(
      [entry.path],
      directoryScanComplete && directoryRevision && store.directoryPath
        ? {
            revision: directoryRevision,
            directoryPath: store.directoryPath,
          }
        : undefined,
    );
    await store.reloadDirectory();
    previewCoordinator.close();
    directorySelection.clear();
  };

  /** 复制/移动到目标目录（冲突先询问策略，传当前目录 revision）。 */
  const copyOrMoveEntry = async (
    entry: DirectoryEntry,
    kind: "copy" | "move",
  ) => {
    setContextMenu(null);
    const target = await window.refCanvas.system.pickDirectory({
      title: kind === "copy" ? "选择复制目标目录" : "选择移动目标目录",
      defaultPath: store.directoryPath ?? undefined,
    });
    if (!target) return;
    const conflictAction = await askConflictStrategy();
    if (!conflictAction) return;
    const revisionOptions = {
      conflictAction,
      revision: directoryRevision || undefined,
      directoryPath: store.directoryPath ?? undefined,
    };
    const report = await (kind === "copy"
      ? window.refCanvas.filesystem.copy([entry.path], target, revisionOptions)
      : window.refCanvas.filesystem.move([entry.path], target, revisionOptions));
    await store.reloadDirectory();
    const failed = report.failed[0];
    if (failed) {
      window.alert(`无法${kind === "copy" ? "复制" : "移动"}：${failed.reason}`);
    }
  };

  const closePreview = () => previewCoordinator.close();

  // ===== 批量操作（选中文件集合） =====
  const selectedFilePaths = () =>
    files
      .map((entry) => entry.path)
      .filter((path) => selectedPaths.has(path));

  const focusedFile = () => {
    const focusedPath = previewPath ?? selectionAnchor ?? store.selectedDirectoryEntry?.path;
    return files.find((entry) => entry.path === focusedPath) ?? files[0] ?? null;
  };

  const selectFileFromKeyboard = (entry: DirectoryEntry) => {
    directorySelection.selectOnly(entry.path);
    store.selectDirectoryEntry(entry);

    const absoluteIndex = visibleEntries.findIndex(
      (candidate) => candidate.path === entry.path,
    );
    const node = viewportRef.current;
    if (absoluteIndex < 0 || !node) return;
    const row = Math.floor(absoluteIndex / columns);
    const top = row * rowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + rowHeight > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.max(0, top + rowHeight - node.clientHeight);
    }
  };

  const updateFocusedMetadata = async (
    action: "favorite" | "rating",
    rating?: number,
  ) => {
    const entry = focusedFile();
    if (!entry) {
      showShortcutNotice("当前没有可操作的素材");
      return;
    }
    try {
      const { asset } = await window.refCanvas.filesystem.materialize(entry.path);
      const patch =
        action === "favorite"
          ? { favorite: !asset.favorite }
          : { rating: Math.max(0, Math.min(5, rating ?? 0)) };
      const updated = await window.refCanvas.library.update(asset.id, patch);
      updateEntryMetadata(entry.path, {
        favorite: updated.favorite,
        rating: updated.rating,
      });
      showShortcutNotice(
        action === "favorite"
          ? updated.favorite
            ? `已收藏 ${entry.name}`
            : `已取消收藏 ${entry.name}`
          : updated.rating
            ? `${entry.name} 已设为 ${updated.rating} 星`
            : `已清除 ${entry.name} 的评分`,
      );
    } catch (error) {
      showShortcutNotice(
        `操作失败：${error instanceof Error ? error.message : "无法更新素材"}`,
      );
    }
  };

  const dragOutEntry = (entry: DirectoryEntry) => {
    const paths = allMatchingSelected
      ? files
          .filter((item) => !excludedPaths.has(item.path))
          .map((item) => item.path)
      : selectedPaths.has(entry.path)
        ? selectedFilePaths()
        : [entry.path];
    window.refCanvas.filesystem.dragOut(paths.length ? paths : [entry.path]);
  };

  const clearSelection = () => {
    directorySelection.clear();
    store.selectDirectoryEntry(null);
  };

  const startAllBatch = async (action: DirectoryBatchAction): Promise<boolean> => {
    if (
      !allMatchingSelected ||
      !window.refCanvas.filesystem.startBatch
    ) return false;
    const selection = resolveDirectorySelectionScope({
      allMatchingSelected,
      searchId,
      searchComplete,
      searchRevision,
      directoryPath: store.directoryPath,
      directoryScanComplete,
      directoryRevision,
      excludedPaths,
      extensions: formatFilterExtensions,
    });
    if (!selection) return false;
    const snapshot = await window.refCanvas.filesystem.startBatch(
      selection,
      action,
    );
    setBatchJob(snapshot);
    clearSelection();
    return true;
  };

  const copySelectedPaths = async () => {
    if (allMatchingSelected) {
      const selection = resolveDirectorySelectionScope({
        allMatchingSelected,
        searchId,
        searchComplete,
        searchRevision,
        directoryPath: store.directoryPath,
        directoryScanComplete,
        directoryRevision,
        excludedPaths,
        extensions: formatFilterExtensions,
      });
      if (!selection) return;
      const snapshot = await window.refCanvas.filesystem.exportPaths(selection);
      if (snapshot) {
        setBatchJob(snapshot);
        clearSelection();
      }
      return;
    }
    void window.refCanvas.system.writeClipboard(
      selectedFilePaths().join("\n"),
    );
  };

  const batchTag = async () => {
    const values = await dialog.requestForm({
      title: "设置标签",
      description: `给选中的 ${selectedCount} 个文件打标签时会先建立链接索引。`,
      confirmLabel: "保存",
      fields: [
        {
          name: "tags",
          label: "标签（逗号分隔）",
          required: true,
          maxLength: 500,
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const tags = values.tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (await startAllBatch({ type: "tag", tags })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.materializeEntriesWithTags(
      paths,
      tags,
    );
    updateEntryTags(paths, tags);
    clearSelection();
  };

  const addSelectedToBoard = async () => {
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.addDirectoryEntriesToBoard(paths);
    clearSelection();
  };

  const batchTrash = async () => {
    const confirmed = await dialog.requestConfirm({
      title: `删除选中的 ${selectedCount} 个文件？`,
      description:
        "文件会移入 Windows 回收站。若已建立索引，记录将同步标记为断链。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!confirmed) return;
    if (await startAllBatch({ type: "trash" })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.trashEntries(paths);
    previewCoordinator.close();
    clearSelection();
  };

  /** 询问冲突处理策略（apply-to-all：一次选择应用于全部冲突）。 */
  const askConflictStrategy = async (): Promise<
    "skip" | "rename" | "replace" | null
  > => {
    const values = await dialog.requestForm({
      title: "遇到同名文件",
      description: "目标目录已有同名文件时如何处理？选择会应用到本次全部冲突。",
      confirmLabel: "继续",
      fields: [
        {
          name: "strategy",
          label: "冲突处理",
          type: "select",
          initialValue: "rename",
          options: [
            { value: "rename", label: "自动改名（保留两者）" },
            { value: "replace", label: "覆盖现有文件" },
            { value: "skip", label: "跳过现有文件" },
          ],
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return null;
    return String(values.strategy) as "skip" | "rename" | "replace";
  };

  /** 批量复制/移动到目标目录（冲突策略先询问，应用到全部）。 */
  const batchCopyMove = async (kind: "copy" | "move") => {
    const paths = selectedFilePaths();
    if (!paths.length) return;
    const target = await window.refCanvas.system.pickDirectory({
      title: kind === "copy" ? "选择复制目标目录" : "选择移动目标目录",
      defaultPath: store.directoryPath ?? undefined,
    });
    if (!target) return;
    const conflictAction = await askConflictStrategy();
    if (!conflictAction) return;
    const revisionOptions = {
      conflictAction,
      revision: directoryRevision || undefined,
      directoryPath: store.directoryPath ?? undefined,
    };
    const report = await (kind === "copy"
      ? window.refCanvas.filesystem.copy(paths, target, revisionOptions)
      : window.refCanvas.filesystem.move(paths, target, revisionOptions));
    await store.reloadDirectory();
    clearSelection();
    if (report.failed.length) {
      window.alert(
        `${kind === "copy" ? "复制" : "移动"}失败 ${report.failed.length} 项，例如：${report.failed[0].reason}`,
      );
    }
  };

  const batchCopyTo = () => batchCopyMove("copy");
  const batchMoveTo = () => batchCopyMove("move");

  /** 剪切/复制到剪贴板。 */
  const clipboardSelection = (mode: "copy" | "cut") => {
    const paths = selectedFilePaths();
    if (!paths.length) return;
    setDirectoryClipboard({
      paths,
      mode,
      sourceDirectory: store.directoryPath,
    });
  };

  /** 粘贴剪贴板内容到当前目录。 */
  const pasteClipboard = async () => {
    const clipboard = getDirectoryClipboard();
    if (!clipboard || !clipboard.paths.length || !store.directoryPath) return;
    const target = store.directoryPath;
    const conflictAction = await askConflictStrategy();
    if (!conflictAction) return;
    const revisionOptions = {
      conflictAction,
      revision: directoryRevision || undefined,
      directoryPath: store.directoryPath,
    };
    const report = await (clipboard.mode === "copy"
      ? window.refCanvas.filesystem.copy(clipboard.paths, target, revisionOptions)
      : window.refCanvas.filesystem.move(clipboard.paths, target, revisionOptions));
    if (clipboard.mode === "cut") {
      setDirectoryClipboard(null);
      if (store.directoryPath === clipboard.sourceDirectory) {
        await store.reloadDirectory();
      }
    }
    await store.reloadDirectory();
    clearSelection();
    if (report.failed.length) {
      window.alert(
        `粘贴失败 ${report.failed.length} 项，例如：${report.failed[0].reason}`,
      );
    }
  };

  const shortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(
    () => undefined,
  );
  shortcutHandlerRef.current = (event) => {
    const target =
      event.target instanceof HTMLElement ? event.target : null;
    const isEditing =
      target?.matches("input, textarea, select") || target?.isContentEditable;
    if (isEditing) return;
    if (
      target?.closest("button") &&
      !target.closest(".directory-card") &&
      !previewEntry
    ) {
      return;
    }

    if (previewEntry) {
      if (event.key === "Escape" || event.key === " ") {
        event.preventDefault();
        closePreview();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigatePreview(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigatePreview(1);
        return;
      }
    }

    if (contextMenu && event.key !== "Escape") return;
    if (event.key === "Escape") {
      if (selectedCount) clearSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      if (
        (!searchId && directoryScanComplete && directoryRevision) ||
        (searchId && searchComplete && searchRevision)
      ) {
        directorySelection.selectAllMatching();
      } else {
        directorySelection.selectLoaded(files.map((entry) => entry.path));
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    ) {
      const navigation = assetGridNavigationTarget({
        key: event.key as AssetGridNavigationKey,
        currentIndex: files.findIndex(
          (entry) =>
            entry.path ===
            (selectionAnchor ?? store.selectedDirectoryEntry?.path),
        ),
        itemCount: files.length,
        columns,
        visibleRows: Math.max(1, Math.floor(viewport.height / rowHeight)),
        canLoadMore:
          files.length < (searchId ? searchTotal : directoryFileTotal),
      });
      if (!navigation) return;
      event.preventDefault();
      const next = files[navigation.index];
      if (next) selectFileFromKeyboard(next);
      if (navigation.requestMore && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
      return;
    }
    if (event.key === " " && files.length) {
      event.preventDefault();
      if (!event.repeat) {
        const entry = focusedFile();
        if (entry) openPreview(entry);
      }
      return;
    }
    if (event.key.toLowerCase() === "f" && !event.repeat) {
      event.preventDefault();
      void updateFocusedMetadata("favorite");
      return;
    }
    if (/^[0-5]$/.test(event.key) && !event.repeat) {
      event.preventDefault();
      void updateFocusedMetadata("rating", Number(event.key));
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      shortcutHandlerRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section
      className="asset-panel"
      tabIndex={0}
    >
      {shortcutNotice && (
        <div className="directory-shortcut-notice" role="status">
          {shortcutNotice}
        </div>
      )}
      <header className="panel-header asset-header">
        <div>
          <h2 title={store.directoryPath ?? ""}>
            {store.directoryPath ? store.directoryPath.split(/[\\/]/).pop() : translate("directory.local")}
          </h2>
          <span className="panel-count">
            {translate("directory.itemCount")
              .replace("{shown}", String(entries.length))
              .replace("{total}", String(totalEntries))}
          </span>
        </div>
        <div className="dir-header-actions">
          <button
            className="icon-button"
            aria-label={translate("directory.back")}
            disabled={!canGoBack}
            onClick={() => void store.goBackDirectory()}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={translate("directory.forward")}
            disabled={!canGoForward}
            onClick={() => void store.goForwardDirectory()}
          >
            <ArrowRight size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={translate("directory.refresh")}
            onClick={() => void store.reloadDirectory()}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={translate("directory.newFolder")}
            disabled={!store.directoryPath}
            onClick={() => {
              void dialog
                .requestForm({
                  title: translate("directory.newFolder"),
                  confirmLabel: translate("directory.create"),
                  fields: [
                    {
                      name: "name",
                      label: translate("directory.folderName"),
                      required: true,
                      maxLength: 120,
                    },
                  ],
                  onSubmit: () => undefined,
                })
                .then(async (values) => {
                  if (!values || !store.directoryPath) return;
                  await window.refCanvas.filesystem.createFolder(
                    store.directoryPath,
                    String(values.name),
                    {
                      revision: directoryRevision || undefined,
                      directoryPath: store.directoryPath,
                    },
                  );
                  await store.reloadDirectory();
                });
            }}
          >
            <FolderPlus size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={translate("directory.previewSettings")}
            title={translate("directory.previewSettings")}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("refcanvas:open-settings", {
                  detail: "found",
                }),
              )
            }
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>

      <div className="search-field">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={translate("directory.searchPlaceholder")}
          aria-label={translate("directory.searchCurrent")}
        />
        {searching ? (
          <button
            className="search-cancel"
            aria-label={translate("directory.cancelSearch")}
            onClick={cancelSearch}
          >
            <X size={14} />
          </button>
        ) : (
          <kbd>{translate("directory.includeSubdirectories")}</kbd>
        )}
      </div>
      {searchSnapshot && !searching && (
        <p className="directory-search-status">
          搜索完成：{searchSnapshot.totalFiles ?? searchSnapshot.entries.length} 项
          {searchSnapshot.failedDirectories.length
            ? `，${searchSnapshot.failedDirectories.length} 个目录无法访问`
            : ""}
        </p>
      )}
      {searchSnapshot?.failedDirectories.length ? (
        <p className="directory-search-status">
          无权限目录：{searchSnapshot.failedDirectories.length} 个（已跳过）
        </p>
      ) : null}

      {batchJob?.state === "running" && (
        <div className="directory-search-status">
          正在处理 {batchJob.processed} / {batchJob.total || selectedCount}
          <button
            className="search-cancel"
            aria-label="取消批量任务"
            onClick={() => void window.refCanvas.filesystem.cancelBatch(batchJob.id)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {batchJob && batchJob.state !== "running" && (
        <div className="directory-search-status" role="status">
          {batchJob.state === "completed"
            ? `处理完成：${batchJob.processed} 项`
            : batchJob.state === "cancelled"
              ? `已取消：完成 ${batchJob.processed} 项`
              : `处理失败：${batchJob.failed.length} 项`}
        </div>
      )}

      <DirectoryBatchToolbar
        selectedCount={selectedCount}
        allMatchingSelected={allMatchingSelected}
        selectedVideoCount={selectedVideoPaths.length}
        onAddToBoard={() => void addSelectedToBoard()}
        onCopyPaths={() => void copySelectedPaths()}
        onOpenVideoGif={() => {
          const primary = files.find((item) => item.path === selectedVideoPaths[0]);
          if (primary) store.selectDirectoryEntry(primary);
          window.setTimeout(() => window.dispatchEvent(new CustomEvent("refcanvas:directory-workbench", {
            detail: { path: selectedVideoPaths[0], paths: selectedVideoPaths, tool: "gif" },
          })), 0);
        }}
        onCopyTo={() => void batchCopyTo()}
        onMoveTo={() => void batchMoveTo()}
        onClipboardCopy={() => clipboardSelection("copy")}
        onClipboardCut={() => clipboardSelection("cut")}
        onTag={() => void batchTag()}
        onTrash={() => void batchTrash()}
        onClear={clearSelection}
      />
      {(() => {
        void clipboardVersion; // 订阅剪贴板变更以触发粘贴条渲染。
        const clipboard = getDirectoryClipboard();
        if (!clipboard || !clipboard.paths.length || !store.directoryPath) {
          return null;
        }
        return (
          <div className="batch-toolbar">
            <span>
              剪贴板：{clipboard.paths.length} 项
              {clipboard.mode === "cut" ? "（剪切）" : "（复制）"}
            </span>
            <button onClick={() => void pasteClipboard()} title="粘贴到当前目录">
              <Copy size={14} />
            </button>
            <button
              className="danger"
              onClick={() => {
                setDirectoryClipboard(null);
              }}
              title="清除剪贴板"
            >
              <X size={14} />
            </button>
          </div>
        );
      })()}

      <div className="dir-path-bar">
        <button
          className="secondary-button"
          aria-label={translate("directory.up")}
          disabled={!store.directoryPath}
          onClick={() => void store.goUpDirectory()}
        >
          <ArrowUp size={14} />
          {translate("directory.up")}
        </button>
        <div className="dir-crumbs">
          {crumbs.map((crumb, index) => (
            <span className="dir-crumb" key={crumb.path}>
              {index > 0 && <span className="dir-crumb-sep">›</span>}
              <button
                className={index === crumbs.length - 1 ? "current" : ""}
                title={crumb.path}
                onClick={() => void store.openDirectory(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        <label className="dir-flatten-control">
          <span>{translate("directory.subdirectories")}</span>
          <select
            data-testid="directory-flatten-depth"
            value={currentFlattenDepth}
            onChange={(event) => void setFlattenDepth(Number(event.target.value))}
            aria-label={translate("directory.subdirectories")}
          >
            <option value={0}>{translate("directory.currentOnly")}</option>
            {[1, 2, 3, 4, 5, 6, 7].map((depth) => (
              <option key={depth} value={depth}>
                {translate("directory.includeDepth").replace("{depth}", String(depth))}
              </option>
            ))}
            <option value={8}>{translate("directory.includeAllDepths")}</option>
          </select>
        </label>
        <label className="dir-sequence-toggle">
          <input
            type="checkbox"
            checked={foundSettings.collapseImageSequences}
            onChange={(event) =>
              void setSequenceCollapsing(event.target.checked)
            }
          />
          <span>{translate("directory.mergeSequences")}</span>
        </label>
      </div>
      <div className="dir-format-filter" role="group" aria-label={translate("directory.formatFilter")}>
        <button
          type="button"
          className={formatFilter === "all" ? "active" : ""}
          aria-pressed={formatFilter === "all"}
          onClick={() => setFormatFilter("all")}
        >
          {translate("directory.all")}
        </button>
        {foundSettings.formatGroups.map((group) => (
          <button
            type="button"
            key={group.id}
            className={formatFilter === group.id ? "active" : ""}
            aria-pressed={formatFilter === group.id}
            title={translate("directory.extensionCount").replace("{count}", String(group.extensions.length))}
            onClick={() => setFormatFilter(group.id)}
          >
            {group.label}
          </button>
        ))}
        <button
          type="button"
          className={formatFilter === "other" ? "active" : ""}
          aria-pressed={formatFilter === "other"}
          title={translate("directory.extensionCount").replace("{count}", String(foundSettings.formatWhitelist.length))}
          onClick={() => setFormatFilter("other")}
        >
          OTHER
        </button>
      </div>

      {currentFlattenDepth > 0 && totalEntries > 5000 && (
        <div className="dir-flatten-warning">
          {translate("directory.flattenWarning").replace("{count}", String(totalEntries))}
        </div>
      )}

      {totalEntries ? (
        <div
          className="asset-viewport"
          ref={viewportRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            pendingScrollTopRef.current = node.scrollTop;
            if (scrollFrameRef.current === null) {
              scrollFrameRef.current = window.requestAnimationFrame(() => {
                scrollFrameRef.current = null;
                setViewport((current) => ({
                  ...current,
                  top: pendingScrollTopRef.current,
                }));
              });
            }
          }}
        >
          <div
            className="asset-virtual-grid"
            style={{ height: Math.max(rowHeight, rowCount * rowHeight) }}
          >
            {visible.map(({ entry, absoluteIndex }) => {
              const row = Math.floor(absoluteIndex / columns);
              const column = absoluteIndex % columns;
              if (!entry) {
                return (
                  <div
                    key={`directory-loading-${absoluteIndex}`}
                    className="directory-card-wrap directory-card-loading"
                    style={{
                      left: column * (cardWidth + gap),
                      top: row * rowHeight,
                      width: cardWidth,
                    }}
                  />
                );
              }
              const group = sequenceIndex.byPath.get(entry.path);
              // 序列首帧条目：渲染序列卡片。
              if (group) {
                return (
                  <div
                    key={entry.path}
                    className="directory-card-wrap"
                    style={{
                      left: column * (cardWidth + gap),
                      top: row * rowHeight,
                      width: cardWidth,
                      ...(currentFlattenDepth > 0 && (entry.depth ?? 0) > 0
                        ? { "--directory-group-color": directoryGroupColor(entry.path) }
                        : {}),
                    }}
                    data-flatten-group={currentFlattenDepth > 0 && (entry.depth ?? 0) > 0}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        entry,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    <SequenceCard
                      sequence={group}
                      tags={entry.tags}
                      selected={
                        allMatchingSelected
                          ? !excludedPaths.has(entry.path)
                          : selectedPaths.has(entry.path)
                      }
                      onSelect={(event) => selectEntry(entry, event)}
                      onPreview={() => setSequencePreview(group)}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={entry.path}
                  className="directory-card-wrap"
                  style={{
                    left: column * (cardWidth + gap),
                    top: row * rowHeight,
                    width: cardWidth,
                    ...(currentFlattenDepth > 0 && (entry.depth ?? 0) > 0
                      ? { "--directory-group-color": directoryGroupColor(entry.path) }
                      : {}),
                  }}
                  data-flatten-group={currentFlattenDepth > 0 && (entry.depth ?? 0) > 0}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      entry,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  <DirectoryCard
                    entry={entry}
                    tags={entry.tags}
                    selected={
                      allMatchingSelected
                        ? !excludedPaths.has(entry.path)
                        : selectedPaths.has(entry.path)
                    }
                    query={query}
                    onEnter={() => void store.openDirectory(entry.path)}
                    onSelect={(event) => selectEntry(entry, event)}
                    onPreview={() => openPreview(entry)}
                    onDragOut={() => dragOutEntry(entry)}
                    folderClickMode={foundSettings.folderClickMode}
                    displayName={
                      currentFlattenDepth > 0 && (entry.depth ?? 0) > 0
                        ? entry.path.slice((store.directoryPath ?? "").length + 1)
                        : undefined
                    }
                    priority={
                      row >= firstVisibleRow && row <= lastVisibleRow
                        ? "visible"
                        : "overscan"
                    }
                  />
                </div>
              );
            })}
          </div>
          {loadingMore && <div className="load-more">{translate("directory.loading")}</div>}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <FolderOpen size={25} />
          </span>
          <h3>{translate(query ? "directory.searchEmpty" : "directory.empty")}</h3>
          <p>
            {query
              ? translate("directory.searchEmptyHint")
              : translate("directory.emptyHint")}
          </p>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="asset-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.entry.isDirectory ? (
            <button
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                void store.openDirectory(contextMenu.entry.path);
              }}
            >
              <FolderOpen size={16} />
              打开目录
            </button>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  void window.refCanvas.filesystem.open(contextMenu.entry.path);
                  setContextMenu(null);
                }}
              >
                <Eye size={16} />
                打开
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void window.refCanvas.filesystem.reveal(contextMenu.entry.path);
                  setContextMenu(null);
                }}
              >
                <FolderOpen size={16} />
                在资源管理器中显示
              </button>
            </>
          )}
          <button
            role="menuitem"
            onClick={() => {
              const path = contextMenu.entry.path;
              setContextMenu(null);
              if (contextMenu.entry.isDirectory) {
                void store.openDirectoryInNewTab(path);
              } else {
                const directory = dirnameOf(path);
                void store.openDirectoryInNewTab(directory);
              }
            }}
          >
            <SquareArrowOutUpRight size={16} />
            在新标签打开
          </button>
          {contextMenu.entry.isDirectory && (
            <button
              role="menuitem"
              onClick={() => void toggleQuickAccess(contextMenu.entry)}
            >
              <Star
                size={16}
                fill={store.quickAccess.some(
                  (item) => normalizeQuickAccessPath(item.path) === normalizeQuickAccessPath(contextMenu.entry.path),
                ) ? "currentColor" : "none"}
              />
              {store.quickAccess.some(
                (item) => normalizeQuickAccessPath(item.path) === normalizeQuickAccessPath(contextMenu.entry.path),
              ) ? "取消收藏" : "收藏到快速访问"}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              void window.refCanvas.system.writeClipboard(contextMenu.entry.path);
              setContextMenu(null);
            }}
          >
            <Copy size={16} />
            复制路径
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDirectoryClipboard({
                paths: [contextMenu.entry.path],
                mode: "cut",
                sourceDirectory: store.directoryPath,
              });
              setContextMenu(null);
            }}
          >
            <Scissors size={16} />
            剪切
          </button>
          <span className="context-menu-divider" />
          <button
            role="menuitem"
            onClick={() => {
              void copyOrMoveEntry(contextMenu.entry, "copy");
            }}
          >
            <Copy size={16} />
            复制到…
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void copyOrMoveEntry(contextMenu.entry, "move");
            }}
          >
            <FolderOpen size={16} />
            移动到…
          </button>
          {!contextMenu.entry.isDirectory && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  void tagEntry(contextMenu.entry);
                }}
              >
                <Tags size={16} />
                设置标签
              </button>
              <span className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  void downscaleEntry(contextMenu.entry);
                }}
              >
                <Shrink size={16} />
                Downscale…
              </button>
              {/^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i.test(contextMenu.entry.extension) && (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const entry = contextMenu.entry;
                      setContextMenu(null);
                      store.selectDirectoryEntry(entry);
                      window.setTimeout(() => window.dispatchEvent(new CustomEvent("refcanvas:directory-workbench", {
                        detail: { path: entry.path, tool: "gif" },
                      })), 0);
                    }}
                  >
                    <Film size={16} />
                    GIF 工作台…
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const entry = contextMenu.entry;
                      setContextMenu(null);
                      store.selectDirectoryEntry(entry);
                      window.setTimeout(() => window.dispatchEvent(new CustomEvent("refcanvas:directory-workbench", {
                        detail: { path: entry.path, tool: "frames" },
                      })), 0);
                    }}
                  >
                    <Film size={16} />
                    导出 PNG/JPG 序列帧…
                  </button>
                </>
              )}
              {registeredScripts.length > 0 && (
                <>
                  <span className="context-menu-divider" />
                  <span className="context-menu-label">运行脚本</span>
                  {registeredScripts.map((script) => (
                    <button
                      role="menuitem"
                      key={script.id}
                      onClick={() => {
                        const entry = contextMenu.entry;
                        setContextMenu(null);
                        void runScript(script, entry);
                      }}
                    >
                      <TerminalSquare size={16} />
                      {script.name}
                    </button>
                  ))}
                </>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  void trashEntry(contextMenu.entry);
                }}
              >
                <Trash2 size={16} />
                移入回收站
              </button>
            </>
          )}
        </div>
      )}
      {contextMenu && (
        <div
          className="context-menu-dismiss"
          onClick={() => setContextMenu(null)}
        />
      )}

      {previewEntry && (
        <DirectoryQuickPreview
          entry={previewEntry}
          files={files}
          query={query}
          onNavigate={navigatePreview}
          onOpen={(entry) => {
            void window.refCanvas.filesystem.open(entry.path);
            closePreview();
          }}
          onReveal={(entry) => {
            void window.refCanvas.filesystem.reveal(entry.path);
          }}
          onCopyPath={(entry) => {
            void window.refCanvas.system.writeClipboard(entry.path);
          }}
          onTag={(entry) => {
            void tagEntry(entry);
          }}
          onTrash={(entry) => {
            void trashEntry(entry);
          }}
          onClose={closePreview}
        />
      )}

      {sequencePreview && (
        <SequencePreviewDialog
          sequence={sequencePreview}
          onClose={() => setSequencePreview(null)}
        />
      )}
    </section>
  );

  async function loadDirectoryPage(offset: number) {
    if (
      !store.directoryPath ||
      !window.refCanvas.filesystem.listDirectory ||
      pageRequestsRef.current.has(offset)
    ) return;
    const requestPath = store.directoryPath;
    if (!requestPath) return;
    pageRequestsRef.current.add(offset);
    setLoadingMore(true);
    try {
      // 阶段 5 §10.1：flatten 深度（每文件夹记忆优先于默认）+ 隐藏文件。
      const page = await window.refCanvas.filesystem.listDirectory(
        requestPath,
        {
          pageSize: directoryPageSize,
          offset,
          flattenDepth: currentFlattenDepth,
          showHidden: foundSettings.showHiddenFiles,
          collapseSequences: foundSettings.collapseImageSequences,
          extensions: formatFilterExtensions,
        },
      );
      if (useAppStore.getState().directoryPath !== requestPath) return;
      setDirectoryTotal(page.total);
      setDirectoryRevision(page.revision ?? "");
      setDirectoryFileTotal(
        page.totalFiles ?? page.entries.filter((entry) => !entry.isDirectory).length,
      );
      setDirectoryScanComplete(page.scanState === "complete");
      setDirectoryPages((current) => {
        const next = new Map(current);
        next.set(offset, page.entries);
        const currentOffset = Math.floor(
          (Math.floor(viewport.top / rowHeight) * columns) / directoryPageSize,
        ) * directoryPageSize;
        return trimDirectoryPageCache(
          next,
          currentOffset,
          maximumCachedPages,
          previewPath,
        );
      });
    } finally {
      pageRequestsRef.current.delete(offset);
      if (useAppStore.getState().directoryPath === requestPath) {
        setLoadingMore(false);
      }
    }
  }

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
          (Math.floor(viewport.top / rowHeight) * columns) / directoryPageSize,
        ) * directoryPageSize;
        return trimDirectoryPageCache(next, currentOffset, maximumCachedPages);
      });
    } finally {
      searchPageRequestsRef.current.delete(offset);
      setLoadingMore(false);
    }
  }
}
