import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Eye,
  FolderDown,
  FolderOpen,
  FolderPlus,
  Heart,
  Import,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DirectoryBatchAction,
  DirectoryBatchSnapshot,
  DirectoryEntry,
  DirectorySearchSnapshot,
} from "../../shared/contracts";
import { applySelectionClick } from "../directory-selection";
import { trimDirectoryPageCache } from "../directory-page-cache";
import { directoryBreadcrumb } from "../folder-navigation";
import { useAppStore } from "../store";
import { useDialog } from "./DialogProvider";
import { DirectoryQuickPreview } from "./DirectoryQuickPreview";
import { HighlightedText } from "./HighlightedText";
import { ImportProgressBar } from "./ImportProgressBar";

const cardWidth = 148;
const rowHeight = 160;
const gap = 12;
const directoryPageSize = 512;
const maximumCachedPages = 12;

/** 目录条目拖拽 MIME：携带 {path, isDirectory}，由 Sidebar 文件夹行消费。 */
export const DIRECTORY_ENTRY_MIME = "application/x-refcanvas-directory-entry";

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "…";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface DirectoryCardProps {
  entry: DirectoryEntry;
  selected: boolean;
  query: string;
  onEnter(): void;
  onSelect(event: React.MouseEvent): void;
  onPreview(): void;
  priority: "visible" | "overscan";
}

/** 未入库文件的预览/操作卡片（目录模式下复用虚拟网格布局）。 */
function DirectoryCard({
  entry,
  selected,
  query,
  onEnter,
  onSelect,
  onPreview,
  priority,
}: DirectoryCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setThumbnailUrl(null);
    setFailed(false);
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

  const canPreview = !entry.isDirectory && thumbnailUrl && !failed;

  return (
    <button
      className={`asset-card directory-card ${selected ? "selected" : ""}`}
      onClick={(event) => {
        if (entry.isDirectory) onEnter();
        else onSelect(event);
      }}
      onDoubleClick={() => {
        if (!entry.isDirectory) onPreview();
      }}
      draggable
      onDragStart={(event) => {
        // 文件/文件夹均可拖入侧栏文件夹：文件按需入库+加入，文件夹层级导入。
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
            src={thumbnailUrl}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : entry.isDirectory ? (
          <span className="asset-placeholder">
            <FolderOpen size={28} strokeWidth={1.35} />
            <span>文件夹</span>
          </span>
        ) : (
          <span className="asset-placeholder">
            <span>{entry.extension.toUpperCase() || "FILE"}</span>
          </span>
        )}
        {selected && !entry.isDirectory && (
          <span className="selection-badge">
            <Check size={13} />
          </span>
        )}
      </span>
      <span className="asset-title" title={entry.path}>
        <HighlightedText text={entry.name} query={query} />
      </span>
      <span className="asset-meta">
        {entry.isDirectory ? "目录" : formatSize(entry.size)}
      </span>
    </button>
  );
}

/** 目录模式素材区：虚拟网格 + 顶部目录搜索（流式/可取消）+ 导入/导航/预览。 */
export function DirectoryAssetPanel() {
  const store = useAppStore();
  const dialog = useDialog();
  const [query, setQuery] = useState("");
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
  const [importMenuOpen, setImportMenuOpen] = useState(false);
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
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());
  const [directoryRevision, setDirectoryRevision] = useState("");
  const [directoryFileTotal, setDirectoryFileTotal] = useState(0);
  const [directoryScanComplete, setDirectoryScanComplete] = useState(false);
  const [batchJob, setBatchJob] = useState<DirectoryBatchSnapshot | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  // 即时预览的当前条目路径（null = 未打开）。
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const searching = searchSnapshot?.state === "running";

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
    setAllMatchingSelected(false);
    setExcludedPaths(new Set());
    setSelectedPaths(new Set());
    pageRequestsRef.current.clear();
    if (store.directoryPath) {
      void loadDirectoryPage(0);
    }
  }, [store.directoryEntries, store.directoryPath, store.directoryTotal]);

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
        setAllMatchingSelected(false);
        setExcludedPaths(new Set());
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
    setSelectedPaths(new Set());
    setAllMatchingSelected(false);
    setExcludedPaths(new Set());
    if (searchId) {
      void window.refCanvas.filesystem.cancelSearch(searchId);
      setSearchId(null);
      setSearchPages(new Map());
      setSearchSnapshot(null);
    }
    if (!value.trim() || !store.directoryPath) return;
    void window.refCanvas.filesystem
      .startSearch(store.directoryPath, value.trim())
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
    setSelectedPaths(new Set());
  };

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
  const files = entries.filter((entry) => !entry.isDirectory);
  const selectedCount = allMatchingSelected
    ? Math.max(
        0,
        (searchId ? searchTotal : directoryFileTotal) - excludedPaths.size,
      )
    : selectedPaths.size;

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

  const columns = Math.max(
    1,
    Math.floor((viewport.width + gap) / (cardWidth + gap)),
  );
  const totalEntries = searchId ? searchTotal : directoryTotal;
  const rowCount = Math.ceil(totalEntries / columns);
  const startRow = Math.max(0, Math.floor(viewport.top / rowHeight) - 2);
  const endRow = Math.min(
    rowCount,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + 3,
  );
  const firstVisibleRow = Math.floor(viewport.top / rowHeight);
  const lastVisibleRow = Math.ceil(
    (viewport.top + viewport.height) / rowHeight,
  );
  const indexedEntries = useMemo(() => {
    const indexed = new Map<number, DirectoryEntry>();
    for (const [offset, page] of directoryPages) {
      page.forEach((entry, index) => indexed.set(offset + index, entry));
    }
    return indexed;
  }, [directoryPages]);
  const indexedSearchEntries = useMemo(() => {
    const indexed = new Map<number, DirectoryEntry>();
    for (const [offset, page] of searchPages) {
      page.forEach((entry, index) => indexed.set(offset + index, entry));
    }
    return indexed;
  }, [searchPages]);
  const activeIndexedEntries = searchId ? indexedSearchEntries : indexedEntries;
  useEffect(() => {
    indexedEntriesRef.current = activeIndexedEntries;
  }, [activeIndexedEntries]);
  const visible = useMemo(() => {
    const result: Array<{ entry: DirectoryEntry | null; absoluteIndex: number }> = [];
    const start = startRow * columns;
    const end = Math.min(totalEntries, endRow * columns);
    for (let index = start; index < end; index += 1) {
      result.push({
        entry: activeIndexedEntries.get(index) ?? null,
        absoluteIndex: index,
      });
    }
    return result;
  }, [activeIndexedEntries, columns, endRow, startRow, totalEntries]);

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

  const previewEntry =
    (previewPath && entries.find((entry) => entry.path === previewPath)) ?? null;

  const selectEntry = (entry: DirectoryEntry, event: React.MouseEvent) => {
    if (allMatchingSelected) {
      if (event.ctrlKey || event.metaKey) {
        setExcludedPaths((current) => {
          const next = new Set(current);
          if (next.has(entry.path)) next.delete(entry.path);
          else next.add(entry.path);
          return next;
        });
        return;
      }
      setAllMatchingSelected(false);
      setExcludedPaths(new Set());
      setSelectedPaths(new Set([entry.path]));
      setSelectionAnchor(entry.path);
      return;
    }
    const result = applySelectionClick(
      selectedPaths,
      files.map((item) => item.path),
      selectionAnchor,
      entry.path,
      { ctrl: event.ctrlKey, shift: event.shiftKey },
    );
    setSelectedPaths(result.selection);
    setSelectionAnchor(result.anchor);
  };

  const openPreview = (entry: DirectoryEntry) => {
    if (entry.isDirectory) return;
    setPreviewPath(entry.path);
  };

  const navigatePreview = (delta: number) => {
    if (!previewPath) return;
    const index = files.findIndex((entry) => entry.path === previewPath);
    if (index === -1) return;
    const next = files[(index + delta + files.length) % files.length];
    if (next) setPreviewPath(next.path);
  };

  const materialize = async (entry: DirectoryEntry) => {
    const result = await window.refCanvas.filesystem.materialize(entry.path, {
      storageMode: "library-default",
    });
    return result.asset;
  };

  /** 弹窗选择目标文件夹（无文件夹时先创建），取消返回 null。 */
  const pickCollection = async (): Promise<string | null> => {
    if (!store.collections.length) {
      const created = await dialog.requestForm({
        title: "还没有文件夹",
        description: "先创建一个文件夹，未入库文件会自动建立链接索引。",
        confirmLabel: "创建文件夹",
        fields: [
          {
            name: "title",
            label: "文件夹名称",
            required: true,
            maxLength: 120,
          },
        ],
        onSubmit: ({ title }) => store.createCollection(title),
      });
      if (!created) return null;
    }
    const state = useAppStore.getState();
    if (!state.collections.length) return null;
    const values = await dialog.requestForm({
      title: "添加到文件夹",
      confirmLabel: "添加",
      fields: [
        {
          name: "collection",
          label: "文件夹",
          type: "select",
          initialValue:
            state.collectionFilter &&
            state.collections.some(
              (collection) => collection.id === state.collectionFilter,
            )
              ? state.collectionFilter
              : state.collections[0].id,
          options: state.collections.map((collection) => ({
            value: collection.id,
            label: collection.title,
          })),
          required: true,
        },
      ],
    });
    if (!values) return null;
    return String(values.collection);
  };

  const addToCollection = async (entry: DirectoryEntry) => {
    const collectionId = await pickCollection();
    if (!collectionId) return;
    await window.refCanvas.filesystem.materialize(entry.path, {
      collectionIds: [collectionId],
    });
    await store.reloadAssets();
  };

  const tagEntry = async (entry: DirectoryEntry) => {
    const values = await dialog.requestForm({
      title: "设置标签",
      description: "给未入库文件打标签时会先建立链接索引。",
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
    await window.refCanvas.filesystem.materialize(entry.path, {
      tags: values.tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    await store.reloadAssets();
  };

  const trashEntry = async (entry: DirectoryEntry) => {
    const confirmed = await dialog.requestConfirm({
      title: `删除“${entry.name}”？`,
      description:
        "文件会移入 Windows 回收站。若该文件已在资料库中，记录将同步标记为断链。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.filesystem.trash([entry.path]);
    await store.reloadDirectory();
    setPreviewPath(null);
    setSelectedPaths(new Set());
  };

  const closePreview = () => setPreviewPath(null);

  // ===== 批量操作（选中文件集合） =====
  const selectedFilePaths = () =>
    files
      .map((entry) => entry.path)
      .filter((path) => selectedPaths.has(path));

  const clearSelection = () => {
    setSelectedPaths(new Set());
    setAllMatchingSelected(false);
    setExcludedPaths(new Set());
  };

  const startAllBatch = async (action: DirectoryBatchAction): Promise<boolean> => {
    if (
      !allMatchingSelected ||
      !window.refCanvas.filesystem.startBatch
    ) return false;
    const selection = searchId
      ? searchComplete && searchRevision
        ? {
            mode: "search" as const,
            searchId,
            revision: searchRevision,
            excludedPaths: [...excludedPaths],
          }
        : null
      : directoryScanComplete && directoryRevision && store.directoryPath
        ? {
            mode: "all" as const,
            directoryPath: store.directoryPath,
            revision: directoryRevision,
            excludedPaths: [...excludedPaths],
          }
        : null;
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
      const selection = searchId
        ? searchComplete && searchRevision
          ? {
              mode: "search" as const,
              searchId,
              revision: searchRevision,
              excludedPaths: [...excludedPaths],
            }
          : null
        : directoryScanComplete && directoryRevision && store.directoryPath
          ? {
              mode: "all" as const,
              directoryPath: store.directoryPath,
              revision: directoryRevision,
              excludedPaths: [...excludedPaths],
            }
          : null;
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

  const batchMaterialize = async () => {
    if (await startAllBatch({ type: "materialize" })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.materializeEntries(paths);
    clearSelection();
  };

  const batchAddToCollection = async () => {
    const collectionId = await pickCollection();
    if (!collectionId) return;
    if (await startAllBatch({ type: "addCollection", collectionId })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.materializeEntriesToCollection(paths, collectionId);
    clearSelection();
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
    clearSelection();
  };

  const batchTrash = async () => {
    const confirmed = await dialog.requestConfirm({
      title: `删除选中的 ${selectedCount} 个文件？`,
      description:
        "文件会移入 Windows 回收站。若已在资料库中，记录将同步标记为断链。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!confirmed) return;
    if (await startAllBatch({ type: "trash" })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.trashEntries(paths);
    setPreviewPath(null);
    clearSelection();
  };

  return (
    <section
      className="asset-panel"
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select")) return;
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
            setAllMatchingSelected(true);
            setExcludedPaths(new Set());
            setSelectedPaths(new Set());
          } else {
            setSelectedPaths(new Set(files.map((entry) => entry.path)));
            setSelectionAnchor(files[0]?.path ?? null);
          }
          return;
        }
        if (event.key === " " && files.length) {
          event.preventDefault();
          // 空格打开最近选中文件的即时预览。
          const anchor = selectionAnchor ?? files[0].path;
          const target = files.find((entry) => entry.path === anchor) ?? files[0];
          openPreview(target);
        }
      }}
    >
      <header className="panel-header asset-header">
        <div>
          <h2 title={store.directoryPath ?? ""}>
            {store.directoryPath ? store.directoryPath.split(/[\\/]/).pop() : "本地目录"}
          </h2>
          <span className="panel-count">
            {entries.length} / {totalEntries} 项
          </span>
        </div>
        <div className="dir-header-actions">
          <button
            className="icon-button"
            aria-label="后退"
            disabled={!canGoBack}
            onClick={() => void store.goBackDirectory()}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="前进"
            disabled={!canGoForward}
            onClick={() => void store.goForwardDirectory()}
          >
            <ArrowRight size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="刷新当前目录"
            onClick={() => void store.reloadDirectory()}
          >
            <RefreshCw size={17} />
          </button>
          <div className="dir-import-menu">
            <button
              className="icon-button"
              aria-label="导入当前目录"
              aria-expanded={importMenuOpen}
              disabled={!store.directoryPath}
              onClick={() => setImportMenuOpen((value) => !value)}
            >
              <Import size={17} />
            </button>
            {importMenuOpen && (
              <>
                <div
                  className="context-menu-dismiss"
                  onClick={() => setImportMenuOpen(false)}
                />
                <div className="dir-import-popover" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      if (store.directoryPath) {
                        void store.importDirectoryTree(store.directoryPath);
                      }
                    }}
                  >
                    <FolderDown size={16} />
                    导入当前目录（含子文件夹层级）
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      if (store.directoryPath) {
                        void store.importDirectoryTree(store.directoryPath, {
                          hierarchyMode: "flat",
                        });
                      }
                    }}
                  >
                    <Import size={16} />
                    导入全部文件（不建文件夹）
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="search-field">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索当前目录（含子目录）"
          aria-label="搜索当前目录"
        />
        {searching ? (
          <button
            className="search-cancel"
            aria-label="取消搜索"
            onClick={cancelSearch}
          >
            <X size={14} />
          </button>
        ) : (
          <kbd>含子目录</kbd>
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

      <ImportProgressBar />

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

      {selectedCount > 0 && (
        <div className="batch-toolbar">
          <span>{selectedCount} 项已选</span>
          <button
            onClick={() => void copySelectedPaths()}
            title={allMatchingSelected ? "导出 UTF-8 路径清单" : "复制选中文件路径"}
          >
            <Copy size={14} />
          </button>
          <button onClick={() => void batchMaterialize()} title="加入素材库">
            <FolderPlus size={14} />
          </button>
          <button
            onClick={() => void batchAddToCollection()}
            title="添加到文件夹"
          >
            <Heart size={14} />
          </button>
          <button onClick={() => void batchTag()} title="设置标签">
            <Tags size={14} />
          </button>
          <button
            className="danger"
            onClick={() => void batchTrash()}
            title="移入回收站"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="danger"
            onClick={clearSelection}
            title="清除选择"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="dir-path-bar">
        <button
          className="secondary-button"
          aria-label="上一级目录"
          disabled={!store.directoryPath}
          onClick={() => void store.goUpDirectory()}
        >
          <ArrowUp size={14} />
          上一级
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
      </div>

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
              return (
                <div
                  key={entry.path}
                  className="directory-card-wrap"
                  style={{
                    left: column * (cardWidth + gap),
                    top: row * rowHeight,
                    width: cardWidth,
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      entry,
                      x: Math.min(event.clientX, window.innerWidth - 236),
                      y: Math.min(event.clientY, window.innerHeight - 300),
                    });
                  }}
                >
                  <DirectoryCard
                    entry={entry}
                    selected={
                      allMatchingSelected
                        ? !excludedPaths.has(entry.path)
                        : selectedPaths.has(entry.path)
                    }
                    query={query}
                    onEnter={() => void store.openDirectory(entry.path)}
                    onSelect={(event) => selectEntry(entry, event)}
                    onPreview={() => openPreview(entry)}
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
          {loadingMore && <div className="load-more">正在加载…</div>}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <FolderOpen size={25} />
          </span>
          <h3>{query ? "没有匹配的文件" : "目录为空"}</h3>
          <p>
            {query
              ? "尝试更换关键词；子目录结果会流式追加。"
              : "浏览不会导入资料库，使用时再按需建立链接索引。"}
          </p>
        </div>
      )}

      {contextMenu && (
        <div
          className="asset-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
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
          {contextMenu.entry.isDirectory ? (
            <button
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                void store.importDirectoryTree(contextMenu.entry.path);
              }}
            >
              <FolderDown size={16} />
              导入此目录到素材库（保留子文件夹层级）
            </button>
          ) : (
            <>
              <span className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  void materialize(contextMenu.entry).then(() => {
                    void store.reloadAssets();
                    setContextMenu(null);
                  });
                }}
              >
                <FolderPlus size={16} />
                加入素材库
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  void addToCollection(contextMenu.entry);
                }}
              >
                <Heart size={16} />
                添加到文件夹
              </button>
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
          onMaterialize={(entry) => {
            void materialize(entry).then(() => {
              void store.reloadAssets();
              closePreview();
            });
          }}
          onAddToCollection={(entry) => {
            void addToCollection(entry);
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
    pageRequestsRef.current.add(offset);
    setLoadingMore(true);
    try {
      const page = await window.refCanvas.filesystem.listDirectory(
        store.directoryPath,
        { pageSize: directoryPageSize, offset },
      );
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
      setLoadingMore(false);
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
