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
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  FolderOpen,
  FolderPlus,
  Layers,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type DragEvent,
  useEffect,
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
import { useDialog } from "./DialogProvider";
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
  const [draggingOver, setDraggingOver] = useState(false);
  const [pending, setPending] = useState(false);
  const active = store.activeCollectionId === collection.id;

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
        title={translate("collections.addFiles")}
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
          className="dir-tree-chevron"
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
            title={translate("collections.menu")}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <>
          <div className="context-menu-dismiss" onClick={() => setMenuOpen(false)} />
          <div className="collection-menu" role="menu">
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
  onRelink,
  onRemove,
  onContextMenu,
}: {
  item: ReferenceCollectionItem;
  onRelink(item: ReferenceCollectionItem): void;
  onRemove(item: ReferenceCollectionItem): void;
  onContextMenu(event: React.MouseEvent, item: ReferenceCollectionItem): void;
}) {
  const store = useAppStore();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setThumbnailUrl(null);
    setFailed(false);
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
  }, [item.lastResolvedPath]);

  const displayName =
    item.lastResolvedPath.split(/[\\/]/).pop() ?? item.pathKey.split(/[\\/]/).pop() ?? item.pathKey;
  const displayExtension = (() => {
    const dot = displayName.lastIndexOf(".");
    return dot > 0 ? displayName.slice(dot + 1) : "";
  })();

  /** 点击卡片进入右侧预览（与目录网格选中行为一致）。 */
  const openInPreview = () => {
    if (item.state === "missing") return;
    store.selectDirectoryEntry({
      path: item.lastResolvedPath,
      name: displayName,
      isDirectory: false,
      extension: displayExtension.toLowerCase(),
    });
  };

  return (
    <div
      className={`collection-item-card ${stateClasses[item.state]}${
        store.selectedDirectoryEntry?.path === item.lastResolvedPath ? " active" : ""
      }`}
      draggable
      onClick={openInPreview}
      onDragStart={(event) => {
        event.dataTransfer.setData(
          DIRECTORY_ENTRY_MIME,
          JSON.stringify({ path: item.lastResolvedPath, isDirectory: false }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event, item);
      }}
    >
      <span className="asset-preview">
        {thumbnailUrl && !failed ? (
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
      </span>
      <span className="asset-title" title={item.lastResolvedPath}>
        {displayName}
      </span>
      <span className="collection-item-actions">
        <button
          className="mini-icon-button"
          title={translate("collections.relink")}
          aria-label={`${translate("collections.resolve")} ${displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            onRelink(item);
          }}
        >
          <Link2 size={13} />
        </button>
        <button
          className="mini-icon-button"
          title={translate("preview.copyPath")}
          aria-label={`${translate("preview.copyPath")} ${displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            void window.refCanvas.system.writeClipboard(item.lastResolvedPath);
          }}
        >
          <Copy size={13} />
        </button>
        <button
          className="mini-icon-button danger-hover"
          title={translate("collections.removeItem")}
          aria-label={`${translate("collections.removeItem")} ${displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item);
          }}
        >
          <X size={13} />
        </button>
      </span>
    </div>
  );
}

/** 集合详情视图：条目网格（main 区域），由 DirectoryAssetPanel 挂载。 */
export function CollectionDetailsPanel() {
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
              onRelink={(target) => void relinkItem(target)}
              onRemove={(target) => void removeItems([target.id])}
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
          </div>
          <div className="context-menu-dismiss" onClick={() => setItemMenu(null)} />
        </>
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
            aria-label={translate("collections.create")}
            title={translate("collections.create")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="mini-icon-button pane-collapse"
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? translate("directory.expand") : translate("directory.collapse")
            }
            title={
              collapsed ? translate("directory.expand") : translate("directory.collapse")
            }
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      </header>
      {!collapsed && (
        <div className="sidebar-pane-content">
          {menuOpen && (
            <>
              <div className="context-menu-dismiss" onClick={() => setMenuOpen(false)} />
              <div className="collection-menu collection-menu-head" role="menu">
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
