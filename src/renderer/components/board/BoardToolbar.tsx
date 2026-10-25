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
  ChevronUp,
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
  ImageDown,
  ImagePlus,
  Layers,
  LayoutGrid,
  ListTodo,
  Lock,
  LockOpen,
  Maximize,
  MessageSquareText,
  MousePointer2,
  NotebookPen,
  Paintbrush,
  Palette,
  Pipette,
  Proportions,
  Redo2,
  RotateCcw,
  RotateCw,
  Scaling,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
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
  | "opacity"
  | "zoom-100";

interface ToolbarAction {
  readonly id: string;
  readonly label: string;
  readonly icon: ToolbarIcon;
  readonly command: () => void;
  readonly active?: boolean;
  readonly primary?: boolean;
  readonly shortcut?: string;
  readonly title?: string;
  readonly disabled?: boolean;
}

// 工具栏分组:组内按钮不换行,组与组之间是 .canvas-toolbar flex-wrap 的换行单位。
interface ToolbarGroup {
  readonly id: string;
  readonly actions: readonly ToolbarAction[];
}

export interface BoardToolbarState {
  readonly tool: string;
  readonly drawingToolActive: boolean;
  readonly drawingPanelOpen: boolean;
  readonly arrangePanelOpen: boolean;
  readonly selectedHasComment: boolean;
  readonly focused: boolean;
  readonly layersOpen: boolean;
  readonly inspectorOpen: boolean;
  readonly gridVisible: boolean;
  readonly canvasLocked: boolean;
  readonly canvasGrayscale: boolean;
  readonly hasSelection: boolean;
  readonly selectionHasNote: boolean;
  readonly selectionCount: number;
  readonly hasBoardObjects: boolean;
  readonly toolbarCollapsed: boolean;
}

export interface BoardToolbarCommands {
  readonly importFiles: () => void;
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
  readonly toggleArrangePanel: () => void;
  readonly toggleEraser: () => void;
  readonly undoStroke: () => void;
  readonly moveBottom: () => void;
  readonly moveTop: () => void;
  readonly moveUp: () => void;
  readonly moveDown: () => void;
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
  readonly uniformArea: () => void;
  readonly uniformScale: () => void;
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
  readonly setOpacity: () => void;
  readonly duplicate: () => void;
  readonly editContent: () => void;
  readonly editComment: () => void;
  readonly delete: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly fitAll: () => void;
  readonly toggleFocus: () => void;
  readonly fitSelection: () => void;
  readonly exportPng: () => void;
  readonly toggleInspector: () => void;
  readonly toggleLayers: () => void;
  readonly toggleGrid: () => void;
  readonly editAppearance: () => void;
  readonly toggleCanvasLock: () => void;
  readonly toggleCanvasGrayscale: () => void;
  readonly cycleGridStyle: () => void;
  readonly zoom100: () => void;
  readonly resetViewport: () => void;
  readonly sampleColor: () => void;
  readonly openCommandPalette: () => void;
  readonly toggleToolbarCollapsed: () => void;
}

export type BoardToolbarCommand = keyof BoardToolbarCommands;

interface BoardToolbarProps {
  readonly state: BoardToolbarState;
  readonly onCommand: (command: BoardToolbarCommand) => void;
  readonly shortcuts: Readonly<Record<string, string>>;
}

function iconNode(icon: ToolbarIcon) {
  if (typeof icon === "string") {
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
}: BoardToolbarProps) {
  // 禁用态映射：选中类命令依赖选区，对齐/编组/等比归一至少 2 个对象，分布至少 3 个，
  // 紧凑排列/宽高归一依赖白板上存在对象；编辑内容只对笔记/清单类生效。
  const selectionDisabled = !state.hasSelection;
  const noteSelectionDisabled = !state.selectionHasNote;
  const pairDisabled = state.selectionCount < 2;
  const distributeDisabled = state.selectionCount < 3;
  const arrangeDisabled = !state.hasBoardObjects;
  // 与现有按钮一一对应的七个功能组 + 栏尾命令面板，不增不减。
  const groups: readonly ToolbarGroup[] = [
    {
      id: "file-tools",
      actions: [
        { id: "import", label: translate("board.importFiles"), icon: ImagePlus, command: () => onCommand("importFiles"), primary: true },
        { id: "select", label: translate("board.toolSelect"), icon: MousePointer2, command: () => onCommand("select"), active: state.tool === "select", primary: true },
        { id: "drawing", label: state.drawingToolActive ? translate("board.exitDrawing") : translate("board.enableDrawing"), icon: Paintbrush, command: () => onCommand("toggleDrawing"), active: state.drawingToolActive, primary: true },
        { id: "drawing-settings", label: translate("board.drawingSettings"), icon: ChevronDown, command: () => onCommand("toggleDrawingPanel"), active: state.drawingPanelOpen },
        { id: "eraser", label: translate("board.eraser"), icon: Eraser, command: () => onCommand("toggleEraser"), active: state.tool === "eraser", primary: true },
        { id: "undo-stroke", label: translate("board.undoStroke"), icon: Undo2, command: () => onCommand("undoStroke") },
      ],
    },
    {
      id: "add",
      actions: [
        { id: "text", label: translate("board.addText"), icon: Type, command: () => onCommand("addText") },
        { id: "note", label: translate("board.addNote"), icon: StickyNote, command: () => onCommand("addNote"), primary: true },
        { id: "checklist", label: translate("board.addChecklist"), icon: ListTodo, command: () => onCommand("addChecklist") },
        { id: "arrow", label: translate("board.addArrow"), icon: ArrowUpRight, command: () => onCommand("addArrow") },
        { id: "rectangle", label: translate("board.addRectangle"), icon: Square, command: () => onCommand("addRectangle") },
        { id: "guide-x", label: translate("board.addGuideX"), icon: "guide-x", command: () => onCommand("addVerticalGuide") },
        { id: "guide-y", label: translate("board.addGuideY"), icon: "guide-y", command: () => onCommand("addHorizontalGuide") },
      ],
    },
    {
      id: "transform",
      actions: [
        { id: "bottom", label: translate("board.moveBottom"), icon: ArrowDownToLine, command: () => onCommand("moveBottom"), disabled: selectionDisabled },
        { id: "top", label: translate("board.moveTop"), icon: ArrowUpToLine, command: () => onCommand("moveTop"), disabled: selectionDisabled },
        { id: "move-up", label: translate("board.moveUpOne"), icon: ChevronUp, command: () => onCommand("moveUp"), disabled: selectionDisabled },
        { id: "move-down", label: translate("board.moveDownOne"), icon: ChevronDown, command: () => onCommand("moveDown"), disabled: selectionDisabled },
        { id: "rotate", label: translate("board.rotate90"), icon: RotateCw, command: () => onCommand("rotate"), disabled: selectionDisabled },
        { id: "flip-x", label: translate("board.flipH"), icon: FlipHorizontal2, command: () => onCommand("flipX"), disabled: selectionDisabled },
        { id: "flip-y", label: translate("board.flipV"), icon: FlipVertical2, command: () => onCommand("flipY"), disabled: selectionDisabled },
        { id: "reset-transform", label: translate("board.resetTransform"), icon: RotateCcw, command: () => onCommand("resetTransform"), shortcut: shortcuts.resetTransform, disabled: selectionDisabled },
      ],
    },
    {
      id: "align",
      actions: [
        { id: "align-left", label: translate("board.alignLeft"), icon: AlignStartVertical, command: () => onCommand("alignLeft"), disabled: pairDisabled },
        { id: "align-center-x", label: translate("board.alignCenterX"), icon: AlignCenterVertical, command: () => onCommand("alignCenterX"), disabled: pairDisabled },
        { id: "align-right", label: translate("board.alignRight"), icon: AlignEndVertical, command: () => onCommand("alignRight"), disabled: pairDisabled },
        { id: "align-top", label: translate("board.alignTop"), icon: AlignStartHorizontal, command: () => onCommand("alignTop"), disabled: pairDisabled },
        { id: "align-center-y", label: translate("board.alignCenterY"), icon: AlignCenterHorizontal, command: () => onCommand("alignCenterY"), disabled: pairDisabled },
        { id: "align-bottom", label: translate("board.alignBottom"), icon: AlignEndHorizontal, command: () => onCommand("alignBottom"), disabled: pairDisabled },
        { id: "distribute-x", label: translate("board.distributeX"), icon: "distribute-x", command: () => onCommand("distributeX"), disabled: distributeDisabled },
        { id: "distribute-y", label: translate("board.distributeY"), icon: "distribute-y", command: () => onCommand("distributeY"), disabled: distributeDisabled },
        { id: "arrange", label: translate("board.arrangeCompactSelection"), icon: LayoutGrid, command: () => onCommand("arrangeCompact"), disabled: arrangeDisabled },
        { id: "arrange-settings", label: translate("board.arrangeSettings"), icon: ChevronDown, command: () => onCommand("toggleArrangePanel"), active: state.arrangePanelOpen },
        { id: "width", label: translate("board.normalizeWidth"), icon: "width", command: () => onCommand("normalizeWidth"), disabled: arrangeDisabled },
        { id: "height", label: translate("board.normalizeHeight"), icon: "height", command: () => onCommand("normalizeHeight"), disabled: arrangeDisabled },
        { id: "uniform-area", label: translate("board.uniformArea"), icon: Scaling, command: () => onCommand("uniformArea"), disabled: pairDisabled },
        { id: "uniform-scale", label: translate("board.uniformScale"), icon: Proportions, command: () => onCommand("uniformScale"), disabled: pairDisabled },
      ],
    },
    {
      id: "objects",
      actions: [
        { id: "lock", label: translate("board.toggleLock"), icon: Lock, command: () => onCommand("toggleLock"), disabled: selectionDisabled },
        { id: "group", label: translate("board.group"), icon: GroupIcon, command: () => onCommand("group"), shortcut: shortcuts.group, disabled: pairDisabled },
        { id: "parent", label: translate("board.parentWithHint"), icon: GitBranch, command: () => onCommand("parent"), shortcut: shortcuts.parent, disabled: selectionDisabled },
        { id: "unparent", label: translate("board.unparent"), icon: Unlink, command: () => onCommand("unparent"), shortcut: shortcuts.unparent, disabled: selectionDisabled },
        { id: "ungroup", label: translate("board.ungroup"), icon: LockOpen, command: () => onCommand("ungroup"), shortcut: shortcuts.ungroup, disabled: selectionDisabled },
        { id: "mask-rect", label: translate("board.maskRectShort"), icon: Square, command: () => onCommand("maskRect"), disabled: selectionDisabled },
        { id: "mask-circle", label: translate("board.maskCircleShort"), icon: Circle, command: () => onCommand("maskCircle"), disabled: selectionDisabled },
        { id: "crop", label: translate("board.cropImage"), icon: Crop, command: () => onCommand("crop"), disabled: selectionDisabled },
        { id: "reset-crop", label: translate("board.resetCrop"), icon: RotateCcw, command: () => onCommand("resetCrop"), disabled: selectionDisabled },
        { id: "opacity", label: translate("board.opacity"), icon: "opacity", command: () => onCommand("setOpacity"), disabled: selectionDisabled },
        { id: "duplicate", label: translate("board.duplicate"), icon: CopyPlus, command: () => onCommand("duplicate"), shortcut: shortcuts.duplicate, disabled: selectionDisabled },
        { id: "edit-content", label: translate("board.editContent"), icon: NotebookPen, command: () => onCommand("editContent"), disabled: noteSelectionDisabled },
        { id: "comment", label: state.selectedHasComment ? translate("board.commentEdit") : translate("board.commentAdd"), icon: MessageSquareText, command: () => onCommand("editComment"), active: state.selectedHasComment, shortcut: shortcuts.comment, disabled: selectionDisabled },
        { id: "delete", label: translate("board.delete"), icon: Trash2, command: () => onCommand("delete"), shortcut: shortcuts.delete, disabled: selectionDisabled },
      ],
    },
    {
      id: "view",
      actions: [
        { id: "undo", label: translate("board.undo"), icon: Undo2, command: () => onCommand("undo"), shortcut: shortcuts.undo },
        { id: "redo", label: translate("board.redo"), icon: Redo2, command: () => onCommand("redo"), shortcut: shortcuts.redo },
        { id: "fit-all", label: translate("board.fitAll"), icon: Maximize, command: () => onCommand("fitAll"), shortcut: shortcuts.fitAll },
        { id: "focus", label: state.focused ? translate("board.exitFocus") : translate("board.focusSelection"), icon: ScanSearch, command: () => onCommand("toggleFocus"), active: state.focused, shortcut: shortcuts.focus, disabled: selectionDisabled },
        { id: "fit-selection", label: translate("board.fitSelection"), icon: Focus, command: () => onCommand("fitSelection"), shortcut: shortcuts.fitSelection },
        { id: "export-png", label: translate("board.exportPngSelection"), icon: ImageDown, command: () => onCommand("exportPng"), disabled: selectionDisabled },
        { id: "inspector", label: state.inspectorOpen ? translate("board.closeInspector") : translate("board.openInspector"), icon: SlidersHorizontal, command: () => onCommand("toggleInspector"), active: state.inspectorOpen },
        { id: "layers", label: translate("board.layersTitle"), icon: Layers, command: () => onCommand("toggleLayers"), active: state.layersOpen, primary: true },
        { id: "zoom-100", label: translate("board.zoom100"), icon: "zoom-100", command: () => onCommand("zoom100") },
        { id: "reset-viewport", label: translate("board.resetViewport"), icon: Maximize, command: () => onCommand("resetViewport") },
      ],
    },
    {
      id: "canvas",
      actions: [
        { id: "grid", label: state.gridVisible ? translate("board.hideGrid") : translate("board.showGrid"), icon: Grid3X3, command: () => onCommand("toggleGrid"), active: state.gridVisible, shortcut: shortcuts.toggleGrid },
        { id: "appearance", label: translate("board.appearanceTitle"), icon: Palette, command: () => onCommand("editAppearance") },
        { id: "canvas-lock", label: state.canvasLocked ? translate("board.unlockCanvas") : translate("board.lockCanvasWhole"), icon: state.canvasLocked ? LockOpen : Lock, command: () => onCommand("toggleCanvasLock"), active: state.canvasLocked },
        { id: "canvas-gray", label: state.canvasGrayscale ? translate("board.restoreCanvasColor") : translate("board.canvasGrayscaleWhole"), icon: "grayscale", command: () => onCommand("toggleCanvasGrayscale"), active: state.canvasGrayscale },
        { id: "grid-style", label: translate("board.gridStyleCycle"), icon: Grid3X3, command: () => onCommand("cycleGridStyle") },
        { id: "sample-color", label: translate("board.sampleColor"), title: translate("board.sampleColorTitle"), icon: Pipette, command: () => onCommand("sampleColor") },
      ],
    },
    {
      id: "palette",
      actions: [
        { id: "command-palette", label: translate("board.commandPaletteTitle"), icon: Search, command: () => onCommand("openCommandPalette") },
      ],
    },
  ];
  // 收起态单行展示：只保留「文件与工具 + 视图 + 命令面板」三组，其余组不渲染。
  const visibleGroups = state.toolbarCollapsed
    ? groups.filter((group) => ["file-tools", "view", "palette"].includes(group.id))
    : groups;

  const renderButton = (action: ToolbarAction) => (
    <button
      key={action.id}
      className={`${action.primary ? "toolbar-primary " : ""}${action.active ? "active" : ""}`.trim() || undefined}
      onClick={action.command}
      disabled={action.disabled}
      aria-label={action.label}
      data-shortcut={action.shortcut}
    >
      {iconNode(action.icon)}
    </button>
  );

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label={translate("board.toolbarLabel")}>
      {visibleGroups.map((group) => (
        <div className="toolbar-group" key={group.id} data-group={group.id}>
          {group.actions.map(renderButton)}
        </div>
      ))}
      <div className="toolbar-group">
        <button
          className="toolbar-collapse"
          onClick={() => onCommand("toggleToolbarCollapsed")}
          aria-label={state.toolbarCollapsed ? translate("board.expandToolbar") : translate("board.collapseToolbar")}
          aria-expanded={!state.toolbarCollapsed}
        >
          {state.toolbarCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
    </div>
  );
}
