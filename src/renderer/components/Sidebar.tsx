import { PanelsTopLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";
import { PaneCollapseButton } from "./PaneCollapseButton";
import { DirectoryTreePane, QuickAccessPane } from "./DirectoryBrowser";
import { CollectionsPanel } from "./CollectionsPanel";
import {
  SIDEBAR_LAYOUT_DEFAULTS,
  type SidebarLayoutPreference,
} from "../../shared/contracts";
import {
  MAX_BOARD,
  MIN_BOARD,
  MIN_DIRECTORY,
  MIN_QUICK_ACCESS,
  SPLITTER_COUNT,
  SPLITTER_HEIGHT,
  clampSidebarLayout,
  collectionsFloor,
  fitSidebarLayout,
} from "../app/sidebar-layout";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 面板间水平分隔条：4px 深色条 + 中央 40×2 手柄，行拖拽调高（参考 PanelDividers）。 */
function SidebarSplitter({
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  onDragStart(): void;
  onDrag(deltaY: number): void;
  onDragEnd(): void;
}) {
  const dragRef = useRef<{ startY: number } | null>(null);
  const pendingDeltaRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const scheduleFrame = (callback: () => void) =>
    typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(callback)
      : window.setTimeout(callback, 0);

  const cancelFrame = (frame: number) => {
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
    } else {
      window.clearTimeout(frame);
    }
  };

  const flushDrag = () => {
    if (frameRef.current !== null) {
      cancelFrame(frameRef.current);
      frameRef.current = null;
    }
    if (dragRef.current) onDrag(pendingDeltaRef.current);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startY: event.clientY };
    pendingDeltaRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("dragging");
    document.body.classList.add("sidebar-resizing");
    onDragStart();
    event.preventDefault();
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    pendingDeltaRef.current = event.clientY - drag.startY;
    if (frameRef.current !== null) return;
    frameRef.current = scheduleFrame(() => {
      frameRef.current = null;
      if (dragRef.current) onDrag(pendingDeltaRef.current);
    });
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    flushDrag();
    dragRef.current = null;
    event.currentTarget.classList.remove("dragging");
    document.body.classList.remove("sidebar-resizing");
    onDragEnd();
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.key === "ArrowUp" ? -8 : 8;
    onDragStart();
    onDrag(step);
    onDragEnd();
  };
  return (
    <div
      className="sidebar-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label={translate("sidebar.adjustHeight")}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    />
  );
}

/** Navigation for the disk browser and Fabric reference boards. */
export function Sidebar() {
  const store = useAppStore();
  const dialog = useDialog();
  const [layout, setLayout] = useState<SidebarLayoutPreference>(
    SIDEBAR_LAYOUT_DEFAULTS,
  );
  /** 白板（参考板）区折叠态：与其他面板一致，可展开/折叠。 */
  const [boardsCollapsed, setBoardsCollapsed] = useState(false);
  const recentBoardIds = new Set(store.recentBoards.map((board) => board.id));
  const boardRows = [
    ...store.recentBoards,
    ...store.boards.filter((board) => !recentBoardIds.has(board.id)),
  ];
  // onDragEnd / 键盘调整是同步连续流：state 异步更新，ref 镜像保证
  // 结束时读到的是最新高度。
  const layoutRef = useRef(layout);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    quickAccess: number;
    directory: number;
    board: number;
    available: number;
    collections: number;
  } | null>(null);

  const applyLayout = (next: SidebarLayoutPreference) => {
    layoutRef.current = next;
    setLayout(next);
  };

  /** 集合面板当前实际占高与折叠态：拖动约束必须按实际渲染值预留，
   * 否则集合被压到 min-height 后再拖会把参考板顶出容器（overflow
   * hidden 裁剪），或出现「向下拖反而变小」的反弹。 */
  const measureCollections = () => {
    const section = panesRef.current?.querySelector<HTMLElement>(
      ".collections-section",
    );
    if (!section) return collectionsFloor(0, false);
    return collectionsFloor(
      section.clientHeight,
      section.classList.contains("collapsed"),
    );
  };
  const measuredAvailable = () => {
    const height = panesRef.current?.clientHeight ?? 0;
    return height > 0 ? height : 720;
  };

  // 启动时恢复持久化高度并按当前窗口收紧（应用级偏好，主进程 settings 表）。
  useEffect(() => {
    // 真实布局下把固定面板总量压回可用高度，避免参考板被 overflow
    // hidden 裁剪（jsdom 等无布局环境跳过，保留设计规格默认值）。
    const fitNow = () => {
      const available = panesRef.current?.clientHeight ?? 0;
      if (available <= 0) return;
      const fitted = fitSidebarLayout(
        layoutRef.current,
        available,
        measureCollections(),
      );
      if (
        fitted.quickAccessHeight !== layoutRef.current.quickAccessHeight ||
        fitted.directoryHeight !== layoutRef.current.directoryHeight ||
        fitted.boardHeight !== layoutRef.current.boardHeight
      ) {
        applyLayout(fitted);
      }
    };
    const request = window.refCanvas?.system?.getPreferences?.();
    if (!request) {
      fitNow();
      return;
    }
    void request
      .then((preferences) => {
        const stored = preferences.sidebarLayout;
        if (stored) applyLayout(clampSidebarLayout(stored));
        fitNow();
      })
      .catch(() => undefined);
  }, []);

  // 窗口尺寸变化 / 集合折叠展开（占高变化）时收紧溢出，避免参考板被裁剪。
  useEffect(() => {
    const panes = panesRef.current;
    if (!panes || typeof ResizeObserver === "undefined") return;
    const refit = () => {
      const available = panes.clientHeight;
      if (available <= 0) return;
      const fitted = fitSidebarLayout(
        layoutRef.current,
        available,
        measureCollections(),
      );
      if (
        fitted.quickAccessHeight !== layoutRef.current.quickAccessHeight ||
        fitted.directoryHeight !== layoutRef.current.directoryHeight ||
        fitted.boardHeight !== layoutRef.current.boardHeight
      ) {
        applyLayout(fitted);
      }
    };
    const observer = new ResizeObserver(refit);
    observer.observe(panes);
    const section = panes.querySelector<HTMLElement>(".collections-section");
    if (section) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const snapshotDragStart = () => {
    dragStartRef.current = {
      quickAccess: layoutRef.current.quickAccessHeight,
      directory: layoutRef.current.directoryHeight,
      board: layoutRef.current.boardHeight,
      // jsdom 等无布局环境 clientHeight 为 0：回退设计规格高度，保证
      // 拖动钳制区间可用。
      available: measuredAvailable(),
      collections: measureCollections(),
    };
  };

  /** 拖动/键盘调整结束：清快照并持久化当前高度。 */
  const endDrag = () => {
    dragStartRef.current = null;
    void window.refCanvas?.system?.setPreferences?.({
      sidebarLayout: layoutRef.current,
    })?.catch?.(() => undefined);
  };

  /** Splitter 1（快速访问 / 目录）：QA 吸收增量，目录反向补偿，总和不变。 */
  const splitter1Drag = (deltaY: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const sum = start.quickAccess + start.directory;
    const maxQuickAccess = Math.max(
      MIN_QUICK_ACCESS,
      start.available -
        SPLITTER_HEIGHT * SPLITTER_COUNT -
        MIN_DIRECTORY -
        start.collections -
        MIN_BOARD,
    );
    const quickAccess = clamp(
      start.quickAccess + deltaY,
      MIN_QUICK_ACCESS,
      Math.min(maxQuickAccess, sum - MIN_DIRECTORY),
    );
    applyLayout({
      ...layoutRef.current,
      quickAccessHeight: quickAccess,
      directoryHeight: sum - quickAccess,
    });
  };

  /** Splitter 2（目录 / 收集）：目录吸收增量，集合面板（flex-grow）让出
   * 实际富余（超出最小占位的部分）；集合到底后目录停下，不顶出参考板。 */
  const splitter2Drag = (deltaY: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const maxDirectory = Math.max(
      MIN_DIRECTORY,
      start.available -
        SPLITTER_HEIGHT * SPLITTER_COUNT -
        start.quickAccess -
        start.collections -
        start.board,
    );
    applyLayout({
      ...layoutRef.current,
      directoryHeight: clamp(
        start.directory + deltaY,
        MIN_DIRECTORY,
        maxDirectory,
      ),
    });
  };

  /** Splitter 3（收集 / 参考板）：参考板在分隔条下方，向下拖 = 收集变大、
   * 参考板变小（分隔条跟随光标），与前两个分隔条方向一致。 */
  const splitter3Drag = (deltaY: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const maxBoard = Math.max(
      MIN_BOARD,
      start.available -
        SPLITTER_HEIGHT * SPLITTER_COUNT -
        start.quickAccess -
        start.directory -
        start.collections,
    );
    applyLayout({
      ...layoutRef.current,
      boardHeight: clamp(
        start.board - deltaY,
        MIN_BOARD,
        Math.min(MAX_BOARD, maxBoard),
      ),
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-panes" ref={panesRef}>
        <QuickAccessPane style={{ height: layout.quickAccessHeight }} />
        <SidebarSplitter
          onDragStart={snapshotDragStart}
          onDrag={splitter1Drag}
          onDragEnd={endDrag}
        />
        <DirectoryTreePane style={{ height: layout.directoryHeight }} />
        <SidebarSplitter
          onDragStart={snapshotDragStart}
          onDrag={splitter2Drag}
          onDragEnd={endDrag}
        />
        <CollectionsPanel />
        <SidebarSplitter
          onDragStart={snapshotDragStart}
          onDrag={splitter3Drag}
          onDragEnd={endDrag}
        />
        <div
          className={`sidebar-section sidebar-board-section${boardsCollapsed ? " collapsed" : ""}`}
          style={boardsCollapsed ? undefined : { height: layout.boardHeight }}
        >
          <div className="section-label row-label">
            <span>{translate("sidebar.boards")}</span>
            <div className="sidebar-pane-actions">
              <button
                className="mini-icon-button"
                aria-label={translate("boards.new")}
                onClick={() =>
                  void dialog.requestForm({
                    title: translate("boards.new"),
                    confirmLabel: translate("boards.createConfirm"),
                    fields: [
                      {
                        name: "title",
                        label: translate("boards.nameLabel"),
                        required: true,
                        maxLength: 120,
                      },
                    ],
                    onSubmit: ({ title }) => store.createBoard(title),
                  })
                }
              >
                <Plus size={14} />
              </button>
              <PaneCollapseButton
                collapsed={boardsCollapsed}
                onToggle={() => setBoardsCollapsed((value) => !value)}
              />
            </div>
          </div>
          {!boardsCollapsed && boardRows.map((board) => (
            <button
              className={`nav-row ${
                store.workspaceMode === "board" &&
                store.activeBoard?.id === board.id
                  ? "active"
                  : ""
              }`}
              key={board.id}
              onClick={() => void store.switchBoard(board.id)}
            >
              {board.thumbnailUrl ? (
                <img className="board-nav-thumbnail" src={board.thumbnailUrl} alt="" />
              ) : (
                <PanelsTopLeft size={16} strokeWidth={1.8} />
              )}
              <span>{board.title}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-footer">
        <button
          className="sidebar-recycle-button"
          onClick={() => void window.refCanvas.system.openRecycleBin()}
          title={translate("sidebar.openRecycleBin")}
        >
          <Trash2 size={15} />
          {translate("sidebar.recycleBin")}
        </button>
      </div>
    </aside>
  );
}
