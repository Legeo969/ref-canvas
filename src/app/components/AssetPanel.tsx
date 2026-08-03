import {
  BookmarkPlus,
  Box,
  Check,
  ChevronRight,
  Eye,
  FileImage,
  FileText,
  Film,
  FolderMinus,
  FolderPlus,
  FolderSearch,
  FolderX,
  Headphones,
  Heart,
  Import,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  RotateCcw,
  Search,
  Shapes,
  SlidersHorizontal,
  Star,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AssetKind,
  AssetRecord,
  SimilarityIndexSnapshot,
} from "../../shared/contracts";
import {
  readNavigationState,
  updateNavigationState,
} from "../navigation-state";
import {
  assetGridNavigationTarget,
  type AssetGridNavigationKey,
} from "../asset-grid-navigation";
import { formatDuration } from "../format-duration";
import { ancestorChain, folderLabel } from "../folder-navigation";
import { useAppStore } from "../store";
import { useDialog } from "./DialogProvider";
import { DirectoryAssetPanel } from "./DirectoryAssetPanel";
import { HighlightedText } from "./HighlightedText";
import { ImportProgressBar } from "./ImportProgressBar";
import { QuickPreview } from "./QuickPreview";
import { SearchField } from "./SearchField";
import type { LibraryPreferences } from "../../shared/contracts";

const kindIcons: Record<AssetKind, typeof FileImage> = {
  image: FileImage,
  video: Film,
  audio: Headphones,
  pdf: FileText,
  model3d: Box,
  dcc: Shapes,
  font: FileText,
  generic: FileImage,
};

const cardWidth = 148;
const cardRowHeight = 160;
const detailRowHeight = 38;
const gap = 12;
const kindTitles: Record<AssetKind | "all", string> = {
  all: "全部素材",
  image: "图片",
  video: "视频",
  audio: "音频",
  pdf: "PDF",
  model3d: "3D 模型",
  dcc: "DCC 文件",
  font: "字体",
  generic: "通用文件",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateInputValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function AssetCardPreview({
  asset,
  Icon,
  priority,
}: {
  asset: AssetRecord;
  Icon: typeof FileImage;
  priority: "visible" | "overscan";
}) {
  const [failed, setFailed] = useState(false);
  const source = `${asset.thumbnailUrl}?priority=${priority}`;
  const canPreview =
    asset.lifecycle !== "purged" &&
    asset.linkState === "online" &&
    asset.kind !== "audio" &&
    !failed;
  if (canPreview) {
    return (
      <img
        src={source}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="asset-placeholder">
      <Icon size={28} strokeWidth={1.35} />
      <span>{asset.lifecycle === "purged" ? "已清除" : asset.extension.toUpperCase()}</span>
    </span>
  );
}

export function AssetPanel() {
  const store = useAppStore();
  const dialog = useDialog();
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousScopeRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const batchMenuRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 340, height: 600, top: 0 });
  const [collectionId, setCollectionId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    asset: AssetRecord;
    x: number;
    y: number;
  } | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [batchMenuPosition, setBatchMenuPosition] = useState({
    x: 8,
    y: 8,
    maxHeight: 320,
  });
  const [folderQuery, setFolderQuery] = useState("");
  const [visualIndex, setVisualIndex] = useState<SimilarityIndexSnapshot>({
    state: "idle",
    total: 0,
    processed: 0,
    indexed: 0,
    failed: 0,
  });
  const selectedCount = store.allMatchingSelected
    ? store.totalAssets - store.excludedIds.size
    : store.selectedIds.size;
  const detailMode = store.preferences.layoutMode === "detail";
  const columns = detailMode
    ? 1
    : Math.max(1, Math.floor((viewport.width + gap) / (cardWidth + gap)));
  const itemRowHeight = detailMode ? detailRowHeight : cardRowHeight;
  const rowCount = Math.ceil(store.assets.length / columns);
  const startRow = Math.max(0, Math.floor(viewport.top / itemRowHeight) - 2);
  const endRow = Math.min(
    rowCount,
    Math.ceil((viewport.top + viewport.height) / itemRowHeight) + 3,
  );
  const visibleAssets = useMemo(
    () =>
      store.assets.slice(startRow * columns, Math.min(store.assets.length, endRow * columns)),
    [store.assets, startRow, endRow, columns],
  );
  const firstVisibleRow = Math.floor(viewport.top / itemRowHeight);
  const lastVisibleRow = Math.ceil(
    (viewport.top + viewport.height) / itemRowHeight,
  );

  useEffect(() => {
    const prefetchRows = Math.max(1, Math.ceil(viewport.height / itemRowHeight) * 2);
    const start = Math.max(0, (firstVisibleRow - prefetchRows) * columns);
    const end = Math.min(
      store.assets.length,
      (lastVisibleRow + prefetchRows) * columns,
    );
    const controller = new AbortController();
    for (const asset of store.assets.slice(start, end)) {
      void fetch(`${asset.thumbnailUrl}?priority=prefetch`, {
        signal: controller.signal,
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [columns, firstVisibleRow, lastVisibleRow, store.assets, viewport.height]);
  const collectionLabels = useMemo(() => {
    const byId = new Map(store.collections.map((item) => [item.id, item]));
    const labelFor = (id: string): string => {
      const collection = byId.get(id);
      if (!collection) return "";
      return collection.parentId
        ? `${labelFor(collection.parentId)} / ${collection.title}`
        : collection.title;
    };
    return new Map(store.collections.map((item) => [item.id, labelFor(item.id)]));
  }, [store.collections]);
  const activeCollection = store.collectionFilter
    ? store.collections.find((item) => item.id === store.collectionFilter) ?? null
    : null;
  const panelTitle = store.lifecycleFilter === "trashed"
    ? "回收站"
    : activeCollection
      ? activeCollection.title
      : kindTitles[store.kindFilter];
  const contextCollections = useMemo(() => {
    const query = folderQuery.trim().toLocaleLowerCase("zh-CN");
    return [...store.collections]
      .filter((collection) =>
        (collectionLabels.get(collection.id) ?? collection.title)
          .toLocaleLowerCase("zh-CN")
          .includes(query),
      )
      .sort((left, right) =>
        (collectionLabels.get(left.id) ?? left.title).localeCompare(
          collectionLabels.get(right.id) ?? right.title,
          "zh-CN",
        ),
      );
  }, [collectionLabels, folderQuery, store.collections]);
  const navigationScope = JSON.stringify({
    query: store.query,
    kind: store.kindFilter,
    collection: store.collectionFilter,
    link: store.linkStateFilter,
    lifecycle: store.lifecycleFilter,
    favorite: store.favoriteFilter,
    rating: store.ratingFilter,
    color: store.colorFilter,
    visualColor: store.visualColor,
    minWidth: store.minWidth,
    maxWidth: store.maxWidth,
    minHeight: store.minHeight,
    maxHeight: store.maxHeight,
    minSize: store.minSize,
    maxSize: store.maxSize,
    minDuration: store.minDuration,
    maxDuration: store.maxDuration,
    createdAfter: store.createdAfter,
    createdBefore: store.createdBefore,
    sort: store.sort,
    direction: store.direction,
    includeSubfolderAssets: store.preferences.includeSubfolderAssets,
  });

  useEffect(() => {
    void window.refCanvas.library.getSimilarityIndex().then(setVisualIndex);
    return window.refCanvas.library.onSimilarityProgress((snapshot) => {
      setVisualIndex(snapshot);
      if (
        (snapshot.state === "completed" || snapshot.state === "cancelled") &&
        useAppStore.getState().visualColor
      ) {
        void useAppStore.getState().reloadAssets();
      }
    });
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport((current) => ({
        ...current,
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    if (previousScopeRef.current === null) {
      const scrollTop = readNavigationState().scrollTop;
      node.scrollTop = scrollTop;
      setViewport((current) => ({ ...current, top: scrollTop }));
    } else if (previousScopeRef.current !== navigationScope) {
      node.scrollTop = 0;
      setViewport((current) => ({ ...current, top: 0 }));
      updateNavigationState({ scrollTop: 0 });
    }
    previousScopeRef.current = navigationScope;
  }, [navigationScope]);

  useEffect(
    () => () => {
      if (scrollSaveTimerRef.current) {
        window.clearTimeout(scrollSaveTimerRef.current);
      }
      updateNavigationState({
        scrollTop: viewportRef.current?.scrollTop ?? 0,
      });
    },
    [],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".asset-folder-submenu")
      ) {
        return;
      }
      close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!batchMenuOpen) return;
    const close = (event?: Event) => {
      if (
        event?.target instanceof Node &&
        batchMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setBatchMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [batchMenuOpen]);

  const applyTag = async () => {
    await dialog.requestForm({
      title: "批量添加标签",
      confirmLabel: "添加标签",
      fields: [
        {
          name: "tag",
          label: "标签名称",
          required: true,
          maxLength: 64,
        },
      ],
      onSubmit: ({ tag }) => store.batchUpdate({ addTags: [tag] }),
    });
  };

  const batchRename = async () => {
    await dialog.requestForm({
      title: "批量重命名",
      description: "使用 {name} 保留原名称，{index} 插入三位递增序号。",
      confirmLabel: "重命名",
      fields: [
        {
          name: "pattern",
          label: "标题模板",
          initialValue: "{name}_{index}",
          required: true,
          maxLength: 256,
        },
      ],
      onSubmit: ({ pattern }) => store.batchRename(pattern),
    });
  };

  const batchNotes = async () => {
    await dialog.requestForm({
      title: "批量设置备注",
      description: "新备注会覆盖所选素材的现有备注；留空可清除。",
      confirmLabel: "应用",
      fields: [
        {
          name: "notes",
          label: "备注",
          maxLength: 10_000,
        },
      ],
      onSubmit: ({ notes }) => store.batchUpdate({ notes }),
    });
  };

  const focusAssetCard = (assetId: string, index: number) => {
    const node = viewportRef.current;
    if (node) {
      const rowTop = Math.floor(index / columns) * itemRowHeight;
      if (rowTop < node.scrollTop) {
        node.scrollTop = rowTop;
      } else if (rowTop + itemRowHeight > node.scrollTop + node.clientHeight) {
        node.scrollTop = rowTop + itemRowHeight - node.clientHeight;
      }
    }
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `.asset-card[data-asset-id="${CSS.escape(assetId)}"]`,
        )
        ?.focus({ preventScroll: true });
    });
  };

  const navigateGrid = async (
    key: AssetGridNavigationKey,
    extendSelection: boolean,
  ) => {
    let state = useAppStore.getState();
    const currentIndex = state.assets.findIndex(
      (asset) => asset.id === state.selectedAsset?.id,
    );
    let target = assetGridNavigationTarget({
      key,
      currentIndex,
      itemCount: state.assets.length,
      columns,
      visibleRows: Math.max(1, Math.floor(viewport.height / itemRowHeight)),
      canLoadMore: Boolean(state.nextCursor),
    });
    if (!target) return;
    if (target.requestMore) {
      await state.loadMore();
      state = useAppStore.getState();
      target = assetGridNavigationTarget({
        key,
        currentIndex,
        itemCount: state.assets.length,
        columns,
        visibleRows: Math.max(1, Math.floor(viewport.height / itemRowHeight)),
        canLoadMore: false,
      });
      if (!target) return;
    }
    const asset = state.assets[target.index];
    if (!asset) return;
    state.selectAssetInGrid(
      asset.id,
      extendSelection && currentIndex >= 0 ? "range" : "replace",
    );
    focusAssetCard(asset.id, target.index);
  };

  const replaceTags = async () => {
    await dialog.requestForm({
      title: "批量替换标签",
      description: "使用逗号分隔。现有标签会被完整替换；留空可清除。",
      confirmLabel: "替换",
      fields: [
        {
          name: "tags",
          label: "标签",
          maxLength: 4_000,
        },
      ],
      onSubmit: ({ tags }) =>
        store.batchUpdate({
          replaceTags: tags
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
    });
  };

  const startAction = async (
    type: "convert" | "webp" | "compress" | "video-to-gif" | "merge-images" | "change-extension" | "export-csv" | "export-folder",
    scope: ReturnType<typeof store.selectionScope>,
  ) => {
    const common: {
      type: typeof type;
      targets: typeof scope;
      options: Record<string, unknown>;
      outputDirectory?: string;
      namingTemplate?: string;
      keepHierarchy?: boolean;
      writeSidecar?: boolean;
    } = { type, targets: scope, options: {} };

    if (type === "convert" || type === "webp") {
      const values = await dialog.requestForm({
        title: type === "convert" ? "格式转换" : "WebP 转换",
        description: "输出为副本文件，不会修改原素材。",
        confirmLabel: "开始转换",
        fields: [
          ...(type === "convert"
            ? [
                {
                  name: "format",
                  label: "目标格式",
                  initialValue: "webp",
                  required: true,
                  maxLength: 8,
                },
              ]
            : []),
          {
            name: "quality",
            label: "质量 (1–100)",
            initialValue: "88",
            maxLength: 3,
          },
          { name: "maxWidth", label: "最大宽度（留空不限）", maxLength: 6 },
          { name: "maxHeight", label: "最大高度（留空不限）", maxLength: 6 },
          {
            name: "naming",
            label: "命名模板（{name} {index} {ext}）",
            initialValue: "{name}",
            maxLength: 256,
          },
        ],
        onSubmit: () => undefined,
      });
      if (!values) return;
      common.options = {
        format:
          type === "webp"
            ? "webp"
            : (["png", "jpeg", "webp", "avif", "tiff"].includes(values.format ?? "") ? values.format : "webp"),
        quality: Number(values.quality || 88),
        maxWidth: values.maxWidth ? Number(values.maxWidth) : undefined,
        maxHeight: values.maxHeight ? Number(values.maxHeight) : undefined,
      };
      common.namingTemplate = values.naming;
    } else if (type === "video-to-gif") {
      const values = await dialog.requestForm({
        title: "视频转 GIF",
        description: "使用本机 ffmpeg 离线转换。",
        confirmLabel: "开始转换",
        fields: [
          { name: "fps", label: "帧率", initialValue: "12", maxLength: 2 },
          { name: "scale", label: "宽度（缩放）", initialValue: "640", maxLength: 4 },
        ],
        onSubmit: () => undefined,
      });
      if (!values) return;
      common.options = {
        fps: Number(values.fps || 12),
        scale: Number(values.scale || 640),
      };
    } else if (type === "merge-images") {
      const values = await dialog.requestForm({
        title: "图片合并",
        description: "把所选图片合成为一张新图。",
        confirmLabel: "开始合并",
        fields: [
          {
            name: "direction",
            label: "方向",
            initialValue: "horizontal",
            maxLength: 16,
          },
          { name: "columns", label: "网格列数", maxLength: 2 },
          { name: "gap", label: "间距 px", maxLength: 3 },
        ],
        onSubmit: () => undefined,
      });
      if (!values) return;
      common.options = {
        direction: values.direction || "horizontal",
        columns: values.columns ? Number(values.columns) : undefined,
        gap: values.gap ? Number(values.gap) : 0,
      };
    } else if (type === "change-extension") {
      const values = await dialog.requestForm({
        title: "修改扩展名",
        description: "复制文件并改写扩展名（例如 png → webp），原文件不变。",
        confirmLabel: "开始",
        fields: [
          { name: "extension", label: "新扩展名（不带点）", required: true, maxLength: 16 },
        ],
        onSubmit: () => undefined,
      });
      if (!values) return;
      common.options = { extension: values.extension };
    } else if (type === "export-folder" || type === "export-csv") {
      const values = await dialog.requestForm({
        title: type === "export-csv" ? "导出 CSV" : "导出文件夹副本",
        description:
          type === "export-csv"
            ? "把所选素材的元数据导出为 CSV。"
            : "把所选素材复制到指定目录（保持文件夹层级、可写元数据 sidecar）。",
        confirmLabel: "开始导出",
        fields: [
          { name: "naming", label: "命名模板", initialValue: "{name}", maxLength: 256 },
        ],
        onSubmit: () => undefined,
      });
      if (!values) return;
      common.namingTemplate = values.naming;
      if (type === "export-csv") {
        common.options = {
          fields: ["title", "path", "extension", "size", "rating", "tags", "notes"],
        };
      } else {
        common.keepHierarchy = true;
        common.writeSidecar = true;
      }
    }

    await window.refCanvas.actions.start(common);
  };

  if (store.navigationSource === "directory") {
    return <DirectoryAssetPanel />;
  }

  return (
    <section
      className="asset-panel"
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const isEditing =
          target.matches("input, textarea, select") ||
          (target.matches("button") && !target.matches(".asset-card")) ||
          Boolean(target.closest('[role="dialog"]'));
        const navigationKeys = new Set([
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ]);
        if (!isEditing && navigationKeys.has(event.key)) {
          event.preventDefault();
          void navigateGrid(
            event.key as AssetGridNavigationKey,
            event.shiftKey,
          );
          return;
        }
        if (
          !isEditing &&
          store.lifecycleFilter === "active" &&
          selectedCount > 0 &&
          event.key.toLocaleLowerCase("en-US") === "f"
        ) {
          event.preventDefault();
          void store.batchUpdate({
            favorite: !(store.selectedAsset?.favorite ?? false),
          });
          return;
        }
        if (
          !isEditing &&
          store.lifecycleFilter === "active" &&
          selectedCount > 0 &&
          /^[0-5]$/.test(event.key)
        ) {
          event.preventDefault();
          void store.batchUpdate({ rating: Number(event.key) });
          return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === "a") {
          event.preventDefault();
          store.selectAllMatching();
        }
        if (event.key === "Escape") store.clearSelection();
        if (event.key === " " && !isEditing) {
          const selected =
            store.selectedAsset ??
            store.assets.find((asset) => store.selectedIds.has(asset.id));
          if (selected) {
            event.preventDefault();
            setPreviewId(selected.id);
          }
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        const paths = window.refCanvas.library.pathsForFiles([
          ...event.dataTransfer.files,
        ]);
        void store.importPaths(paths);
      }}
    >
      <header className="panel-header asset-header">
        <div>
          <h2>{panelTitle}</h2>
          <span className="panel-count">
            {activeCollection && `${collectionLabels.get(activeCollection.id)} · `}
            {store.assets.length} / {store.totalAssets} 项
          </span>
        </div>
        <button
          className="icon-button"
          onClick={() => void store.importAssets("files")}
          aria-label="导入素材"
          disabled={store.importing}
        >
          <Import size={17} />
        </button>
      </header>

      {activeCollection && (
        <nav className="folder-crumbs" aria-label="文件夹路径">
          <span className="folder-crumb">
            <button
              onClick={() => store.setCollectionFilter(null)}
              title="全部素材"
            >
              全部素材
            </button>
          </span>
          {ancestorChain(store.collections, activeCollection.id).map(
            (folder) => (
              <span className="folder-crumb" key={folder.id}>
                <span className="folder-crumb-sep">›</span>
                <button
                  className={folder.id === store.collectionFilter ? "current" : ""}
                  title={folderLabel(store.collections, folder.id)}
                  onClick={() => store.setCollectionFilter(folder.id)}
                >
                  {folder.title}
                </button>
              </span>
            ),
          )}
        </nav>
      )}

      <SearchField />

      <div className="asset-filter-row">
        <select
          value={`${store.sort}:${store.direction}`}
          onChange={(event) => {
            const [sort, direction] = event.target.value.split(":");
            store.setSort(
              sort as typeof store.sort,
              direction as typeof store.direction,
            );
          }}
          aria-label="素材排序"
        >
          <option value="createdAt:desc">最新导入</option>
          <option value="createdAt:asc">最早导入</option>
          <option value="title:asc">名称 A–Z</option>
          <option value="size:desc">文件最大</option>
          <option value="mtimeMs:desc">最近修改</option>
          <option value="rating:desc">评分最高</option>
          <option value="random:desc">随机浏览</option>
        </select>
        <select
          value={store.preferences.layoutMode}
          onChange={(event) =>
            void store.setPreferences({
              layoutMode: event.target.value as LibraryPreferences["layoutMode"],
            })
          }
          aria-label="布局模式"
          title="布局模式会保存在当前资料库"
        >
          <option value="grid">网格</option>
          <option value="waterfall">瀑布流</option>
          <option value="detail">详情列表</option>
        </select>
        <select
          value={store.ratingFilter}
          onChange={(event) => store.setRatingFilter(Number(event.target.value))}
          aria-label="最低评分"
        >
          <option value="0">全部评分</option>
          <option value="1">★ 以上</option>
          <option value="3">★★★ 以上</option>
          <option value="5">★★★★★</option>
        </select>
        <button
          className="compact-button"
          onClick={() => setFiltersOpen((value) => !value)}
          title="高级筛选"
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
      {activeCollection && (
        <label className="include-subfolders-toggle">
          <input
            type="checkbox"
            checked={store.preferences.includeSubfolderAssets}
            onChange={(event) =>
              void store.setPreferences({
                includeSubfolderAssets: event.target.checked,
              })
            }
          />
          <span>
            包含子文件夹素材
            <small>
              {store.preferences.includeSubfolderAssets
                ? "查询时包含该文件夹及全部子文件夹"
                : "只显示该文件夹的直接素材"}
            </small>
          </span>
        </label>
      )}
      {filtersOpen && (
        <div className="advanced-filters">
          <label>
            最小宽度（px）
            <input
              type="number"
              min="0"
              value={store.minWidth ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  minWidth: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最大宽度（px）
            <input
              type="number"
              min="0"
              value={store.maxWidth ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  maxWidth: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最小高度（px）
            <input
              type="number"
              min="0"
              value={store.minHeight ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  minHeight: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最大高度（px）
            <input
              type="number"
              min="0"
              value={store.maxHeight ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  maxHeight: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最小文件（MB）
            <input
              type="number"
              min="0"
              step="0.1"
              value={
                store.minSize === undefined
                  ? ""
                  : Number((store.minSize / 1024 / 1024).toFixed(2))
              }
              onChange={(event) =>
                store.setAdvancedFilters({
                  minSize: event.target.value
                    ? Math.round(Number(event.target.value) * 1024 * 1024)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最大文件（MB）
            <input
              type="number"
              min="0"
              step="0.1"
              value={
                store.maxSize === undefined
                  ? ""
                  : Number((store.maxSize / 1024 / 1024).toFixed(2))
              }
              onChange={(event) =>
                store.setAdvancedFilters({
                  maxSize: event.target.value
                    ? Math.round(Number(event.target.value) * 1024 * 1024)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最短时长（秒）
            <input
              type="number"
              min="0"
              step="0.1"
              value={store.minDuration ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  minDuration: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            最长时长（秒）
            <input
              type="number"
              min="0"
              step="0.1"
              value={store.maxDuration ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  maxDuration: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            文件格式
            <input
              type="text"
              maxLength={17}
              placeholder="png"
              value={store.extension ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  extension:
                    event.target.value
                      .trim()
                      .replace(/^\./, "")
                      .replace(/[^a-z0-9]/gi, "")
                      .toLowerCase() || undefined,
                })
              }
            />
          </label>
          <label>
            画面方向
            <select
              value={store.orientation ?? ""}
              onChange={(event) =>
                store.setAdvancedFilters({
                  orientation:
                    (event.target.value as typeof store.orientation) ||
                    undefined,
                })
              }
            >
              <option value="">全部方向</option>
              <option value="landscape">横向</option>
              <option value="portrait">竖向</option>
              <option value="square">方形（±2%）</option>
            </select>
          </label>
          <label>
            颜色标签
            <select
              value={store.colorFilter}
              onChange={(event) =>
                store.setColorFilter(
                  event.target.value as typeof store.colorFilter,
                )
              }
            >
              <option value="none">全部</option>
              <option value="red">红色</option>
              <option value="orange">橙色</option>
              <option value="yellow">黄色</option>
              <option value="green">绿色</option>
              <option value="blue">蓝色</option>
              <option value="purple">紫色</option>
              <option value="gray">灰色</option>
            </select>
          </label>
          <label className="visual-color-filter">
            图片主色
            <span>
              <input
                type="color"
                value={store.visualColor ?? "#808080"}
                onChange={(event) => store.setVisualColor(event.target.value)}
                aria-label="选择图片主色"
              />
              <button
                type="button"
                disabled={!store.visualColor}
                onClick={() => store.setVisualColor(null)}
              >
                清除
              </button>
            </span>
          </label>
          {store.visualColor && (
            <label className="visual-color-tolerance">
              颜色容差
              <span>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={store.visualColorTolerance}
                  onChange={(event) =>
                    store.setVisualColorTolerance(Number(event.target.value))
                  }
                />
                <strong>{store.visualColorTolerance}%</strong>
              </span>
            </label>
          )}
          {store.visualColor && visualIndex.state === "running" && (
            <div className="color-index-progress">
              <span>
                正在建立本地颜色索引
                <b>
                  {visualIndex.processed} / {visualIndex.total}
                </b>
              </span>
              <progress
                max={Math.max(1, visualIndex.total)}
                value={visualIndex.processed}
              />
              <button
                type="button"
                onClick={() => void window.refCanvas.library.cancelSimilarityIndex()}
              >
                取消
              </button>
            </div>
          )}
          <label>
            导入起始
            <input
              type="date"
              value={dateInputValue(store.createdAfter)}
              onChange={(event) =>
                store.setAdvancedFilters({
                  createdAfter: event.target.value
                    ? new Date(`${event.target.value}T00:00:00`).toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <label>
            导入截止
            <input
              type="date"
              value={dateInputValue(store.createdBefore)}
              onChange={(event) =>
                store.setAdvancedFilters({
                  createdBefore: event.target.value
                    ? new Date(`${event.target.value}T23:59:59`).toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <label>
            修改起始
            <input
              type="date"
              value={dateInputValue(store.modifiedAfter)}
              onChange={(event) =>
                store.setAdvancedFilters({
                  modifiedAfter: event.target.value
                    ? new Date(`${event.target.value}T00:00:00`).toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <label>
            修改截止
            <input
              type="date"
              value={dateInputValue(store.modifiedBefore)}
              onChange={(event) =>
                store.setAdvancedFilters({
                  modifiedBefore: event.target.value
                    ? new Date(`${event.target.value}T23:59:59`).toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <button
            className="secondary-button"
            onClick={() => {
              void dialog.requestForm({
                title: "保存 Smart Folder",
                description: "保存当前搜索、筛选和排序条件。",
                confirmLabel: "保存",
                fields: [
                  {
                    name: "title",
                    label: "名称",
                    required: true,
                    maxLength: 120,
                  },
                ],
                onSubmit: ({ title }) => store.saveCurrentView(title),
              });
            }}
          >
            <BookmarkPlus size={14} />
            保存 Smart Folder
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              store.setAdvancedFilters({
                minWidth: undefined,
                maxWidth: undefined,
                minHeight: undefined,
                maxHeight: undefined,
                minSize: undefined,
                maxSize: undefined,
                minDuration: undefined,
                maxDuration: undefined,
                extension: undefined,
                orientation: undefined,
                createdAfter: undefined,
                createdBefore: undefined,
                modifiedAfter: undefined,
                modifiedBefore: undefined,
              })
            }
          >
            <RotateCcw size={14} />
            清除高级筛选
          </button>
        </div>
      )}

      {store.importJob && store.importing && (
        <ImportProgressBar />
      )}

      {selectedCount > 0 && (
        <div className="batch-toolbar" ref={batchMenuRef}>
          <span>{selectedCount} 项</span>
          {store.lifecycleFilter === "active" ? (
            <>
              <button
                onClick={() => void store.batchUpdate({ favorite: true })}
                title="收藏"
              >
                <Heart size={15} />
              </button>
              <button onClick={() => void applyTag()} title="添加标签">
                <Tags size={15} />
              </button>
            </>
          ) : (
            <button onClick={() => void store.restoreSelection()} title="恢复">
              <RotateCcw size={15} />
            </button>
          )}
          <button
            className="batch-more-trigger"
            aria-label="更多批量操作"
            aria-haspopup="menu"
            aria-expanded={batchMenuOpen}
            onClick={(event) => {
              if (batchMenuOpen) {
                setBatchMenuOpen(false);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const x = Math.max(
                8,
                Math.min(bounds.right - 252, window.innerWidth - 260),
              );
              const y = Math.min(bounds.bottom + 6, window.innerHeight - 52);
              setBatchMenuPosition({
                x,
                y,
                maxHeight: Math.max(44, window.innerHeight - y - 8),
              });
              setBatchMenuOpen(true);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
          <button onClick={store.clearSelection} title="取消选择">
            <X size={15} />
          </button>
          {batchMenuOpen && (
            <div
              className="batch-actions-popover"
              role="menu"
              style={{
                left: batchMenuPosition.x,
                top: batchMenuPosition.y,
                maxHeight: batchMenuPosition.maxHeight,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {!store.allMatchingSelected &&
                store.selectedIds.size === store.assets.length && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      store.selectAllMatching();
                      setBatchMenuOpen(false);
                    }}
                  >
                    <Check size={15} />
                    选择全部结果
                  </button>
                )}
              {store.lifecycleFilter === "active" ? (
                <>
                  <button role="menuitem" onClick={() => { setBatchMenuOpen(false); void batchRename(); }}>
                    <Pencil size={15} />
                    批量重命名
                  </button>
                  <button role="menuitem" onClick={() => { setBatchMenuOpen(false); void batchNotes(); }}>
                    <NotebookPen size={15} />
                    批量设置备注
                  </button>
                  <button role="menuitem" onClick={() => { setBatchMenuOpen(false); void replaceTags(); }}>
                    <Tags size={15} />
                    批量替换标签
                  </button>
                  <select
                    value=""
                    onChange={(event) => {
                      const action = event.target.value as
                        | ""
                        | "convert"
                        | "webp"
                        | "compress"
                        | "video-to-gif"
                        | "merge-images"
                        | "change-extension"
                        | "export-csv"
                        | "export-folder";
                      if (!action) return;
                      setBatchMenuOpen(false);
                      void startAction(action, store.selectionScope());
                    }}
                    aria-label="导出与转换"
                  >
                    <option value="">导出/转换…</option>
                    <option value="convert">格式转换…</option>
                    <option value="webp">WebP 转换</option>
                    <option value="compress">无损压缩</option>
                    <option value="video-to-gif">视频转 GIF…</option>
                    <option value="merge-images">图片合并…</option>
                    <option value="change-extension">修改扩展名…</option>
                    <option value="export-csv">导出 CSV</option>
                    <option value="export-folder">导出文件夹副本</option>
                  </select>
                  <select
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      void store.batchUpdate({ rating: Number(event.target.value) });
                      setBatchMenuOpen(false);
                    }}
                    aria-label="批量评分"
                  >
                    <option value="">评分…</option>
                    <option value="0">清除</option>
                    <option value="1">★</option>
                    <option value="3">★★★</option>
                    <option value="5">★★★★★</option>
                  </select>
                  <select
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      void store.batchUpdate({ colorLabel: event.target.value as AssetRecord["colorLabel"] });
                      setBatchMenuOpen(false);
                    }}
                    aria-label="批量颜色"
                  >
                    <option value="">颜色…</option>
                    <option value="none">清除</option>
                    <option value="red">红</option>
                    <option value="yellow">黄</option>
                    <option value="green">绿</option>
                    <option value="blue">蓝</option>
                    <option value="purple">紫</option>
                  </select>
                  <select
                    value={collectionId}
                    onChange={(event) => {
                      setCollectionId(event.target.value);
                      if (!event.target.value) return;
                      void store.batchUpdate({ addCollectionId: event.target.value });
                      setCollectionId("");
                      setBatchMenuOpen(false);
                    }}
                    aria-label="添加到集合"
                  >
                    <option value="">添加到文件夹…</option>
                    {store.collections.map((collection) => (
                      <option value={collection.id} key={collection.id}>
                        {collectionLabels.get(collection.id)}
                      </option>
                    ))}
                  </select>
                  {store.collectionFilter && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        void store.batchUpdate({ removeCollectionId: store.collectionFilter! });
                        setBatchMenuOpen(false);
                      }}
                    >
                      <FolderMinus size={15} />
                      移出当前文件夹
                    </button>
                  )}
                  <div className="folder-menu-separator" />
                  <button
                    className="danger"
                    role="menuitem"
                    onClick={() => {
                      setBatchMenuOpen(false);
                      if (window.confirm(`将 ${selectedCount} 个源文件移动到 RefCanvas 回收站？`)) {
                        void store.trashSelection();
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    移入回收站
                  </button>
                  <button
                    className="danger"
                    role="menuitem"
                    onClick={() => {
                      setBatchMenuOpen(false);
                      if (window.confirm(`从资料库移除 ${selectedCount} 个素材？源文件不会被修改，已加入白板的素材会保留记录。`)) {
                        void store.removeFromLibrarySelection();
                      }
                    }}
                  >
                    <FolderX size={15} />
                    从资料库移除
                  </button>
                </>
              ) : (
                <select
                  value=""
                  aria-label="回收站清理方式"
                  onChange={(event) => {
                    const action = event.currentTarget.value;
                    event.currentTarget.value = "";
                    setBatchMenuOpen(false);
                    if (action === "forget" && window.confirm(`仅从 RefCanvas 回收站清除 ${selectedCount} 条记录？实际文件会保留在磁盘中。`)) {
                      void store.forgetTrashSelection();
                    } else if (
                      action === "purge" &&
                      window.confirm(`永久删除 ${selectedCount} 个文件及记录？此操作不可恢复。`) &&
                      window.confirm("再次确认：永久删除所选文件？")
                    ) {
                      void store.purgeSelection();
                    }
                  }}
                >
                  <option value="">清理方式…</option>
                  <option value="forget">仅清除记录，保留文件</option>
                  <option value="purge">永久删除文件和记录</option>
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {store.assets.length ? (
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
            if (scrollSaveTimerRef.current) {
              window.clearTimeout(scrollSaveTimerRef.current);
            }
            scrollSaveTimerRef.current = window.setTimeout(() => {
              updateNavigationState({ scrollTop: node.scrollTop });
            }, 160);
            if (
              node.scrollTop + node.clientHeight >= node.scrollHeight - itemRowHeight * 2
            ) {
              void store.loadMore();
            }
          }}
        >
          {detailMode ? (
            <div
              className="asset-detail-list asset-detail-list-virtual"
              style={{ height: Math.max(detailRowHeight, rowCount * detailRowHeight) }}
            >
              {visibleAssets.map((asset, visibleIndex) => {
                const absoluteIndex = startRow + visibleIndex;
                const selected =
                  (store.allMatchingSelected && !store.excludedIds.has(asset.id)) ||
                  store.selectedIds.has(asset.id);
                const Icon = kindIcons[asset.kind];
                return (
                  <button
                    className={`asset-detail-row ${selected ? "selected" : ""}`}
                    key={asset.id}
                    style={{ top: absoluteIndex * detailRowHeight }}
                    data-asset-id={asset.id}
                    onClick={(event) =>
                      store.selectAssetInGrid(
                        asset.id,
                        event.ctrlKey || event.metaKey
                          ? "toggle"
                          : event.shiftKey
                            ? "range"
                            : "replace",
                      )
                    }
                    onDoubleClick={() => setPreviewId(asset.id)}
                  >
                    <Icon size={15} strokeWidth={1.8} />
                    <span className="detail-title">{asset.title}</span>
                    <span className="detail-kind">
                      {kindTitles[asset.kind]}
                    </span>
                    <span className="detail-size">{formatSize(asset.size)}</span>
                    <span className="detail-dimensions">
                      {asset.width && asset.height
                        ? `${asset.width} × ${asset.height}`
                        : ""}
                    </span>
                    <span className="detail-tags">
                      {asset.tags.slice(0, 3).join("、")}
                    </span>
                    {asset.linkState === "missing" && (
                      <span className="detail-missing">断链</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
          <div
            className="asset-virtual-grid"
            style={{ height: Math.max(cardRowHeight, rowCount * cardRowHeight) }}
          >
            {visibleAssets.map((asset, visibleIndex) => {
              const absoluteIndex = startRow * columns + visibleIndex;
              const row = Math.floor(absoluteIndex / columns);
              const column = absoluteIndex % columns;
              const Icon = kindIcons[asset.kind];
              const selected =
                (store.allMatchingSelected && !store.excludedIds.has(asset.id)) ||
                store.selectedIds.has(asset.id);
              return (
                <button
                  className={`asset-card ${selected ? "selected" : ""}`}
                  style={{
                    left: column * (cardWidth + gap),
                    top: row * cardRowHeight,
                    width: cardWidth,
                  }}
                  draggable={store.lifecycleFilter === "active"}
                  data-asset-id={asset.id}
                  key={asset.id}
                  tabIndex={store.selectedAsset?.id === asset.id ? 0 : -1}
                  onClick={(event) =>
                    store.selectAssetInGrid(
                      asset.id,
                      event.shiftKey
                        ? "range"
                        : event.ctrlKey || event.metaKey
                          ? "toggle"
                          : "replace",
                    )
                  }
                  onDoubleClick={() => setPreviewId(asset.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selected) {
                      store.selectAssetInGrid(asset.id, "replace");
                    }
                    setContextMenu({
                      asset,
                      x: Math.min(event.clientX, window.innerWidth - 228),
                      y: Math.min(event.clientY, window.innerHeight - 248),
                    });
                    setFolderMenuOpen(false);
                    setFolderQuery("");
                  }}
                  onDragStart={(event) => {
                    const draggedIds = selected
                      ? store.assets
                          .filter((item) =>
                            store.allMatchingSelected
                              ? !store.excludedIds.has(item.id)
                              : store.selectedIds.has(item.id),
                          )
                          .map((item) => item.id)
                      : [asset.id];
                    if (event.altKey) {
                      event.preventDefault();
                      window.refCanvas.system.startNativeDrag(draggedIds);
                      return;
                    }
                    event.dataTransfer.setData(
                      "application/x-refcanvas-asset",
                      asset.id,
                    );
                    event.dataTransfer.setData(
                      "application/x-refcanvas-asset-ids",
                      JSON.stringify(draggedIds),
                    );
                    if (selected) {
                      event.dataTransfer.setData(
                        "application/x-refcanvas-selection",
                        "current",
                      );
                    }
                    event.dataTransfer.effectAllowed = "copyMove";
                  }}
                >
                  <span className="asset-preview">
                  <AssetCardPreview
                    asset={asset}
                    Icon={Icon}
                    priority={
                      row >= firstVisibleRow && row <= lastVisibleRow
                        ? "visible"
                        : "overscan"
                    }
                  />
                    {asset.linkState === "missing" && (
                      <span className="missing-badge">断链</span>
                    )}
                    {asset.favorite && <Heart className="favorite-badge" size={14} />}
                    {selected && (
                      <span className="selection-badge">
                        <Check size={13} />
                      </span>
                    )}
                    {asset.colorLabel !== "none" && (
                      <span
                        className={`color-label color-${asset.colorLabel}`}
                        aria-label={`颜色标签 ${asset.colorLabel}`}
                      />
                    )}
                    {(asset.kind === "video" || asset.kind === "audio") &&
                      asset.duration !== null && (
                        <span className="duration-badge">
                          {formatDuration(asset.duration)}
                        </span>
                      )}
                  </span>
                  <span className="asset-title" title={asset.title}>
                    <HighlightedText text={asset.title} query={store.query} />
                  </span>
                  <span className="asset-meta">
                    {asset.rating > 0 ? (
                      <span className="rating-mini">
                        <Star size={11} fill="currentColor" /> {asset.rating}
                      </span>
                    ) : (
                      formatSize(asset.size)
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          )}
          {store.loadingMore && <div className="load-more">正在加载…</div>}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            {store.lifecycleFilter === "trashed" ? (
              <Trash2 size={25} />
            ) : (
              <FileImage size={25} />
            )}
          </span>
          <h3>
            {store.lifecycleFilter === "trashed"
              ? "回收站为空"
              : store.query
                ? "没有匹配素材"
                : "把灵感放进来"}
          </h3>
          <p>
            {store.lifecycleFilter === "trashed"
              ? "移入回收站的源文件会安全保存在本机，直到手动清空。"
              : store.query
                ? "尝试更换关键词或筛选条件。"
                : "拖入文件或文件夹，RefCanvas 会建立可搜索的本地索引。"}
          </p>
          {!store.query && store.lifecycleFilter === "active" && (
            <button
              className="primary-button"
              onClick={() => void store.importAssets("files")}
            >
              <Import size={16} />
              导入素材
            </button>
          )}
        </div>
      )}
      {contextMenu && (
        <div
          className="asset-context-menu"
          role="menu"
          aria-label="素材操作"
          style={{
            left: Math.max(8, contextMenu.x),
            top: Math.max(8, contextMenu.y),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            onClick={() => {
              setPreviewId(contextMenu.asset.id);
              setContextMenu(null);
            }}
          >
            <Eye size={16} />
            快速预览
            <kbd>Space</kbd>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void window.refCanvas.system.revealInFolder(
                contextMenu.asset.path,
              );
              setContextMenu(null);
            }}
          >
            <FolderSearch size={16} />
            在资源管理器中显示
          </button>
          {store.lifecycleFilter === "active" && (
            <>
              <span className="context-menu-divider" />
              <button
                role="menuitem"
                onClick={() => {
                  void store.batchUpdate({
                    favorite: !contextMenu.asset.favorite,
                  });
                  setContextMenu(null);
                }}
              >
                <Heart size={16} />
                {contextMenu.asset.favorite ? "取消收藏所选" : "收藏所选"}
              </button>
              <button
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={folderMenuOpen}
                onClick={() => setFolderMenuOpen((value) => !value)}
              >
                <FolderPlus size={16} />
                添加到文件夹
                <ChevronRight className="context-menu-chevron" size={15} />
              </button>
              {store.collectionFilter && (
                <button
                  role="menuitem"
                  onClick={() => {
                    void store.batchUpdate({
                      removeCollectionId: store.collectionFilter!,
                    });
                    setContextMenu(null);
                  }}
                >
                  <FolderMinus size={16} />
                  从当前文件夹移除
                </button>
              )}
              <button
                className="danger"
                role="menuitem"
                onClick={() => {
                  if (
                    window.confirm(
                      `将 ${selectedCount} 个源文件移动到 RefCanvas 回收站？`,
                    )
                  ) {
                    void store.trashSelection();
                  }
                  setContextMenu(null);
                }}
              >
                <Trash2 size={16} />
                移入回收站
              </button>
            </>
          )}
          {folderMenuOpen && (
            <div
              className="asset-folder-submenu"
              role="menu"
              aria-label="选择文件夹"
              style={{
                left:
                  contextMenu.x + 452 <= window.innerWidth
                    ? "calc(100% + 4px)"
                    : "auto",
                right:
                  contextMenu.x + 452 <= window.innerWidth
                    ? "auto"
                    : "calc(100% + 4px)",
                top: Math.max(
                  -6,
                  Math.min(82, window.innerHeight - contextMenu.y - 388),
                ),
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <label className="folder-menu-search">
                <Search size={14} />
                <input
                  autoFocus
                  value={folderQuery}
                  onChange={(event) => setFolderQuery(event.target.value)}
                  placeholder="搜索文件夹路径"
                  aria-label="搜索文件夹路径"
                />
              </label>
              <div className="folder-menu-list">
                {contextCollections.map((collection) => {
                  const included =
                    contextMenu.asset.collectionIds.includes(collection.id);
                  return (
                    <button
                      className={included ? "included" : ""}
                      role="menuitemcheckbox"
                      aria-checked={included}
                      key={collection.id}
                      onClick={() => {
                        void store.batchUpdate(
                          included
                            ? { removeCollectionId: collection.id }
                            : { addCollectionId: collection.id },
                        );
                        setContextMenu(null);
                      }}
                    >
                      <span>
                        {collectionLabels.get(collection.id) ??
                          collection.title}
                      </span>
                      {included && <Check size={14} />}
                    </button>
                  );
                })}
                {!contextCollections.length && (
                  <p>
                    {store.collections.length
                      ? "没有匹配的文件夹"
                      : "尚未创建文件夹"}
                  </p>
                )}
              </div>
              <small>
                操作将应用到当前选中的 {selectedCount} 项
              </small>
            </div>
          )}
        </div>
      )}
      {previewId && store.assets.some((asset) => asset.id === previewId) && (
        <QuickPreview
          assets={store.assets}
          total={store.totalAssets}
          hasMore={Boolean(store.nextCursor)}
          activeId={previewId}
          onChange={(id) => {
            setPreviewId(id);
            store.selectAssetInGrid(id, "replace");
          }}
          onLoadMore={() => store.loadMore()}
          onUpdate={store.updateAsset}
          onClose={() => setPreviewId(null)}
        />
      )}
    </section>
  );
}
