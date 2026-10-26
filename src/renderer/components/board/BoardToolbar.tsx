import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowUpRight,
  BringToFront,
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Crop,
  Ellipsis,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  GitBranch,
  Grid2x2,
  Grid3X3,
  GroupIcon,
  ImageDown,
  ImagePlus,
  Layers,
  LayoutGrid,
  ListTodo,
  Lock,
  LockKeyhole,
  LockOpen,
  Maximize,
  MessageSquareText,
  MousePointer2,
  NotebookPen,
  Paintbrush,
  Palette,
  PenLine,
  Pipette,
  Proportions,
  Redo2,
  RotateCcw,
  RotateCcwSquare,
  RotateCw,
  Scaling,
  ScanSearch,
  Search,
  SendToBack,
  Settings2,
  SlidersHorizontal,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  UndoDot,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import { translate } from "../../app/i18n";

type ToolbarIcon =
  | LucideIcon
  | "guide-x"
  | "guide-y"
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
  readonly shortcut?: string;
  readonly disabled?: boolean;
}

// 工具栏分组：组内按钮不换行，组与组之间是 .canvas-toolbar flex-wrap 的换行单位。
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
  readonly sampleColor: () => void;
  readonly openCommandPalette: () => void;
  readonly toggleToolbarCollapsed: () => void;
}

export type BoardToolbarCommand = keyof BoardToolbarCommands;

interface BoardToolbarProps {
  readonly state: BoardToolbarState;
  readonly onCommand: (command: BoardToolbarCommand) => void;
  readonly shortcuts: Readonly<Record<string, string>>;
  /** 供父级测量换行后的实际高度，右侧卡片据此避让。 */
  readonly toolbarRef?: Ref<HTMLDivElement>;
}

function iconNode(icon: ToolbarIcon) {
  if (typeof icon === "string") {
    const text = {
      "guide-x": "│",
      "guide-y": "—",
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

/**
 * 白板工具栏：分层而不平铺。
 *
 * 历史教训：把 67 个动作全部平铺成"七组一行"，在 1490px 的画布宽度下
 * 需要约 2375px——必然换行成参差两行，且同一图形被多个语义复用。现在分三层：
 *
 * - 常驻层 (base)：无选区时也必用的少量动作，位置固定，默认单行。
 * - 上下文层 (context)：仅在有选区时出现（变换/对齐/对象操作）。
 * - 溢出层 (overflow)：低频的棋盘与视图开关，收进「更多」弹层。
 *
 * 位置稳定性优先于"全部可见"：常驻层永远是前几个位置，不随选区变化漂移。
 */
export function BoardToolbar({
  state,
  onCommand,
  shortcuts,
  toolbarRef,
}: BoardToolbarProps) {
  // 禁用态映射：选中类命令依赖选区，对齐/编组/等比归一至少 2 个对象，分布至少 3 个，
  // 紧凑排列/宽高归一依赖白板上存在对象；编辑内容只对笔记/清单类生效。
  const selectionDisabled = !state.hasSelection;
  const noteSelectionDisabled = !state.selectionHasNote;
  const pairDisabled = state.selectionCount < 2;
  const distributeDisabled = state.selectionCount < 3;
  const arrangeDisabled = !state.hasBoardObjects;

  // ── 常驻层：导入 / 选择 / 绘图 / 橡皮 / 撤销 / 添加 / 面板 / 命令 ──
  const baseGroups: readonly ToolbarGroup[] = [
    {
      id: "file-tools",
      actions: [
        { id: "import", label: translate("board.importFiles"), icon: ImagePlus, command: () => onCommand("importFiles") },
        { id: "select", label: translate("board.toolSelect"), icon: MousePointer2, command: () => onCommand("select"), active: state.tool === "select" },
        { id: "drawing", label: state.drawingToolActive ? translate("board.exitDrawing") : translate("board.enableDrawing"), icon: Paintbrush, command: () => onCommand("toggleDrawing"), active: state.drawingToolActive },
        // 铅笔设置与「下移一层」过去共用 ChevronDown：这里换成钢笔线图标。
        { id: "drawing-settings", label: translate("board.drawingSettings"), icon: PenLine, command: () => onCommand("toggleDrawingPanel"), active: state.drawingPanelOpen },
        { id: "eraser", label: translate("board.eraser"), icon: Eraser, command: () => onCommand("toggleEraser"), active: state.tool === "eraser" },
        // 撤销笔画与画布撤销过去共用 Undo2：笔画用带点的 UndoDot 区分。
        { id: "undo-stroke", label: translate("board.undoStroke"), icon: UndoDot, command: () => onCommand("undoStroke") },
      ],
    },
    {
      id: "add",
      actions: [
        { id: "text", label: translate("board.addText"), icon: Type, command: () => onCommand("addText") },
        { id: "note", label: translate("board.addNote"), icon: StickyNote, command: () => onCommand("addNote") },
        { id: "checklist", label: translate("board.addChecklist"), icon: ListTodo, command: () => onCommand("addChecklist") },
        { id: "arrow", label: translate("board.addArrow"), icon: ArrowUpRight, command: () => onCommand("addArrow") },
        { id: "rectangle", label: translate("board.addRectangle"), icon: Square, command: () => onCommand("addRectangle") },
        { id: "guide-x", label: translate("board.addGuideX"), icon: "guide-x", command: () => onCommand("addVerticalGuide") },
        { id: "guide-y", label: translate("board.addGuideY"), icon: "guide-y", command: () => onCommand("addHorizontalGuide") },
      ],
    },
    {
      id: "history",
      actions: [
        { id: "undo", label: translate("board.undo"), icon: Undo2, command: () => onCommand("undo"), shortcut: shortcuts.undo },
        { id: "redo", label: translate("board.redo"), icon: Redo2, command: () => onCommand("redo"), shortcut: shortcuts.redo },
      ],
    },
    {
      id: "panels",
      actions: [
        { id: "layers", label: translate("board.layersTitle"), icon: Layers, command: () => onCommand("toggleLayers"), active: state.layersOpen },
        { id: "inspector", label: state.inspectorOpen ? translate("board.closeInspector") : translate("board.openInspector"), icon: SlidersHorizontal, command: () => onCommand("toggleInspector"), active: state.inspectorOpen },
      ],
    },
    {
      id: "palette",
      actions: [
        { id: "command-palette", label: translate("board.commandPaletteTitle"), icon: Search, command: () => onCommand("openCommandPalette") },
      ],
    },
  ];

  // ── 上下文层：仅在选中对象时出现。
  // 只放“没有第二入口或高频”的动作：对齐 6 项在右键菜单里有完整一套、
  // 层级4 项同样在右键菜单，它们下放到溢出层，不占常驻视野。
  const contextGroups: readonly ToolbarGroup[] = [
    {
      id: "transform",
      actions: [
        { id: "rotate", label: translate("board.rotate90"), icon: RotateCw, command: () => onCommand("rotate"), disabled: selectionDisabled },
        { id: "flip-x", label: translate("board.flipH"), icon: FlipHorizontal2, command: () => onCommand("flipX"), disabled: selectionDisabled },
        { id: "flip-y", label: translate("board.flipV"), icon: FlipVertical2, command: () => onCommand("flipY"), disabled: selectionDisabled },
        { id: "reset-transform", label: translate("board.resetTransform"), icon: RotateCcw, command: () => onCommand("resetTransform"), shortcut: shortcuts.resetTransform, disabled: selectionDisabled },
      ],
    },
    {
      id: "align",
      actions: [
        { id: "distribute-x", label: translate("board.distributeX"), icon: AlignHorizontalDistributeCenter, command: () => onCommand("distributeX"), disabled: distributeDisabled },
        { id: "distribute-y", label: translate("board.distributeY"), icon: AlignVerticalDistributeCenter, command: () => onCommand("distributeY"), disabled: distributeDisabled },
        { id: "arrange", label: translate("board.arrangeCompactSelection"), icon: LayoutGrid, command: () => onCommand("arrangeCompact"), disabled: arrangeDisabled },
        // 唯一没有第二入口的排列参数面板，必须留在可见处。
        { id: "arrange-settings", label: translate("board.arrangeSettings"), icon: Settings2, command: () => onCommand("toggleArrangePanel"), active: state.arrangePanelOpen },
      ],
    },
    {
      id: "objects",
      actions: [
        { id: "lock", label: translate("board.toggleLock"), icon: LockKeyhole, command: () => onCommand("toggleLock"), disabled: selectionDisabled },
        { id: "group", label: translate("board.group"), icon: GroupIcon, command: () => onCommand("group"), shortcut: shortcuts.group, disabled: pairDisabled },
        // 取消组合提到可见层：成组后最常用的下一步就是它（成组/解组成对出现）。
        { id: "ungroup", label: translate("board.ungroup"), icon: LockOpen, command: () => onCommand("ungroup"), shortcut: shortcuts.ungroup, disabled: selectionDisabled },
        { id: "crop", label: translate("board.cropImage"), icon: Crop, command: () => onCommand("crop"), disabled: selectionDisabled },
        { id: "duplicate", label: translate("board.duplicate"), icon: CopyPlus, command: () => onCommand("duplicate"), shortcut: shortcuts.duplicate, disabled: selectionDisabled },
        { id: "comment", label: state.selectedHasComment ? translate("board.commentEdit") : translate("board.commentAdd"), icon: MessageSquareText, command: () => onCommand("editComment"), active: state.selectedHasComment, shortcut: shortcuts.comment, disabled: selectionDisabled },
        { id: "delete", label: translate("board.delete"), icon: Trash2, command: () => onCommand("delete"), shortcut: shortcuts.delete, disabled: selectionDisabled },
      ],
    },
  ];

  // ── 溢出层：低频视图/画布开关 + 已有右键菜单第二入口的选区操作 ──
  const overflowGroups: readonly ToolbarGroup[] = [
    {
      id: "align",
      actions: [
        { id: "align-left", label: translate("board.alignLeft"), icon: AlignStartVertical, command: () => onCommand("alignLeft"), disabled: pairDisabled },
        { id: "align-center-x", label: translate("board.alignCenterX"), icon: AlignCenterVertical, command: () => onCommand("alignCenterX"), disabled: pairDisabled },
        { id: "align-right", label: translate("board.alignRight"), icon: AlignEndVertical, command: () => onCommand("alignRight"), disabled: pairDisabled },
        { id: "align-top", label: translate("board.alignTop"), icon: AlignStartHorizontal, command: () => onCommand("alignTop"), disabled: pairDisabled },
        { id: "align-center-y", label: translate("board.alignCenterY"), icon: AlignCenterHorizontal, command: () => onCommand("alignCenterY"), disabled: pairDisabled },
        { id: "align-bottom", label: translate("board.alignBottom"), icon: AlignEndHorizontal, command: () => onCommand("alignBottom"), disabled: pairDisabled },
        { id: "width", label: translate("board.normalizeWidth"), icon: "width", command: () => onCommand("normalizeWidth"), disabled: arrangeDisabled },
        { id: "height", label: translate("board.normalizeHeight"), icon: "height", command: () => onCommand("normalizeHeight"), disabled: arrangeDisabled },
        { id: "uniform-area", label: translate("board.uniformArea"), icon: Scaling, command: () => onCommand("uniformArea"), disabled: pairDisabled },
        { id: "uniform-scale", label: translate("board.uniformScale"), icon: Proportions, command: () => onCommand("uniformScale"), disabled: pairDisabled },
      ],
    },
    {
      id: "order",
      actions: [
        { id: "bottom", label: translate("board.moveBottom"), icon: SendToBack, command: () => onCommand("moveBottom"), disabled: selectionDisabled },
        { id: "top", label: translate("board.moveTop"), icon: BringToFront, command: () => onCommand("moveTop"), disabled: selectionDisabled },
        { id: "move-up", label: translate("board.moveUpOne"), icon: ChevronUp, command: () => onCommand("moveUp"), disabled: selectionDisabled },
        { id: "move-down", label: translate("board.moveDownOne"), icon: ChevronDown, command: () => onCommand("moveDown"), disabled: selectionDisabled },
        { id: "reset-crop", label: translate("board.resetCrop"), icon: RotateCcwSquare, command: () => onCommand("resetCrop"), disabled: selectionDisabled },
        { id: "opacity", label: translate("board.opacity"), icon: "opacity", command: () => onCommand("setOpacity"), disabled: selectionDisabled },
        { id: "edit-content", label: translate("board.editContent"), icon: NotebookPen, command: () => onCommand("editContent"), disabled: noteSelectionDisabled },
        // 层级关系三键：parent/unparent/ungroup 均有快捷键，且图层面板可直接拖拽改层级。
        { id: "parent", label: translate("board.parentWithHint"), icon: GitBranch, command: () => onCommand("parent"), shortcut: shortcuts.parent, disabled: selectionDisabled },
        { id: "unparent", label: translate("board.unparent"), icon: Unlink, command: () => onCommand("unparent"), shortcut: shortcuts.unparent, disabled: selectionDisabled },
      ],
    },
    {
      id: "view",
      actions: [
        { id: "fit-all", label: translate("board.fitAll"), icon: Maximize, command: () => onCommand("fitAll"), shortcut: shortcuts.fitAll },
        { id: "focus", label: state.focused ? translate("board.exitFocus") : translate("board.focusSelection"), icon: ScanSearch, command: () => onCommand("toggleFocus"), active: state.focused, shortcut: shortcuts.focus, disabled: selectionDisabled },
        { id: "fit-selection", label: translate("board.fitSelection"), icon: Focus, command: () => onCommand("fitSelection"), shortcut: shortcuts.fitSelection },
        { id: "export-png", label: translate("board.exportPngSelection"), icon: ImageDown, command: () => onCommand("exportPng"), disabled: selectionDisabled },
        { id: "zoom-100", label: translate("board.zoom100"), icon: "zoom-100", command: () => onCommand("zoom100") },
      ],
    },
    {
      id: "canvas",
      actions: [
        { id: "grid", label: state.gridVisible ? translate("board.hideGrid") : translate("board.showGrid"), icon: Grid3X3, command: () => onCommand("toggleGrid"), active: state.gridVisible, shortcut: shortcuts.toggleGrid },
        { id: "appearance", label: translate("board.appearanceTitle"), icon: Palette, command: () => onCommand("editAppearance") },
        { id: "canvas-lock", label: state.canvasLocked ? translate("board.unlockCanvas") : translate("board.lockCanvasWhole"), icon: state.canvasLocked ? LockOpen : Lock, command: () => onCommand("toggleCanvasLock"), active: state.canvasLocked },
        { id: "canvas-gray", label: state.canvasGrayscale ? translate("board.restoreCanvasColor") : translate("board.canvasGrayscaleWhole"), icon: "grayscale", command: () => onCommand("toggleCanvasGrayscale"), active: state.canvasGrayscale },
        // 与 grid 的 Grid3X3 区分：网格样式循环用 2×2 表示"切换排布方式"。
        { id: "grid-style", label: translate("board.gridStyleCycle"), icon: Grid2x2, command: () => onCommand("cycleGridStyle") },
        { id: "sample-color", label: translate("board.sampleColorTitle"), icon: Pipette, command: () => onCommand("sampleColor") },
      ],
    },
  ];

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  // 点在弹层与触发按钮之外时关闭，避免叠在画布上挡操作。
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = overflowRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      setOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [overflowOpen]);

  // 收起态只留常驻层最核心的几组，保持单行。
  const baseVisible = state.toolbarCollapsed
    ? baseGroups.filter((group) => ["file-tools", "palette"].includes(group.id))
    : baseGroups;
  const contextVisible = state.hasSelection && !state.toolbarCollapsed ? contextGroups : [];

  const renderButton = (action: ToolbarAction) => (
    <button
      key={action.id}
      className={action.active ? "active" : undefined}
      onClick={action.command}
      disabled={action.disabled}
      aria-label={action.label}
      aria-pressed={action.active}
      data-shortcut={action.shortcut}
    >
      {iconNode(action.icon)}
    </button>
  );

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label={translate("board.toolbarLabel")} ref={toolbarRef}>
      <div className="toolbar-layer toolbar-layer-base">
        {baseVisible.map((group) => (
          <div className="toolbar-group" key={group.id} data-group={group.id}>
            {group.actions.map(renderButton)}
          </div>
        ))}
      </div>
      {contextVisible.length > 0 && (
        <div className="toolbar-layer toolbar-layer-context" data-layer="context">
          {contextVisible.map((group) => (
            <div className="toolbar-group" key={group.id} data-group={group.id}>
              {group.actions.map(renderButton)}
            </div>
          ))}
        </div>
      )}
      {!state.toolbarCollapsed && (
        <div className="toolbar-group toolbar-overflow" data-group="overflow" ref={overflowRef}>
          <button
            className={overflowOpen ? "active" : undefined}
            aria-label={translate("board.toolbarMore")}
            aria-expanded={overflowOpen}
            aria-haspopup="true"
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <Ellipsis size={16} />
          </button>
          {overflowOpen && (
            <div className="toolbar-overflow-popover" role="group" aria-label={translate("board.toolbarMore")}>
              {overflowGroups.map((group) => (
                <div className="toolbar-overflow-row" key={group.id} data-group={group.id}>
                  {group.actions.map(renderButton)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="toolbar-group toolbar-collapse-group" data-group="collapse">
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
