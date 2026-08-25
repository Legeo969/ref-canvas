import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GitBranch,
  Lock,
  LockOpen,
  MessageSquareText,
  MoreHorizontal,
  ScanSearch,
  Search,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import type {
  BoardControllerCommand,
  BoardLayerRowSnapshot,
} from "../../features/board/board-canvas-controller";
import { placeTriggerMenu, type MenuPlacement } from "../../app/menu-position";
import { translate } from "../../app/i18n";

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 352;
const OVERSCAN = 5;

export function BoardLayerPanel({
  rows,
  onCommand,
  onReparent,
  onReorder,
  onRename,
  onComment,
  rootRef,
}: {
  rows: readonly Readonly<BoardLayerRowSnapshot>[];
  onCommand(command: BoardControllerCommand, id: string): void;
  onReparent(id: string, parentId: string | null): void;
  onReorder(id: string, targetId: string, before: boolean): void;
  onRename(row: Readonly<BoardLayerRowSnapshot>): void;
  onComment(id: string): void;
  /** 供父级测量面板高度（检查器双开时下移避让）。 */
  rootRef?: Ref<HTMLElement>;
}) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    mode: "before" | "after" | "parent";
  } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return rows;
    return rows.filter((row) =>
      row.name.toLocaleLowerCase("zh-CN").includes(normalized) ||
      row.comment?.toLocaleLowerCase("zh-CN").includes(normalized),
    );
  }, [query, rows]);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
  const start = Math.min(
    Math.max(0, filtered.length - visibleCount),
    Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN),
  );
  const visible = filtered
    .slice(start, Math.min(filtered.length, start + visibleCount + OVERSCAN * 2))
    .map((row, offset) => ({ row, index: start + offset }));
  const closeMenu = () => {
    setMenuId(null);
    setMenuPlacement(null);
  };
  useEffect(() => {
    if (!menuId) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const dismiss = () => closeMenu();
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
  }, [menuId]);

  return (
    <aside className="layers-panel" ref={rootRef}>
      <header><strong>{translate("board.layersTitle")}</strong><span>{translate("board.layerDragHint")}</span></header>
      <label className="layer-search">
        <Search size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate("board.layerSearch")} aria-label={translate("board.layerSearch")} />
      </label>
      <div
        className="layer-root-drop"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-refcanvas-layer")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          const id = event.dataTransfer.getData("application/x-refcanvas-layer");
          if (!id) return;
          event.preventDefault();
          onReparent(id, null);
          setDropTarget(null);
        }}
      >
        <Unlink size={13} />{translate("board.layerUnparentDrop")}
      </div>
      <div className="layer-list-viewport" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="layer-list-spacer" style={{ height: filtered.length * ROW_HEIGHT }}>
          {visible.map(({ row, index }) => {
            const dropMode = dropTarget?.id === row.id ? dropTarget.mode : null;
            return (
              <div
                className={`layer-row ${dropMode ? `drop-${dropMode}` : ""}`}
                style={{ top: index * ROW_HEIGHT }}
                key={row.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-refcanvas-layer", row.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  const draggedId = event.dataTransfer.getData("application/x-refcanvas-layer");
                  if (!draggedId || draggedId === row.id) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const ratio = (event.clientY - bounds.top) / bounds.height;
                  setDropTarget({ id: row.id, mode: ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "parent" });
                }}
                onDragEnd={() => setDropTarget(null)}
                onDrop={(event) => {
                  const draggedId = event.dataTransfer.getData("application/x-refcanvas-layer");
                  if (!draggedId || draggedId === row.id) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const ratio = (event.clientY - bounds.top) / bounds.height;
                  if (ratio >= 0.25 && ratio <= 0.75) onReparent(draggedId, row.id);
                  else onReorder(draggedId, row.id, ratio < 0.25);
                  setDropTarget(null);
                }}
              >
                <button className="layer-name" style={{ paddingLeft: 10 + row.depth * 14 }} onClick={() => onCommand("select", row.id)} onDoubleClick={() => onRename(row)}>
                  <span className="layer-tree-marker">{row.depth > 0 ? "↳" : row.hasChildren ? <GitBranch size={12} /> : null}</span>
                  <span>{row.name}</span>
                </button>
                <button onClick={() => onCommand("toggle-visible", row.id)} aria-label={row.visible ? translate("board.layerHide") : translate("board.layerShow")}>
                  {row.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button onClick={() => onCommand("toggle-locked", row.id)} aria-label={row.locked ? translate("board.layerUnlock") : translate("board.layerLock")}>
                  {row.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <div className="layer-row-more">
                  <button
                    aria-label={translate("board.layerMoreActions").replace("{name}", row.name)}
                    aria-haspopup="menu"
                    aria-expanded={menuId === row.id}
                    onClick={(event) => {
                      if (menuId === row.id) return closeMenu();
                      setMenuPlacement(placeTriggerMenu(event.currentTarget.getBoundingClientRect(), { width: 196, height: 172 }, { width: window.innerWidth, height: window.innerHeight }));
                      setMenuId(row.id);
                    }}
                  ><MoreHorizontal size={14} /></button>
                  {menuId === row.id && createPortal(
                    <div ref={menuRef} className="folder-actions-popover layer-row-menu" role="menu" style={{ left: menuPlacement?.left ?? 0, top: menuPlacement?.top ?? 0, visibility: menuPlacement ? "visible" : "hidden" }} onPointerDown={(event) => event.stopPropagation()}>
                      <button role="menuitem" onClick={() => { onComment(row.id); closeMenu(); }}><MessageSquareText size={15} />{row.hasComment ? translate("board.commentEditShort") : translate("board.commentAddShort")}</button>
                      <button role="menuitem" onClick={() => { onCommand("move-up", row.id); closeMenu(); }}><ChevronUp size={15} />{translate("board.layerMoveUp")}</button>
                      <button role="menuitem" onClick={() => { onCommand("move-down", row.id); closeMenu(); }}><ChevronDown size={15} />{translate("board.layerMoveDown")}</button>
                      <button role="menuitem" onClick={() => { onCommand("select", row.id); closeMenu(); }}><ScanSearch size={15} />{translate("board.layerLocateSelect")}</button>
                    </div>,
                    window.document.body,
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
