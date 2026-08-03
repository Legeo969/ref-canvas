import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  HardDrive,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DirectoryEntry } from "../../shared/contracts";
import { useAppStore } from "../app/store";

/** 单个可展开目录节点（展开时才读取下一层）。 */
function DirectoryNode({
  entry,
  depth,
}: {
  entry: DirectoryEntry;
  depth: number;
}) {
  const store = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);
  const active = store.directoryPath === entry.path;

  const toggle = async () => {
    if (!expanded) {
      setExpanded(true);
      if (!loadedRef.current) {
        setLoading(true);
        try {
          const page = await window.refCanvas.filesystem.listDirectory(
            entry.path,
            { pageSize: 10_000 },
          );
          setChildren(page.entries);
          loadedRef.current = true;
        } catch {
          setChildren([]);
        } finally {
          setLoading(false);
        }
      }
    } else {
      setExpanded(false);
    }
  };

  return (
    <div>
      <div
        className={`dir-tree-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          className="dir-tree-chevron"
          aria-label={expanded ? "折叠" : "展开"}
          onClick={() => void toggle()}
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
          <FolderOpen size={15} strokeWidth={1.8} />
          <span className="dir-tree-name" title={entry.path}>
            {entry.name}
          </span>
        </button>
      </div>
      {expanded &&
        children.map((child) =>
          child.isDirectory ? (
            <DirectoryNode key={child.path} entry={child} depth={depth + 1} />
          ) : null,
        )}
    </div>
  );
}

/** 侧栏"本地目录"区：磁盘树（懒展开）+ 快速访问。 */
export function DirectoryBrowser() {
  const store = useAppStore();
  const [roots, setRoots] = useState<DirectoryEntry[] | null>(null);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());

  useEffect(() => {
    void window.refCanvas.filesystem.listRoots().then(setRoots);
  }, []);

  const active = store.navigationSource === "directory";

  const addDirectory = async () => {
    const directory = await window.refCanvas.system.pickDirectory({
      title: "添加本地目录到快速访问",
    });
    if (!directory) return;
    await store.addQuickAccess(directory);
    await store.openDirectory(directory);
  };

  const toggleRoot = async (root: DirectoryEntry) => {
    setExpandedRoots((current) => {
      const next = new Set(current);
      if (next.has(root.path)) next.delete(root.path);
      else next.add(root.path);
      return next;
    });
  };

  return (
    <div className="sidebar-section">
      <div className="section-label row-label">
        <span>本地目录</span>
        <button
          className="mini-icon-button"
          aria-label="添加本地目录"
          onClick={() => void addDirectory()}
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {store.quickAccess.length > 0 && (
        <div className="quick-access-list">
          {store.quickAccess.map((entry) => (
            <div
              className={`quick-access-row ${
                store.directoryPath === entry.path ? "active" : ""
              }`}
              key={entry.id}
            >
              <button
                className="quick-access-main"
                onClick={() => void store.openDirectory(entry.path)}
              >
                <HardDrive size={14} strokeWidth={1.8} />
                <span className="quick-access-name" title={entry.path}>
                  {entry.name}
                </span>
              </button>
              <button
                className="mini-icon-button"
                aria-label={`移除快速访问 ${entry.name}`}
                onClick={() => void store.removeQuickAccess(entry.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="dir-current-row">
          <button
            className="mini-icon-button"
            aria-label="上一级目录"
            onClick={() => void store.goUpDirectory()}
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="mini-icon-button"
            aria-label="刷新当前目录"
            onClick={() => void store.reloadDirectory()}
          >
            <RefreshCw size={14} />
          </button>
          <span className="dir-current-path" title={store.directoryPath ?? ""}>
            {store.directoryPath}
          </span>
        </div>
      )}

      <div className="dir-roots">
        {roots === null && <p className="collections-empty">正在探测磁盘…</p>}
        {roots?.map((root) => {
          const open = expandedRoots.has(root.path);
          return (
            <div key={root.path}>
              <div
                className={`dir-tree-row ${
                  store.directoryPath === root.path ? "active" : ""
                }`}
              >
                <button
                  className="dir-tree-chevron"
                  aria-label={open ? "折叠" : "展开"}
                  onClick={() => void toggleRoot(root)}
                >
                  {open ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                </button>
                <button
                  className="dir-tree-main"
                  onClick={() => void store.openDirectory(root.path)}
                >
                  <HardDrive size={15} strokeWidth={1.8} />
                  <span className="dir-tree-name" title={root.path}>
                    {root.name}
                  </span>
                </button>
              </div>
              {open && (
                <DirectoryContents path={root.path} depth={1} />
              )}
            </div>
          );
        })}
        {roots?.length === 0 && (
          <p className="collections-empty">没有可访问的磁盘。</p>
        )}
      </div>
    </div>
  );
}

function DirectoryContents({ path, depth }: { path: string; depth: number }) {
  const [children, setChildren] = useState<DirectoryEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.filesystem
      .listDirectory(path, { pageSize: 10_000 })
      .then((page) => {
        if (!cancelled) setChildren(page.entries);
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (children === null) return <p className="collections-empty">加载中…</p>;
  return (
    <>
      {children
        .filter((child) => child.isDirectory)
        .map((child) => (
          <DirectoryNode key={child.path} entry={child} depth={depth} />
        ))}
    </>
  );
}
