import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  File,
  Film,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Scissors,
  Settings,
  Settings2,
  Shrink,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  Star,
  Tags,
  TerminalSquare,
  Trash2,
  X,
  ZoomIn,
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
import { isDownscalableImageExtension } from "../../shared/asset-kind";
import {
  isExportableImageExtension,
  isExportableVideoExtension,
  pathNameOf,
  pathStemOf,
} from "../features/directory/asset-export-formats";
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
import { FolderGlyph } from "./FolderGlyph";
import { HighlightedText } from "./HighlightedText";
import {
  SequenceCard,
} from "./SequencePreview";
import { useRetryingPreviewUrl } from "./useRetryingPreviewUrl";
import { hoverScrubTime } from "../app/hover-scrub";
import {
  calculateDirectoryVirtualWindow,
  DIRECTORY_CARD_FOOTER_HEIGHT as directoryCardFooterHeight,
  DIRECTORY_CARD_WIDTH as cardWidth,
  DIRECTORY_FOLDER_ROW_HEIGHT as folderRowHeight,
  DIRECTORY_FOLDER_ROW_WIDTH as folderRowWidth,
  DIRECTORY_GRID_GAP as gap,
  DIRECTORY_GROUP_HEADER_HEIGHT as directoryGroupHeaderHeight,
  DIRECTORY_LIST_ROW_HEIGHT as directoryListRowHeight,
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
  thumbnailOverride?: { url: string; revision: string };
}

export function directoryThumbnailSource(
  generatedUrl: string | null,
  override?: { url: string; revision: string },
): string | null {
  if (!override) return generatedUrl;
  const separator = override.url.includes("?") ? "&" : "?";
  return `${override.url}${separator}revision=${encodeURIComponent(override.revision)}`;
}

/** 未索引文件的预览/操作卡片（目录模式下复用虚拟网格布局）。 */
export function DirectoryCard({
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
  thumbnailOverride,
}: DirectoryCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [hoverScrub, setHoverScrub] = useState(false);
  const hoverVideoRef = useRef<HTMLVideoElement | null>(null);
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

  const preview = useRetryingPreviewUrl(
    directoryThumbnailSource(thumbnailUrl, thumbnailOverride),
    // .blend/.abc 由 Blender 渲染：滚动浏览时 abort 频繁、首帧生成慢，
    // 用更长重试窗口避免缩略图被快速判死「不见」。
    { dccSlowAsset: /\.(blend|abc)$/i.test(entry.extension) },
  );
  const canPreview = !entry.isDirectory && preview.url && preview.status !== "failed";
  const isVideo = /^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i.test(entry.extension);
  const hoverVideoUrl = thumbnailUrl?.replace("refbrowse://thumbnail/", "refbrowse://preview/").replace(/\?.*$/, "") ?? null;

  return (
    <button
      className={`asset-card directory-card ${selected ? "selected" : ""}`}
      aria-busy={preview.status === "loading" || preview.status === "waiting"}
      onMouseEnter={() => { if (isVideo) setHoverScrub(true); }}
      onMouseLeave={() => setHoverScrub(false)}
      onMouseMove={(event) => {
        const video = hoverVideoRef.current;
        if (!video || !Number.isFinite(video.duration)) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        video.currentTime = hoverScrubTime(event.clientX, bounds.left, bounds.width, video.duration);
      }}
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
        {hoverScrub && hoverVideoUrl && <video
          ref={hoverVideoRef}
          className="directory-hover-scrub"
          src={hoverVideoUrl}
          muted
          preload="metadata"
          playsInline
        />}
        {canPreview && (
          <img
            className={preview.status === "ready" ? "" : "preview-image-pending"}
            src={preview.url!}
            alt=""
            draggable={false}
            onLoad={preview.markReady}
            onError={preview.markError}
          />
        )}
        {entry.isDirectory ? (
          <span className="asset-placeholder">
            <FolderGlyph size={30} />
            <span>文件夹</span>
          </span>
        ) : preview.status !== "ready" && (
          <span className="asset-placeholder">
            <span>{entry.extension.toUpperCase() || "FILE"}</span>
          </span>
        )}
        {!entry.isDirectory && (
          <span className="directory-extension-badge" title={entry.path}>
            {entry.extension.toUpperCase() || "FILE"}
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

/** 文件夹区紧凑行（迅雷式多列行）：FolderGlyph + 暖黄名称，行高 40px。
 * 交互与 DirectoryRow 一致（单击/双击进入、选中、拖拽、右键菜单）。
 * 仅出现在文件夹区（索引空间 [0, folderCount) 全为目录条目）。 */
export function FolderRow({
  entry,
  selected,
  query,
  onEnter,
  onSelect,
  onPreview,
  onDragOut,
  folderClickMode,
  displayName,
}: {
  entry: DirectoryEntry;
  selected: boolean;
  query: string;
  onEnter(): void;
  onSelect(event: React.MouseEvent): void;
  onPreview(): void;
  onDragOut(): void;
  folderClickMode: "single" | "double";
  displayName?: string;
}) {
  return (
    <button
      className={`directory-folder-row ${selected ? "selected" : ""}`}
      draggable
      onClick={(event) => {
        if (entry.isDirectory && folderClickMode === "single") onEnter();
        else onSelect(event);
      }}
      onDoubleClick={() => {
        if (entry.isDirectory && folderClickMode === "double") onEnter();
        else if (!entry.isDirectory) onPreview();
      }}
      onDragStart={(event) => {
        if (event.altKey && !entry.isDirectory) {
          event.preventDefault();
          onDragOut();
          return;
        }
        event.dataTransfer.setData(
          DIRECTORY_ENTRY_MIME,
          JSON.stringify({ path: entry.path, isDirectory: entry.isDirectory }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="directory-folder-icon">
        <FolderGlyph size={16} />
      </span>
      <span className="directory-folder-name" title={entry.path}>
        <HighlightedText text={displayName ?? entry.name} query={query} />
      </span>
    </button>
  );
}

/** 目录排序键：名称 / 修改时间 / 大小。名称 = 服务端既有顺序。 */
export type DirectorySortMode = "name" | "mtime" | "size";

/**
 * 客户端稳定排序：目录优先（与服务端 sortDirectory 语义一致），
 * 再按所选键升序，名称作平局决胜。仅在整目录已加载时启用（见调用处）。
 */
export function sortDirectoryEntries(
  entries: DirectoryEntry[],
  mode: DirectorySortMode,
): DirectoryEntry[] {
  const keyOf = (entry: DirectoryEntry): number =>
    mode === "mtime" ? (entry.mtimeMs ?? 0) : (entry.size ?? 0);
  return entries.slice().sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);
    if (leftKey !== rightKey) return leftKey - rightKey;
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

interface DirectoryRowProps {
  entry: DirectoryEntry;
  selected: boolean;
  query: string;
  /** 序列首帧条目在列表视图下展示帧数。 */
  sequenceFrameCount?: number;
  onEnter(): void;
  onSelect(event: React.MouseEvent): void;
  onPreview(): void;
  onDragOut(): void;
  folderClickMode: "single" | "double";
  displayName?: string;
}

/** 列表视图行：图标 + 名称 + 元信息，复用与 DirectoryCard 相同的交互
 *（单击选中 / 双击预览 / 文件夹单击或双击进入 / 拖拽 / Alt 拖出）。 */
export function DirectoryRow({
  entry,
  selected,
  query,
  sequenceFrameCount,
  onEnter,
  onSelect,
  onPreview,
  onDragOut,
  folderClickMode,
  displayName,
}: DirectoryRowProps) {
  return (
    <button
      className={`directory-row ${selected ? "selected" : ""}`}
      draggable
      onClick={(event) => {
        if (entry.isDirectory && folderClickMode === "single") onEnter();
        else onSelect(event);
      }}
      onDoubleClick={() => {
        if (entry.isDirectory && folderClickMode === "double") onEnter();
        else if (!entry.isDirectory) onPreview();
      }}
      onDragStart={(event) => {
        if (event.altKey && !entry.isDirectory) {
          event.preventDefault();
          onDragOut();
          return;
        }
        event.dataTransfer.setData(
          DIRECTORY_ENTRY_MIME,
          JSON.stringify({ path: entry.path, isDirectory: entry.isDirectory }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="directory-row-icon">
        {entry.isDirectory ? (
          <FolderGlyph size={18} />
        ) : (
          <File size={16} />
        )}
      </span>
      <span className="directory-row-name" title={entry.path}>
        <HighlightedText text={displayName ?? entry.name} query={query} />
      </span>
      <span className="directory-row-meta">
        {entry.isDirectory
          ? "目录"
          : sequenceFrameCount
            ? `${sequenceFrameCount} 帧`
            : formatBytes(entry.size, "…")}
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
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const viewOptionsRef = useRef<HTMLDivElement>(null);
  // 参考图重设计：视图模式 / 卡片缩放 / 分组折叠 / 排序键。
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [cardScale, setCardScale] = useState(1);
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [sortMode, setSortMode] = useState<DirectorySortMode>("name");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
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
  const [thumbnailOverrides, setThumbnailOverrides] = useState<Map<string, { url: string; revision: string }>>(
    () => new Map(),
  );
  const shortcutNoticeTimerRef = useRef<number | null>(null);
  const [previewCoordinator] = useState(() => new DirectoryPreviewCoordinator());
  const previewSnapshot = useSyncExternalStore(
    previewCoordinator.subscribe,
    previewCoordinator.getSnapshot,
    previewCoordinator.getSnapshot,
  );
  const previewPath = previewSnapshot.path;
  useEffect(() => () => previewCoordinator.dispose(), [previewCoordinator]);
  useEffect(() => {
    const library = window.refCanvas.library;
    if (!library?.onLibraryChanged || !library.getByPath) return;
    return library.onLibraryChanged((event) => {
      if (event.reason !== "thumbnail") return;
      for (const path of event.paths) {
        void library.getByPath(path).then((asset) => {
          if (!asset?.customThumbnailPath) return;
          setThumbnailOverrides((current) => {
            const next = new Map(current);
            next.set(path, { url: asset.thumbnailUrl, revision: asset.updatedAt });
            return next;
          });
        }).catch(() => undefined);
      }
    });
  }, []);
  // 图片序列：目录级检测结果（按首帧路径索引）。
  const [sequenceGroups, setSequenceGroups] = useState<Map<string, SequenceGroupInfo>>(
    () => new Map(),
  );
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

  // 视图选项 popover：点击外部 / Escape / 窗口缩放或滚动时关闭，
  // 与仓库其他 popover（如图层菜单）的外部点击 dismiss 模式一致。
  useEffect(() => {
    if (!viewOptionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!viewOptionsRef.current?.contains(event.target as Node)) {
        setViewOptionsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewOptionsOpen(false);
    };
    const dismiss = () => setViewOptionsOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [viewOptionsOpen]);

  // 排序菜单：与视图选项 popover 一致的外部点击 / Escape 关闭模式。
  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) {
        setSortOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOpen]);

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
    favoritesOnly,
    store.directoryEntries,
    store.directoryPath,
    store.directoryTotal,
  ]);

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
        favoritesOnly,
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

  // 侧栏底部搜索框 → 复用本面板现有搜索管线（目录索引 worker + 分页 + 取消）。
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;
  useEffect(() => {
    const onSidebarSearch = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") onQueryChangeRef.current(detail);
    };
    window.addEventListener("refcanvas:directory-search", onSidebarSearch);
    return () =>
      window.removeEventListener("refcanvas:directory-search", onSidebarSearch);
  }, []);

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

  const toggleFavoritesOnly = () => {
    const next = !favoritesOnly;
    setFavoritesOnly(next);
    // 搜索中的结果跟随收藏过滤重新执行。
    if (query.trim() && searchId) {
      void runSearch(query);
    }
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
  const hiddenSequencePaths = useMemo(() => {
    const hidden = new Set<string>();
    if (!foundSettings.collapseImageSequences) return hidden;
    for (const group of sequenceGroups.values()) {
      group.files.slice(1).forEach((filename) => hidden.add(filename));
    }
    return hidden;
  }, [foundSettings.collapseImageSequences, sequenceGroups]);
  const loadedEntries = searchId ? searchEntries : directoryEntries;
  const collapseLoadedSequences = foundSettings.collapseImageSequences &&
    loadedEntries.some((entry) => hiddenSequencePaths.has(entry.path));
  const totalEntries = Math.max(
    0,
    (searchId ? searchTotal : directoryTotal) -
      (collapseLoadedSequences ? hiddenSequencePaths.size : 0),
  );
  // 排序：仅在整个目录/整搜索结果已加载时启用（未全量加载时保持服务端
  // 分页顺序，避免虚拟网格出现「未加载占位与已排序条目交错」）。
  const sortActive =
    sortMode !== "name" &&
    totalEntries > 0 &&
    loadedEntries.length >= totalEntries;
  const sortedDirectoryEntries = useMemo(
    () =>
      sortActive
        ? sortDirectoryEntries(directoryEntries, sortMode)
        : directoryEntries,
    [directoryEntries, sortActive, sortMode],
  );
  const sortedSearchEntries = useMemo(
    () =>
      sortActive
        ? sortDirectoryEntries(searchEntries, sortMode)
        : searchEntries,
    [searchEntries, sortActive, sortMode],
  );
  const entries = searchId ? sortedSearchEntries : sortedDirectoryEntries;
  const sequenceVisibleEntries = collapseLoadedSequences
    ? entries.filter((entry) => !hiddenSequencePaths.has(entry.path))
    : entries;
  // Format chips filter assets, not navigation. Hide folders while a format is
  // active so the result grid contains only matching media.
  // 「只看收藏」时服务端已过滤；这里补一层客户端过滤：把本地刚取消收藏的
  // 条目立即隐藏（favorite !== false 兼容服务端条目不带 favorite 字段）。
  const visibleEntries = (formatFilter === "all"
    ? sequenceVisibleEntries
    : sequenceVisibleEntries.filter((entry) => !entry.isDirectory)
  ).filter(
    (entry) => !favoritesOnly || (!entry.isDirectory && entry.favorite !== false),
  );
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

  // ===== 参考图重设计：文件夹 / 文件分区虚拟化（两区各自行高/列数） =====
  // 服务端目录优先排序 ⇒ 索引空间天然分区：文件夹区 [0, folderCount)，
  // 文件区 [folderCount, total)。两区分区各自虚拟化，分组头作为定高条
  // 插在区域之间（不参与行高换算；折叠时行区高度归零、头部保留）。
  // 文件夹区 = 紧凑多列行（迅雷式：行高 40、列数按视口宽度自适应）；
  // 文件区 = 大缩略图卡片网格（行高/列数沿用现有缩放逻辑）。
  const zoomCardWidth = Math.max(56, Math.round(cardWidth * cardScale));
  const zoomGap = Math.max(4, Math.round(gap * cardScale));
  const gridRowHeight =
    Math.max(96, Math.round((rowHeight - directoryCardFooterHeight) * cardScale)) +
    directoryCardFooterHeight;
  const effectiveRowHeight =
    viewMode === "list" ? directoryListRowHeight : gridRowHeight;
  const baseWindow = calculateDirectoryVirtualWindow({
    width: viewport.width,
    height: viewport.height,
    scrollTop: viewport.top,
    total: Math.max(1, totalEntries),
    cardWidth: zoomCardWidth,
    gap: zoomGap,
    rowHeight: effectiveRowHeight,
  });
  const columns = viewMode === "list" ? 1 : baseWindow.columns;
  // 文件夹区列数：按视口宽度自适应（列表视图退化为单列，与文件区一致）。
  const folderColumns =
    viewMode === "list"
      ? 1
      : Math.max(1, Math.floor((viewport.width + gap) / (folderRowWidth + gap)));
  const indexedEntries = useMemo(() => {
    if (sortActive) {
      return new Map(sortedDirectoryEntries.map((entry, index) => [index, entry]));
    }
    return indexDirectoryPages(directoryPages);
  }, [directoryPages, sortActive, sortedDirectoryEntries]);
  const indexedSearchEntries = useMemo(() => {
    if (sortActive) {
      return new Map(sortedSearchEntries.map((entry, index) => [index, entry]));
    }
    return indexDirectoryPages(searchPages);
  }, [searchPages, sortActive, sortedSearchEntries]);
  const activeIndexedEntries = useMemo(() => {
    const source = searchId ? indexedSearchEntries : indexedEntries;
    let entries: Map<number, DirectoryEntry>;
    if (!collapseLoadedSequences) {
      entries = source;
    } else {
      const collapsed = [...source.entries()]
        .sort(([left], [right]) => left - right)
        .filter(([, entry]) => !hiddenSequencePaths.has(entry.path));
      entries = new Map(
        collapsed.map(([, entry], index) => [index, entry]),
      );
    }
    if (!favoritesOnly) return entries;
    // 「只看收藏」：服务端已按收藏过滤；这里补过滤本地刚取消收藏的条目，
    // 并把结果标记为已收藏（星标全量展示）。
    const filtered = [...entries.entries()]
      .filter(([, entry]) => !entry.isDirectory && entry.favorite !== false)
      .map(([, entry]) => ({ ...entry, favorite: true }));
    return new Map(filtered.map((entry, index) => [index, entry]));
  }, [
    collapseLoadedSequences,
    favoritesOnly,
    hiddenSequencePaths,
    indexedEntries,
    indexedSearchEntries,
    searchId,
  ]);
  useEffect(() => {
    indexedEntriesRef.current = activeIndexedEntries;
  }, [activeIndexedEntries]);

  // 分组计数：与网格实际渲染的索引空间一致（含收藏/序列折叠过滤）。
  const gridEntries = useMemo(
    () => [...activeIndexedEntries.values()],
    [activeIndexedEntries],
  );
  const folderCount = useMemo(
    () =>
      gridEntries.reduce(
        (count, entry) => count + (entry.isDirectory ? 1 : 0),
        0,
      ),
    [gridEntries],
  );
  const fileCount = gridEntries.length - folderCount;

  const showFolderHeader = folderCount > 0;
  const folderHeaderHeight = showFolderHeader ? directoryGroupHeaderHeight : 0;
  // 文件分组头已移除（对齐迅雷：文件区直接网格，计数由状态栏提供）。
  const folderRows =
    showFolderHeader && foldersExpanded ? Math.ceil(folderCount / folderColumns) : 0;
  const fileRows = Math.ceil(fileCount / columns);
  const folderRegionHeight = folderRows * folderRowHeight;
  const fileRegionHeight = fileRows * effectiveRowHeight;
  const fileRegionTop = folderHeaderHeight + folderRegionHeight;
  const contentHeight =
    folderHeaderHeight + folderRegionHeight + fileRegionHeight;

  const folderWindow =
    folderRows > 0
      ? calculateDirectoryVirtualWindow({
          width: viewport.width,
          height: viewport.height,
          scrollTop: Math.max(0, viewport.top - folderHeaderHeight),
          total: folderCount,
          cardWidth: folderRowWidth,
          gap,
          rowHeight: folderRowHeight,
        })
      : null;
  const fileWindow =
    fileRows > 0
      ? calculateDirectoryVirtualWindow({
          width: viewport.width,
          height: viewport.height,
          scrollTop: Math.max(0, viewport.top - fileRegionTop),
          total: fileCount,
          cardWidth: zoomCardWidth,
          gap: zoomGap,
          rowHeight: effectiveRowHeight,
        })
      : null;
  const visibleFolderItems = folderWindow
    ? visibleDirectoryWindow(activeIndexedEntries, {
        startIndex: folderWindow.startIndex,
        endIndex: folderWindow.endIndex,
      })
    : [];
  const visibleFileItems = fileWindow
    ? visibleDirectoryWindow(activeIndexedEntries, {
        startIndex: folderCount + fileWindow.startIndex,
        endIndex: folderCount + fileWindow.endIndex,
      })
    : [];
  // 两个分区的可见范围并集（绝对索引），供分页加载与缩略图预取使用。
  const activeWindowRanges: Array<[number, number]> = [];
  if (folderWindow) {
    activeWindowRanges.push([folderWindow.startIndex, folderWindow.endIndex]);
  }
  if (fileWindow) {
    activeWindowRanges.push([
      folderCount + fileWindow.startIndex,
      folderCount + fileWindow.endIndex,
    ]);
  }
  const windowStartIndex = activeWindowRanges.length
    ? Math.min(...activeWindowRanges.map(([start]) => start))
    : 0;
  const windowEndIndex = activeWindowRanges.length
    ? Math.max(...activeWindowRanges.map(([, end]) => end))
    : 0;
  // 当前视口顶部对应的索引空间位置（分区感知；用于分页缓存修剪）。
  const currentViewportIndex = (): number => {
    const scrolled = viewport.top;
    if (folderRows > 0 && scrolled < folderHeaderHeight + folderRegionHeight) {
      return Math.max(
        0,
        Math.floor((scrolled - folderHeaderHeight) / folderRowHeight),
      ) * folderColumns;
    }
    return (
      folderCount +
      Math.max(
        0,
        Math.floor(Math.max(0, scrolled - fileRegionTop) / effectiveRowHeight),
      ) * columns
    );
  };

  useEffect(() => {
    if (
      !store.directoryPath ||
      !totalEntries ||
      !activeWindowRanges.length ||
      !window.refCanvas.filesystem.listDirectory
    ) return;
    const first = Math.floor(windowStartIndex / directoryPageSize) * directoryPageSize;
    const last = Math.floor(
      Math.max(0, windowEndIndex - 1) / directoryPageSize,
    ) * directoryPageSize;
    for (let offset = first; offset <= last; offset += directoryPageSize) {
      if (searchId) {
        if (!searchPages.has(offset)) void loadSearchPage(searchId, offset);
      } else if (!directoryPages.has(offset)) {
        void loadDirectoryPage(offset);
      }
    }
  }, [columns, directoryPages, folderColumns, folderRowHeight, foldersExpanded, searchId, searchPages, store.directoryPath, totalEntries, windowEndIndex, windowStartIndex]);

  useEffect(() => {
    if (
      !store.directoryPath ||
      !activeWindowRanges.length ||
      !window.refCanvas.filesystem.listDirectory
    ) return;
    const prefetchRows = Math.max(1, Math.ceil(viewport.height / effectiveRowHeight) * 2);
    const start = Math.max(0, windowStartIndex - prefetchRows * columns);
    const end = Math.min(totalEntries, windowEndIndex + prefetchRows * columns);
    const firstPage = Math.floor(start / directoryPageSize) * directoryPageSize;
    const lastPage = Math.floor(Math.max(0, end - 1) / directoryPageSize) * directoryPageSize;
    let controller: AbortController | null = null;
    // 面板拖拽时 viewport/columns 每个像素都会变：防抖 150ms，拖动期间不
    // 逐帧重建整批 prefetch，也不反复作废上一批请求（在途解码被中止后
    // 只能从头再来，大目录会一直「正在生成预览」）。
    const timer = window.setTimeout(() => {
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
      const batchController = new AbortController();
      controller = batchController;
      void window.refCanvas.filesystem.previewTokens(paths).then((tokens) => {
        if (batchController.signal.aborted) return;
        for (const item of tokens) {
          void fetch(`refbrowse://thumbnail/${item.token}?priority=prefetch`, {
            signal: batchController.signal,
          }).catch(() => undefined);
        }
      }).catch(() => undefined);
    }, 150);
    // 应用经 reload 完成目录导航；旧文档的定时器在卸载窗口内触发会从
    // 已销毁的 frame 发 IPC（主进程报 INVALID_IPC_SENDER），pagehide 时取消。
    const cancelOnPageHide = () => window.clearTimeout(timer);
    window.addEventListener("pagehide", cancelOnPageHide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", cancelOnPageHide);
      controller?.abort();
    };
  }, [activeIndexedEntries, columns, directoryPages, effectiveRowHeight, folderColumns, folderRowHeight, foldersExpanded, searchId, searchPages, store.directoryPath, totalEntries, viewport.height, windowEndIndex, windowStartIndex]);

  // 目录内容失效/重置：按分区映射恢复滚动位置（分组头偏移感知），再重载页面。
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
        const scrollToTopIndex = (scrollTop: number): number => {
          if (folderRows > 0 && scrollTop < folderHeaderHeight + folderRegionHeight) {
            return Math.max(
              0,
              Math.floor((scrollTop - folderHeaderHeight) / folderRowHeight),
            ) * folderColumns;
          }
          return (
            folderCount +
            Math.max(
              0,
              Math.floor(Math.max(0, scrollTop - fileRegionTop) / effectiveRowHeight),
            ) * columns
          );
        };
        const topIndex = Math.max(0, scrollToTopIndex(viewport.top));
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
            .locateEntry(store.directoryPath!, anchorPath, snapshot.revision, favoritesOnly)
            .then((index) => {
              const nextIndex = index ?? topIndex;
              const nextOffset = Math.floor(nextIndex / directoryPageSize) * directoryPageSize;
              if (viewportRef.current) {
                viewportRef.current.scrollTop =
                  nextIndex < folderCount
                    ? folderHeaderHeight +
                      Math.floor(nextIndex / folderColumns) * folderRowHeight
                    : fileRegionTop +
                      Math.floor((nextIndex - folderCount) / columns) * effectiveRowHeight;
              }
              void loadDirectoryPage(nextOffset);
            })
            .catch(() => void loadDirectoryPage(offset));
        } else {
          void loadDirectoryPage(offset);
        }
      }
    });
  }, [columns, effectiveRowHeight, favoritesOnly, fileRegionTop, folderColumns, folderCount, folderHeaderHeight, folderRegionHeight, folderRowHeight, folderRows, store.directoryPath, viewport.top, viewport.width]);

  const crumbs = directoryBreadcrumb(store.directoryPath);
  const canGoBack =
    store.directoryHistoryIndex < store.directoryHistory.length - 1;
  const canGoForward = store.directoryHistoryIndex > 0;

  useEffect(() => previewCoordinator.syncEntries(visibleEntries), [previewCoordinator, visibleEntries]);
  const previewEntry = previewSnapshot.entry;

  const selectEntry = (entry: DirectoryEntry, event: React.MouseEvent) => {
    const sequenceGroup = sequenceIndex.byPath.get(entry.path);
    store.selectDirectoryEntry(sequenceGroup ? { ...entry, sequenceGroup } : entry);
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

  // 右键菜单「导出 MP4」：视频走 media:exportMp4（ffmpeg 转码）；
  // 图片仅在属于已检测序列（合并序列帧）时提供，走 sequences:exportMp4。
  // 预设复用 FoundSettings 的 MP4 presets，默认选中 defaultMp4PresetId。
  const exportMp4Entry = async (entry: DirectoryEntry) => {
    if (entry.isDirectory) return;
    const sequenceGroup = sequenceIndex.byPath.get(entry.path);
    const isVideo = isExportableVideoExtension(entry.extension);
    if (!isVideo && !sequenceGroup) return;
    const enabledPresets = foundSettings.mp4Presets.filter((preset) => preset.enabled);
    const presets = enabledPresets.length
      ? enabledPresets
      : foundSettings.mp4Presets.slice(0, 1);
    if (!presets.length) {
      await dialog.requestConfirm({
        title: "无法导出 MP4",
        description: "设置中没有可用的 MP4 转换预设。",
        confirmLabel: "知道了",
      });
      return;
    }
    const defaultPresetId =
      presets.some((preset) => preset.id === foundSettings.defaultMp4PresetId)
        ? foundSettings.defaultMp4PresetId
        : presets[0].id;
    const frameCount = sequenceGroup?.files.length ?? 1;
    const fps = sequenceGroup?.fps ?? foundSettings.defaultSequenceFps;
    const baseName = sequenceGroup?.baseName ?? pathStemOf(entry.path);
    const defaultDirectory = sequenceGroup?.directory ?? dirnameOf(entry.path);
    const description = isVideo
      ? `将「${pathNameOf(entry.path)}」转码为 MP4`
      : `将图片序列「${baseName}」导出为 MP4（${frameCount} 帧 · ${fps} FPS）`;
    await dialog.requestForm({
      title: translate("directory.exportMp4"),
      description,
      confirmLabel: "导出",
      fields: [
        {
          name: "preset",
          label: "转换预设",
          type: "select",
          options: presets.map((preset) => ({
            value: preset.id,
            label: preset.label,
          })),
          initialValue: defaultPresetId,
        },
        {
          name: "outputDirectory",
          label: "输出目录",
          type: "directory",
          required: true,
          initialValue: defaultDirectory,
        },
      ],
      onSubmit: async (values) => {
        if (isVideo) {
          const result = await window.refCanvas.media.exportMp4({
            inputPath: entry.path,
            outputDirectory: values.outputDirectory,
            baseName,
            presetId: values.preset,
          });
          showShortcutNotice(`已导出 MP4：${pathNameOf(result.outputPath)}`);
        } else {
          const result = await window.refCanvas.sequences.exportMp4({
            files: sequenceGroup ? sequenceGroup.files : [entry.path],
            fps,
            presetId: values.preset,
            outputDirectory: values.outputDirectory,
            baseName,
          });
          showShortcutNotice(`已导出 MP4：${pathNameOf(result.outputPath)}`);
        }
      },
    });
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

    // 用网格索引空间定位（分组头偏移感知，两区各自行高/列数），与虚拟
    // 网格渲染位置一致。
    const gridIndex = gridEntries.findIndex(
      (candidate) => candidate.path === entry.path,
    );
    const node = viewportRef.current;
    if (gridIndex < 0 || !node) return;
    const top =
      gridIndex < folderCount
        ? folderHeaderHeight +
          Math.floor(gridIndex / folderColumns) * folderRowHeight
        : fileRegionTop +
          Math.floor((gridIndex - folderCount) / columns) * effectiveRowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + effectiveRowHeight > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.max(0, top + effectiveRowHeight - node.clientHeight);
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
      favoritesOnly,
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
    // 方向键按焦点归属路由：事件目标位于预览区域（视频/序列预览根、
    // 右侧 Found 预览面板、模态预览浮层）时，由预览自己的方向键处理
    // 接管——网格导航与面板内预览导航都让位，避免「按一下又步进又
    // 跳目录/切素材」。
    const inPreviewFocus = Boolean(
      target?.closest(
        ".video-preview, .sequence-preview-shell, .found-preview-panel, .quick-preview-backdrop",
      ),
    );
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
      if (event.key === "ArrowLeft" && !inPreviewFocus) {
        event.preventDefault();
        navigatePreview(-1);
        return;
      }
      if (event.key === "ArrowRight" && !inPreviewFocus) {
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
    // 焦点在预览区域时网格不响应方向键（预览接管；见上方 inPreviewFocus）。
    if (inPreviewFocus) return;

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
        visibleRows: Math.max(1, Math.floor(viewport.height / effectiveRowHeight)),
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

  // 右键菜单格式条件：Downscale 只在 ffmpeg 可下采样的图片格式上提供
  // （isDownscalableImageExtension，见 shared/asset-kind.ts）；GIF 工作台保留
  // 原有视频判定。两者共用分隔线，避免非图片/非视频文件出现悬空分隔线。
  const menuEntryIsDownscalableImage = isDownscalableImageExtension(
    contextMenu?.entry.extension ?? "",
  );
  const menuEntryIsVideo = /^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i.test(
    contextMenu?.entry.extension ?? "",
  );
  // GIF / 导出 MP4：视频直接提供；图片仅在属于已检测序列（合并序列帧）时
  // 提供——普通单帧图片不参与 GIF/MP4 导出。格式判定独立于 Downscale
  // （见 features/directory/asset-export-formats）。
  const menuEntryIsExportableImage = isExportableImageExtension(
    contextMenu?.entry.extension ?? "",
  );
  const menuEntryIsExportableVideo = isExportableVideoExtension(
    contextMenu?.entry.extension ?? "",
  );
  const menuEntryIsSequenceImage =
    menuEntryIsExportableImage &&
    Boolean(
      contextMenu && sequenceIndex.byPath.has(contextMenu.entry.path),
    );

  /**
   * 渲染单个网格单元（文件夹区 / 文件区共用）：loading 占位 / 序列卡 /
   * 普通卡片；列表视图渲染行式条目。topBase 为分区在滚动容器内的起始
   * 偏移（分组头 + 前序分区高度），regionStartIndex 为该分区在索引
   * 空间的起点（文件夹区 0，文件区 folderCount）。两区各自的行高/列数
   * 不同：文件夹区 = 紧凑多列行（40px），文件区 = 大缩略图卡片网格。
   */
  const renderGridCell = (
    item: { entry: DirectoryEntry | null; absoluteIndex: number },
    topBase: number,
    regionStartIndex: number,
    regionWindow: (typeof folderWindow) | null,
    regionKind: "folder" | "file",
  ) => {
    const regionIndex = item.absoluteIndex - regionStartIndex;
    const isFolderRegion = regionKind === "folder";
    const regionColumns = isFolderRegion ? folderColumns : columns;
    const regionRowHeight = isFolderRegion ? folderRowHeight : effectiveRowHeight;
    const row = Math.floor(regionIndex / regionColumns);
    const column = regionIndex % regionColumns;
    const top = topBase + row * regionRowHeight;
    const contextMenuHandler = (event: React.MouseEvent) => {
      if (!item.entry) return;
      event.preventDefault();
      setContextMenu({
        entry: item.entry,
        x: event.clientX,
        y: event.clientY,
      });
    };
    const flattenMark =
      currentFlattenDepth > 0 && (item.entry?.depth ?? 0) > 0;

    if (viewMode === "list") {
      if (!item.entry) {
        return (
          <div
            key={`directory-row-loading-${item.absoluteIndex}`}
            className="directory-row-wrap directory-row-loading"
            style={{ top }}
          />
        );
      }
      const group = sequenceIndex.byPath.get(item.entry.path);
      return (
        <div
          key={item.entry.path}
          className="directory-row-wrap"
          style={{
            top,
            ...(flattenMark
              ? { "--directory-group-color": directoryGroupColor(item.entry.path) }
              : {}),
          }}
          data-flatten-group={flattenMark}
          onContextMenu={contextMenuHandler}
        >
          <DirectoryRow
            entry={item.entry}
            selected={
              allMatchingSelected
                ? !excludedPaths.has(item.entry.path)
                : selectedPaths.has(item.entry.path)
            }
            query={query}
            sequenceFrameCount={group?.files.length}
            onEnter={() => void store.openDirectory(item.entry!.path)}
            onSelect={(event) => selectEntry(item.entry!, event)}
            onPreview={() => openPreview(item.entry!)}
            onDragOut={() => dragOutEntry(item.entry!)}
            folderClickMode={foundSettings.folderClickMode}
            displayName={
              flattenMark
                ? item.entry.path.slice((store.directoryPath ?? "").length + 1)
                : undefined
            }
          />
        </div>
      );
    }

    // 文件夹区（网格视图）：紧凑多列行，行高 40px，列宽固定。
    if (isFolderRegion) {
      if (!item.entry) {
        return (
          <div
            key={`directory-folder-loading-${item.absoluteIndex}`}
            className="directory-folder-row-wrap directory-folder-row-loading"
            style={{
              left: column * (folderRowWidth + gap),
              top,
              width: folderRowWidth,
              height: folderRowHeight,
            }}
          />
        );
      }
      return (
        <div
          key={item.entry.path}
          className="directory-folder-row-wrap"
          style={{
            left: column * (folderRowWidth + gap),
            top,
            width: folderRowWidth,
            height: folderRowHeight,
            ...(flattenMark
              ? { "--directory-group-color": directoryGroupColor(item.entry.path) }
              : {}),
          }}
          data-flatten-group={flattenMark}
          onContextMenu={contextMenuHandler}
        >
          <FolderRow
            entry={item.entry}
            selected={
              allMatchingSelected
                ? !excludedPaths.has(item.entry.path)
                : selectedPaths.has(item.entry.path)
            }
            query={query}
            onEnter={() => void store.openDirectory(item.entry!.path)}
            onSelect={(event) => selectEntry(item.entry!, event)}
            onPreview={() => openPreview(item.entry!)}
            onDragOut={() => dragOutEntry(item.entry!)}
            folderClickMode={foundSettings.folderClickMode}
            displayName={
              flattenMark
                ? item.entry.path.slice((store.directoryPath ?? "").length + 1)
                : undefined
            }
          />
        </div>
      );
    }

    if (!item.entry) {
      return (
        <div
          key={`directory-loading-${item.absoluteIndex}`}
          className="directory-card-wrap directory-card-loading"
          style={{
            left: column * (zoomCardWidth + zoomGap),
            top,
            width: zoomCardWidth,
            height: effectiveRowHeight,
          }}
        />
      );
    }
    const group = sequenceIndex.byPath.get(item.entry.path);
    const cardWrapStyle: React.CSSProperties = {
      left: column * (zoomCardWidth + zoomGap),
      top,
      width: zoomCardWidth,
      // 自定义属性经断言绕过 CSSProperties 的 excess check（与 HdrPreview 同法）。
      ...({
        "--directory-card-h": `${effectiveRowHeight}px`,
        // 大缩略图：预览区约占卡高 75%（迅雷式大卡），剩余为文件名+元信息。
        "--directory-preview-h": `${Math.max(
          60,
          Math.round(effectiveRowHeight * 0.75),
        )}px`,
      } as React.CSSProperties),
      ...(flattenMark
        ? { "--directory-group-color": directoryGroupColor(item.entry.path) }
        : {}),
    };
    const isVisibleRow =
      row >= (regionWindow?.firstVisibleRow ?? 0) &&
      row <= (regionWindow?.lastVisibleRow ?? 0);
    if (group) {
      return (
        <div
          key={item.entry.path}
          className="directory-card-wrap"
          style={cardWrapStyle}
          data-flatten-group={flattenMark}
          onContextMenu={contextMenuHandler}
        >
          <SequenceCard
            sequence={group}
            tags={item.entry.tags}
            selected={
              allMatchingSelected
                ? !excludedPaths.has(item.entry.path)
                : selectedPaths.has(item.entry.path)
            }
            onSelect={(event) => selectEntry(item.entry!, event)}
            onPreview={() => openPreview(item.entry!)}
          />
        </div>
      );
    }
    return (
      <div
        key={item.entry.path}
        className="directory-card-wrap"
        style={cardWrapStyle}
        data-flatten-group={flattenMark}
        onContextMenu={contextMenuHandler}
      >
        <DirectoryCard
          entry={item.entry}
          thumbnailOverride={thumbnailOverrides.get(item.entry.path)}
          tags={item.entry.tags}
          selected={
            allMatchingSelected
              ? !excludedPaths.has(item.entry.path)
              : selectedPaths.has(item.entry.path)
          }
          query={query}
          onEnter={() => void store.openDirectory(item.entry!.path)}
          onSelect={(event) => selectEntry(item.entry!, event)}
          onPreview={() => openPreview(item.entry!)}
          onDragOut={() => dragOutEntry(item.entry!)}
          folderClickMode={foundSettings.folderClickMode}
          displayName={
            flattenMark
              ? item.entry.path.slice((store.directoryPath ?? "").length + 1)
              : undefined
          }
          priority={isVisibleRow ? "visible" : "overscan"}
        />
      </div>
    );
  };

  return (
    <section
      className="asset-panel"
      tabIndex={0}
      onPointerDown={(event) => {
        // 点击面板空白处把键盘焦点收进目录面板：此后 ←/→ 由网格接管
        // （与预览面板的点击聚焦对称）。交互控件保持原生焦点。
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("button, input, textarea, select, a, [tabindex]")
        ) {
          return;
        }
        event.currentTarget.focus({ preventScroll: true });
      }}
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

      <div
        className="search-field directory-search"
        title={translate("directory.includeSubdirectories")}
      >
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={translate("directory.searchPlaceholderShort")}
          aria-label={translate("directory.searchCurrent")}
        />
        {searching && (
          <button
            className="search-cancel"
            aria-label={translate("directory.cancelSearch")}
            onClick={cancelSearch}
          >
            <X size={14} />
          </button>
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
        <div className="dir-path-bar-right">
          <label
            className="directory-zoom"
            title={translate("directory.zoom")}
          >
            <span className="directory-zoom-icon">
              <ZoomIn size={13} />
            </span>
            <input
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={cardScale}
              data-testid="directory-zoom-slider"
              aria-label={translate("directory.zoom")}
              onChange={(event) => setCardScale(Number(event.target.value))}
            />
          </label>
          <div className="dir-view-options" ref={viewOptionsRef}>
          <button
            type="button"
            className="icon-button"
            data-testid="directory-view-options-toggle"
            aria-label={translate("directory.viewOptions")}
            title={translate("directory.viewOptions")}
            aria-haspopup="dialog"
            aria-expanded={viewOptionsOpen}
            onClick={() => setViewOptionsOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} />
          </button>
          {viewOptionsOpen && (
            <div
              className="dir-view-options-popover"
              role="group"
              aria-label={translate("directory.viewOptions")}
            >
              <div className="dir-view-options-section">
                <span className="dir-view-options-label">
                  {translate("directory.subdirectories")}
                </span>
                <div
                  className="dir-view-options-depths"
                  role="radiogroup"
                  aria-label={translate("directory.subdirectories")}
                  data-testid="directory-flatten-depth"
                >
                  <label className="dir-view-option">
                    <input
                      type="radio"
                      name="directory-flatten-depth"
                      value={0}
                      checked={currentFlattenDepth === 0}
                      onChange={() => void setFlattenDepth(0)}
                    />
                    <span>{translate("directory.currentOnly")}</span>
                  </label>
                  {[1, 2, 3, 4, 5, 6, 7].map((depth) => (
                    <label className="dir-view-option" key={depth}>
                      <input
                        type="radio"
                        name="directory-flatten-depth"
                        value={depth}
                        checked={currentFlattenDepth === depth}
                        onChange={() => void setFlattenDepth(depth)}
                      />
                      <span>
                        {translate("directory.includeDepth").replace(
                          "{depth}",
                          String(depth),
                        )}
                      </span>
                    </label>
                  ))}
                  <label className="dir-view-option">
                    <input
                      type="radio"
                      name="directory-flatten-depth"
                      value={8}
                      checked={currentFlattenDepth === 8}
                      onChange={() => void setFlattenDepth(8)}
                    />
                    <span>{translate("directory.includeAllDepths")}</span>
                  </label>
                </div>
              </div>
              <div className="dir-view-options-divider" />
              <label className="dir-view-option">
                <input
                  type="checkbox"
                  data-testid="directory-sequence-toggle"
                  checked={foundSettings.collapseImageSequences}
                  onChange={(event) =>
                    void setSequenceCollapsing(event.target.checked)
                  }
                />
                <span>{translate("directory.mergeSequences")}</span>
              </label>
            </div>
          )}
        </div>
        </div>
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
        <button
          type="button"
          className={favoritesOnly ? "active" : ""}
          aria-pressed={favoritesOnly}
          title={translate("directory.favoritesOnly")}
          onClick={toggleFavoritesOnly}
        >
          <Star size={13} /> {translate("directory.favoritesOnly")}
        </button>
        <div className="dir-sort-control" ref={sortRef}>
          <button
            type="button"
            className="dir-sort-trigger"
            data-testid="directory-sort-toggle"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            title={translate("directory.sortBy")}
            onClick={() => setSortOpen((open) => !open)}
          >
            <ArrowUpDown size={14} />
            <span>
              {sortMode === "mtime"
                ? translate("directory.sortModified")
                : sortMode === "size"
                  ? translate("directory.sortSize")
                  : translate("directory.sortName")}
            </span>
            <ChevronDown size={12} />
          </button>
          {sortOpen && (
            <div className="dir-sort-popover" role="menu">
              {(["name", "mtime", "size"] as const).map((mode) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={sortMode === mode}
                  className={`dir-sort-option ${sortMode === mode ? "active" : ""}`}
                  key={mode}
                  data-testid={`directory-sort-${mode}`}
                  onClick={() => {
                    setSortMode(mode);
                    setSortOpen(false);
                  }}
                >
                  {mode === "mtime"
                    ? translate("directory.sortModified")
                    : mode === "size"
                      ? translate("directory.sortSize")
                      : translate("directory.sortName")}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="dir-view-mode"
          role="group"
          aria-label={translate("directory.viewMode")}
        >
          <button
            type="button"
            className={viewMode === "grid" ? "active" : ""}
            data-testid="directory-view-grid"
            aria-label={translate("directory.gridView")}
            aria-pressed={viewMode === "grid"}
            title={translate("directory.gridView")}
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            data-testid="directory-view-list"
            aria-label={translate("directory.listView")}
            aria-pressed={viewMode === "list"}
            title={translate("directory.listView")}
            onClick={() => setViewMode("list")}
          >
            <List size={15} />
          </button>
        </div>
        <button
          type="button"
          className="dir-filter-settings"
          data-testid="directory-filter-settings"
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
          <Settings size={14} />
        </button>
      </div>

      {currentFlattenDepth > 0 && totalEntries > 5000 && (
        <div className="dir-flatten-warning">
          {translate("directory.flattenWarning").replace("{count}", String(totalEntries))}
        </div>
      )}

      {folderCount + fileCount > 0 ? (
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
            style={{ height: Math.max(effectiveRowHeight, contentHeight) }}
          >
            {showFolderHeader && (
              <button
                type="button"
                className="directory-group-header"
                style={{ top: 0 }}
                data-testid="directory-folder-group-header"
                data-kind="folders"
                aria-expanded={foldersExpanded}
                title={translate("directory.folders")}
                onClick={() => setFoldersExpanded((value) => !value)}
              >
                <ChevronRight
                  size={14}
                  className={`directory-group-chevron ${foldersExpanded ? "expanded" : ""}`}
                />
                <span className="directory-group-icon">
                  <FolderGlyph size={16} />
                </span>
                <span>{translate("directory.folders")}</span>
                <span className="directory-group-count">{folderCount}</span>
              </button>
            )}
            {visibleFolderItems.map((item) =>
              renderGridCell(item, folderHeaderHeight, 0, folderWindow, "folder"),
            )}
            {visibleFileItems.map((item) =>
              renderGridCell(item, fileRegionTop, folderCount, fileWindow, "file"),
            )}
          </div>
          {loadingMore && <div className="load-more">{translate("directory.loading")}</div>}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <FolderOpen size={25} />
          </span>
          <h3>{translate(
            favoritesOnly
              ? "directory.favoritesOnlyEmpty"
              : query
                ? "directory.searchEmpty"
                : "directory.empty",
          )}</h3>
          <p>
            {favoritesOnly
              ? translate("directory.favoritesOnlyEmptyHint")
              : query
                ? translate("directory.searchEmptyHint")
                : translate("directory.emptyHint")}
          </p>
        </div>
      )}

      <footer
        className="directory-status-bar"
        data-testid="directory-status-bar"
      >
        <span>{translate("directory.filesCount").replace("{count}", String(fileCount))}</span>
        <span>{translate("directory.foldersCount").replace("{count}", String(folderCount))}</span>
      </footer>

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
              ) ? "取消收藏" : "收藏目录"}
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
              {(menuEntryIsDownscalableImage || menuEntryIsVideo || menuEntryIsSequenceImage) && (
                <span className="context-menu-divider" />
              )}
              {menuEntryIsDownscalableImage && (
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
              )}
              {(menuEntryIsExportableVideo || menuEntryIsSequenceImage) && (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const entry = contextMenu.entry;
                      setContextMenu(null);
                      // 序列图片带 sequenceGroup 选中，预览面板即以序列模式
                      // 打开 GIF 工作台；视频沿用原工作台入口。
                      const sequenceGroup = sequenceIndex.byPath.get(entry.path);
                      store.selectDirectoryEntry(sequenceGroup ? { ...entry, sequenceGroup } : entry);
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
                      void exportMp4Entry(entry);
                    }}
                  >
                    <Download size={16} />
                    {translate("directory.exportMp4")}
                  </button>
                  {menuEntryIsExportableVideo && (
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
                  )}
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
          favoritesOnly,
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
          currentViewportIndex() / directoryPageSize,
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
          currentViewportIndex() / directoryPageSize,
        ) * directoryPageSize;
        return trimDirectoryPageCache(next, currentOffset, maximumCachedPages);
      });
    } finally {
      searchPageRequestsRef.current.delete(offset);
      setLoadingMore(false);
    }
  }
}
