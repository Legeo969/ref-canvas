import {
  ArrowUpRight,
  Focus,
  Grid3X3,
  ListTodo,
  Lock,
  LockOpen,
  Maximize,
  Palette,
  Pipette,
  Redo2,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { translate } from "../../app/i18n";

export interface BoardToolbarMorePosition {
  x: number;
  y: number;
  maxHeight?: number;
}

/** “更多工具”面板行为：全部由 BoardCanvas 注入。 */
export interface BoardToolbarMoreActions {
  addText(): void;
  addChecklist(): void;
  addArrow(): void;
  addRectangle(): void;
  addGuide(axis: "x" | "y"): void;
  editAppearance(): void;
  sampleColor(): void;
  undo(): void;
  redo(): void;
  fitAll(): void;
  fitSelection(): void;
  toggleFocusCarousel(): void;
  toggleInspector(): void;
  exportPngSelection(): void;
  toggleCanvasLock(): void;
  toggleCanvasGrayscale(): void;
  cycleGridStyle(): void;
  openCommandPalette(): void;
}

interface BoardToolbarMorePanelProps {
  position: BoardToolbarMorePosition;
  panelRef: (element: HTMLElement | null) => void;
  inspectorOpen: boolean;
  canvasLocked: boolean;
  hasSelection: boolean;
  actions: BoardToolbarMoreActions;
  onClose(): void;
}

/** 工具栏“更多”弹层：静态命令菜单，命令执行后自动收起（命令面板除外）。 */
export function BoardToolbarMorePanel({
  position,
  panelRef,
  inspectorOpen,
  canvasLocked,
  hasSelection,
  actions,
  onClose,
}: BoardToolbarMorePanelProps) {
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <aside
      ref={panelRef}
      className="board-toolbar-more"
      role="dialog"
      aria-label={translate("board.moreTools")}
      style={{
        left: position.x,
        top: position.y,
        maxHeight: position.maxHeight,
      }}
    >
      <header>
        <strong>{translate("board.moreTools")}</strong>
        <button onClick={onClose} aria-label={translate("board.closeMoreTools")}>
          <X size={15} />
        </button>
      </header>
      <div className="board-toolbar-more-actions" role="menu">
        <button role="menuitem" onClick={() => run(actions.addText)}>
          <Type size={15} />
          {translate("board.addText")}
        </button>
        <button role="menuitem" onClick={() => run(actions.addChecklist)}>
          <ListTodo size={15} />
          {translate("board.addChecklist")}
        </button>
        <button role="menuitem" onClick={() => run(actions.addArrow)}>
          <ArrowUpRight size={15} />
          {translate("board.addArrow")}
        </button>
        <button role="menuitem" onClick={() => run(actions.addRectangle)}>
          <Square size={15} />
          {translate("board.addRectangle")}
        </button>
        <button role="menuitem" onClick={() => run(() => actions.addGuide("x"))}>
          <span className="text-tool-icon">│</span>
          {translate("board.guideVertical")}
        </button>
        <button role="menuitem" onClick={() => run(() => actions.addGuide("y"))}>
          <span className="text-tool-icon">—</span>
          {translate("board.guideHorizontal")}
        </button>
        <div className="folder-menu-separator" />
        <button role="menuitem" onClick={() => run(actions.editAppearance)}>
          <Palette size={15} />
          {translate("board.backgroundGrid")}
        </button>
        <button role="menuitem" onClick={() => run(actions.sampleColor)}>
          <Pipette size={15} />
          {translate("board.sampleColor")}
        </button>
        <div className="folder-menu-separator" />
        <button role="menuitem" onClick={() => run(actions.undo)}>
          <Undo2 size={15} />
          {translate("board.undo")}
        </button>
        <button role="menuitem" onClick={() => run(actions.redo)}>
          <Redo2 size={15} />
          {translate("board.redo")}
        </button>
        <button role="menuitem" onClick={() => run(actions.fitAll)}>
          <Maximize size={15} />
          {translate("board.fitAll")}
        </button>
        <button role="menuitem" onClick={() => run(actions.fitSelection)}>
          <Focus size={15} />
          {translate("board.fitSelection")}
        </button>
        <button role="menuitem" onClick={() => run(actions.toggleFocusCarousel)}>
          <ScanSearch size={15} />
          {translate("board.focusSelection")}
        </button>
        <div className="folder-menu-separator" />
        <button role="menuitem" onClick={() => run(actions.toggleInspector)}>
          <SlidersHorizontal size={15} />
          {inspectorOpen ? translate("board.closeInspector") : translate("board.inspectorTitle")}
        </button>
        <button
          role="menuitem"
          disabled={!hasSelection}
          onClick={() => run(actions.exportPngSelection)}
        >
          <Maximize size={15} />
          {translate("board.exportPngSelection")}
        </button>
        <div className="folder-menu-separator" />
        <button role="menuitem" onClick={() => run(actions.toggleCanvasLock)}>
          {canvasLocked ? <LockOpen size={15} /> : <Lock size={15} />}
          {canvasLocked ? translate("board.unlockCanvas") : translate("board.lockCanvas")}
        </button>
        <button role="menuitem" onClick={() => run(actions.toggleCanvasGrayscale)}>
          <span className="text-tool-icon">{translate("board.grayscaleGlyph")}</span>
          {translate("board.canvasGrayscale")}
        </button>
        <button role="menuitem" onClick={() => run(actions.cycleGridStyle)}>
          <Grid3X3 size={15} />
          {translate("board.gridStyle")}
        </button>
        <button role="menuitem" onClick={actions.openCommandPalette}>
          <Search size={15} />
          {translate("board.commandPaletteTitle")}
        </button>
      </div>
    </aside>
  );
}
