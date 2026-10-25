import { FabricImage } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { translate } from "../../app/i18n";
import type {
  BoardAppearance,
  BoardSummary,
} from "../../../shared/contracts";
import type { BoardShortcutBindings } from "../../app/board-shortcuts";
import type { BoardCommand } from "../../components/BoardCommandPalette";
import type { BoardCanvasObject as CanvasObjectWithData } from "./board-fabric-kernel";
import type { BoardCanvasSnapshot, BoardSelectionCapabilities } from "./board-canvas-controller";
import type { BoardDrawingTool, BoardTool } from "./controllers/drawing-controller";
import type { BoardHistoryController } from "./controllers/history-controller";

/**
 * 命令面板数据源：命令数组只做“声明式”的 id/label/group/keywords/disabled/run
 * 组装，行为全部来自 BoardCanvas 注入的闭包（与 use-board-shortcuts 的
 * BoardShortcutActions 同构的注入模式）。
 */
export interface BoardCommandContext {
  selectionCount: number;
  hasSelection: boolean;
  hasImageSelection: boolean;
  activeHasComment: boolean;
  hasBoardObjects: boolean;
  boards: BoardSummary[];
  board: BoardSummary;
  boardSnapshot: BoardCanvasSnapshot;
  capabilities: Readonly<BoardSelectionCapabilities>;
  boardClipboard: Record<string, unknown>[];
  runtime: { appearance: BoardAppearance };
  appearance: BoardAppearance;
  focusedObjectId: string | null;
  shortcutBindings: BoardShortcutBindings;
  inspectorOpen: boolean;
  layersOpen: boolean;
  canvasRef: { current: FabricCanvas | null };
  historyControllerRef: { current: BoardHistoryController };

  setTool: (tool: BoardTool) => void;
  setLastDrawingTool: (tool: BoardDrawingTool) => void;
  setDrawingPanelOpen: (open: boolean) => void;
  setInspectorOpen: (update: (value: boolean) => boolean) => void;
  setLayersOpen: (update: (value: boolean) => boolean) => void;
  setShortcutSettingsOpen: (open: boolean) => void;
  addText: () => void;
  addArrow: () => void;
  addRectangle: () => void;
  addGuide: (axis: "x" | "y") => void;
  addNote: () => Promise<void>;
  addChecklistNote: () => Promise<void>;
  importFilesFromDialog: () => Promise<void>;
  editSelectedNote: () => Promise<void>;
  moveSelection: (toFront: boolean) => void;
  moveSelectionLayer: (direction: "move-up" | "move-down") => void;
  transformSelection: (mode: "rotate" | "flipX" | "flipY") => void;
  alignSelection: (mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => void;
  distributeSelection: (axis: "x" | "y") => void;
  arrangeCompact: () => void;
  arrangeBy: (key: "name" | "added" | "layer" | "path" | "random" | "stack") => void;
  normalizeSize: (axis: "width" | "height") => void;
  uniformArea: () => void;
  uniformScale: () => void;
  resetSelectionTransform: () => void;
  toggleLockSelection: () => void;
  groupSelection: () => void;
  parentSelection: () => void;
  unparentSelection: () => void;
  ungroupSelection: () => void;
  applyMask: (shape: "rect" | "circle") => void;
  openCropDialog: (target: FabricImage) => void;
  resetSelectionCrop: () => void;
  setSelectionOpacity: () => Promise<void>;
  duplicateSelection: () => Promise<void>;
  editObjectComment: (target?: CanvasObjectWithData) => Promise<void>;
  deleteSelection: () => void;
  copySelection: () => void;
  pasteSelection: () => Promise<void>;
  restoreHistory: (offset: -1 | 1) => void;
  fitObjects: (selectionOnly?: boolean) => void;
  focusObjects: (canvas: FabricCanvas) => CanvasObjectWithData[];
  toggleObjectFocus: () => void;
  updateAppearance: (next: BoardAppearance) => void;
  editBoardAppearance: () => Promise<void>;
  setWindowMode: (mode: "normal" | "always-on-bottom" | "transparent-overlay" | "locked") => Promise<void>;
  createBoard: () => Promise<void>;
  onRenameBoard: (board: BoardSummary) => void;
  onDeleteBoard: (board: BoardSummary) => void;
}

export function buildBoardCommands(ctx: BoardCommandContext): BoardCommand[] {
  const {
    selectionCount,
    hasSelection,
    hasImageSelection,
    activeHasComment,
    hasBoardObjects,
    boards,
    board,
    boardSnapshot,
    capabilities,
    boardClipboard,
    runtime,
    appearance,
    focusedObjectId,
    shortcutBindings,
    inspectorOpen,
    layersOpen,
    canvasRef,
    historyControllerRef,
    setTool,
    setLastDrawingTool,
    setDrawingPanelOpen,
    setInspectorOpen,
    setLayersOpen,
    setShortcutSettingsOpen,
    addText,
    addArrow,
    addRectangle,
    addGuide,
    addNote,
    addChecklistNote,
    importFilesFromDialog,
    editSelectedNote,
    moveSelection,
    moveSelectionLayer,
    transformSelection,
    alignSelection,
    distributeSelection,
    arrangeCompact,
    arrangeBy,
    normalizeSize,
    uniformArea,
    uniformScale,
    resetSelectionTransform,
    toggleLockSelection,
    groupSelection,
    parentSelection,
    unparentSelection,
    ungroupSelection,
    applyMask,
    openCropDialog,
    resetSelectionCrop,
    setSelectionOpacity,
    duplicateSelection,
    editObjectComment,
    deleteSelection,
    copySelection,
    pasteSelection,
    restoreHistory,
    fitObjects,
    focusObjects,
    toggleObjectFocus,
    updateAppearance,
    editBoardAppearance,
    setWindowMode,
    createBoard,
    onRenameBoard,
    onDeleteBoard,
  } = ctx;
  return [
    {
      id: "tool-select",
      label: translate("board.toolSelect"),
      group: translate("board.groupTools"),
      keywords: ["select pointer"],
      run: () => setTool("select"),
    },
    {
      id: "tool-pencil",
      label: translate("board.drawingToolPencil"),
      group: translate("board.groupTools"),
      keywords: ["draw pencil brush"],
      run: () => {
        setLastDrawingTool("pencil");
        setTool("pencil");
      },
    },
    {
      id: "tool-line",
      label: translate("board.drawLine"),
      group: translate("board.groupTools"),
      keywords: ["draw line"],
      run: () => {
        setLastDrawingTool("line");
        setTool("line");
      },
    },
    {
      id: "tool-rectangle",
      label: translate("board.drawRectangle"),
      group: translate("board.groupTools"),
      keywords: ["draw rectangle"],
      run: () => {
        setLastDrawingTool("rectangle");
        setTool("rectangle");
      },
    },
    {
      id: "tool-ellipse",
      label: translate("board.drawEllipse"),
      group: translate("board.groupTools"),
      keywords: ["draw ellipse circle"],
      run: () => {
        setLastDrawingTool("ellipse");
        setTool("ellipse");
      },
    },
    {
      id: "drawing-settings",
      label: translate("board.drawingSettings"),
      group: translate("board.groupTools"),
      keywords: ["drawing style color width"],
      run: () => setDrawingPanelOpen(true),
    },
    {
      id: "add-text",
      label: translate("board.addText"),
      group: translate("board.groupInsert"),
      keywords: ["text"],
      run: addText,
    },
    {
      id: "add-arrow",
      label: translate("board.addArrow"),
      group: translate("board.groupInsert"),
      keywords: ["arrow"],
      run: addArrow,
    },
    {
      id: "add-rectangle",
      label: translate("board.addRectangleObject"),
      group: translate("board.groupInsert"),
      keywords: ["rectangle shape"],
      run: addRectangle,
    },
    {
      id: "import-files",
      label: translate("board.importFiles"),
      group: translate("board.groupInsert"),
      keywords: ["import file add", "导入文件"],
      run: () => void importFilesFromDialog(),
    },
    {
      id: "add-guide-x",
      label: translate("board.addGuideX"),
      group: translate("board.groupInsert"),
      keywords: ["guide vertical"],
      run: () => addGuide("x"),
    },
    {
      id: "add-guide-y",
      label: translate("board.addGuideY"),
      group: translate("board.groupInsert"),
      keywords: ["guide horizontal"],
      run: () => addGuide("y"),
    },
    {
      id: "move-back",
      label: translate("board.moveBottom"),
      group: translate("board.groupArrange"),
      disabled: !hasSelection,
      keywords: ["send back"],
      run: () => moveSelection(false),
    },
    {
      id: "move-front",
      label: translate("board.moveTop"),
      group: translate("board.groupArrange"),
      disabled: !hasSelection,
      keywords: ["bring front"],
      run: () => moveSelection(true),
    },
    {
      id: "move-up",
      label: translate("board.moveUpOne"),
      group: translate("board.groupArrange"),
      disabled: !hasSelection,
      keywords: ["bring forward one layer"],
      run: () => moveSelectionLayer("move-up"),
    },
    {
      id: "move-down",
      label: translate("board.moveDownOne"),
      group: translate("board.groupArrange"),
      disabled: !hasSelection,
      keywords: ["send backward one layer"],
      run: () => moveSelectionLayer("move-down"),
    },
    {
      id: "rotate-90",
      label: translate("board.rotate90"),
      group: translate("board.groupTransform"),
      disabled: !hasSelection,
      keywords: ["rotate"],
      run: () => transformSelection("rotate"),
    },
    {
      id: "flip-x",
      label: translate("board.flipH"),
      group: translate("board.groupTransform"),
      disabled: !hasSelection,
      keywords: ["flip horizontal"],
      run: () => transformSelection("flipX"),
    },
    {
      id: "flip-y",
      label: translate("board.flipV"),
      group: translate("board.groupTransform"),
      disabled: !hasSelection,
      keywords: ["flip vertical"],
      run: () => transformSelection("flipY"),
    },
    ...([
      ["align-left", "board.alignLeft", "left"],
      ["align-center-x", "board.alignCenterX", "centerX"],
      ["align-right", "board.alignRight", "right"],
      ["align-top", "board.alignTop", "top"],
      ["align-center-y", "board.alignCenterY", "centerY"],
      ["align-bottom", "board.alignBottom", "bottom"],
    ] as const).map(([id, labelKey, mode]) => ({
      id,
      label: translate(labelKey),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 2,
      keywords: ["align"],
      run: () => alignSelection(mode),
    })),
    {
      id: "distribute-x",
      label: translate("board.distributeX"),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 3,
      keywords: ["distribute horizontal"],
      run: () => distributeSelection("x"),
    },
    {
      id: "distribute-y",
      label: translate("board.distributeY"),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 3,
      keywords: ["distribute vertical"],
      run: () => distributeSelection("y"),
    },
    {
      id: "arrange-compact",
      label: translate("board.arrangeCompact"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["compact layout"],
      run: arrangeCompact,
    },
    {
      id: "arrange-by-name",
      label: translate("board.arrangeByName"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["sort by name"],
      run: () => arrangeBy("name"),
    },
    {
      id: "arrange-by-added",
      label: translate("board.arrangeByAdded"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["sort by added"],
      run: () => arrangeBy("added"),
    },
    {
      id: "arrange-by-layer",
      label: translate("board.arrangeByLayer"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["sort by layer"],
      run: () => arrangeBy("layer"),
    },
    {
      id: "arrange-by-path",
      label: translate("board.arrangeByPath"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["sort by path"],
      run: () => arrangeBy("path"),
    },
    {
      id: "arrange-random",
      label: translate("board.arrangeRandom"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["shuffle random"],
      run: () => arrangeBy("random"),
    },
    {
      id: "arrange-stack",
      label: translate("board.arrangeStack"),
      group: translate("board.groupArrange"),
      disabled: selectionCount
        ? selectionCount < 2
        : !hasBoardObjects,
      keywords: ["stack"],
      run: () => arrangeBy("stack"),
    },
    {
      id: "uniform-area",
      label: translate("board.uniformArea"),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 2,
      keywords: ["same area"],
      run: () => uniformArea(),
    },
    {
      id: "uniform-scale",
      label: translate("board.uniformScale"),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 2,
      keywords: ["same scale"],
      run: () => uniformScale(),
    },
    {
      id: "add-note",
      label: translate("board.addNote"),
      group: translate("board.groupInsert"),
      keywords: ["sticky note checklist"],
      run: () => void addNote(),
    },
    {
      id: "add-checklist",
      label: translate("board.addChecklist"),
      group: translate("board.groupInsert"),
      keywords: ["todo checklist"],
      run: () => void addChecklistNote(),
    },
    {
      id: "edit-note",
      label: translate("board.editNote"),
      group: translate("board.groupEdit"),
      disabled: !capabilities.hasNote,
      keywords: ["edit note"],
      run: () => void editSelectedNote(),
    },
    {
      id: "normalize-width",
      label: translate("board.normalizeWidth"),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 2,
      keywords: ["same width"],
      run: () => normalizeSize("width"),
    },
    {
      id: "normalize-height",
      label: translate("board.normalizeHeight"),
      group: translate("board.groupArrange"),
      disabled: selectionCount < 2,
      keywords: ["same height"],
      run: () => normalizeSize("height"),
    },
    {
      id: "reset-transform",
      label: translate("board.resetTransform"),
      group: translate("board.groupTransform"),
      shortcut: shortcutBindings.resetTransform || undefined,
      disabled: !hasSelection,
      keywords: ["reset transform"],
      run: resetSelectionTransform,
    },
    {
      id: "lock",
      label: translate("board.toggleLock"),
      group: translate("board.groupObject"),
      disabled: !hasSelection,
      keywords: ["lock unlock"],
      run: toggleLockSelection,
    },
    {
      id: "group",
      label: translate("board.group"),
      group: translate("board.groupObject"),
      shortcut: shortcutBindings.group || undefined,
      disabled: !capabilities.activeIsMultiSelection,
      keywords: ["group"],
      run: groupSelection,
    },
    {
      id: "ungroup",
      label: translate("board.ungroup"),
      group: translate("board.groupObject"),
      shortcut: shortcutBindings.ungroup || undefined,
      disabled: !capabilities.activeIsGroup,
      keywords: ["ungroup"],
      run: ungroupSelection,
    },
    {
      id: "parent",
      label: translate("board.parent"),
      group: translate("board.groupObject"),
      shortcut: shortcutBindings.parent || undefined,
      disabled: selectionCount < 2,
      keywords: ["parent hierarchy"],
      run: parentSelection,
    },
    {
      id: "unparent",
      label: translate("board.unparent"),
      group: translate("board.groupObject"),
      shortcut: shortcutBindings.unparent || undefined,
      disabled: !capabilities.hasParent,
      keywords: ["unparent hierarchy"],
      run: unparentSelection,
    },
    {
      id: "mask-rect",
      label: translate("board.maskRect"),
      group: translate("board.groupImage"),
      disabled: !hasSelection,
      keywords: ["mask rectangle"],
      run: () => applyMask("rect"),
    },
    {
      id: "mask-circle",
      label: translate("board.maskCircle"),
      group: translate("board.groupImage"),
      disabled: !hasSelection,
      keywords: ["mask circle"],
      run: () => applyMask("circle"),
    },
    {
      id: "crop",
      label: translate("board.cropImage"),
      group: translate("board.groupImage"),
      disabled: !capabilities.activeIsImage,
      keywords: ["crop"],
      run: () => {
        const active = canvasRef.current?.getActiveObject();
        if (active instanceof FabricImage) openCropDialog(active);
      },
    },
    {
      id: "reset-crop",
      label: translate("board.resetCrop"),
      group: translate("board.groupImage"),
      disabled: !hasImageSelection,
      keywords: ["reset crop"],
      run: resetSelectionCrop,
    },
    {
      id: "opacity",
      label: translate("board.opacityTitle"),
      group: translate("board.groupObject"),
      disabled: !hasSelection,
      keywords: ["opacity"],
      run: setSelectionOpacity,
    },
    {
      id: "duplicate",
      label: translate("board.duplicate"),
      group: translate("board.groupEdit"),
      shortcut: shortcutBindings.duplicate || undefined,
      disabled: !hasSelection,
      keywords: ["duplicate"],
      run: duplicateSelection,
    },
    {
      id: "copy",
      label: translate("board.copyClipboard"),
      group: translate("board.groupEdit"),
      shortcut: shortcutBindings.copy || undefined,
      disabled: !hasSelection,
      keywords: ["copy"],
      run: copySelection,
    },
    {
      id: "paste",
      label: translate("board.pasteObject"),
      group: translate("board.groupEdit"),
      shortcut: shortcutBindings.paste || undefined,
      disabled: boardClipboard.length === 0,
      keywords: ["paste"],
      run: pasteSelection,
    },
    {
      id: "comment",
      label: activeHasComment ? translate("board.commentEdit") : translate("board.commentAdd"),
      group: translate("board.groupObject"),
      shortcut: shortcutBindings.comment || undefined,
      disabled: !boardSnapshot.activeObjectId || capabilities.activeIsMultiSelection,
      keywords: ["comment note"],
      run: editObjectComment,
    },
    {
      id: "delete",
      label: translate("board.delete"),
      group: translate("board.groupEdit"),
      shortcut: shortcutBindings.delete || undefined,
      disabled: !hasSelection,
      keywords: ["delete remove"],
      run: deleteSelection,
    },
    {
      id: "undo",
      label: translate("board.undo"),
      group: translate("board.groupEdit"),
      shortcut: shortcutBindings.undo || undefined,
      disabled: !historyControllerRef.current.canUndo,
      keywords: ["undo"],
      run: () => restoreHistory(-1),
    },
    {
      id: "redo",
      label: translate("board.redo"),
      group: translate("board.groupEdit"),
      shortcut: shortcutBindings.redo || undefined,
      disabled: !historyControllerRef.current.canRedo,
      keywords: ["redo"],
      run: () => restoreHistory(1),
    },
    {
      id: "fit-all",
      label: translate("board.fitAll"),
      group: translate("board.groupView"),
      shortcut: shortcutBindings.fitAll || undefined,
      disabled: !hasBoardObjects,
      keywords: ["fit all"],
      run: () => fitObjects(false),
    },
    {
      id: "fit-selection",
      label: translate("board.fitSelection"),
      group: translate("board.groupView"),
      shortcut: shortcutBindings.fitSelection || undefined,
      disabled: !hasSelection,
      keywords: ["fit selection"],
      run: () => fitObjects(true),
    },
    {
      id: "focus",
      label: focusedObjectId ? translate("board.exitFocus") : translate("board.focusSelection"),
      group: translate("board.groupView"),
      shortcut: shortcutBindings.focus || undefined,
      disabled:
        !focusedObjectId &&
        (!canvasRef.current || focusObjects(canvasRef.current).length === 0),
      keywords: ["focus carousel"],
      run: toggleObjectFocus,
    },
    {
      id: "layers",
      label: layersOpen ? translate("board.closeLayers") : translate("board.openLayers"),
      group: translate("board.groupView"),
      keywords: ["layers hierarchy"],
      run: () => setLayersOpen((value) => !value),
    },
    {
      id: "inspector",
      label: inspectorOpen ? translate("board.closeInspector") : translate("board.openInspector"),
      group: translate("board.groupView"),
      keywords: ["inspector", "属性", "数值"],
      run: () => setInspectorOpen((value) => !value),
    },
    {
      id: "export-png-selection",
      label: translate("board.exportPngSelection"),
      group: translate("board.groupExport"),
      disabled: !hasSelection,
      keywords: ["export selection", "导出选区"],
      run: () => {
        window.dispatchEvent(new Event("refcanvas:export-png-selection"));
      },
    },
    {
      id: "grid",
      label: appearance.gridVisible ? translate("board.hideGrid") : translate("board.showGrid"),
      group: translate("board.groupView"),
      keywords: ["grid"],
      run: () =>
        updateAppearance({
          ...runtime.appearance,
          gridVisible: !runtime.appearance.gridVisible,
        }),
    },
    {
      id: "appearance",
      label: translate("board.appearanceTitle"),
      group: translate("board.groupView"),
      keywords: ["appearance background grid"],
      run: editBoardAppearance,
    },
    {
      id: "window-normal",
      label: translate("board.windowNormal"),
      group: translate("board.groupWindow"),
      keywords: ["window normal"],
      run: () => void setWindowMode("normal"),
    },
    {
      id: "window-always-bottom",
      label: translate("board.windowAlwaysBottom"),
      group: translate("board.groupWindow"),
      keywords: ["always on bottom window"],
      run: () => void setWindowMode("always-on-bottom"),
    },
    {
      id: "window-overlay",
      label: translate("board.windowOverlay"),
      group: translate("board.groupWindow"),
      keywords: ["transparent click through overlay floating"],
      run: () => void setWindowMode("transparent-overlay"),
    },
    {
      id: "window-locked",
      label: translate("board.windowLocked"),
      group: translate("board.groupWindow"),
      keywords: ["window locked canvas"],
      run: () => void setWindowMode("locked"),
    },
    {
      id: "shortcut-settings",
      label: translate("board.shortcutSettingsTitle"),
      group: translate("board.groupSettings"),
      keywords: ["keyboard shortcut keybinding hotkey"],
      run: () => setShortcutSettingsOpen(true),
    },
    {
      id: "new-board",
      label: translate("boards.new"),
      group: translate("board.groupBoard"),
      keywords: ["new board"],
      run: createBoard,
    },
    {
      id: "rename-board",
      label: translate("board.renameBoard"),
      group: translate("board.groupBoard"),
      keywords: ["rename board"],
      run: () => onRenameBoard(board),
    },
    {
      id: "delete-board",
      label: translate("board.deleteBoard"),
      group: translate("board.groupBoard"),
      disabled: boards.length <= 1,
      keywords: ["delete board"],
      run: () => onDeleteBoard(board),
    },
  ];
}
