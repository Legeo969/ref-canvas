import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Copy,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DirectoryEntry,
  LibraryChangedEvent,
} from "../../shared/contracts";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { FolderGlyph } from "./FolderGlyph";
import { PaneCollapseButton } from "./PaneCollapseButton";
import { VisibilityToggle } from "./VisibilityToggle";
import { useDialog } from "./DialogProvider";

function normalizePath(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

/** 快速访问条目的路径副文字：显示父目录（条目自身 title 已是完整路径）。 */
function quickAccessSubtext(path: string): string {
  const normalized = path.replace(/[\\/]+$/g, "");
  const separator = Math.max(
    normalized.lastIndexOf("\\"),
    normalized.lastIndexOf("/"),
  );
  if (separator <= 0) return path;
  return normalized.slice(0, separator);
}

function FavoriteButton({ path, name }: { path: string; name: string }) {
  const store = useAppStore();
  const entry = store.quickAccess.find(
    (candidate) => normalizePath(candidate.path) === normalizePath(path),
  );
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      if (entry) await store.removeQuickAccess(entry.id);
      else await store.addQuickAccess(path, name);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      className={`mini-icon-button favorite-button ${entry ? "active" : ""}`}
      aria-label={
        entry
          ? translate("directory.unfavoriteNamed").replace("{name}", name)
          : translate("directory.favoriteNamed").replace("{name}", name)
      }
      aria-pressed={Boolean(entry)}
      disabled={pending}
      onClick={() => void toggle()}
    >
      <Star size={13} fill={entry ? "currentColor" : "none"} />
    </button>
  );
}

/** 单个可展开目录节点（展开时才读取下一层）。 */
function DirectoryNode({
  entry,
  depth,
  globalRefreshVersion,
  directoryRefreshVersions,
}: {
  entry: DirectoryEntry;
  depth: number;
  globalRefreshVersion: number;
  directoryRefreshVersions: Record<string, number>;
}) {
  const store = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  // 只有磁盘工作区才显示目录激活态；其他工作区仍保留路径用于返回恢复。
  const active =
    store.workspaceMode === "directory" &&
    store.activeCollectionId === null &&
    store.directoryPath === entry.path;
  const refreshToken = `${globalRefreshVersion}:${
    directoryRefreshVersions[normalizeRefreshPath(entry.path)] ?? 0
  }`;

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    void window.refCanvas.filesystem
      .listDirectory(entry.path, { pageSize: 512 })
      .then((page) => {
        if (!cancelled) setChildren(page.entries);
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path, expanded, refreshToken]);

  return (
    <div>
      <div
        className={`dir-tree-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          className="dir-tree-chevron"
          aria-label={expanded ? translate("directory.collapse") : translate("directory.expand")}
          onClick={() => setExpanded((value) => !value)}
        >
          {loading ? (
            <RefreshCw size={12} className="spin" />
          ) : expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )}
        </button>
        <button
          className="dir-tree-main"
          onClick={() => void store.openDirectory(entry.path)}
        >
          <FolderGlyph size={15} />
          <span className="dir-tree-name" title={entry.path}>
            {entry.name}
          </span>
        </button>
        <FavoriteButton path={entry.path} name={entry.name} />
      </div>
      {expanded &&
        children.map((child) =>
          child.isDirectory ? (
            <DirectoryNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              globalRefreshVersion={globalRefreshVersion}
              directoryRefreshVersions={directoryRefreshVersions}
            />
          ) : null,
        )}
    </div>
  );
}

function normalizeRefreshPath(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

function refreshPathsFor(value: string): string[] {
  const normalized = normalizeRefreshPath(value);
  const separator = normalized.lastIndexOf("\\");
  if (separator < 0) return [normalized];
  const parent = normalized.slice(0, separator);
  return parent && parent !== normalized ? [normalized, parent] : [normalized];
}

function RootNode({
  entry,
  expanded,
  onToggle,
  globalRefreshVersion,
  directoryRefreshVersions,
}: {
  entry: DirectoryEntry;
  expanded: boolean;
  onToggle: () => void;
  globalRefreshVersion: number;
  directoryRefreshVersions: Record<string, number>;
}) {
  const store = useAppStore();
  const active =
    store.workspaceMode === "directory" &&
    store.activeCollectionId === null &&
    store.directoryPath === entry.path;
  return (
    <div className="dir-root-node">
      <div className={`dir-root-row ${active ? "active" : ""}`}>
        <button
          className="dir-tree-chevron"
          aria-label={
            expanded ? translate("directory.collapseDrive") : translate("directory.expandDrive")
          }
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          className="dir-root-main"
          onClick={() => void store.openDirectory(entry.path)}
        >
          <HardDrive size={15} strokeWidth={1.8} />
          <span className="dir-root-copy">
            <strong title={entry.path}>{entry.name}</strong>
            <small title={entry.path}>{entry.path}</small>
          </span>
        </button>
        <FavoriteButton path={entry.path} name={entry.name} />
      </div>
      {expanded && (
        <DirectoryContents
          path={entry.path}
          depth={1}
          globalRefreshVersion={globalRefreshVersion}
          directoryRefreshVersions={directoryRefreshVersions}
        />
      )}
    </div>
  );
}

/** Pane 1（快速访问）：用户收藏目录列表 + 折叠 + 路径副文字。 */
export function QuickAccessPane({
  style,
}: {
  style?: React.CSSProperties;
}) {
  const store = useAppStore();
  const dialog = useDialog();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={`sidebar-pane quick-access-pane ${collapsed ? "collapsed" : ""}`}
      style={collapsed ? undefined : style}
      aria-label={translate("sidebar.quickAccess")}
    >
      <header className="sidebar-pane-header">
        <span className="sidebar-pane-title">
          <Star size={12} fill="currentColor" />
          {translate("sidebar.quickAccess")}
        </span>
        <div className="sidebar-pane-actions">
          <VisibilityToggle />
          <PaneCollapseButton
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
          />
        </div>
      </header>
      {!collapsed && (
        <div className="sidebar-pane-content">
          {store.quickAccess.length > 0 ? (
            <div className="quick-access-list">
              {store.quickAccess.map((entry) => (
                <div
                  className={`quick-access-row ${
                    store.workspaceMode === "directory" &&
                    store.activeCollectionId === null &&
                    store.directoryPath === entry.path
                      ? "active"
                      : ""
                  }`}
                  key={entry.id}
                >
                  <button
                    className="quick-access-main"
                    onClick={() => void store.openDirectory(entry.path)}
                  >
                    <FolderGlyph size={15} />
                    <span className="quick-access-copy">
                      <span className="quick-access-name" title={entry.path}>
                        {entry.name}
                      </span>
                      <small className="quick-access-path" title={entry.path}>
                        {quickAccessSubtext(entry.path)}
                      </small>
                    </span>
                  </button>
                  <FavoriteButton path={entry.path} name={entry.name} />
                </div>
              ))}
            </div>
          ) : (
            <p className="directory-empty">{translate("directory.favoriteHint")}</p>
          )}
          <div className="saved-view-heading">
            <span><Bookmark size={12} /> 保存搜索</span>
            <button
              className="mini-icon-button"
              aria-label="保存当前搜索"
              onClick={() => void dialog.requestForm({
                title: "保存当前搜索",
                confirmLabel: "保存",
                fields: [{ name: "title", label: "名称", required: true, maxLength: 120 }],
                onSubmit: ({ title }) => store.saveCurrentView(title),
              })}
            >
              <Plus size={13} />
            </button>
          </div>
          {store.savedViews.length === 0 ? (
            <p className="directory-empty">筛选后可保存为常用搜索</p>
          ) : (
            <div className="saved-view-list">
              {store.savedViews.map((view) => (
                <div className="saved-view-row" key={view.id}>
                  <button className="saved-view-main" onClick={() => store.applySavedView(view)}>
                    <Bookmark size={14} />
                    <span title={view.title}>{view.title}</span>
                  </button>
                  <div className="saved-view-actions">
                    <button
                      className="mini-icon-button"
                      aria-label={`重命名 ${view.title}`}
                      onClick={() => void dialog.requestForm({
                        title: "重命名保存搜索",
                        confirmLabel: "保存",
                        fields: [{ name: "title", label: "名称", initialValue: view.title, required: true, maxLength: 120 }],
                        onSubmit: ({ title }) => store.updateSavedView(view.id, { title }),
                      })}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="mini-icon-button"
                      aria-label={`复制 ${view.title}`}
                      onClick={() => void store.duplicateSavedView(view.id)}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      className="mini-icon-button danger"
                      aria-label={`删除 ${view.title}`}
                      onClick={() => void dialog.requestConfirm({
                        title: "删除保存搜索",
                        description: `“${view.title}”只会从侧栏移除，不会删除素材。`,
                        confirmLabel: "删除",
                        danger: true,
                      }).then((confirmed) => {
                        if (confirmed) return store.deleteSavedView(view.id);
                      })}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Pane 2（目录）：磁盘卷标树（懒展开）+ 折叠。 */
export function DirectoryTreePane({
  style,
}: {
  style?: React.CSSProperties;
}) {
  const [roots, setRoots] = useState<DirectoryEntry[] | null>(null);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [globalRefreshVersion, setGlobalRefreshVersion] = useState(0);
  const [directoryRefreshVersions, setDirectoryRefreshVersions] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    const refreshDirectories = (paths: string[]) => {
      if (paths.length === 0) {
        setGlobalRefreshVersion((value) => value + 1);
        return;
      }
      setDirectoryRefreshVersions((current) => {
        const next = { ...current };
        for (const changedPath of paths) {
          for (const refreshPath of refreshPathsFor(changedPath)) {
            next[refreshPath] = (next[refreshPath] ?? 0) + 1;
          }
        }
        return next;
      });
    };
    void window.refCanvas.filesystem.listRoots().then(setRoots);
    const unsubscribeDirectory =
      window.refCanvas.filesystem.onDirectoryProgress?.((snapshot) => {
        if (snapshot.state === "invalidated") {
          refreshDirectories([snapshot.path]);
        }
      });
    const unsubscribeLibrary = window.refCanvas.library?.onLibraryChanged?.(
      (event: LibraryChangedEvent) => {
        refreshDirectories(event.paths);
      },
    );
    return () => {
      unsubscribeDirectory?.();
      unsubscribeLibrary?.();
    };
  }, []);

  return (
    <section
      className={`sidebar-pane directory-tree-pane ${collapsed ? "collapsed" : ""}`}
      style={collapsed ? undefined : style}
      aria-label={translate("sidebar.directory")}
    >
      <header className="sidebar-pane-header">
        <span className="sidebar-pane-title">{translate("sidebar.directory")}</span>
        <div className="sidebar-pane-actions">
          <VisibilityToggle />
          <PaneCollapseButton
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
          />
        </div>
      </header>
      {!collapsed && (
        <div className="sidebar-pane-content">
          <div className="dir-roots">
            {roots === null && (
              <p className="directory-empty">{translate("directory.loadingDrives")}</p>
            )}
            {roots?.map((root) => (
              <RootNode
                key={root.path}
                entry={root}
                expanded={expandedRoots.has(normalizePath(root.path))}
                onToggle={() =>
                  setExpandedRoots((current) => {
                    const next = new Set(current);
                    const key = normalizePath(root.path);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                globalRefreshVersion={globalRefreshVersion}
                directoryRefreshVersions={directoryRefreshVersions}
              />
            ))}
            {roots?.length === 0 && (
              <p className="directory-empty">{translate("directory.noDrives")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** 侧栏本地目录区组合视图（两个面板同屏；Sidebar 用 SplitPanes 分隔）。 */
export function DirectoryBrowser() {
  return (
    <>
      <QuickAccessPane />
      <DirectoryTreePane />
    </>
  );
}

function DirectoryContents({
  path,
  depth,
  globalRefreshVersion,
  directoryRefreshVersions,
}: {
  path: string;
  depth: number;
  globalRefreshVersion: number;
  directoryRefreshVersions: Record<string, number>;
}) {
  const [children, setChildren] = useState<DirectoryEntry[] | null>(null);
  const refreshToken = `${globalRefreshVersion}:${
    directoryRefreshVersions[normalizeRefreshPath(path)] ?? 0
  }`;
  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.filesystem
      .listDirectory(path, { pageSize: 512 })
      .then((page) => {
        if (!cancelled) setChildren(page.entries);
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshToken]);
  if (children === null) return <p className="directory-empty">{translate("directory.loading")}</p>;
  return (
    <>
      {children
        .filter((child) => child.isDirectory)
        .map((child) => (
          <DirectoryNode
            key={child.path}
            entry={child}
            depth={depth}
            globalRefreshVersion={globalRefreshVersion}
            directoryRefreshVersions={directoryRefreshVersions}
          />
        ))}
    </>
  );
}
