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
    { id: "select", label: "选择工具", icon: MousePointer2, command: () => onCommand("select"), active: state.tool === "select", primary: true },
    "divider",
    { id: "text", label: "添加文字", icon: Type, command: () => onCommand("addText") },
    { id: "note", label: "新建便签（富文本/链接/清单）", icon: StickyNote, command: () => onCommand("addNote"), primary: true },
    { id: "checklist", label: "新建清单", icon: ListTodo, command: () => onCommand("addChecklist") },
    { id: "arrow", label: "添加箭头", icon: ArrowUpRight, command: () => onCommand("addArrow") },
    { id: "rectangle", label: "添加矩形", icon: Square, command: () => onCommand("addRectangle") },
    { id: "guide-x", label: "添加垂直参考线", icon: "guide-x", command: () => onCommand("addVerticalGuide") },
    { id: "guide-y", label: "添加水平参考线", icon: "guide-y", command: () => onCommand("addHorizontalGuide") },
    { id: "drawing", label: state.drawingToolActive ? "退出绘图工具" : "启用绘图工具", icon: Paintbrush, command: () => onCommand("toggleDrawing"), active: state.drawingToolActive, primary: true },
    { id: "drawing-settings", label: "绘图工具设置", icon: ChevronDown, command: () => onCommand("toggleDrawingPanel"), active: state.drawingPanelOpen },
    { id: "eraser", label: "橡皮擦（点击或拖动擦除笔画）", icon: Eraser, command: () => onCommand("toggleEraser"), active: state.tool === "eraser", primary: true },
    { id: "undo-stroke", label: "撤销上一笔画", icon: Undo2, command: () => onCommand("undoStroke") },
    "divider",
    { id: "bottom", label: "移到最底层", icon: ArrowDownToLine, command: () => onCommand("moveBottom") },
    { id: "top", label: "移到最顶层", icon: ArrowUpToLine, command: () => onCommand("moveTop") },
    { id: "rotate", label: "顺时针旋转 90°", icon: RotateCw, command: () => onCommand("rotate") },
    { id: "flip-x", label: "水平翻转", icon: FlipHorizontal2, command: () => onCommand("flipX") },
    { id: "flip-y", label: "垂直翻转", icon: FlipVertical2, command: () => onCommand("flipY") },
    { id: "align-left", label: "左对齐", icon: AlignStartVertical, command: () => onCommand("alignLeft") },
    { id: "align-center-x", label: "水平居中", icon: AlignCenterVertical, command: () => onCommand("alignCenterX") },
    { id: "align-right", label: "右对齐", icon: AlignEndVertical, command: () => onCommand("alignRight") },
    { id: "align-top", label: "顶部对齐", icon: AlignStartHorizontal, command: () => onCommand("alignTop") },
    { id: "align-center-y", label: "垂直居中", icon: AlignCenterHorizontal, command: () => onCommand("alignCenterY") },
    { id: "align-bottom", label: "底部对齐", icon: AlignEndHorizontal, command: () => onCommand("alignBottom") },
    { id: "distribute-x", label: "水平分布", icon: "distribute-x", command: () => onCommand("distributeX") },
    { id: "distribute-y", label: "垂直分布", icon: "distribute-y", command: () => onCommand("distributeY") },
    { id: "arrange", label: "紧凑排列（有选区时排列选区）", icon: LayoutGrid, command: () => onCommand("arrangeCompact") },
    { id: "width", label: "统一宽度", icon: "width", command: () => onCommand("normalizeWidth") },
    { id: "height", label: "统一高度", icon: "height", command: () => onCommand("normalizeHeight") },
    { id: "reset-transform", label: "重置尺寸、旋转和翻转", icon: RotateCcw, command: () => onCommand("resetTransform"), shortcut: shortcuts.resetTransform },
    { id: "lock", label: "锁定或解锁", icon: Lock, command: () => onCommand("toggleLock") },
    { id: "group", label: "组合", icon: GroupIcon, command: () => onCommand("group"), shortcut: shortcuts.group },
    { id: "parent", label: "建立父子关系（首个选中对象为父级）", icon: GitBranch, command: () => onCommand("parent"), shortcut: shortcuts.parent },
    { id: "unparent", label: "解除父级", icon: Unlink, command: () => onCommand("unparent"), shortcut: shortcuts.unparent },
    { id: "ungroup", label: "取消组合", icon: LockOpen, command: () => onCommand("ungroup"), shortcut: shortcuts.ungroup },
    { id: "mask-rect", label: "矩形蒙版", icon: Square, command: () => onCommand("maskRect") },
    { id: "mask-circle", label: "圆形蒙版", icon: Circle, command: () => onCommand("maskCircle") },
    { id: "crop", label: "裁切图片", icon: Crop, command: () => onCommand("crop") },
    { id: "reset-crop", label: "重置图片裁切", icon: RotateCcw, command: () => onCommand("resetCrop") },
    { id: "grayscale", label: "切换图片灰度", icon: "grayscale", command: () => onCommand("toggleGrayscale") },
    { id: "color", label: "恢复图片原色", icon: "color", command: () => onCommand("restoreColor") },
    { id: "opacity", label: "透明度", icon: "opacity", command: () => onCommand("setOpacity") },
    { id: "duplicate", label: "复制对象", icon: CopyPlus, command: () => onCommand("duplicate"), shortcut: shortcuts.duplicate },
    { id: "comment", label: state.selectedHasComment ? "编辑对象评论" : "添加对象评论", icon: MessageSquareText, command: () => onCommand("editComment"), active: state.selectedHasComment, shortcut: shortcuts.comment },
    { id: "delete", label: "删除对象", icon: Trash2, command: () => onCommand("delete"), shortcut: shortcuts.delete },
    "divider",
    { id: "undo", label: "撤销", icon: Undo2, command: () => onCommand("undo"), shortcut: shortcuts.undo },
    { id: "redo", label: "重做", icon: Redo2, command: () => onCommand("redo"), shortcut: shortcuts.redo },
    { id: "fit-all", label: "适应全部对象", icon: Maximize, command: () => onCommand("fitAll"), shortcut: shortcuts.fitAll },
    { id: "focus", label: state.focused ? "退出单图聚焦" : "聚焦选中图片", icon: ScanSearch, command: () => onCommand("toggleFocus"), active: state.focused, shortcut: shortcuts.focus },
    { id: "fit-selection", label: "适应选区", icon: Focus, command: () => onCommand("fitSelection"), shortcut: shortcuts.fitSelection },
    { id: "layers", label: "图层", icon: Layers, command: () => onCommand("toggleLayers"), active: state.layersOpen, primary: true },
    "divider",
    { id: "grid", label: state.gridVisible ? "隐藏网格" : "显示网格", icon: Grid3X3, command: () => onCommand("toggleGrid"), active: state.gridVisible, shortcut: shortcuts.toggleGrid },
    { id: "appearance", label: "白板背景与网格设置", icon: Palette, command: () => onCommand("editAppearance") },
    "divider",
    { id: "canvas-lock", label: state.canvasLocked ? "解锁画布" : "锁定整个画布", icon: state.canvasLocked ? LockOpen : Lock, command: () => onCommand("toggleCanvasLock"), active: state.canvasLocked },
    { id: "canvas-gray", label: state.canvasGrayscale ? "恢复画布原色" : "画布整体灰度", icon: "grayscale", command: () => onCommand("toggleCanvasGrayscale"), active: state.canvasGrayscale },
    { id: "grid-style", label: "切换网格样式（线/点/无）", icon: Grid3X3, command: () => onCommand("cycleGridStyle") },
    { id: "zoom-100", label: "100% 缩放", icon: "zoom-100", command: () => onCommand("zoom100") },
    { id: "reset-viewport", label: "重置相机（适应全部对象）", icon: Maximize, command: () => onCommand("resetViewport") },
    { id: "sample-color", label: "取色", title: "从画布取色", icon: Pipette, command: () => onCommand("sampleColor") },
    { id: "sampling", label: "切换采样（nearest/bilinear）", title: `采样：${state.sampling === "nearest" ? "nearest（像素）" : "bilinear（平滑）"}`, icon: state.sampling, command: () => onCommand("toggleSampling") },
  ];

  return (
    <div className="canvas-toolbar toolbar-compact" role="toolbar" aria-label="白板工具">
      {actions.map((action, index) =>
        action === "divider" ? (
          <span className="toolbar-divider" key={`divider-${index}`} />
        ) : (
          <button
            key={action.id}
            className={`${action.primary ? "toolbar-primary " : ""}${action.active ? "active" : ""}`.trim() || undefined}
            onClick={action.command}
            aria-label={action.label}
            title={action.title}
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
        aria-label="更多工具"
        aria-haspopup="dialog"
        aria-expanded={state.moreOpen}
      >
        {iconNode("more")}
      </button>
    </div>
  );
}
