import { PanelsTopLeft, Plus, Search, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";
import { DirectoryTreePane, QuickAccessPane } from "./DirectoryBrowser";
import { CollectionsPanel } from "./CollectionsPanel";

/** SplitPanes 默认/最小高度（设计规格 360×850：270 / 290 / 240，min 120 / 140 / 100）。 */
const DEFAULT_QUICK_ACCESS_HEIGHT = 270;
const DEFAULT_DIRECTORY_HEIGHT = 290;
const MIN_QUICK_ACCESS = 120;
const MIN_DIRECTORY = 140;
const MIN_COLLECTIONS = 100;
const SPLITTER_HEIGHT = 4;

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
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("dragging");
    document.body.classList.add("sidebar-resizing");
    onDragStart();
    event.preventDefault();
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onDrag(event.clientY - drag.startY);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
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

/** 底部搜索框：驱动 found 面板（DirectoryAssetPanel）的现有递归目录搜索。 */
function SidebarSearchBox() {
  const [value, setValue] = useState("");
  return (
    <div className="sidebar-search">
      <Search size={13} />
      <input
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          window.dispatchEvent(
            new CustomEvent("refcanvas:directory-search", { detail: next }),
          );
        }}
        placeholder={translate("sidebar.searchAssets")}
        aria-label={translate("sidebar.searchAssets")}
      />
    </div>
  );
}

/** Navigation for the disk browser and Fabric reference boards. */
export function Sidebar() {
  const store = useAppStore();
  const dialog = useDialog();
  const [quickAccessHeight, setQuickAccessHeight] = useState(
    DEFAULT_QUICK_ACCESS_HEIGHT,
  );
  const [directoryHeight, setDirectoryHeight] = useState(DEFAULT_DIRECTORY_HEIGHT);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    quickAccess: number;
    directory: number;
    available: number;
  } | null>(null);

  const snapshotDragStart = () => {
    dragStartRef.current = {
      quickAccess: quickAccessHeight,
      directory: directoryHeight,
      available: panesRef.current?.clientHeight ?? 720,
    };
  };

  /** Splitter 1（快速访问 / 目录）：QA 吸收增量，目录反向补偿，总和不变。 */
  const splitter1Drag = (deltaY: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const sum = start.quickAccess + start.directory;
    const maxQuickAccess = Math.max(
      MIN_QUICK_ACCESS,
      start.available - SPLITTER_HEIGHT * 2 - MIN_DIRECTORY - MIN_COLLECTIONS,
    );
    const quickAccess = clamp(
      start.quickAccess + deltaY,
      MIN_QUICK_ACCESS,
      Math.min(maxQuickAccess, sum - MIN_DIRECTORY),
    );
    setQuickAccessHeight(quickAccess);
    setDirectoryHeight(sum - quickAccess);
  };

  /** Splitter 2（目录 / 收集）：目录吸收增量，收集面板（flex-grow）自适应。 */
  const splitter2Drag = (deltaY: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const maxDirectory = Math.max(
      MIN_DIRECTORY,
      start.available - SPLITTER_HEIGHT * 2 - start.quickAccess - MIN_COLLECTIONS,
    );
    setDirectoryHeight(
      clamp(start.directory + deltaY, MIN_DIRECTORY, maxDirectory),
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-panes" ref={panesRef}>
        <QuickAccessPane style={{ height: quickAccessHeight }} />
        <SidebarSplitter
          onDragStart={snapshotDragStart}
          onDrag={splitter1Drag}
          onDragEnd={() => (dragStartRef.current = null)}
        />
        <DirectoryTreePane style={{ height: directoryHeight }} />
        <SidebarSplitter
          onDragStart={snapshotDragStart}
          onDrag={splitter2Drag}
          onDragEnd={() => (dragStartRef.current = null)}
        />
        <CollectionsPanel />
      </div>
      <div className="sidebar-section sidebar-board-section">
        <div className="section-label row-label">
          <span>{translate("sidebar.boards")}</span>
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
        </div>
        {store.boards.map((board) => (
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
            <PanelsTopLeft size={16} strokeWidth={1.8} />
            <span>{board.title}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <SidebarSearchBox />
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
