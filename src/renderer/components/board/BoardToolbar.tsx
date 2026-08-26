import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpToLine,
  ChevronDown,
  Circle,
  CopyPlus,
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  GitBranch,
  Grid3X3,
  GroupIcon,
  Layers,
  LayoutGrid,
  ListTodo,
  Lock,
  LockOpen,
  Maximize,
  MessageSquareText,
  MousePointer2,
  Paintbrush,
  Palette,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { translate } from "../../app/i18n";

type ToolbarIcon =
  | LucideIcon
  | "guide-x"
  | "guide-y"
  | "distribute-x"
  | "distribute-y"
  | "width"
  | "height"
  | "grayscale"
  | "color"
  | "opacity"
  | "zoom-100"
  | "nearest"
  | "bilinear"
  | "more";

interface ToolbarAction {
  readonly id: string;
  readonly label: string;
  readonly icon: ToolbarIcon;
  readonly command: () => void;
  readonly active?: boolean;
  readonly primary?: boolean;
  readonly shortcut?: string;
  readonly title?: string;
}

export interface BoardToolbarState {
  readonly tool: string;
  readonly drawingToolActive: boolean;
  readonly drawingPanelOpen: boolean;
  readonly selectedHasComment: boolean;
  readonly focused: boolean;
  readonly layersOpen: boolean;
  readonly gridVisible: boolean;
  readonly canvasLocked: boolean;
  readonly canvasGrayscale: boolean;
  readonly sampling: "nearest" | "bilinear";
  readonly moreOpen: boolean;
}

export interface BoardToolbarCommands {
  readonly select: () => void;
  readonly addText: () => void;
  readonly addNote: () => void;
  readonly addChecklist: () => void;
  readonly addArrow: () => void;
  readonly addRectangle: () => void;
  readonly addVerticalGuide: () => void;
  readonly addHorizontalGuide: () => void;
  readonly toggleDrawing: () => void;
  readonly toggleDrawingPanel: () => void;
  readonly toggleEraser: () => void;
  readonly undoStroke: () => void;
  readonly moveBottom: () => void;
  readonly moveTop: () => void;
  readonly rotate: () => void;
  readonly flipX: () => void;
  readonly flipY: () => void;
  readonly alignLeft: () => void;
  readonly alignCenterX: () => void;
  readonly alignRight: () => void;
  readonly alignTop: () => void;
  readonly alignCenterY: () => void;
  readonly alignBottom: () => void;
  readonly distributeX: () => void;
  readonly distributeY: () => void;
  readonly arrangeCompact: () => void;
  readonly normalizeWidth: () => void;
  readonly normalizeHeight: () => void;
  readonly resetTransform: () => void;
  readonly toggleLock: () => void;
  readonly group: () => void;
  readonly parent: () => void;
  readonly unparent: () => void;
  readonly ungroup: () => void;
  readonly maskRect: () => void;
  readonly maskCircle: () => void;
  readonly crop: () => void;
  readonly resetCrop: () => void;
  readonly toggleGrayscale: () => void;
  readonly restoreColor: () => void;
  readonly setOpacity: () => void;
  readonly duplicate: () => void;
  readonly editComment: () => void;
  readonly delete: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly fitAll: () => void;
  readonly toggleFocus: () => void;
  readonly fitSelection: () => void;
  readonly toggleLayers: () => void;
  readonly toggleGrid: () => void;
  readonly editAppearance: () => void;
  readonly toggleCanvasLock: () => void;
  readonly toggleCanvasGrayscale: () => void;
  readonly cycleGridStyle: () => void;
  readonly zoom100: () => void;
  readonly resetViewport: () => void;
  readonly sampleColor: () => void;
  readonly toggleSampling: () => void;
}

export type BoardToolbarCommand = keyof BoardToolbarCommands;

interface BoardToolbarProps {
  readonly state: BoardToolbarState;
  readonly onCommand: (command: BoardToolbarCommand) => void;
  readonly shortcuts: Readonly<Record<string, string>>;
  readonly moreButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onMoreClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function iconNode(icon: ToolbarIcon) {
  if (typeof icon === "string") {
    if (icon === "color") return <span className="color-dot-icon" />;
    const text = {
      "guide-x": "│",
      "guide-y": "—",
      "distribute-x": "H",
      "distribute-y": "V",
      width: "W",
      height: "H",
      grayscale: "B/W",
      opacity: "%",
      "zoom-100": "100%",
      nearest: "NN",
      bilinear: "BL",
      more: "⋯",
    }[icon];
    return <span className="text-tool-icon">{text}</span>;
  }
  const Icon = icon;
  return <Icon size={16} />;
}

export function BoardToolbar({
  state,
  onCommand,
  shortcuts,
  moreButtonRef,
  onMoreClick,
}: BoardToolbarProps) {
  const actions: readonly (ToolbarAction | "divider")[] = [
    { id: "select", label: translate("board.toolSelect"), icon: MousePointer2, command: () => onCommand("select"), active: state.tool === "select", primary: true },
    "divider",
    { id: "text", label: translate("board.addText"), icon: Type, command: () => onCommand("addText") },
    { id: "note", label: translate("board.addNote"), icon: StickyNote, command: () => onCommand("addNote"), primary: true },
    { id: "checklist", label: translate("board.addChecklist"), icon: ListTodo, command: () => onCommand("addChecklist") },
    { id: "arrow", label: translate("board.addArrow"), icon: ArrowUpRight, command: () => onCommand("addArrow") },
    { id: "rectangle", label: translate("board.addRectangle"), icon: Square, command: () => onCommand("addRectangle") },
    { id: "guide-x", label: translate("board.addGuideX"), icon: "guide-x", command: () => onCommand("addVerticalGuide") },
    { id: "guide-y", label: translate("board.addGuideY"), icon: "guide-y", command: () => onCommand("addHorizontalGuide") },
    { id: "drawing", label: state.drawingToolActive ? translate("board.exitDrawing") : translate("board.enableDrawing"), icon: Paintbrush, command: () => onCommand("toggleDrawing"), active: state.drawingToolActive, primary: true },
    { id: "drawing-settings", label: translate("board.drawingSettings"), icon: ChevronDown, command: () => onCommand("toggleDrawingPanel"), active: state.drawingPanelOpen },
    { id: "eraser", label: translate("board.eraser"), icon: Eraser, command: () => onCommand("toggleEraser"), active: state.tool === "eraser", primary: true },
    { id: "undo-stroke", label: translate("board.undoStroke"), icon: Undo2, command: () => onCommand("undoStroke") },
    "divider",
    { id: "bottom", label: translate("board.moveBottom"), icon: ArrowDownToLine, command: () => onCommand("moveBottom") },
    { id: "top", label: translate("board.moveTop"), icon: ArrowUpToLine, command: () => onCommand("moveTop") },
    { id: "rotate", label: translate("board.rotate90"), icon: RotateCw, command: () => onCommand("rotate") },
    { id: "flip-x", label: translate("board.flipH"), icon: FlipHorizontal2, command: () => onCommand("flipX") },
    { id: "flip-y", label: translate("board.flipV"), icon: FlipVertical2, command: () => onCommand("flipY") },
    { id: "align-left", label: translate("board.alignLeft"), icon: AlignStartVertical, command: () => onCommand("alignLeft") },
    { id: "align-center-x", label: translate("board.alignCenterX"), icon: AlignCenterVertical, command: () => onCommand("alignCenterX") },
    { id: "align-right", label: translate("board.alignRight"), icon: AlignEndVertical, command: () => onCommand("alignRight") },
    { id: "align-top", label: translate("board.alignTop"), icon: AlignStartHorizontal, command: () => onCommand("alignTop") },
    { id: "align-center-y", label: translate("board.alignCenterY"), icon: AlignCenterHorizontal, command: () => onCommand("alignCenterY") },
    { id: "align-bottom", label: translate("board.alignBottom"), icon: AlignEndHorizontal, command: () => onCommand("alignBottom") },
    { id: "distribute-x", label: translate("board.distributeX"), icon: "distribute-x", command: () => onCommand("distributeX") },
    { id: "distribute-y", label: translate("board.distributeY"), icon: "distribute-y", command: () => onCommand("distributeY") },
    { id: "arrange", label: translate("board.arrangeCompactSelection"), icon: LayoutGrid, command: () => onCommand("arrangeCompact") },
    { id: "width", label: translate("board.normalizeWidth"), icon: "width", command: () => onCommand("normalizeWidth") },
    { id: "height", label: translate("board.normalizeHeight"), icon: "height", command: () => onCommand("normalizeHeight") },
    { id: "reset-transform", label: translate("board.resetTransform"), icon: RotateCcw, command: () => onCommand("resetTransform"), shortcut: shortcuts.resetTransform },
    { id: "lock", label: translate("board.toggleLock"), icon: Lock, command: () => onCommand("toggleLock") },
    { id: "group", label: translate("board.group"), icon: GroupIcon, command: () => onCommand("group"), shortcut: shortcuts.group },
    { id: "parent", label: translate("board.parentWithHint"), icon: GitBranch, command: () => onCommand("parent"), shortcut: shortcuts.parent },
    { id: "unparent", label: translate("board.unparent"), icon: Unlink, command: () => onCommand("unparent"), shortcut: shortcuts.unparent },
    { id: "ungroup", label: translate("board.ungroup"), icon: LockOpen, command: () => onCommand("ungroup"), shortcut: shortcuts.ungroup },
    { id: "mask-rect", label: translate("board.maskRectShort"), icon: Square, command: () => onCommand("maskRect") },
    { id: "mask-circle", label: translate("board.maskCircleShort"), icon: Circle, command: () => onCommand("maskCircle") },
    { id: "crop", label: translate("board.cropImage"), icon: Crop, command: () => onCommand("crop") },
    { id: "reset-crop", label: translate("board.resetCrop"), icon: RotateCcw, command: () => onCommand("resetCrop") },
    { id: "grayscale", label: translate("board.toggleGrayscale"), icon: "grayscale", command: () => onCommand("toggleGrayscale") },
    { id: "color", label: translate("board.restoreColor"), icon: "color", command: () => onCommand("restoreColor") },
    { id: "opacity", label: translate("board.opacity"), icon: "opacity", command: () => onCommand("setOpacity") },
    { id: "duplicate", label: translate("board.duplicate"), icon: CopyPlus, command: () => onCommand("duplicate"), shortcut: shortcuts.duplicate },
    { id: "comment", label: state.selectedHasComment ? translate("board.commentEdit") : translate("board.commentAdd"), icon: MessageSquareText, command: () => onCommand("editComment"), active: state.selectedHasComment, shortcut: shortcuts.comment },
    { id: "delete", label: translate("board.delete"), icon: Trash2, command: () => onCommand("delete"), shortcut: shortcuts.delete },
    "divider",
    { id: "undo", label: translate("board.undo"), icon: Undo2, command: () => onCommand("undo"), shortcut: shortcuts.undo },
    { id: "redo", label: translate("board.redo"), icon: Redo2, command: () => onCommand("redo"), shortcut: shortcuts.redo },
    { id: "fit-all", label: translate("board.fitAll"), icon: Maximize, command: () => onCommand("fitAll"), shortcut: shortcuts.fitAll },
    { id: "focus", label: state.focused ? translate("board.exitFocus") : translate("board.focusSelection"), icon: ScanSearch, command: () => onCommand("toggleFocus"), active: state.focused, shortcut: shortcuts.focus },
    { id: "fit-selection", label: translate("board.fitSelection"), icon: Focus, command: () => onCommand("fitSelection"), shortcut: shortcuts.fitSelection },
    { id: "layers", label: translate("board.layersTitle"), icon: Layers, command: () => onCommand("toggleLayers"), active: state.layersOpen, primary: true },
    "divider",
    { id: "grid", label: state.gridVisible ? translate("board.hideGrid") : translate("board.showGrid"), icon: Grid3X3, command: () => onCommand("toggleGrid"), active: state.gridVisible, shortcut: shortcuts.toggleGrid },
    { id: "appearance", label: translate("board.appearanceTitle"), icon: Palette, command: () => onCommand("editAppearance") },
    "divider",
    { id: "canvas-lock", label: state.canvasLocked ? translate("board.unlockCanvas") : translate("board.lockCanvasWhole"), icon: state.canvasLocked ? LockOpen : Lock, command: () => onCommand("toggleCanvasLock"), active: state.canvasLocked },
    { id: "canvas-gray", label: state.canvasGrayscale ? translate("board.restoreCanvasColor") : translate("board.canvasGrayscaleWhole"), icon: "grayscale", command: () => onCommand("toggleCanvasGrayscale"), active: state.canvasGrayscale },
    { id: "grid-style", label: translate("board.gridStyleCycle"), icon: Grid3X3, command: () => onCommand("cycleGridStyle") },
    { id: "zoom-100", label: translate("board.zoom100"), icon: "zoom-100", command: () => onCommand("zoom100") },
    { id: "reset-viewport", label: translate("board.resetViewport"), icon: Maximize, command: () => onCommand("resetViewport") },
    { id: "sample-color", label: translate("board.sampleColor"), title: translate("board.sampleColorTitle"), icon: Pipette, command: () => onCommand("sampleColor") },
    { id: "sampling", label: translate("board.toggleSamplingLabel"), title: translate("board.samplingTitle").replace("{mode}", translate(state.sampling === "nearest" ? "board.samplingNearest" : "board.samplingBilinear")), icon: state.sampling, command: () => onCommand("toggleSampling") },
  ];

  return (
    <div className="canvas-toolbar toolbar-compact" role="toolbar" aria-label={translate("board.toolbarLabel")}>
      {actions.map((action, index) =>
        action === "divider" ? (
          <span className="toolbar-divider" key={`divider-${index}`} />
        ) : (
          <button
            key={action.id}
            className={`${action.primary ? "toolbar-primary " : ""}${action.active ? "active" : ""}`.trim() || undefined}
            onClick={action.command}
            aria-label={action.label}
            data-shortcut={action.shortcut}
          >
            {iconNode(action.icon)}
          </button>
        ),
      )}
      <span className="toolbar-divider" />
      <button
        ref={moreButtonRef}
        className={`toolbar-more-btn ${state.moreOpen ? "active" : ""}`}
        onClick={onMoreClick}
        aria-label={translate("board.moreTools")}
        aria-haspopup="dialog"
        aria-expanded={state.moreOpen}
      >
        {iconNode("more")}
      </button>
    </div>
  );
}
