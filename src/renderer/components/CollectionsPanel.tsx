/**
 * 引用集合面板（FND-003，§6）。
 *
 * 侧栏分组显示集合树；展开集合后展示条目网格（resolved/offline/missing/
 * ambiguous 四种状态），并支持：
 * - 新建/重命名/嵌套/递归删除集合（§6.3）
 * - 拖放目录条目或外部文件加入集合；批量添加/移除
 * - 解析（自动重定位）与手动重定位（指纹不一致需确认）
 * - 导出到目标目录（仅 resolved；重名不覆盖）
 *
 * 集合只记录磁盘引用，零拷贝；磁盘/挂载变化不静默删除集合意图。
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  FolderOpen,
  FolderPlus,
  Globe,
  Layers,
  LayoutGrid,
  List,
  Link2,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SquareArrowOutUpRight,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CollectionAddResult,
  CollectionExportSnapshot,
  CollectionItemState,
  FileConflictAction,
  ReferenceCollection,
  ReferenceCollectionItem,
} from "../../shared/contracts";
import { useAppStore } from "../app/store";
import { translate, type MessageKey } from "../app/i18n";
import { placeTriggerMenu, type MenuPlacement } from "../app/menu-position";
import { useDirectorySelection } from "../features/directory/use-directory-selection";
import {
  buildCollectionVirtualTree,
  filterCollectionItems,
  itemDisplayName,
  itemParentLabel,
  sortCollectionItems,
  type CollectionFilterState,
  type CollectionSearchScope,
  type CollectionSortMode,
  type CollectionVirtualFolder,
} from "../features/collections/collection-browser-model";
import { useDialog } from "./DialogProvider";
import { PaneCollapseButton } from "./PaneCollapseButton";
import { SelectMenu } from "./SelectMenu";
import { VisibilityToggle } from "./VisibilityToggle";

/** 状态标签直接映射 i18n key（值随语言切换）。 */
const stateLabelKeys: Record<CollectionItemState, MessageKey> = {
  resolved: "collections.state.resolved",
  offline: "collections.state.offline",
  missing: "collections.state.missing",
  ambiguous: "collections.state.ambiguous",
};

const stateClasses: Record<CollectionItemState, string> = {
  resolved: "state-resolved",
  offline: "state-offline",
  missing: "state-missing",
  ambiguous: "state-ambiguous",
};

/** 状态标签（渲染时取当前语言）。 */
function stateLabel(state: CollectionItemState): string {
  return translate(stateLabelKeys[state]);
}

/** 目录条目拖拽 MIME（DirectoryAssetPanel 注入）。 */
const DIRECTORY_ENTRY_MIME = "application/x-refcanvas-directory-entry";

/** 集合行拖拽 MIME：携带被拖集合 id（用于嵌套/重排）。 */
const COLLECTION_DRAG_MIME = "application/x-refcanvas-collection-id";

/** 目录被跳过时给出反馈（文件夹本身不会被加入集合）。 */
function notifySkippedDirectories(
  dialog: ReturnType<typeof useDialog>,
  skipped: CollectionAddResult["skipped"],
): void {
  if (skipped.directories.length === 0) return;
  void dialog.requestConfirm({
    title: translate("collections.addFailed"),
    description: translate("collections.skippedDirectories").replace(
      "{count}",
      String(skipped.directories.length),
    ),
    confirmLabel: translate("collections.acknowledge"),
  });
}

/** 询问导出冲突处理策略（apply-to-all：一次选择应用于全部冲突）。 */
async function askExportConflictAction(
  dialog: ReturnType<typeof useDialog>,
): Promise<FileConflictAction | null> {
  const values = await dialog.requestForm({
    title: translate("collections.exportConflictTitle"),
    description: translate("collections.exportConflictDescription"),
    confirmLabel: translate("collections.continue"),
    fields: [
      {
        name: "strategy",
        label: translate("collections.exportConflictStrategy"),
        type: "select",
        initialValue: "rename",
        options: [
          { value: "rename", label: translate("collections.exportConflictRename") },
          { value: "replace", label: translate("collections.exportConflictReplace") },
          { value: "skip", label: translate("collections.exportConflictSkip") },
        ],
      },
    ],
    onSubmit: () => undefined,
  });
  if (!values) return null;
  return String(values.strategy) as FileConflictAction;
}

interface CollectionNodeProps {
  collection: ReferenceCollection;
  depth: number;
  onRefreshTree(): void;
  onOpen(id: string): void;
  onAddFiles(id: string): void;
  onExport(id: string): void;
}

function CollectionNode({
  collection,
  depth,
  onRefreshTree,
  onOpen,
  onAddFiles,
  onExport,
}: CollectionNodeProps) {
  const store = useAppStore();
  const dialog = useDialog();
  const children = store.collectionTree[collection.id] ?? [];
  const items = store.collectionItems[collection.id];
  const [expanded, setExpanded] = useState(depth === 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [pending, setPending] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active =
    store.workspaceMode === "directory" &&
    store.activeCollectionId === collection.id;

  const updateMenuPlacement = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const menu = menuRef.current;
    const next = placeTriggerMenu(
      {
        left: rect.left + 22,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      },
      { width: menu?.offsetWidth || 220, height: menu?.offsetHeight || 340 },
      { width: window.innerWidth, height: window.innerHeight },
      2,
      8,
    );
    setMenuPlacement(next);
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null);
      return;
    }
    updateMenuPlacement();
  }, [menuOpen, updateMenuPlacement]);

  useEffect(() => {
    if (!menuOpen) return;
    const reposition = () => updateMenuPlacement();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [menuOpen, updateMenuPlacement]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Let menu items and the trigger receive their own click; other targets
      // should close this menu without blocking the underlying navigation.
      if (
        target.closest(".collection-menu") ||
        target.closest(".collection-row-actions")
      ) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const addPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setPending(true);
    try {
      const result = await window.refCanvas.collections.addPaths(
        collection.id,
        paths,
      );
      notifySkippedDirectories(dialog, result.skipped);
      onRefreshTree();
      if (store.activeCollectionId === collection.id) setExpanded(true);
    } catch {
      // 主进程错误已包含用户可读信息；拖放静默失败不打扰。
    } finally {
      setPending(false);
    }
  };

  const rename = async () => {
    setMenuOpen(false);
    const values = await dialog.requestForm({
      title: translate("collections.rename"),
      confirmLabel: translate("collections.save"),
      fields: [
        { name: "name", label: translate("collections.nameLabel"), required: true, maxLength: 256, initialValue: collection.name },
      ],
      onSubmit: ({ name }) =>
        window.refCanvas.collections.update(collection.id, { name }).then(() => undefined),
    });
    if (values) onRefreshTree();
  };

  const remove = async () => {
    setMenuOpen(false);
    const childCount = children.length;
    const itemCount = items?.length ?? 0;
    if (childCount === 0 && itemCount === 0) {
      const confirmed = await dialog.requestConfirm({
        title: translate("collections.delete"),
        description: translate("collections.deleteNamed")
          .replace("{name}", collection.name)
          .replace("{detail}", translate("collections.deleteConfirm")),
        confirmLabel: translate("collections.delete"),
        danger: true,
      });
      if (!confirmed) return;
      try {
        await window.refCanvas.collections.delete(collection.id, { recursive: false });
        onRefreshTree();
      } catch {
        // 竞态：期间有内容被加入 → 提示改用递归删除。
        await removeRecursive();
      }
      return;
    }
    await removeRecursive();
  };

  const removeRecursive = async () => {
    const scope = children.length
      ? translate("collections.scopeChildrenItems")
          .replace("{children}", String(children.length))
          .replace("{items}", String(items?.length ?? 0))
      : translate("collections.scopeItems").replace(
          "{items}",
          String(items?.length ?? 0),
        );
    const confirmed = await dialog.requestConfirm({
      title: translate("collections.recursiveDelete"),
      description: translate("collections.containsScope")
        .replace("{name}", collection.name)
        .replace("{scope}", scope)
        .replace("{detail}", translate("collections.recursiveDelete")),
      confirmLabel: translate("collections.delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await window.refCanvas.collections.delete(collection.id, { recursive: true });
      onRefreshTree();
    } catch {
      // 删除失败（例如集合已在别处被删）只刷新树。
      onRefreshTree();
    }
  };

  const createChild = async () => {
    setMenuOpen(false);
    const values = await dialog.requestForm({
      title: translate("collections.newChild"),
      confirmLabel: translate("collections.createConfirm"),
      fields: [{ name: "name", label: translate("collections.childNameLabel"), required: true, maxLength: 256 }],
      onSubmit: ({ name }) =>
        window.refCanvas.collections.create({ parentId: collection.id, name }).then(() => undefined),
    });
    if (values) {
      setExpanded(true);
      onRefreshTree();
    }
  };

  /** 认领捕获：把本集合里落在 browser-captures 的条目复制进用户目录。 */
  const adoptCaptures = async () => {
    setMenuOpen(false);
    try {
      const captureRoot = await window.refCanvas.libraries.capturesDirectory();
      // 主进程路径是 Windows/POSIX 原生分隔符；归一化后做前缀匹配。
      const normalize = (value: string) =>
        value.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
      const rootPrefix = `${normalize(captureRoot)}/`;
      const items = await window.refCanvas.collections.listItems(collection.id);
      const adoptable = items
        .map((item) => item.lastResolvedPath)
        .filter((filePath) => normalize(filePath).startsWith(rootPrefix));
      if (!adoptable.length) {
        void dialog.requestConfirm({
          title: translate("collections.adopt"),
          description: translate("collections.adoptNone"),
          confirmLabel: translate("collections.acknowledge"),
        });
        return;
      }
      const target = await window.refCanvas.system.pickDirectory({
        title: translate("collections.adoptPickTitle"),
      });
      if (!target) return;
      await store.adoptCaptures(adoptable, target);
    } catch {
      // 目录查询失败等异常保持静默，与面板其它后台刷新一致。
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingOver(false);
    const draggedCollectionId = event.dataTransfer.getData(COLLECTION_DRAG_MIME);
    if (draggedCollectionId && draggedCollectionId !== collection.id) {
      // 集合行拖放：嵌套为子集合（防环由仓储 COLLECTION_CYCLE 保证）。
      void window.refCanvas.collections
        .update(draggedCollectionId, { parentId: collection.id })
        .then(() => {
          setExpanded(true);
          onRefreshTree();
        })
        .catch(() => {
          // 环或缺失目标：只刷新树，不打断其它拖放。
          onRefreshTree();
        });
      return;
    }
    const payload = event.dataTransfer.getData(DIRECTORY_ENTRY_MIME);
    if (payload) {
      try {
        const parsed = JSON.parse(payload) as { path?: string; isDirectory?: boolean };
        if (typeof parsed.path === "string") {
          void addPaths([parsed.path]);
          return;
        }
      } catch {
        // 外部拖放携带非 JSON 载荷 → 走 File 路径。
      }
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      void addPaths(window.refCanvas.library.pathsForFiles(files));
    }
  };

  /** 与相邻兄弟集合交换 sortOrder 实现上移/下移。 */
  const reorderSibling = async (direction: -1 | 1) => {
    setMenuOpen(false);
    const siblings = store.collectionTree[collection.parentId ?? ""] ?? [];
    const index = siblings.findIndex((candidate) => candidate.id === collection.id);
    const neighbor = siblings[index + direction];
    if (index < 0 || !neighbor) return;
    try {
      await window.refCanvas.collections.update(collection.id, {
        sortOrder: neighbor.sortOrder,
      });
      await window.refCanvas.collections.update(neighbor.id, {
        sortOrder: collection.sortOrder,
      });
      onRefreshTree();
    } catch {
      // 排序冲突被拒时保持原顺序。
      onRefreshTree();
    }
  };

  const badge = (
    <span className="collection-row-meta">
      {items && items.length > 0 && <span className="nav-count">{items.length}</span>}
      <button
        className="mini-icon-button collection-node-add"
        aria-label={translate("collections.addFilesNamed").replace("{name}", collection.name)}
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          onAddFiles(collection.id);
        }}
      >
        <Plus size={13} />
      </button>
    </span>
  );

  return (
    <div className="collection-node">
      <div
        ref={rowRef}
        className={`collection-row ${active ? "active" : ""} ${draggingOver ? "drop-target" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(COLLECTION_DRAG_MIME, collection.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDraggingOver(true);
        }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={(event) => onDrop(event)}
      >
        <button
          className="collection-tree-chevron"
          aria-label={translate(expanded ? "collections.collapse" : "collections.expand")}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          className="collection-row-main"
          onClick={() => onOpen(collection.id)}
        >
          <Layers size={15} strokeWidth={1.8} />
          <span className="collection-row-name" title={collection.name}>
            {collection.name}
          </span>
        </button>
        {badge}
        <div className="collection-row-actions">
          <button
            className="mini-icon-button"
            aria-label={translate("collections.menu")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((value) => !value);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <>
          <div className="context-menu-dismiss collection-menu-dismiss" onClick={() => setMenuOpen(false)} />
          <div
            ref={menuRef}
            className="collection-menu"
            role="menu"
            style={{
              position: "fixed",
              left: menuPlacement?.left ?? 0,
              top: menuPlacement?.top ?? 0,
              margin: 0,
              maxHeight: menuPlacement?.maxHeight ?? 340,
              visibility: menuPlacement ? "visible" : "hidden",
            }}
          >
            <button role="menuitem" onClick={() => { void onAddFiles(collection.id); setMenuOpen(false); }}>
              <Plus size={15} />
              {translate("collections.addFiles")}
            </button>
            <button role="menuitem" onClick={() => void createChild()}>
              <FolderPlus size={15} />
              {translate("collections.newChild")}
            </button>
            <button role="menuitem" onClick={() => void rename()}>
              <Pencil size={15} />
              {translate("collections.rename")}
            </button>
            <span className="context-menu-divider" />
            <button role="menuitem" onClick={() => void reorderSibling(-1)}>
              <ChevronUp size={15} />
              {translate("collections.moveUp")}
            </button>
            <button role="menuitem" onClick={() => void reorderSibling(1)}>
              <ChevronDown size={15} />
              {translate("collections.moveDown")}
            </button>
            <span className="context-menu-divider" />
            <button role="menuitem" onClick={() => { setMenuOpen(false); void onExport(collection.id); }}>
              <ArrowDownToLine size={15} />
              {translate("collections.export")}
            </button>
            <button role="menuitem" onClick={() => void adoptCaptures()}>
              <FolderOpen size={15} />
              {translate("collections.adopt")}
            </button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void store.openCollectionInNewTab(collection.id, collection.name); }}>
              <SquareArrowOutUpRight size={15} />
              {translate("collections.openInNewTab")}
            </button>
            <span className="context-menu-divider" />
            <button role="menuitem" onClick={() => void remove()}>
              <Trash2 size={15} />
              {translate("collections.delete")}
            </button>
          </div>
        </>
      )}
      <div className={`collection-children ${draggingOver ? "drop-target" : ""}`}>
        {expanded &&
          children.map((child) => (
            <CollectionNode
              key={child.id}
              collection={child}
              depth={depth + 1}
              onRefreshTree={onRefreshTree}
              onOpen={onOpen}
              onAddFiles={onAddFiles}
              onExport={onExport}
            />
          ))}
      </div>
    </div>
  );
}

/** 集合条目网格卡片（含右键菜单：重定位/复制路径/移除）。 */
function CollectionItemCard({
  item,
  onContextMenu,
  selected = false,
  onSelect,
}: {
  item: ReferenceCollectionItem;
  onContextMenu(event: React.MouseEvent, item: ReferenceCollectionItem, sourceInfo?: { url: string; label: string } | null): void;
  selected?: boolean;
  onSelect?(item: ReferenceCollectionItem, event: React.MouseEvent): void;
}) {
  const store = useAppStore();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const [sourceInfo, setSourceInfo] = useState<{ url: string; label: string } | null>(
    null,
  );

  useEffect(() => {
    const node = cardRef.current;
    if (!node || item.state !== "resolved") return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true);
      },
      { rootMargin: "480px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.id, item.state]);

  useEffect(() => {
    setThumbnailUrl(null);
    setFailed(false);
    if (item.state !== "resolved" || !nearViewport) return;
    const request = window.refCanvas.filesystem.previewToken?.(item.lastResolvedPath);
    if (!request) return;
    let cancelled = false;
    void request
      .then((token) => {
        if (!cancelled) setThumbnailUrl(`refbrowse://thumbnail/${token}?priority=visible`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.lastResolvedPath, item.state, nearViewport]);

  useEffect(() => {
    setSourceInfo(null);
    let cancelled = false;
    // 集合条目只带路径：反查资产拿浏览器捕获回写的来源元数据，
    // 非捕获文件（无 sourceUrl）静默保持空。
    void window.refCanvas.library
      .getByPath(item.lastResolvedPath)
      .then((asset) => {
        if (cancelled || !asset) return;
        const url = asset.customFields?.sourceUrl;
        if (!url) return;
        const pageTitle = asset.customFields?.pageTitle?.trim();
        const hostname = (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return "";
          }
        })();
        setSourceInfo({ url, label: pageTitle || hostname || url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.lastResolvedPath]);

  const displayName =
    item.lastResolvedPath.split(/[\\/]/).pop() ?? item.pathKey.split(/[\\/]/).pop() ?? item.pathKey;
  const displayExtension = (() => {
    const dot = displayName.lastIndexOf(".");
    return dot > 0 ? displayName.slice(dot + 1) : "";
  })();

  /** 点击卡片进入右侧预览（与目录网格选中行为一致）。 */
  const openInPreview = () => {
    if (item.state !== "resolved") return;
    store.selectDirectoryEntry({
      path: item.lastResolvedPath,
      name: displayName,
      isDirectory: false,
      extension: displayExtension.toLowerCase(),
    });
  };

  return (
    <div
      ref={cardRef}
      className={`collection-item-card ${stateClasses[item.state]}${
        selected || store.selectedDirectoryEntry?.path === item.lastResolvedPath ? " active" : ""
      }`}
      draggable
      onClick={(event) => {
        openInPreview();
        onSelect?.(item, event);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(
          DIRECTORY_ENTRY_MIME,
          JSON.stringify({ path: item.lastResolvedPath, isDirectory: false }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event, item, sourceInfo);
      }}
    >
      <span className="asset-preview">
        {thumbnailUrl && !failed && item.state === "resolved" ? (
          <img src={thumbnailUrl} alt="" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <span className="asset-placeholder">
            {item.state === "missing" ? (
              <AlertTriangle size={26} />
            ) : (
              <span>{displayExtension.toUpperCase() || "FILE"}</span>
            )}
          </span>
        )}
        <span className={`collection-state-badge ${stateClasses[item.state]}`}>
          {stateLabel(item.state)}
        </span>
        {selected && <span className="selection-badge"><Check size={13} /></span>}
      </span>
      <span className="asset-title" title={item.lastResolvedPath}>
        {displayName}
      </span>
      <span className="collection-item-path" title={item.lastResolvedPath}>
        {itemParentLabel(item)}
      </span>
    </div>
  );
}

function CollectionFolderCard({
  folder,
  list,
  onOpen,
}: {
  folder: CollectionVirtualFolder;
  list?: boolean;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      className={`collection-folder-card${list ? " list" : ""}`}
      onClick={onOpen}
      aria-label={folder.segments.join("\\")}
    >
      <span className="collection-folder-icon"><FolderOpen size={list ? 17 : 27} /></span>
      <span className="collection-folder-copy">
        <strong>{folder.label}</strong>
        <small>
          {folder.fileCount} {translate("collections.filesShort")}
          {folder.attentionCount > 0 && ` · ${folder.attentionCount} ${translate("collections.attentionShort")}`}
        </small>
      </span>
      {!list && <ChevronRight size={15} className="collection-folder-arrow" />}
    </button>
  );
}

function CollectionVirtualContent({
  folders,
  items,
  viewMode,
  cardScale,
  renderFolder,
  renderItem,
}: {
  folders: CollectionVirtualFolder[];
  items: ReferenceCollectionItem[];
  viewMode: "grid" | "list";
  cardScale: number;
  renderFolder(folder: CollectionVirtualFolder): ReactNode;
  renderItem(item: ReferenceCollectionItem): ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 600, top: 0 });
  const cardWidth = Math.max(148, Math.round(148 * cardScale));
  const gap = Math.max(8, Math.round(12 * cardScale));
  const columns = viewMode === "list"
    ? 1
    : Math.max(1, Math.floor((viewport.width + gap) / (cardWidth + gap)));
  const rowHeight = viewMode === "list"
    ? 64
    : Math.max(150, Math.round(202 * cardScale));
  const entries = useMemo(
    () => [
      ...folders.map((folder) => ({ kind: "folder" as const, folder })),
      ...items.map((item) => ({ kind: "item" as const, item })),
    ],
    [folders, items],
  );
  const rowCount = Math.ceil(entries.length / columns);
  const firstRow = Math.max(0, Math.floor(viewport.top / rowHeight) - 2);
  const lastRow = Math.min(rowCount, Math.ceil((viewport.top + viewport.height) / rowHeight) + 2);
  const startIndex = firstRow * columns;
  const endIndex = Math.min(entries.length, lastRow * columns);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const sync = () => setViewport({ width: node.clientWidth || 800, height: node.clientHeight || 600, top: node.scrollTop });
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewMode, cardScale]);

  return (
    <div
      className={`collection-browser-content ${viewMode}`}
      ref={viewportRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        setViewport((current) => ({ ...current, top: node.scrollTop }));
      }}
    >
      <div className="collection-browser-canvas" style={{ height: Math.max(rowHeight, rowCount * rowHeight) }}>
        {entries.slice(startIndex, endIndex).map((entry, offset) => {
          const absoluteIndex = startIndex + offset;
          const row = Math.floor(absoluteIndex / columns);
          const column = absoluteIndex % columns;
          const style: React.CSSProperties = viewMode === "list"
            ? { top: row * rowHeight, left: 0, width: "100%", height: rowHeight }
            : { top: row * rowHeight, left: column * (cardWidth + gap), width: cardWidth, height: rowHeight };
          return (
            <div className="collection-browser-cell" style={style} key={entry.kind === "folder" ? entry.folder.id : entry.item.id}>
              {entry.kind === "folder" ? renderFolder(entry.folder) : renderItem(entry.item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 集合详情视图：条目网格（main 区域），由 DirectoryAssetPanel 挂载。 */
export function LegacyCollectionDetailsPanel() {
  const store = useAppStore();
  const dialog = useDialog();
  const collectionId = store.activeCollectionId;
  const collection = useMemo(
    () => (collectionId ? store.collections.find((candidate) => candidate.id === collectionId) ?? null : null),
    [collectionId, store.collections],
  );
  const items = collectionId ? store.collectionItems[collectionId] ?? [] : [];
  const [resolving, setResolving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSnapshot, setExportSnapshot] = useState<CollectionExportSnapshot | null>(null);
  const [runningExportId, setRunningExportId] = useState<string | null>(null);
  const [itemMenu, setItemMenu] = useState<{
    item: ReferenceCollectionItem;
    x: number;
    y: number;
  } | null>(null);
  // 浏览器捕获落盘根：用于判断条目是否为可安全删除的捕获文件。
  const [capturesRoot, setCapturesRoot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.libraries
      .capturesDirectory()
      .then((root) => {
        if (!cancelled) setCapturesRoot(root);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!itemMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".asset-context-menu")) return;
      setItemMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [itemMenu]);

  if (!collection) {
    return (
      <section className="board-panel board-unavailable">
        <p>{translate("preview.error")}</p>
        <button className="secondary-button" onClick={() => store.closeCollection()}>
          {translate("workspace.disk")}
        </button>
      </section>
    );
  }

  const resolve = async () => {
    setResolving(true);
    try {
      await window.refCanvas.collections.resolve(collection.id);
      await store.refreshCollections();
    } finally {
      setResolving(false);
    }
  };

  const removeItems = async (ids: string[]) => {
    if (!ids.length) return;
    await window.refCanvas.collections.removeItems(collection.id, ids);
    await store.refreshCollections();
  };

  const normalizeForPrefix = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
  /** 仅捕获目录内的文件允许“删除文件”——集合可引用任意磁盘文件，不能扩大化。 */
  const isBrowserCapturePath = (value: string): boolean =>
    capturesRoot !== null &&
    normalizeForPrefix(value).startsWith(
      `${normalizeForPrefix(capturesRoot)}/`,
    );

  const addItemToBoard = (item: ReferenceCollectionItem) => {
    if (item.state !== "resolved") return;
    void store.addDirectoryEntriesToBoard([item.lastResolvedPath]);
  };

  /** 删除捕获文件：进系统回收站（可恢复），并同步移除集合引用。 */
  const deleteCaptureFile = async (item: ReferenceCollectionItem) => {
    const confirmed = await dialog.requestConfirm({
      title: translate("collections.deleteCaptureFile"),
      description: translate("collections.deleteCaptureFileDesc"),
      confirmLabel: translate("collections.deleteCaptureFile"),
      danger: true,
    });
    if (!confirmed) return;
    if (!(await store.trashEntries([item.lastResolvedPath]))) return;
    await window.refCanvas.collections.removeItems(collection.id, [item.id]);
    await Promise.all([store.refreshCollections(), store.reloadAssets()]);
  };

  const relinkItem = async (item: ReferenceCollectionItem) => {
    const picked = await window.refCanvas.system.pickFile({
      title: `${translate("collections.resolve")}：${item.lastResolvedPath.split(/[\\/]/).pop() ?? item.pathKey}`,
      defaultPath: item.lastResolvedPath,
    });
    if (!picked[0]) return;
    try {
      await window.refCanvas.collections.relink(item.id, picked[0], false);
    } catch (error) {
      if (error instanceof Error && error.message === "RELINE_FINGERPRINT_CHANGED") {
        const confirmed = await dialog.requestConfirm({
          title: translate("collections.fingerprintChanged"),
          description: translate("collections.fingerprintChangedDesc"),
          confirmLabel: translate("collections.resolve"),
          danger: true,
        });
        if (confirmed) {
          await window.refCanvas.collections.relink(item.id, picked[0], true);
        }
      } else {
        throw error;
      }
    }
    await store.refreshCollections();
  };
  const exportCollection = async () => {
    if (!collectionId) return;
    const targetDirectory = await window.refCanvas.system.pickDirectory({
      title: `${translate("collections.export")}“${collection.name}”`,
    });
    if (!targetDirectory) return;
    const conflictAction = await askExportConflictAction(dialog);
    if (!conflictAction) return;
    setExporting(true);
    setExportSnapshot(null);
    const jobId = `collection-export-${collectionId}-${Date.now()}`;
    setRunningExportId(jobId);
    try {
      const snapshot = await window.refCanvas.collections.export(
        collectionId,
        targetDirectory,
        { jobId, conflictAction },
      );
      setExportSnapshot(snapshot);
    } finally {
      setExporting(false);
      setRunningExportId(null);
    }
  };

  const cancelRunningExport = async () => {
    if (!runningExportId) return;
    await window.refCanvas.collections.cancelExport(runningExportId);
    setRunningExportId(null);
  };

  return (
    <section className="collection-details-panel">
      <header className="collection-details-header">
        <div className="collection-title-row">
          <Layers size={17} strokeWidth={1.8} />
          <h2 title={collection.name}>{collection.name}</h2>
          <span className="nav-count">
            {translate("collections.itemCount").replace("{count}", String(items.length))}
          </span>
        </div>
        <div className="collection-detail-actions">
          <button className="secondary-button" onClick={() => void resolve()} disabled={resolving}>
            <RefreshCw size={14} className={resolving ? "spin" : ""} />
            {resolving ? translate("collections.resolving") : translate("collections.resolve")}
          </button>
          {runningExportId ? (
            <button className="secondary-button" onClick={() => void cancelRunningExport()}>
              <X size={14} />
              {translate("collections.cancelExport")}
            </button>
          ) : (
            <button className="secondary-button" onClick={() => void exportCollection()} disabled={exporting}>
              <ArrowDownToLine size={14} />
              {exporting ? translate("collections.exporting") : translate("collections.export")}
            </button>
          )}
        </div>
      </header>

      {exportSnapshot && (
        <div className="collection-export-summary">
          <Check size={15} />
          {translate("collections.exportSummary")
            .replace("{copied}", String(exportSnapshot.copied))
            .replace("{skipped}", String(exportSnapshot.skipped))
            .replace("{failed}", String(exportSnapshot.failed))}
          {exportSnapshot.manifestPath && (
            <span className="collection-export-manifest" title={exportSnapshot.manifestPath}>
              · {exportSnapshot.manifestPath.split(/[\\/]/).pop()}
            </span>
          )}
          {exportSnapshot.errorMessage && (
            <span className="collection-export-error">· {exportSnapshot.errorMessage}</span>
          )}
          <button
            className="mini-icon-button"
            aria-label={translate("preview.close")}
            onClick={() => setExportSnapshot(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Upload size={25} />
          </span>
          <h3>{translate("collections.empty")}</h3>
          <p>{translate("collections.emptyHint")}</p>
        </div>
      ) : (
        <div className="collection-items-grid">
          {items.map((item) => (
            <CollectionItemCard
              key={item.id}
              item={item}
              onContextMenu={(event, target) =>
                setItemMenu({
                  item: target,
                  x: Math.max(8, Math.min(event.clientX, window.innerWidth - 236)),
                  y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)),
                })
              }
            />
          ))}
        </div>
      )}

      {itemMenu && (
        <>
          <div
            className="asset-context-menu"
            style={{ left: itemMenu.x, top: itemMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              role="menuitem"
              onClick={() => {
                const target = itemMenu.item;
                setItemMenu(null);
                void relinkItem(target);
              }}
            >
              <Link2 size={16} />
              {translate("collections.relink")}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const target = itemMenu.item;
                setItemMenu(null);
                if (target.state === "resolved") {
                  void window.refCanvas.filesystem.open(target.lastResolvedPath);
                }
              }}
              disabled={itemMenu.item.state !== "resolved"}
            >
              <Eye size={16} />
              {translate("preview.open")}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const target = itemMenu.item;
                setItemMenu(null);
                if (target.state === "resolved") {
                  void window.refCanvas.filesystem.reveal(target.lastResolvedPath);
                }
              }}
              disabled={itemMenu.item.state !== "resolved"}
            >
              <FolderOpen size={16} />
              {translate("preview.reveal")}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                void window.refCanvas.system.writeClipboard(itemMenu.item.lastResolvedPath);
                setItemMenu(null);
              }}
            >
              <Copy size={16} />
              {translate("preview.copyPath")}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const target = itemMenu.item;
                setItemMenu(null);
                addItemToBoard(target);
              }}
              disabled={itemMenu.item.state !== "resolved"}
            >
              <PanelsTopLeft size={16} />
              {translate("directory.addToBoard")}
            </button>
            <span className="context-menu-divider" />
            <button
              role="menuitem"
              onClick={() => {
                const target = itemMenu.item;
                setItemMenu(null);
                void removeItems([target.id]);
              }}
            >
              <Trash2 size={16} />
              {translate("collections.removeItem")}
            </button>
            {isBrowserCapturePath(itemMenu.item.lastResolvedPath) && (
              <button
                role="menuitem"
                onClick={() => {
                  const target = itemMenu.item;
                  setItemMenu(null);
                  void deleteCaptureFile(target);
                }}
              >
                <Trash2 size={16} />
                {translate("collections.deleteCaptureFile")}
              </button>
            )}
          </div>
          <div className="context-menu-dismiss collection-menu-dismiss" onClick={() => setItemMenu(null)} />
        </>
      )}
    </section>
  );
}

/** 集合内容的磁盘式虚拟目录浏览器：目录只由引用路径推导，不写入磁盘。 */
export function CollectionDetailsPanel() {
  const store = useAppStore();
  const dialog = useDialog();
  const collectionId = store.activeCollectionId;
  const collection = useMemo(
    () => (collectionId
      ? store.collections.find((candidate) => candidate.id === collectionId) ?? null
      : null),
    [collectionId, store.collections],
  );
  const items = collectionId ? store.collectionItems[collectionId] ?? [] : [];
  const tree = useMemo(() => buildCollectionVirtualTree(items), [items]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const [folderId, setFolderId] = useState("");
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<CollectionSearchScope>("current");
  const [stateFilter, setStateFilter] = useState<CollectionFilterState>("all");
  const [sortMode, setSortMode] = useState<CollectionSortMode>("name");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const cardScale = 1;
  const [resolving, setResolving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [itemMenu, setItemMenu] = useState<{
    item: ReferenceCollectionItem;
    x: number;
    y: number;
    sourceInfo?: { url: string; label: string } | null;
  } | null>(null);
  const [capturesRoot, setCapturesRoot] = useState<string | null>(null);
  const selection = useDirectorySelection();
  const selectedIds = selection.state.selectedPaths;
  const clearSelection = selection.clear;
  const selectLoaded = selection.selectLoaded;

  useEffect(() => {
    setFolderId("");
    setHistory([""]);
    setHistoryIndex(0);
    clearSelection();
  }, [clearSelection, collectionId]);

  useEffect(() => {
    const valid = new Set(items.map((item) => item.id));
    const next = [...selectedIds].filter((id) => valid.has(id));
    if (next.length !== selectedIds.size) selectLoaded(next);
  }, [items, selectLoaded, selectedIds]);

  useEffect(() => {
    if (!itemMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".asset-context-menu")) return;
      setItemMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setItemMenu(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [itemMenu]);

  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.libraries
      .capturesDirectory()
      .then((root) => {
        if (!cancelled) setCapturesRoot(root);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const result: Record<CollectionFilterState, number> = {
      all: items.length,
      resolved: 0,
      offline: 0,
      missing: 0,
      ambiguous: 0,
    };
    for (const item of items) result[item.state] += 1;
    return result;
  }, [items]);

  const filteredItems = useMemo(
    () => sortCollectionItems(
      filterCollectionItems(items, tree, {
        query,
        state: stateFilter,
        scope: searchScope,
        folderId,
      }),
      sortMode,
    ),
    [folderId, items, query, searchScope, sortMode, stateFilter, tree],
  );

  if (!collection) {
    return (
      <section className="board-panel board-unavailable">
        <p>{translate("preview.error")}</p>
        <button className="secondary-button" onClick={() => store.closeCollection()}>
          {translate("workspace.disk")}
        </button>
      </section>
    );
  }

  const currentFolder = tree.folders.get(folderId) ?? tree.folders.get("")!;
  const navigateTo = (nextFolderId: string) => {
    // Keep virtual history local to the active collection.
    if (!tree.folders.has(nextFolderId) || nextFolderId === folderId) return;
    const nextHistory = [...history.slice(0, historyIndex + 1), nextFolderId];
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setFolderId(nextFolderId);
    clearSelection();
  };
  const navigateHistory = (direction: -1 | 1) => {
    const nextIndex = historyIndex + direction;
    const nextFolderId = history[nextIndex];
    if (nextFolderId === undefined) return;
    setHistoryIndex(nextIndex);
    setFolderId(nextFolderId);
    clearSelection();
  };

  const folderMatches = (id: string): boolean => {
    const folder = tree.folders.get(id);
    if (!folder) return false;
    const hasDirect = folder.itemIds.some((itemId) => {
      const item = itemsById.get(itemId);
      return Boolean(item && (stateFilter === "all" || item.state === stateFilter));
    });
    return hasDirect || folder.childIds.some((childId) => folderMatches(childId));
  };
  // The collection landing view stays focused on materials. Virtual folders
  // remain part of the model for path-aware search and future navigation, but
  // are intentionally not surfaced as large cards in this content pane.
  const showFolders = false;
  const visibleFolders = showFolders
    ? currentFolder.childIds
      .map((id) => tree.folders.get(id))
      .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder && folderMatches(folder.id)))
    : [];
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const selectedResolved = selectedItems.filter((item) => item.state === "resolved");
  const crumbs = [
    { id: "", label: translate("collections.paneTitle") },
    ...currentFolder.segments.map((segment, index) => ({
      id: currentFolder.segments
        .slice(0, index + 1)
        .map((value) => value.toLocaleLowerCase("en-US"))
        .join("/"),
      label: segment,
    })),
  ];

  const addFiles = async () => {
    const picked = await window.refCanvas.system.pickFile({
      title: translate("collections.pickFiles"),
      multiSelections: true,
      filters: [{ name: translate("ai.fileFilterAll"), extensions: ["*"] }],
    });
    if (!picked.length) return;
    const result = await window.refCanvas.collections.addPaths(collection.id, picked);
    notifySkippedDirectories(dialog, result.skipped);
    await store.refreshCollections();
  };
  const resolve = async () => {
    setResolving(true);
    try {
      await window.refCanvas.collections.resolve(collection.id);
      await store.refreshCollections();
    } finally {
      setResolving(false);
    }
  };
  const removeSelected = async () => {
    if (!selectedItems.length) return;
    await window.refCanvas.collections.removeItems(collection.id, selectedItems.map((item) => item.id));
    clearSelection();
    await store.refreshCollections();
  };
  const normalizeForPrefix = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
  const isBrowserCapturePath = (value: string): boolean =>
    capturesRoot !== null &&
    normalizeForPrefix(value).startsWith(`${normalizeForPrefix(capturesRoot)}/`);
  const deleteFile = async (item: ReferenceCollectionItem) => {
    const confirmed = await dialog.requestConfirm({
      title: translate("collections.deleteFile"),
      description: translate("collections.deleteFileDesc"),
      confirmLabel: translate("collections.deleteFile"),
      danger: true,
    });
    if (!confirmed || !(await store.trashEntries([item.lastResolvedPath]))) return;
    await window.refCanvas.collections.removeItems(collection.id, [item.id]);
    await Promise.all([store.refreshCollections(), store.reloadAssets()]);
  };
  const addSelectedToBoard = () => {
    if (selectedResolved.length) {
      void store.addDirectoryEntriesToBoard(selectedResolved.map((item) => item.lastResolvedPath));
    }
  };
  const copySelectedPaths = () => {
    if (selectedItems.length) {
      void window.refCanvas.system.writeClipboard(selectedItems.map((item) => item.lastResolvedPath).join("\r\n"));
    }
  };
  const exportCollection = async () => {
    const targetDirectory = await window.refCanvas.system.pickDirectory({
      title: translate("collections.exportNamed").replace("{name}", collection.name),
    });
    if (!targetDirectory) return;
    const conflictAction = await askExportConflictAction(dialog);
    if (!conflictAction) return;
    setExporting(true);
    try {
      await window.refCanvas.collections.export(collection.id, targetDirectory, {
        jobId: `collection-export-${collection.id}-${Date.now()}`,
        conflictAction,
      });
    } finally {
      setExporting(false);
    }
  };
  const relinkItem = async (item: ReferenceCollectionItem) => {
    const picked = await window.refCanvas.system.pickFile({
      title: `${translate("collections.resolve")}：${itemDisplayName(item)}`,
      defaultPath: item.lastResolvedPath,
    });
    if (!picked[0]) return;
    try {
      await window.refCanvas.collections.relink(item.id, picked[0], false);
    } catch (error) {
      if (error instanceof Error && error.message === "RELINE_FINGERPRINT_CHANGED") {
        const confirmed = await dialog.requestConfirm({
          title: translate("collections.fingerprintChanged"),
          description: translate("collections.fingerprintChangedDesc"),
          confirmLabel: translate("collections.resolve"),
          danger: true,
        });
        if (confirmed) await window.refCanvas.collections.relink(item.id, picked[0], true);
      } else {
        throw error;
      }
    }
    await store.refreshCollections();
  };
  const addDroppedPaths = async (paths: string[]) => {
    if (!paths.length) return;
    const result = await window.refCanvas.collections.addPaths(collection.id, paths);
    notifySkippedDirectories(dialog, result.skipped);
    await store.refreshCollections();
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingOver(false);
    const payload = event.dataTransfer.getData(DIRECTORY_ENTRY_MIME);
    if (payload) {
      try {
        const parsed = JSON.parse(payload) as { path?: string };
        if (parsed.path) {
          void addDroppedPaths([parsed.path]);
          return;
        }
      } catch {
        // Fall through to native files.
      }
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void addDroppedPaths(window.refCanvas.library.pathsForFiles(files));
  };

  return (
    <section
      className={`collection-details-panel collection-browser-panel${draggingOver ? " drop-target" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDraggingOver(true); }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={handleDrop}
    >
      <header className="collection-details-header collection-browser-header">
        <div className="collection-title-row">
          <Layers size={17} strokeWidth={1.8} />
          <div className="collection-title-copy">
            <h2 title={collection.name}>{collection.name}</h2>
            <span className="collection-total-count">
              {translate("collections.itemCount").replace("{count}", String(counts.all))}
            </span>
          </div>
          <div className="collection-health-summary" role="group" aria-label={translate("collections.statusSummary")}>
            {(["all", "resolved", "offline", "missing", "ambiguous"] as const).map((state) => (
              <button
                type="button"
                key={state}
                className={`collection-health-chip ${state === "all" ? "all" : stateClasses[state]}${stateFilter === state ? " active" : ""}`}
                aria-pressed={stateFilter === state}
                onClick={() => setStateFilter(state)}
              >
                {state === "all" ? translate("collections.all") : stateLabel(state)}
                <strong>{counts[state]}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="collection-detail-actions">
          <button className="secondary-button" onClick={() => void addFiles()}>
            <Plus size={14} />{translate("collections.addFiles")}
          </button>
          <button className="secondary-button" onClick={() => void resolve()} disabled={resolving || counts.offline + counts.missing + counts.ambiguous === 0}>
            <RefreshCw size={14} className={resolving ? "spin" : ""} />
            {resolving ? translate("collections.resolving") : translate("collections.resolve")}
          </button>
          <button className="secondary-button" onClick={() => void exportCollection()} disabled={exporting || counts.all === 0}>
            <ArrowDownToLine size={14} />{exporting ? translate("collections.exporting") : translate("collections.export")}
          </button>
        </div>
      </header>

      <div className="collection-browser-toolbar">
        <div className="collection-breadcrumb-nav">
          <button className="icon-button" aria-label={translate("directory.back")} disabled={historyIndex <= 0} onClick={() => navigateHistory(-1)}><ArrowLeft size={16} /></button>
          <button className="icon-button" aria-label={translate("directory.forward")} disabled={historyIndex >= history.length - 1} onClick={() => navigateHistory(1)}><ArrowRight size={16} /></button>
          <nav className="collection-virtual-crumbs" aria-label={translate("collections.breadcrumb")}>
            {crumbs.map((crumb, index) => (
              <span className="collection-virtual-crumb" key={crumb.id}>
                {index > 0 && <span className="dir-crumb-sep">›</span>}
                <button className={index === crumbs.length - 1 ? "current" : ""} onClick={() => navigateTo(crumb.id)}>{crumb.label}</button>
              </span>
            ))}
          </nav>
        </div>
        <div className="collection-browser-tools">
          <label className="collection-search-field">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate("collections.searchPlaceholder")} aria-label={translate("collections.searchPlaceholder")} />
            {query && <button type="button" className="mini-icon-button" aria-label={translate("collections.clearSearch")} onClick={() => setQuery("")}><X size={13} /></button>}
          </label>
          <SelectMenu<CollectionSearchScope>
            className="collection-browser-select"
            ariaLabel={translate("collections.searchScope")}
            value={searchScope}
            options={[
              { value: "current", label: translate("collections.currentFolder") },
              { value: "all", label: translate("collections.allItems") },
            ]}
            onValueChange={setSearchScope}
          />
          <SelectMenu<CollectionSortMode>
            className="collection-browser-select"
            ariaLabel={translate("collections.sortBy")}
            value={sortMode}
            options={[
              { value: "name", label: translate("directory.sortName") },
              { value: "status", label: translate("collections.sortStatus") },
              { value: "added", label: translate("collections.sortAdded") },
            ]}
            onValueChange={setSortMode}
          />
          <div className="collection-view-mode" role="group" aria-label={translate("directory.viewMode")}>
            <button type="button" className={viewMode === "grid" ? "active" : ""} aria-label={translate("directory.gridView")} aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}><LayoutGrid size={15} /></button>
            <button type="button" className={viewMode === "list" ? "active" : ""} aria-label={translate("directory.listView")} aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><List size={15} /></button>
          </div>
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className="collection-batch-toolbar" role="toolbar" aria-label={translate("collections.batchToolbar")}>
          <strong>{selectedItems.length} {translate("collections.selectedShort")}</strong>
          <button className="secondary-button" onClick={addSelectedToBoard} disabled={!selectedResolved.length}><PanelsTopLeft size={14} />{translate("directory.addToBoard")}</button>
          <button className="secondary-button" onClick={copySelectedPaths}><Copy size={14} />{translate("preview.copyPath")}</button>
          <button className="secondary-button danger" onClick={() => void removeSelected()}><Trash2 size={14} />{translate("collections.removeItem")}</button>
          <button className="mini-icon-button" aria-label={translate("directory.clearSelection")} onClick={() => selection.clear()}><X size={14} /></button>
        </div>
      )}

      {showFolders && visibleFolders.length === 0 && filteredItems.length === 0 ? (
        <div className="empty-state collection-empty-browser">
          <span className="empty-icon"><FolderOpen size={25} /></span>
          <h3>{query || stateFilter !== "all" ? translate("collections.noMatches") : translate("collections.empty")}</h3>
          <p>{query || stateFilter !== "all" ? translate("collections.noMatchesHint") : translate("collections.emptyHint")}</p>
          {!query && stateFilter === "all" && <button className="secondary-button" onClick={() => void addFiles()}><Plus size={14} />{translate("collections.addFiles")}</button>}
          {(query || stateFilter !== "all") && <button className="secondary-button" onClick={() => { setQuery(""); setStateFilter("all"); }}><X size={14} />{translate("collections.clearFilters")}</button>}
        </div>
      ) : (
        <CollectionVirtualContent
          folders={showFolders ? visibleFolders : []}
          items={filteredItems}
          viewMode={viewMode}
          cardScale={cardScale}
          renderFolder={(folder) => (
            <CollectionFolderCard folder={folder} list={viewMode === "list"} onOpen={() => navigateTo(folder.id)} />
          )}
          renderItem={(item) => (
            <CollectionItemCard
              item={item}
              selected={selectedIds.has(item.id)}
              onSelect={(target, event) => selection.click(filteredItems.map((candidate) => candidate.id), target.id, event.ctrlKey || event.metaKey, event.shiftKey)}
              onContextMenu={(event, target, sourceInfo) => setItemMenu({ item: target, sourceInfo, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)) })}
            />
          )}
        />
      )}

      {itemMenu && (
        <div className="asset-context-menu" role="menu" style={{ left: itemMenu.x, top: itemMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          {itemMenu.sourceInfo && (
            <button role="menuitem" onClick={() => { const source = itemMenu.sourceInfo; setItemMenu(null); if (source) void window.refCanvas.system.openUrl(source.url).catch(() => undefined); }}><Globe size={16} />{translate("collections.openSource")}</button>
          )}
          <button role="menuitem" onClick={() => { const item = itemMenu.item; setItemMenu(null); void relinkItem(item); }}><Link2 size={16} />{translate("collections.relink")}</button>
          <button role="menuitem" onClick={() => { const item = itemMenu.item; setItemMenu(null); void window.refCanvas.filesystem.reveal(item.lastResolvedPath); }}><FolderOpen size={16} />{translate("preview.reveal")}</button>
          <button role="menuitem" onClick={() => { void window.refCanvas.system.writeClipboard(itemMenu.item.lastResolvedPath); setItemMenu(null); }}><Copy size={16} />{translate("preview.copyPath")}</button>
          <span className="context-menu-divider" />
          <button role="menuitem" onClick={() => { const item = itemMenu.item; setItemMenu(null); void window.refCanvas.collections.removeItems(collection.id, [item.id]).then(() => store.refreshCollections()); }}><Trash2 size={16} />{translate("collections.removeItem")}</button>
          {itemMenu.item.state !== "missing" && (
            <button role="menuitem" onClick={() => { const item = itemMenu.item; setItemMenu(null); void deleteFile(item); }}>
              <Trash2 size={16} />
              {isBrowserCapturePath(itemMenu.item.lastResolvedPath)
                ? translate("collections.deleteCaptureFile")
                : translate("collections.deleteFile")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** 侧栏引用集合区（§5.1 左栏分组）。 */
export function CollectionsPanel({
  style,
}: {
  style?: React.CSSProperties;
}) {
  const store = useAppStore();
  const dialog = useDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);

  const updateMenuPlacement = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menu = menuRef.current;
    const next = placeTriggerMenu(
      rect,
      { width: menu?.offsetWidth || 220, height: menu?.offsetHeight || 90 },
      { width: window.innerWidth, height: window.innerHeight },
      4,
      8,
      "right",
    );
    setMenuPlacement(next);
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null);
      return;
    }
    updateMenuPlacement();
  }, [menuOpen, updateMenuPlacement]);

  useEffect(() => {
    if (!menuOpen) return;
    const reposition = () => updateMenuPlacement();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [menuOpen, updateMenuPlacement]);

  const createCollection = async () => {
    setMenuOpen(false);
    const values = await dialog.requestForm({
      title: translate("collections.create"),
      confirmLabel: translate("collections.createConfirm"),
      fields: [{ name: "name", label: translate("collections.nameLabel"), required: true, maxLength: 256 }],
      onSubmit: ({ name }) =>
        window.refCanvas.collections.create({ name }).then(() => undefined),
    });
    if (values) void store.refreshCollections();
  };

  const createCollectionWithFiles = async () => {
    setMenuOpen(false);
    const picked = await window.refCanvas.system.pickFile({
      title: translate("collections.create"),
      multiSelections: true,
      filters: [
        { name: translate("ai.fileFilterAll"), extensions: ["*"] },
        { name: translate("ai.fileFilterImages"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "exr", "hdr", "avif", "heic", "psd"] },
        { name: translate("ai.fileFilterVideos"), extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] },
      ],
    });
    if (!picked.length) return;
    const values = await dialog.requestForm({
      title: translate("collections.create"),
      confirmLabel: translate("collections.createConfirm"),
      fields: [{ name: "name", label: translate("collections.nameLabel"), required: true, maxLength: 256 }],
    });
    if (!values) return;
    const collection = await window.refCanvas.collections.create({
      name: values.name,
    });
    const { added, skipped } = await window.refCanvas.collections.addPaths(
      collection.id,
      picked,
    );
    notifySkippedDirectories(dialog, skipped);
    await store.refreshCollections();
    store.openCollection(collection.id);
    if (added.length === 0) {
      void dialog.requestConfirm({
        title: translate("collections.empty"),
        description: translate("collections.emptyHint"),
        confirmLabel: translate("collections.acknowledge"),
      });
    }
  };

  const addFiles = async (id: string) => {
    const picked = await window.refCanvas.system.pickFile({
      title: translate("collections.pickFiles"),
      multiSelections: true,
      filters: [
        { name: translate("ai.fileFilterAll"), extensions: ["*"] },
        { name: translate("ai.fileFilterImages"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "exr", "hdr", "avif", "heic", "psd"] },
        { name: translate("ai.fileFilterVideos"), extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] },
      ],
    });
    if (!picked.length) return;
    const { added, skipped } = await window.refCanvas.collections.addPaths(
      id,
      picked,
    );
    notifySkippedDirectories(dialog, skipped);
    await store.refreshCollections();
    if (added.length > 0) store.openCollection(id);
    if (added.length === 0 && picked.length > 0) {
      void dialog.requestConfirm({
        title: translate("collections.addFailed"),
        description: translate("collections.addFailedDesc"),
        confirmLabel: translate("collections.acknowledge"),
      });
    }
  };

  const exportCollection = async (id: string) => {
    const collection = store.collections.find((candidate) => candidate.id === id);
    if (!collection) return;
    const targetDirectory = await window.refCanvas.system.pickDirectory({
      title: translate("collections.exportNamed").replace("{name}", collection.name),
    });
    if (!targetDirectory) return;
    const conflictAction = await askExportConflictAction(dialog);
    if (!conflictAction) return;
    await window.refCanvas.collections.export(id, targetDirectory, {
      jobId: `collection-export-${id}-${Date.now()}`,
      conflictAction,
    });
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingOver(false);
    const payload = event.dataTransfer.getData(DIRECTORY_ENTRY_MIME);
    if (payload) {
      try {
        const parsed = JSON.parse(payload) as { path?: string; isDirectory?: boolean };
        if (typeof parsed.path === "string") {
          void addPathsToActive(parsed.path);
          return;
        }
      } catch {
        // 外部拖放。
      }
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void addPathsToActiveFiles(files);
  };

  const addPathsToActive = async (path: string) => {
    const active = store.activeCollectionId;
    if (!active) return;
    try {
      const result = await window.refCanvas.collections.addPaths(active, [path]);
      notifySkippedDirectories(dialog, result.skipped);
      await store.refreshCollections();
    } catch {
      // 集合可能已删除；刷新树后回到浏览。
      await store.refreshCollections();
    }
  };

  const addPathsToActiveFiles = async (files: File[]) => {
    const active = store.activeCollectionId;
    if (!active || !files.length) return;
    const paths = window.refCanvas.library.pathsForFiles(files);
    const result = await window.refCanvas.collections.addPaths(active, paths);
    notifySkippedDirectories(dialog, result.skipped);
    await store.refreshCollections();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".collection-menu-head") ||
        target.closest('[aria-label="新建集合"]')
      ) {
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const roots = useMemo(
    () => store.collections.filter((collection) => collection.parentId === null),
    [store.collections],
  );

  return (
    <section
      className={`sidebar-pane collections-section ${collapsed ? "collapsed" : ""}`}
      style={style}
      ref={rootRef}
      onDragOver={(event) => {
        if (!store.activeCollectionId) return;
        event.preventDefault();
        setDraggingOver(true);
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={(event) => onDrop(event)}
    >
      <header className="sidebar-pane-header collections-pane-header">
        <div className="collections-tab active">
          <Layers size={14} />
          <span>{translate("collections.paneTitle")}</span>
        </div>
        <div className="sidebar-pane-actions">
          <VisibilityToggle />
          <button
            type="button"
            className="mini-icon-button"
            ref={menuTriggerRef}
            aria-label={translate("collections.create")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Plus size={14} />
          </button>
          <PaneCollapseButton
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
          />
        </div>
      </header>
      {!collapsed && (
        <div className="sidebar-pane-content">
          {menuOpen && (
            <>
              <div className="context-menu-dismiss collection-menu-dismiss" onClick={() => setMenuOpen(false)} />
              <div
                ref={menuRef}
                className="collection-menu collection-menu-head"
                role="menu"
                style={{
                  position: "fixed",
                  left: menuPlacement?.left ?? 0,
                  top: menuPlacement?.top ?? 0,
                  margin: 0,
                  maxHeight: menuPlacement?.maxHeight ?? 90,
                  visibility: menuPlacement ? "visible" : "hidden",
                }}
              >
                <button type="button" role="menuitem" onClick={() => void createCollection()}>
                  <FolderPlus size={15} />
                  {translate("collections.create")}
                </button>
                <span className="context-menu-divider" />
                <button type="button" role="menuitem" onClick={() => void createCollectionWithFiles()}>
                  <Upload size={15} />
                  {translate("collections.createFromFiles")}
                </button>
              </div>
            </>
          )}
          {roots.length === 0 ? (
            <div className="collections-empty">
              <p>{translate("collections.empty")}</p>
              <button type="button" onClick={() => void createCollection()}>
                <FolderPlus size={14} />
                {translate("collections.create")}
              </button>
            </div>
          ) : (
            <div className="collection-tree">
              {roots.map((collection) => (
                <CollectionNode
                  key={collection.id}
                  collection={collection}
                  depth={0}
                  onRefreshTree={() => void store.refreshCollections()}
                  onOpen={(id) => store.openCollection(id)}
                  onAddFiles={(id) => void addFiles(id)}
                  onExport={(id) => void exportCollection(id)}
                />
              ))}
            </div>
          )}
          <div className={`collection-drop-hint ${draggingOver ? "visible" : ""}`}>
            {translate("collections.dropActive")}
          </div>
        </div>
      )}
    </section>
  );
}
