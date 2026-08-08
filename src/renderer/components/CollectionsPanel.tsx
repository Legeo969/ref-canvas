/**
 * 引用集合面板（FND-003，found-clone.md §6）。
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
  CollectionExportSnapshot,
  CollectionItemState,
  ReferenceCollection,
  ReferenceCollectionItem,
} from "../../shared/contracts";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";

const stateLabels: Record<CollectionItemState, string> = {
  resolved: "可解析",
  offline: "离线",
  missing: "缺失",
  ambiguous: "歧义",
};

const stateClasses: Record<CollectionItemState, string> = {
  resolved: "state-resolved",
  offline: "state-offline",
  missing: "state-missing",
  ambiguous: "state-ambiguous",
};

/** 目录条目拖拽 MIME（DirectoryAssetPanel 注入）。 */
const DIRECTORY_ENTRY_MIME = "application/x-refcanvas-directory-entry";

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
      await window.refCanvas.collections.addPaths(collection.id, paths);
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
      title: "重命名集合",
      confirmLabel: "保存",
      fields: [
        { name: "name", label: "集合名称", required: true, maxLength: 256, initialValue: collection.name },
      ],
      onSubmit: ({ name }) =>
        void window.refCanvas.collections.update(collection.id, { name }),
    });
    if (values) onRefreshTree();
  };

  const remove = async () => {
    setMenuOpen(false);
    const childCount = children.length;
    const itemCount = items?.length ?? 0;
    if (childCount === 0 && itemCount === 0) {
      const confirmed = await dialog.requestConfirm({
        title: "删除集合",
        description: `确定删除“${collection.name}”吗？此操作不可撤销。`,
        confirmLabel: "删除",
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
      ? `${children.length} 个子集合、${items?.length ?? 0} 个条目`
      : `${items?.length ?? 0} 个条目`;
    const confirmed = await dialog.requestConfirm({
      title: "递归删除集合",
      description: `“${collection.name}”包含 ${scope}。删除不会移除磁盘上的任何文件，但集合引用将永久丢失。`,
      confirmLabel: "删除集合",
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
      title: "新建子集合",
      confirmLabel: "创建",
      fields: [{ name: "name", label: "子集合名称", required: true, maxLength: 256 }],
      onSubmit: ({ name }) =>
        void window.refCanvas.collections.create({ parentId: collection.id, name }),
    });
    if (values) {
      setExpanded(true);
      onRefreshTree();
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingOver(false);
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

  const badge =
    items && items.length > 0 ? (
      <span className="nav-count">{items.length}</span>
    ) : (
      <button
        className="mini-icon-button collection-node-add"
        aria-label={`添加文件到 ${collection.name}`}
        title="添加文件"
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          onAddFiles(collection.id);
        }}
      >
        <Plus size={13} />
      </button>
    );

  return (
    <div className="collection-node">
      <div
        className={`collection-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onDragOver={(event) => {
          event.preventDefault();
          setDraggingOver(true);
        }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={(event) => onDrop(event)}
      >
        <button
          className="dir-tree-chevron"
          aria-label={expanded ? "折叠集合" : "展开集合"}
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
          {badge}
        </button>
        <div className="collection-row-actions">
          <button
            className="mini-icon-button"
            aria-label="集合菜单"
            title="集合操作"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <>
          <div className="collection-menu">
            <button role="menuitem" onClick={() => { void onAddFiles(collection.id); setMenuOpen(false); }}>
              <Plus size={15} />
              添加文件…
            </button>
            <button role="menuitem" onClick={() => void createChild()}>
              <FolderPlus size={15} />
              新建子集合
            </button>
            <button role="menuitem" onClick={() => void rename()}>
              <Pencil size={15} />
              重命名
            </button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void onExport(collection.id); }}>
              <ArrowDownToLine size={15} />
              导出…
            </button>
            <span className="context-menu-divider" />
            <button role="menuitem" onClick={() => void remove()}>
              <Trash2 size={15} />
              删除集合
            </button>
          </div>
          <div className="context-menu-dismiss" onClick={() => setMenuOpen(false)} />
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

  return (
    <div
      className={`collection-item-card ${stateClasses[item.state]}`}
      draggable
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
            {item.state === "missing" ? <AlertTriangle size={26} /> : <FolderOpen size={26} strokeWidth={1.35} />}
          </span>
        )}
        <span className={`collection-state-badge ${stateClasses[item.state]}`}>
          {stateLabels[item.state]}
        </span>
      </span>
      <span className="asset-title" title={item.lastResolvedPath}>
        {displayName}
      </span>
      <span className="collection-item-actions">
        <button
          className="mini-icon-button"
          title="重定位"
          aria-label={`重定位 ${displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            onRelink(item);
          }}
        >
          <Link2 size={13} />
        </button>
        <button
          className="mini-icon-button"
          title="复制路径"
          aria-label={`复制 ${displayName} 的路径`}
          onClick={(event) => {
            event.stopPropagation();
            void window.refCanvas.system.writeClipboard(item.lastResolvedPath);
          }}
        >
          <Copy size={13} />
        </button>
        <button
          className="mini-icon-button danger-hover"
          title="从集合移除"
          aria-label={`从集合移除 ${displayName}`}
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
        <p>集合不存在或已被删除。</p>
        <button className="secondary-button" onClick={() => store.closeCollection()}>
          返回浏览
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
      title: `重定位：${item.lastResolvedPath.split(/[\\/]/).pop() ?? item.pathKey}`,
      defaultPath: item.lastResolvedPath,
    });
    if (!picked[0]) return;
    try {
      await window.refCanvas.collections.relink(item.id, picked[0], false);
    } catch (error) {
      if (error instanceof Error && error.message === "RELINE_FINGERPRINT_CHANGED") {
        const confirmed = await dialog.requestConfirm({
          title: "指纹不一致",
          description: "所选文件与集合中记录的文件内容不一致。确认仍要更新引用吗？",
          confirmLabel: "仍要重定位",
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
      title: `导出“${collection.name}”到…`,
    });
    if (!targetDirectory) return;
    setExporting(true);
    setExportSnapshot(null);
    const jobId = `collection-export-${collectionId}-${Date.now()}`;
    setRunningExportId(jobId);
    try {
      const snapshot = await window.refCanvas.collections.export(
        collectionId,
        targetDirectory,
        { jobId },
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
          <span className="nav-count">{items.length} 项</span>
        </div>
        <div className="collection-detail-actions">
          <button className="secondary-button" onClick={() => void resolve()} disabled={resolving}>
            <RefreshCw size={14} className={resolving ? "spin" : ""} />
            {resolving ? "解析中…" : "重新解析"}
          </button>
          {runningExportId ? (
            <button className="secondary-button" onClick={() => void cancelRunningExport()}>
              <X size={14} />
              取消导出
            </button>
          ) : (
            <button className="secondary-button" onClick={() => void exportCollection()} disabled={exporting}>
              <ArrowDownToLine size={14} />
              {exporting ? "导出中…" : "导出…"}
            </button>
          )}
        </div>
      </header>

      {exportSnapshot && (
        <div className="collection-export-summary">
          <Check size={15} />
          已复制 {exportSnapshot.copied} · 已跳过 {exportSnapshot.skipped} · 失败{" "}
          {exportSnapshot.failed}
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
            aria-label="关闭导出摘要"
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
          <h3>集合为空</h3>
          <p>拖入文件、文件夹，或点击侧栏集合旁的 + 添加。</p>
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
              重定位…
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
              打开
            </button>
            <button
              role="menuitem"
              onClick={() => {
                void window.refCanvas.system.writeClipboard(itemMenu.item.lastResolvedPath);
                setItemMenu(null);
              }}
            >
              <Copy size={16} />
              复制路径
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
              从集合移除
            </button>
          </div>
          <div className="context-menu-dismiss" onClick={() => setItemMenu(null)} />
        </>
      )}
    </section>
  );
}

/** 侧栏引用集合区（found-clone.md §5.1 左栏分组）。 */
export function CollectionsPanel() {
  const store = useAppStore();
  const dialog = useDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const createCollection = async () => {
    setMenuOpen(false);
    const values = await dialog.requestForm({
      title: "新建集合",
      confirmLabel: "创建",
      fields: [{ name: "name", label: "集合名称", required: true, maxLength: 256 }],
      onSubmit: ({ name }) => void window.refCanvas.collections.create({ name }),
    });
    if (values) void store.refreshCollections();
  };

  const createCollectionWithFiles = async () => {
    setMenuOpen(false);
    const picked = await window.refCanvas.system.pickFile({
      title: "选择要加入新集合的文件",
      multiSelections: true,
      filters: [
        { name: "所有文件", extensions: ["*"] },
        { name: "图像", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "exr", "hdr", "avif", "heic", "psd"] },
        { name: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] },
      ],
    });
    if (!picked.length) return;
    const values = await dialog.requestForm({
      title: "新建集合",
      confirmLabel: "创建",
      fields: [{ name: "name", label: "集合名称", required: true, maxLength: 256 }],
    });
    if (!values) return;
    const collection = await window.refCanvas.collections.create({
      name: values.name,
    });
    const added = await window.refCanvas.collections.addPaths(collection.id, picked);
    await store.refreshCollections();
    store.openCollection(collection.id);
    if (added.length === 0) {
      void dialog.requestConfirm({
        title: "未能添加",
        description: "所选路径没有可加入集合的文件（文件夹不会被加入）。",
        confirmLabel: "知道了",
      });
    }
  };

  const addFiles = async (id: string) => {
    const picked = await window.refCanvas.system.pickFile({
      title: "选择要加入集合的文件",
      multiSelections: true,
      filters: [
        { name: "所有文件", extensions: ["*"] },
        { name: "图像", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "exr", "hdr", "avif", "heic", "psd"] },
        { name: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] },
      ],
    });
    if (!picked.length) return;
    const added = await window.refCanvas.collections.addPaths(id, picked);
    await store.refreshCollections();
    if (added.length === 0 && picked.length > 0) {
      void dialog.requestConfirm({
        title: "未能添加",
        description: "所选路径没有可加入集合的文件（文件夹不会被加入）。",
        confirmLabel: "知道了",
      });
    }
  };

  const exportCollection = async (id: string) => {
    const collection = store.collections.find((candidate) => candidate.id === id);
    if (!collection) return;
    const targetDirectory = await window.refCanvas.system.pickDirectory({
      title: `导出“${collection.name}”到…`,
    });
    if (!targetDirectory) return;
    await window.refCanvas.collections.export(id, targetDirectory, {
      jobId: `collection-export-${id}-${Date.now()}`,
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
      await window.refCanvas.collections.addPaths(active, [path]);
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
    await window.refCanvas.collections.addPaths(active, paths);
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
    <div
      className="sidebar-section collections-section"
      ref={rootRef}
      onDragOver={(event) => {
        if (!store.activeCollectionId) return;
        event.preventDefault();
        setDraggingOver(true);
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={(event) => onDrop(event)}
    >
      <div className="section-label row-label">
        <span>引用集合</span>
        <button
          className="mini-icon-button"
          aria-label="新建集合"
          title="新建集合"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <Plus size={14} />
        </button>
      </div>
      {menuOpen && (
        <>
          <div className="collection-menu collection-menu-head">
            <button role="menuitem" onClick={() => void createCollection()}>
              <FolderPlus size={15} />
              新建集合
            </button>
            <span className="context-menu-divider" />
            <button role="menuitem" onClick={() => void createCollectionWithFiles()}>
              <Upload size={15} />
              选择文件并新建…
            </button>
          </div>
          <div className="context-menu-dismiss" onClick={() => setMenuOpen(false)} />
        </>
      )}
      {roots.length === 0 ? (
        <p className="directory-empty">还没有集合。点击 + 创建引用集合，或拖入文件。</p>
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
        释放以加入当前集合
      </div>
    </div>
  );
}
