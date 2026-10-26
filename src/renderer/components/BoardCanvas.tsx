import {
  Maximize,
  Grid3X3,
  Minus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { SelectMenu } from "./SelectMenu";
import {
  Canvas as FabricCanvas,
  FabricImage,
  FabricObject,
  FabricText,
  Group,
  Line,
  PencilBrush,
  Point,
  Rect,
  ActiveSelection,
  Textbox,
  Triangle,
  util,
  type TMat2D,
} from "fabric";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  sourcePixelFromUv,
} from "../app/color-readout";
import { BoardObjectComment } from "./BoardObjectComment";
import { translate } from "../app/i18n";
import { useAppStore } from "../app/store";
import {
  createBoardActiveSelection,
  installBoardActiveSelection,
  optimizeBoardActiveSelection,
  selectAllBoardObjects,
  toggleObjectInActiveSelection,
} from "../app/board-active-selection";
import type {
  AssetRecord,
  BoardAppearance,
  BoardDocumentV3,
  BoardSettings,
  BoardSummary,
} from "../../shared/contracts";
import { browserImageExtensions } from "../../shared/asset-kind";
import {
  clampOpacity,
  constrainedAxis,
  cropGestureRect,
  cropPanDelta,
  cropZoomForHorizontalDrag,
  flipAxisForDrag,
  isMiddleButtonPointer,
  isPanPointerEvent,
  MiddlePanSession,
  opacityDelta,
  normalizeSignedAngle,
  pointerAngleDelta,
  recoveredPrimaryMouseUp,
  snapRotationAngle,
  scaleForHorizontalDrag,
  stationarySnapCandidates,
  type PrimaryPointerSnapshot,
  zoomFactorForDrag,
} from "../app/board-gestures";
import {
  loadBoardShortcuts,
  type BoardShortcutBindings,
} from "../app/board-shortcuts";
import {
  applyHierarchyTransform,
  canSetHierarchyParent,
  flattenHierarchy,
  hierarchyDescendantIds,
  hierarchyTransformDelta,
} from "../app/board-hierarchy";
import {
  calculateCompactLayout,
  calculateFocusViewport,
  findAxisSnapTarget,
  nextCircularIndex,
  sceneAxisToViewport,
} from "../app/board-layout";
import { clampBoardZoom, BOARD_MAX_ZOOM, BOARD_PIXEL_ZOOM } from "../app/board-zoom";
import { localToUv } from "../app/board-sample-uv";
import { sampleDisplayPixel } from "../app/display-sample";
import {
  DEFAULT_GIF_STATE,
  GifAnimator,
  gifStateFromData,
  type GifState,
} from "../app/board-gif";
import { BoardInspector } from "./BoardInspector";
import {
  BoardToolbar,
  type BoardToolbarCommand,
} from "./board/BoardToolbar";
import {
  BoardContextMenu,
  type BoardContextMenuState,
} from "./board/BoardContextMenu";
import { BoardAppearancePanel } from "./board/BoardAppearancePanel";
import { BoardArrangePanel } from "./board/BoardArrangePanel";
import { BoardColorSampleBody, type ColorSample } from "./board/BoardColorSample";
import { BoardSideDock } from "./board/BoardSideDock";
import { BoardDrawingPanel } from "./board/BoardDrawingPanel";
import {
  BoardCommandPalette,
  type BoardCommand,
} from "./BoardCommandPalette";
import {
  BoardShortcutSettings,
} from "./BoardShortcutSettings";
import {
  clampBoardContextPosition,
  interruptedSelectionMouseUp,
  resolveBoardContext,
} from "../app/board-context-menu";
import {
  isStandaloneBoardWindow,
  shouldLiftInteraction,
} from "../app/board-window";
import { applyBoardControls } from "../app/board-controls";
import {
  boardProxySizeForPixels,
  boardProxyUrl,
  loadBoardImageWithFallback,
  loadThumbnailWithRetry,
  type BoardProxySize,
} from "../app/board-proxy";
import { loadCleanBoardImageElement } from "../app/board-image-loader";
import { ModelPreview, type ModelView } from "./ModelPreview";
import { AssetPreview } from "./AssetPreview";
import { PreviewToolbar } from "./PreviewToolbar";
import {
  PreviewTransportProvider,
  usePreviewTransport,
} from "./PreviewTransport";
import { formatPreviewTimecode } from "./preview-panel-model";
import { useDialog } from "./DialogProvider";
import { CropDialog, type CropRect } from "./CropDialog";
import {
  boardToolInteractionState,
  createBoardShape,
  defaultBoardDrawingStyle,
  isBoardDrawingTool,
  isBoardShapeTool,
  toggleBoardDrawingTool,
  toggleBoardEraserTool,
  updateBoardShape,
  type BoardDrawingObject,
  type BoardDrawingStyle,
  type BoardDrawingTool,
  type BoardTool,
} from "../features/board/controllers/drawing-controller";
import { BoardHistoryController } from "../features/board/controllers/history-controller";
import { BoardArrangeController } from "../features/board/controllers/arrange-controller";
import {
  copyBoardSelection,
  hasBoardClipboard,
  pasteBoardSelection,
} from "../features/board/board-clipboard";
const CLIPBOARD_PRESENT: Record<string, unknown>[] = [{}];
import { buildBoardCommands } from "../features/board/board-command-registry";
import {
  useBoardShortcuts,
  type BoardShortcutCommand,
  type BoardShortcutPayload,
} from "../features/board/use-board-shortcuts";
import { useBoardGestureKeys } from "../features/board/use-board-gesture-keys";
import { BoardPersistenceController } from "../features/board/board-persistence-controller";
import { BoardImportController } from "../features/board/board-import-controller";
import { resolveBoardSelection } from "../features/board/controllers/selection-controller";
import {
  clientToScenePoint,
  fitViewport,
  zoomTo100,
} from "../features/board/controllers/viewport-controller";
import { useBoardEventBindings } from "../features/board/use-board-bindings";
import {
  BoardRuntimeController,
  DEFAULT_BOARD_APPEARANCE,
} from "../features/board/board-runtime-controller";
import {
  BoardCanvasController,
  type PureRefGestureSnapshot,
} from "../features/board/board-canvas-controller";
import { BoardLayerPanel } from "./board/BoardLayerPanel";
import {
  applyBoardCanvasMode,
  ensureBoardObjectIdentity as ensureObjectIdentity,
  serializeBoardDocument,
  type BoardCanvasObject as CanvasObjectWithData,
} from "../features/board/board-fabric-kernel";

interface BoardCanvasProps {
  board: BoardSummary;
  document: BoardDocumentV3;
  assets: AssetRecord[];
  boards: BoardSummary[];
  onSelectAsset(asset: AssetRecord | null): void;
  onLocateAsset?(asset: AssetRecord): void;
  onSave(document: BoardDocumentV3, revision: number): Promise<BoardSummary>;
  onSwitchBoard(id: string): Promise<void>;
  onCreateBoard(): Promise<void>;
  onRenameBoard(board: BoardSummary): Promise<void>;
  onDeleteBoard(board: BoardSummary): Promise<void>;
  onLibraryChanged(): Promise<void>;
  pendingAssetIds?: string[];
  onPendingAssetsConsumed?(ids: string[]): void;
  /** 阶段 6：引用重连后请求父组件刷新 assets。 */
  onReferencesChanged?(): Promise<void>;
}

interface BoardCropTargetSnapshot {
  id: string;
  title: string;
  src: string;
  initial: CropRect;
}


const defaultBoardAppearance = DEFAULT_BOARD_APPEARANCE;

/** 图层/检查器卡片的统一顶部起点（与 dialogs.css 中两卡片定位一致）。 */
const BOARD_CARD_TOP = 64;
/**
 * 工具栏实际占底（含外边距）：窄窗口分组换行时工具栏会变成两行，
 * 右侧卡片必须跟着下移，否则会压住第二行按钮。
 */
const BOARD_CARD_GAP = 12;

const noopOpenTool = () => {};

function BoardGifPreviewDialog({ asset }: { asset: AssetRecord }) {
  const transport = usePreviewTransport();
  return (
    <div className="model-board-dialog gif-preview-dialog">
      <AssetPreview asset={asset} onOpenTool={noopOpenTool} />
      <PreviewToolbar
        variant="gif"
        seekPosition={transport.snapshot?.position ?? 0}
        onSeekChange={(position) => transport.actions?.seek(position)}
        timecode={formatPreviewTimecode(
          (transport.snapshot?.position ?? 0) * (transport.snapshot?.durationSeconds ?? 0),
          transport.snapshot?.kind === "gif" ? transport.snapshot.fps : null,
        )}
        loopActive={transport.snapshot?.looping ?? false}
        onLoopToggle={() => transport.actions?.setLooping(!(transport.snapshot?.looping ?? false))}
        playing={transport.snapshot?.playing ?? false}
        onPlayingToggle={() => transport.actions?.togglePlaying()}
        onStepFrames={(delta) => transport.actions?.stepFrames(delta)}
        showLowerRow={false}
      />
    </div>
  );
}

/**
 * 独立白板窗口交互抬升：弹层类 UI 打开期间把窗口临时提到置顶层
 * （system:set-interaction-lift），关闭或组件卸载时还原快照；
 * 主窗口工作区恒为 no-op，不产生任何 IPC。
 */
function useBoardWindowInteractionLift(active: boolean): void {
  const standalone = isStandaloneBoardWindow();
  useEffect(() => {
    if (!standalone) return;
    void window.refCanvas.system.setInteractionLift(active);
    return () => {
      void window.refCanvas.system.setInteractionLift(false);
    };
  }, [standalone, active]);
}

export function BoardCanvas({
  board,
  document,
  assets,
  boards,
  onSelectAsset,
  onLocateAsset,
  onSave,
  onSwitchBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onLibraryChanged,
  pendingAssetIds,
  onPendingAssetsConsumed,
  onReferencesChanged,
}: BoardCanvasProps) {
  const dialog = useDialog();
  // 应用级聚焦模式（隐藏侧栏/面板）时收起空板引导层，保持沉浸画面。
  const focusMode = useAppStore((state) => state.focusMode);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<FabricCanvas | null>(null);
  const boardRevisionRef = useRef(board.revision);
  const pendingBatchKeyRef = useRef<string | null>(null);
  const addDroppedAssetsRef = useRef<(
    assetIds: string[],
    position: { x: number; y: number },
    centered?: boolean,
  ) => Promise<number>>(async () => 0);
  const [boardAssets, setBoardAssets] = useState<AssetRecord[]>(assets);
  const eventBindingsRef = useBoardEventBindings(useMemo(() => ({
    assets: boardAssets,
    onSelectAsset,
    onLocateAsset,
    onSaveDocument: onSave,
    onReferencesChanged,
  }), [boardAssets, onLocateAsset, onReferencesChanged, onSave, onSelectAsset]));
  const [runtime] = useState(() => new BoardRuntimeController(document));
  const [controller] = useState(() => new BoardCanvasController());
  const [importController] = useState(() => new BoardImportController());
  const handleSaveError = async (
    error: unknown,
    snapshot?: Record<string, unknown>,
  ) => {
    if (error instanceof Error && error.message === "BOARD_CONFLICT") {
      const saveCopy = await dialog.requestConfirm({
        title: translate("board.conflictTitle"),
        description: translate("board.conflictDescription"),
        confirmLabel: translate("board.conflictSaveCopy"),
      });
      if (saveCopy && snapshot) {
        const copy = await window.refCanvas.boards.create(
          translate("board.conflictCopyName").replace("{title}", board.title).slice(0, 120),
        );
        await window.refCanvas.boards.save(
          copy.id,
          makeDocument(canvasRef.current!, snapshot),
          copy.revision,
        );
      }
      return;
    }
    console.error("BOARD_SAVE_FAILED", error);
  };
  const saveLocalDocument = async (nextDocument: BoardDocumentV3) => {
    const revision = controller.markLocalSave(nextDocument);
    try {
      const summary = await eventBindingsRef.current.onSaveDocument(
        nextDocument,
        boardRevisionRef.current,
      );
      boardRevisionRef.current = summary.revision;
      return summary;
    } catch (error) {
      controller.cancelLocalSave(revision);
      throw error;
    }
  };
  const saveImmediately = (nextDocument: BoardDocumentV3) => {
    void saveLocalDocument(nextDocument)
      .then(() => controller.setSaved(true))
      .catch((error) => void handleSaveError(error, nextDocument.canvas));
  };
  const boardSnapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    boardRevisionRef.current = board.revision;
  }, [board.id, board.revision]);
  const boardStructure = useSyncExternalStore(
    controller.subscribeStructure,
    controller.getStructureSnapshot,
    controller.getStructureSnapshot,
  );
  useEffect(() => () => controller.dispose(), [controller]);
  const toolRef = useRef<BoardTool>("select");
  const drawingStyleRef = useRef<BoardDrawingStyle>(defaultBoardDrawingStyle);
  const scheduleSaveRef = useRef<(() => void) | null>(null);
  // 桥接画布初始化 effect 内的缩放调度，供组件作用域的缩放控件（±按钮）调用。
  const zoomUiRef = useRef<{
    scheduleZoomState: (percent: number) => void;
    scheduleProxyRefresh: () => void;
  } | null>(null);
  const loadingRef = useRef(false);
  const bulkMutationRef = useRef(false);
  const historyControllerRef = useRef(new BoardHistoryController());
  const persistenceRef = useRef<BoardPersistenceController | null>(null);
  const {
    strokeHistory: strokeHistoryRef,
    transformSnapshots: transformSnapshotsRef,
    transformDescendants: transformDescendantsRef,
    focusedObjectId: focusedObjectIdRef,
    preFocusViewport: preFocusViewportRef,
    heldKeys: heldKeysRef,
    finishContinuousGesture: finishContinuousGestureRef,
    gesture: gestureRef,
    cropRect: cropRectRef,
    moveStart: moveStartRef,
  } = controller.gestureResources;
  // 空格平移：按住 Space 时左键临时接管平移（两种交互预设通用），
  // 轻按（未拖动）在 keyup 时保持原 Space 的聚焦切换语义。
  const spaceHeldRef = useRef(false);
  const spacePanMovedRef = useRef(false);
  const [hudMessage, setHudMessage] = useState<string | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const [boardContextMenu, setBoardContextMenu] =
    useState<BoardContextMenuState | null>(null);
  /** 吸附指示：拖动命中吸附时显示临时参考线，松开后淡出。 */
  const [snapIndicator, setSnapIndicator] = useState<{
    axis: "x" | "y";
    value: number;
    visible: boolean;
  } | null>(null);
  const snapFadeTimerRef = useRef<number | null>(null);

  const snapshotPureRefTarget = (
    target: CanvasObjectWithData | null,
    viewport?: TMat2D,
  ): PureRefGestureSnapshot | undefined => {
    if (!target && !viewport) return undefined;
    const image = target instanceof FabricImage ? target : null;
    return {
      angle: target?.angle ?? 0,
      scaleX: target?.scaleX ?? 1,
      scaleY: target?.scaleY ?? 1,
      opacity: target?.opacity ?? 1,
      flipX: target?.flipX ?? false,
      flipY: target?.flipY ?? false,
      left: target?.left ?? 0,
      top: target?.top ?? 0,
      width: target?.width ?? 0,
      height: target?.height ?? 0,
      cropX: image?.cropX ?? 0,
      cropY: image?.cropY ?? 0,
      viewport,
    };
  };

  const restoreCanvasInteraction = (canvas: FabricCanvas) => {
    const interaction = boardToolInteractionState(
      toolRef.current,
      runtime.canvasMode.locked,
    );
    canvas.selection = interaction.selection;
    canvas.defaultCursor =
      toolRef.current === "select"
        ? "default"
        : toolRef.current === "eraser"
          ? "var(--cursor-eraser)"
          : "crosshair";
    canvas.setCursor(canvas.defaultCursor);
  };

  /** Esc：恢复本次 PureRef 连续手势的完整起始状态，不写入 undo。 */
  const cancelPureRefGesture = (): boolean => {
    const gesture = gestureRef.current;
    if (!gesture.kind) return false;
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const snapshot = gesture.snapshot;
    if (gesture.target && snapshot) {
      gesture.target.set({
        angle: snapshot.angle,
        scaleX: snapshot.scaleX,
        scaleY: snapshot.scaleY,
        opacity: snapshot.opacity,
        flipX: snapshot.flipX,
        flipY: snapshot.flipY,
        left: snapshot.left,
        top: snapshot.top,
        width: snapshot.width,
        height: snapshot.height,
      });
      if (gesture.target instanceof FabricImage) {
        gesture.target.set({
          cropX: snapshot.cropX ?? 0,
          cropY: snapshot.cropY ?? 0,
        });
      }
      gesture.target.setCoords();
    }
    if (snapshot?.viewport) {
      canvas.setViewportTransform([...snapshot.viewport] as TMat2D);
      controller.setZoom(Math.round(canvas.getZoom() * 100));
    }
    if (cropRectRef.current) {
      canvas.remove(cropRectRef.current);
      cropRectRef.current = null;
    }
    if (gesture.selection) canvas.setActiveObject(gesture.selection);
    else canvas.discardActiveObject();
    gesture.kind = null;
    gesture.changed = false;
    gesture.suppressSave = false;
    gesture.target = null;
    gesture.selection = null;
    moveStartRef.current = null;
    restoreCanvasInteraction(canvas);
    canvas.requestRenderAll();
    setHudMessage(null);
    return true;
  };

  // 吸附参考线在松手后淡出，不常驻。
  useEffect(() => {
    if (!snapIndicator || snapIndicator.visible) return;
    if (snapFadeTimerRef.current) window.clearTimeout(snapFadeTimerRef.current);
    snapFadeTimerRef.current = window.setTimeout(
      () => setSnapIndicator(null),
      220,
    );
    return () => {
      if (snapFadeTimerRef.current) window.clearTimeout(snapFadeTimerRef.current);
    };
  }, [snapIndicator]);
  const [tool, setTool] = useState<BoardTool>("select");
  const [lastDrawingTool, setLastDrawingTool] = useState<BoardDrawingTool>("pencil");
  const [drawingStyle, setDrawingStyle] =
    useState<BoardDrawingStyle>(defaultBoardDrawingStyle);
  const [drawingPanelOpen, setDrawingPanelOpen] = useState(false);
  const [arrangePanelOpen, setArrangePanelOpen] = useState(false);
  // 工具栏收起态：默认展开，仅会话内有效，不持久化。
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  // 独立白板窗口：弹层打开期间临时抬升窗口，避免被置顶主窗口盖住。
  useBoardWindowInteractionLift(
    shouldLiftInteraction(
      isStandaloneBoardWindow(),
      Boolean(boardContextMenu),
      arrangePanelOpen,
      drawingPanelOpen,
    ),
  );
  const [layersOpen, setLayersOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // 取色结果面板：关闭后不清空面板自己的读数，但再次取色会整体替换。
  const [colorSample, setColorSample] = useState<ColorSample | null>(null);
  // 取色序号：同一位置重复取色时保证面板能确认"换了一份新样本"。
  const colorSampleSeqRef = useRef(0);
  const [appearancePanelOpen, setAppearancePanelOpen] = useState(false);
  // 工具栏换行后的实际占高：右侧停靠列用它作顶部起点。
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarBottom, setToolbarBottom] = useState<number | null>(null);

  // 停靠列里各面板的折叠状态（按面板 id 记录）。
  const [dockCollapsed, setDockCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const panel = toolbarRef.current;
    if (!panel) return;
    const update = () => {
      // offsetTop 相对画布宿主，与停靠列定位同一坐标系。
      setToolbarBottom(panel.offsetTop + panel.offsetHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  // 停靠列顶部：工具栏压得更低时以工具栏为准，否则维持基线。
  const cardTop = toolbarBottom
    ? Math.max(BOARD_CARD_TOP, toolbarBottom + BOARD_CARD_GAP)
    : BOARD_CARD_TOP;
  const [modelAsset, setModelAsset] = useState<AssetRecord | null>(null);
  const [modelView, setModelView] = useState<ModelView | null>(null);
  // 阶段 6 §11：双击进入完整 preview（视频/音频/高位深图片）。
  const [previewAsset, setPreviewAsset] = useState<AssetRecord | null>(null);
  const [readyBoardId, setReadyBoardId] = useState<string | null>(null);
  useEffect(() => {
    setBoardAssets((current) => {
      const merged = new Map(current.map((asset) => [asset.id, asset]));
      for (const asset of assets) merged.set(asset.id, asset);
      return [...merged.values()];
    });
  }, [assets]);

  // 白板预览弹窗：Esc 关闭（与常规弹窗/预览窗口习惯一致）。
  useEffect(() => {
    if (!previewAsset && !modelAsset) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPreviewAsset(null);
      setModelAsset(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewAsset, modelAsset]);

  useEffect(() => {
    if (readyBoardId !== board.id) return;
    const ids = new Set(
      (canvasRef.current?.getObjects() as CanvasObjectWithData[] | undefined)
        ?.map((object) => object.data?.assetId)
        .filter((id): id is string => Boolean(id)) ?? [],
    );
    const known = new Set(boardAssets.map((asset) => asset.id));
    const missing = [...ids].filter((id) => !known.has(id));
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(
      missing.map((id) => window.refCanvas.library.get(id).catch(() => null)),
    ).then((resolved) => {
      if (cancelled) return;
      const available = resolved.filter((asset): asset is AssetRecord => Boolean(asset));
      if (!available.length) return;
      setBoardAssets((current) => {
        const merged = new Map(current.map((asset) => [asset.id, asset]));
        for (const asset of available) merged.set(asset.id, asset);
        return [...merged.values()];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [board.id, boardAssets, readyBoardId]);
  // assets 解析完成后应用引用状态：missing/offline 对象显示半透明占位
  // （保留位置/尺寸/变换，不破坏 Board document）。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getObjects() as CanvasObjectWithData[]) {
      if (!(object instanceof FabricImage)) continue;
      const image = object as CanvasObjectWithData & FabricImage;
      const asset = boardAssets.find((item) => item.id === image.data?.assetId);
      if (!asset || asset.extension === "gif") continue;
      if (asset.linkState !== "online") {
        const missing = asset.linkState !== "offline";
        image.set({
          opacity: missing ? 0.3 : 0.35,
          stroke: missing ? "#c98f5b" : "#6b7a74",
          strokeWidth: 1.5,
          strokeUniform: true,
        });
      } else {
        image.set({ opacity: 1, stroke: null, strokeWidth: 0 });
      }
    }
    canvas.requestRenderAll();
  }, [boardAssets]);

  // Older builds persisted a format card when the board proxy failed even if the
  // original browser-decodable image was healthy. Restore those cards in place.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || readyBoardId !== board.id) return;
    let cancelled = false;
    const restore = async () => {
      let changed = false;
      for (const object of [...canvas.getObjects()] as CanvasObjectWithData[]) {
        if (cancelled || object instanceof FabricImage || !(object instanceof Group)) continue;
        const card = object as CanvasObjectWithData & Group;
        const asset = boardAssets.find((item) => item.id === card.data?.assetId);
        if (!asset || asset.linkState !== "online" || asset.kind === "generic") continue;
        const isImage = asset.kind === "image" &&
          browserImageExtensions.has(asset.extension.toLowerCase());
        let initialProxySize: BoardProxySize | undefined;
        try {
          let loaded: { image: FabricImage; source: "proxy" | "original" };
          if (isImage) {
            initialProxySize = boardProxySizeForPixels(
              Math.max(object.getScaledWidth(), object.getScaledHeight()) * window.devicePixelRatio,
            );
            loaded = await loadBoardImageWithFallback(
              boardProxyUrl(asset.thumbnailUrl, initialProxySize),
              asset.previewUrl,
              (url) => FabricImage.fromURL(url),
            );
          } else {
            // 非图片卡片（视频/PDF/模型/字体/DCC 等）：缩略图生成后升级为
            // 真实图；生成较慢时带 nonce 重试，仍失败则保留参考卡片。
            loaded = {
              image: await loadThumbnailWithRetry(asset.thumbnailUrl, (url) => FabricImage.fromURL(url)),
              source: "original" as const,
            };
          }
          if (cancelled || !canvas.getObjects().includes(object)) continue;
          const image = loaded.image as CanvasObjectWithData & FabricImage;
          const width = Math.max(1, image.width);
          const height = Math.max(1, image.height);
          const scale = Math.min(
            object.getScaledWidth() / width,
            object.getScaledHeight() / height,
          );
          const center = object.getCenterPoint();
          image.set({
            left: center.x,
            top: center.y,
            originX: "center",
            originY: "center",
            angle: object.angle,
            scaleX: scale,
            scaleY: scale,
            opacity: object.opacity,
            cornerColor: "#3ab28f",
            cornerStrokeColor: "#10241e",
            borderColor: "#3ab28f",
            transparentCorners: false,
            data: {
              ...(card.data ?? {}),
              sourceUrl: asset.previewUrl,
              ...(loaded.source === "proxy" ? { boardProxySize: initialProxySize } : {}),
            },
          });
          const index = canvas.getObjects().indexOf(object);
          const active = canvas.getActiveObject() === object;
          canvas.remove(object);
          canvas.insertAt(Math.max(0, index), image);
          applyBoardControls(image);
          image.setCoords();
          if (active) canvas.setActiveObject(image);
          changed = true;
        } catch {
          // Both proxy and source failed; keep the recoverable reference card.
        }
      }
      if (!changed || cancelled) return;
      canvas.requestRenderAll();
      controller.refreshSelectionSnapshot();
      scheduleSaveRef.current?.();
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [boardAssets, board.id, readyBoardId]);
  // GIF 动画播放器，按对象 objectId 索引；随画布生命周期创建/销毁。
  const gifAnimatorsRef = useRef(new Map<string, GifAnimator>());
  const [cropTarget, setCropTarget] = useState<BoardCropTargetSnapshot | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const dropNoticeTimerRef = useRef<number | null>(null);
  const [colorSampling, setColorSampling] = useState(false);
  // 像素级核对：关闭图片平滑，并把缩放上限抬到能看到单个源像素。
  const [pixelView, setPixelView] = useState(false);
  // 滚轮回调里读它，避开闭包快照。
  const pixelViewRef = useRef(false);
  const [focusedObjectId, setFocusedObjectId] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<BoardAppearance>(
    document.appearance ?? defaultBoardAppearance,
  );
  const [canvasLocked, setCanvasLocked] = useState(
    document.canvasMode?.locked ?? false,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false);
  const [shortcutBindings, setShortcutBindings] =
    useState<BoardShortcutBindings>(() => loadBoardShortcuts(null));

  /** 显示临时提示（自动 2400ms 消隐）。 */
  const showDropNotice = (message: string) => {
    setDropNotice(message);
    if (dropNoticeTimerRef.current !== null) window.clearTimeout(dropNoticeTimerRef.current);
    dropNoticeTimerRef.current = window.setTimeout(() => setDropNotice(null), 2400);
  };
  const clearDropNotice = () => {
    if (dropNoticeTimerRef.current !== null) window.clearTimeout(dropNoticeTimerRef.current);
    dropNoticeTimerRef.current = null;
    setDropNotice(null);
  };
  useEffect(() => () => {
    if (dropNoticeTimerRef.current !== null) window.clearTimeout(dropNoticeTimerRef.current);
    dropNoticeTimerRef.current = null;
  }, []);

  const openCropDialog = (target: FabricImage) => {
    const boardObject = target as CanvasObjectWithData & FabricImage;
    ensureObjectIdentity(boardObject);
    const id = boardObject.data?.objectId;
    if (!id) return;
    const original = target.getOriginalSize();
    setCropTarget({
      id,
      title: boardObject.data?.name ?? translate("board.imageDefaultName"),
      src: target.getSrc(),
      initial: {
        x: (target.cropX ?? 0) / original.width,
        y: (target.cropY ?? 0) / original.height,
        width: (target.width ?? original.width) / original.width,
        height: (target.height ?? original.height) / original.height,
      },
    });
  };

  const openCommandPalette = () => {
    setBoardContextMenu(null);
    setDrawingPanelOpen(false);
    setArrangePanelOpen(false);
    setCommandPaletteOpen(true);
  };

  /** client 坐标 → 场景坐标（fabric 的 getScenePoint 只接受真实事件）。 */
  const scenePointFromClient = (clientX: number, clientY: number) => {
    const element = canvasElementRef.current;
    const bounds = element?.getBoundingClientRect();
    const vpt = canvasRef.current?.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const left = bounds?.left ?? 0;
    const top = bounds?.top ?? 0;
    return clientToScenePoint(clientX, clientY, { left, top }, vpt);
  };

  const makeDocument = (
    canvas: FabricCanvas,
    canvasSnapshot?: Record<string, unknown>,
  ): BoardDocumentV3 => serializeBoardDocument(canvas, runtime, canvasSnapshot);

  /** Applies whole-canvas mode (lock / grayscale / grid style) to the canvas. */
  const applyCanvasMode = (
    canvas: FabricCanvas,
    mode: { locked: boolean; grayscale: boolean; gridStyle: string },
  ) => applyBoardCanvasMode(canvas, mode, toolRef.current);

  const hierarchyObjects = (canvas: FabricCanvas): CanvasObjectWithData[] =>
    (canvas.getObjects() as CanvasObjectWithData[]).filter(
      (object) => !object.data?.guideAxis,
    );

  const objectById = (id: string): CanvasObjectWithData | undefined => {
    const canvas = canvasRef.current;
    return canvas
      ? hierarchyObjects(canvas).find((object) => object.data?.objectId === id)
      : undefined;
  };

  const hierarchyItems = (canvas: FabricCanvas) =>
    hierarchyObjects(canvas).flatMap((object) =>
      object.data?.objectId
        ? [{ id: object.data.objectId, parentId: object.data.parentId }]
        : [],
    );

  const rebuildTransformSnapshots = (canvas: FabricCanvas) => {
    const snapshots = new Map<string, TMat2D>();
    for (const object of hierarchyObjects(canvas)) {
      if (!object.data?.objectId) continue;
      snapshots.set(
        object.data.objectId,
        [...object.calcTransformMatrix()] as TMat2D,
      );
    }
    transformSnapshotsRef.current = snapshots;
  };

  const propagateHierarchyTransform = (
    canvas: FabricCanvas,
    parent: CanvasObjectWithData,
  ) => {
    const parentId = parent.data?.objectId;
    if (!parentId) return;
    const previous = transformSnapshotsRef.current.get(parentId);
    const current = [...parent.calcTransformMatrix()] as TMat2D;
    if (!previous) {
      transformSnapshotsRef.current.set(parentId, current);
      return;
    }
    const delta = hierarchyTransformDelta(previous, current);
    transformSnapshotsRef.current.set(parentId, current);
    let cached = transformDescendantsRef.current;
    if (!cached || cached.parentId !== parentId) {
      const descendants = new Set(
        hierarchyDescendantIds(hierarchyItems(canvas), parentId),
      );
      cached = {
        parentId,
        children: hierarchyObjects(canvas).filter(
          (child) => Boolean(child.data?.objectId && descendants.has(child.data.objectId)),
        ),
      };
      transformDescendantsRef.current = cached;
    }
    for (const child of cached.children) {
      const childId = child.data?.objectId;
      if (!childId) continue;
      applyHierarchyTransform(child, delta);
      transformSnapshotsRef.current.set(
        childId,
        [...child.calcTransformMatrix()] as TMat2D,
      );
    }
    canvas.requestRenderAll();
  };

  const sanitizeHierarchy = (canvas: FabricCanvas): boolean => {
    const items = hierarchyItems(canvas);
    const ids = new Set(items.map((item) => item.id));
    let changed = false;
    for (const object of hierarchyObjects(canvas)) {
      const id = object.data?.objectId;
      const parentId = object.data?.parentId;
      if (
        !id ||
        !parentId ||
        (ids.has(parentId) && canSetHierarchyParent(items, id, parentId))
      ) {
        continue;
      }
      object.data = { ...(object.data ?? {}), parentId: undefined };
      changed = true;
    }
    return changed;
  };

  useEffect(() => {
    let current = true;
    void window.refCanvas.system.getBoardShortcuts().then((value) => {
      if (current) setShortcutBindings(loadBoardShortcuts(value));
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(
    () =>
      window.refCanvas.system.onWindowModeReset(() => {
        runtime.windowMode = "normal";
        runtime.document = {
          ...runtime.document,
          windowMode: "normal",
        };
        scheduleSaveRef.current?.();
        showDropNotice(translate("board.exitClickThroughNotice"));
      }),
    [],
  );

  useEffect(() => {
    if (!canvasElementRef.current || !hostRef.current) return;
    const nextAppearance = document.appearance ?? defaultBoardAppearance;
    runtime.appearance = nextAppearance;
    setAppearance(nextAppearance);
    installBoardActiveSelection();
    // 打开白板瞬间宿主可能仍是 0×0（窗口刚建、布局未就绪）。0 尺寸画布会让
    // Fabric 初始化拿不到 2d context，首次 renderAll 时内部 clearContext 直接
    // 崩（Cannot read properties of undefined (reading 'clearRect')）。
    // 先给一个非零初值，随后 ResizeObserver 会校正到真实尺寸。
    const canvas = controller.createCanvas(canvasElementRef.current, {
      backgroundColor: "transparent",
      preserveObjectStacking: true,
      selectionColor: "rgba(58, 178, 143, 0.08)",
      selectionBorderColor: "#3ab28f",
      selectionLineWidth: 1,
      fireMiddleClick: true,
      width: Math.max(1, hostRef.current.clientWidth || 1),
      height: Math.max(1, hostRef.current.clientHeight || 1),
    });
    let renderFrame: number | null = null;
    let zoomFrame: number | null = null;
    let pendingZoom = Math.round(canvas.getZoom() * 100);
    const scheduleRender = () => {
      if (renderFrame !== null) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        canvas.requestRenderAll();
      });
    };
    const scheduleZoomState = (value: number) => {
      pendingZoom = value;
      if (zoomFrame !== null) return;
      zoomFrame = window.requestAnimationFrame(() => {
        zoomFrame = null;
        controller.setZoom(pendingZoom);
      });
    };
    const applyProxyLevel = (
      image: CanvasObjectWithData & FabricImage,
      asset: AssetRecord,
      desired: BoardProxySize,
      current: BoardProxySize | 0,
    ) => {
      if (desired === current) return;
      const displayWidth = image.getScaledWidth();
      const displayHeight = image.getScaledHeight();
      const signX = (image.scaleX ?? 1) < 0 ? -1 : 1;
      const signY = (image.scaleY ?? 1) < 0 ? -1 : 1;
      image.data = {
        ...(image.data ?? {}),
        sourceUrl: asset.previewUrl,
        boardProxySize: desired,
      };
      void image
        .setSrc(boardProxyUrl(asset.thumbnailUrl, desired))
        .then(() => {
          image.set({
            scaleX: (signX * displayWidth) / Math.max(1, image.width),
            scaleY: (signY * displayHeight) / Math.max(1, image.height),
            dirty: true,
          });
          // 换源后要保持像素级核对状态（新图默认平滑）。
          image.imageSmoothing = !pixelViewRef.current;
          image.setCoords();
          scheduleRender();
        })
        .catch(() => {
          if (image.data?.boardProxySize === desired) {
            image.data = {
              ...image.data,
              boardProxySize: current || undefined,
            };
          }
        });
    };
    const refreshVisibleImageProxies = () => {
      for (const object of canvas.getObjects() as CanvasObjectWithData[]) {
        if (!(object instanceof FabricImage)) continue;
        const image = object as CanvasObjectWithData & FabricImage;
        const asset = eventBindingsRef.current.assets.find(
          (item) => item.id === image.data?.assetId,
        );
        // 阶段 6 §11：文件缺失时保留对象位置/尺寸/变换，视觉降级为
        // 半透明 + 描边占位（不破坏 Board document）。
        if (!asset || asset.extension === "gif") continue;
        if (asset.linkState !== "online") {
          const missing = asset.linkState !== "offline";
          image.set({
            opacity: missing ? 0.3 : 0.35,
            stroke: missing ? "#c98f5b" : "#6b7a74",
            strokeWidth: 1.5,
            strokeUniform: true,
          });
          continue;
        }
        // 只有 image 类型走 board proxy 分级；非 image（视频/PDF/3D/字体等）
        // 使用 provider 生成的固定缩略图，不做 proxy 升降级。
        if (asset.kind !== "image") continue;
        image.set({ opacity: 1, stroke: null, strokeWidth: 0 });
        if ((image.cropX ?? 0) !== 0 || (image.cropY ?? 0) !== 0) continue;
        const current = image.data?.boardProxySize ?? 0;
        // 视口外对象：降到最低档（512）释放高分辨率 proxy，滚回时再按需升级。
        if (!image.isOnScreen()) {
          if (current > 512) applyProxyLevel(image, asset, 512, current);
          continue;
        }
        const pixels =
          Math.max(image.getScaledWidth(), image.getScaledHeight()) *
          canvas.getZoom() *
          window.devicePixelRatio;
        const desired = boardProxySizeForPixels(pixels);
        // 精确匹配：放大升级、缩小降级，避免长期持有超出显示所需的分辨率。
        if (desired === current) continue;
        applyProxyLevel(image, asset, desired, current);
      }
    };
    const scheduleProxyRefresh = () => {
      importController.scheduleProxyRefresh(refreshVisibleImageProxies);
    };
    zoomUiRef.current = { scheduleZoomState, scheduleProxyRefresh };
    canvasRef.current = canvas;
    controller.onCanvas(canvas, "contextmenu", ({ e, target: hitTarget }) => {
      const event = e as MouseEvent;
      event.preventDefault();
      const mouseUp = interruptedSelectionMouseUp(event);
      if (mouseUp) {
        canvas.upperCanvasEl.ownerDocument.dispatchEvent(
          new MouseEvent("mouseup", mouseUp),
        );
      }
      const target = (mouseUp
        ? canvas.findTarget(event)
        : hitTarget) as CanvasObjectWithData | undefined;
      const selected = canvas.getActiveObjects() as CanvasObjectWithData[];
      const context = resolveBoardContext(
        selected,
        target,
        target instanceof ActiveSelection,
      );
      if (context.mode === "single" && context.selectTarget) {
        canvas.setActiveObject(context.target);
        canvas.requestRenderAll();
      }
      const targeted = context.mode === "single" ? context.target : undefined;
      if (targeted) ensureObjectIdentity(targeted);
      const targetId = targeted?.data?.objectId;
      const kind =
        context.mode === "multi"
          ? "multi"
          : context.mode === "single"
            ? context.target instanceof FabricImage
              ? "image"
              : "object"
            : "empty";
      const position = clampBoardContextPosition(
        event.clientX,
        event.clientY,
        window.innerWidth,
        window.innerHeight,
      );
      setBoardContextMenu({
        ...position,
        kind,
        target: targeted && targetId
          ? {
              id: targetId,
              isImage: targeted instanceof FabricImage,
              assetId: targeted.data?.assetId ?? null,
              hasGif: Boolean(targeted.data?.gif),
              gifPlaying: Boolean(targeted.data?.gif?.playing),
            }
          : undefined,
      });
    });
    let migratedIdentity = false;

    const persistence = new BoardPersistenceController(
      historyControllerRef.current,
      {
        blocked: () =>
          loadingRef.current ||
          bulkMutationRef.current ||
          gestureRef.current.suppressSave,
        capture: () => canvas.toObject(["data"]) as Record<string, unknown>,
        save: async (snapshot) => {
          await saveLocalDocument(makeDocument(canvas, snapshot));
        },
        setSaved: (value) => controller.setSaved(value),
        onSnapshot: () => controller.refreshSnapshot(),
        onSaveError: (error, snapshot) => handleSaveError(error, snapshot),
      },
    );
    persistenceRef.current = persistence;
    const scheduleSave = () => persistence.schedule();
    scheduleSaveRef.current = scheduleSave;

    controller.onCanvas(canvas, "object:added", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      if (target) {
        applyBoardControls(target);
        const changed = ensureObjectIdentity(target, {
          name:
            target.data?.name ??
            target.data?.type ??
            translate("board.objectIndexName").replace("{index}", String(canvas.getObjects().length)),
        });
        if (changed && loadingRef.current) migratedIdentity = true;
        if (target.data?.objectId) {
          transformSnapshotsRef.current.set(
            target.data.objectId,
            [...target.calcTransformMatrix()] as TMat2D,
          );
        }
        // GIF 对象：解码并按 data.gif 状态播放（覆盖新建/载入/复制/粘贴路径）。
        const gifState = target.data?.gif;
        if (gifState && target.data?.objectId && target instanceof FabricImage) {
          attachGifAnimation(
            target as CanvasObjectWithData & FabricImage,
            gifState,
          );
        }
      }
      scheduleSave();
      transformDescendantsRef.current = null;
    });
    controller.onCanvas(canvas, "object:modified", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      if (target) propagateHierarchyTransform(canvas, target);
      scheduleSave();
    });
    controller.onCanvas(canvas, "object:removed", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      if (target?.data?.objectId) {
        transformSnapshotsRef.current.delete(target.data.objectId);
        gifAnimatorsRef.current.get(target.data.objectId)?.dispose();
        gifAnimatorsRef.current.delete(target.data.objectId);
      }
      scheduleSave();
      transformDescendantsRef.current = null;
    });
    controller.onCanvas(canvas, "path:created", (event) => {
      const path = event.path as CanvasObjectWithData;
      const style = drawingStyleRef.current;
      path.data = {
        ...(path.data ?? {}),
        type: "drawing-pencil",
        name: translate("board.drawingNamePencil"),
      };
      path.set({
        strokeDashArray: style.dashed
          ? [style.width * 3, style.width * 2]
          : null,
      });
      ensureObjectIdentity(path);
      // 记录到笔画级撤销栈。
      strokeHistoryRef.current.push(path);
      if (strokeHistoryRef.current.length > 200) {
        strokeHistoryRef.current.shift();
      }
      canvas.fire("object:modified", { target: path });
    });
    const selectTargetAsset = (target: CanvasObjectWithData | undefined) => {
      const selection = resolveBoardSelection(eventBindingsRef.current.assets, target);
      if (!selection.missingAssetId) {
        eventBindingsRef.current.onSelectAsset(selection.asset);
        return;
      }
      void window.refCanvas.library
        .get(selection.missingAssetId)
        .then((loaded) => eventBindingsRef.current.onSelectAsset(loaded));
    };
    const handleSelectionChange = () => {
      const currentSelection = canvas.getActiveObject();
      const selection = currentSelection instanceof ActiveSelection
        ? optimizeBoardActiveSelection(currentSelection)
        : currentSelection;
      if (selection) applyBoardControls(selection);
      const target =
        selection && !(selection instanceof ActiveSelection)
          ? (selection as CanvasObjectWithData)
          : undefined;
      if (
        target instanceof FabricImage &&
        runtime.bringToFrontOnSelect &&
        canvas.getObjects().at(-1) !== target
      ) {
        canvas.bringObjectToFront(target);
        canvas.fire("object:modified", { target });
        canvas.requestRenderAll();
      }
      selectTargetAsset(target);
    };
    controller.onCanvas(canvas, "selection:created", handleSelectionChange);
    controller.onCanvas(canvas, "selection:updated", handleSelectionChange);
    controller.onCanvas(canvas, "selection:cleared", () => {
      eventBindingsRef.current.onSelectAsset(null);
    });
    let snapGestureTarget: CanvasObjectWithData | null = null;
    let snapCandidates: CanvasObjectWithData[] = [];
    controller.onCanvas(canvas, "object:moving", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      if (!target) return;
      if (!runtime.snapEnabled) {
        setSnapIndicator((current) =>
          current
            ? { axis: current.axis, value: current.value, visible: false }
            : current,
        );
        propagateHierarchyTransform(canvas, target);
        return;
      }
      const threshold = 6 / canvas.getZoom();
      if (snapGestureTarget !== target) {
        snapGestureTarget = target;
        const movingMembers =
          target instanceof ActiveSelection
            ? (target.getObjects() as CanvasObjectWithData[])
            : [];
        snapCandidates = stationarySnapCandidates(
          canvas.getObjects() as CanvasObjectWithData[],
          target,
          movingMembers,
        ).filter((object) => object.visible);
      }
      let snapped: { x?: number; y?: number; other?: CanvasObjectWithData } = {};
      if (runtime.appearance.gridVisible) {
        const grid = runtime.appearance.gridSize;
        const snappedLeft = Math.round((target.left ?? 0) / grid) * grid;
        const snappedTop = Math.round((target.top ?? 0) / grid) * grid;
        if (Math.abs(snappedLeft - (target.left ?? 0)) <= threshold) {
          target.set("left", snappedLeft);
        }
        if (Math.abs(snappedTop - (target.top ?? 0)) <= threshold) {
          target.set("top", snappedTop);
        }
      }
      const bounds = target.getBoundingRect();
      for (const other of snapCandidates) {
        if (other.data?.guideAxis === "x") {
          const guideX = other.left ?? 0;
          const offsets = [0, bounds.width / 2, bounds.width];
          const offset = offsets.find(
            (value) => Math.abs(bounds.left + value - guideX) <= threshold,
          );
          if (offset !== undefined) {
            target.set("left", (target.left ?? 0) + guideX - bounds.left - offset);
            snapped = { ...snapped, x: guideX, other };
          }
          continue;
        }
        if (other.data?.guideAxis === "y") {
          const guideY = other.top ?? 0;
          const offsets = [0, bounds.height / 2, bounds.height];
          const offset = offsets.find(
            (value) => Math.abs(bounds.top + value - guideY) <= threshold,
          );
          if (offset !== undefined) {
            target.set("top", (target.top ?? 0) + guideY - bounds.top - offset);
            snapped = { ...snapped, y: guideY, other };
          }
          continue;
        }
        const otherBounds = other.getBoundingRect();
        const xSnap = findAxisSnapTarget(
          bounds.left,
          bounds.width,
          otherBounds.left,
          otherBounds.width,
          threshold,
        );
        const ySnap = findAxisSnapTarget(
          bounds.top,
          bounds.height,
          otherBounds.top,
          otherBounds.height,
          threshold,
        );
        if (xSnap) {
          target.set(
            "left",
            (target.left ?? 0) + xSnap.position - bounds.left,
          );
          snapped = { ...snapped, x: xSnap.guide, other };
        }
        if (ySnap) {
          target.set(
            "top",
            (target.top ?? 0) + ySnap.position - bounds.top,
          );
          snapped = { ...snapped, y: ySnap.guide, other };
        }
      }
      if (snapped.x !== undefined || snapped.y !== undefined) {
        const axis = snapped.x !== undefined ? "x" : "y";
        const sceneValue = (snapped.x ?? snapped.y)!;
        setSnapIndicator({
          axis,
          value: sceneAxisToViewport(
            axis,
            sceneValue,
            canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0],
          ),
          visible: true,
        });
      } else {
        setSnapIndicator((current) =>
          current
            ? { axis: current.axis, value: current.value, visible: false }
            : current,
        );
      }
      propagateHierarchyTransform(canvas, target);
    });
    controller.onCanvas(canvas, "object:scaling", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      if (target) propagateHierarchyTransform(canvas, target);
    });
    controller.onCanvas(canvas, "object:rotating", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      if (target) {
        propagateHierarchyTransform(canvas, target);
        setHudMessage(translate("board.hudRotate").replace("{angle}", String(Math.round(normalizeSignedAngle(target.angle ?? 0)))));
        if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
        hudTimerRef.current = window.setTimeout(() => setHudMessage(null), 1400);
      }
    });
    controller.onCanvas(canvas, "mouse:dblclick", (event) => {
      const target = event.target as CanvasObjectWithData | undefined;
      const asset = eventBindingsRef.current.assets.find(
        (item) => item.id === target?.data?.assetId,
      );
      if (asset?.kind === "model3d") {
        setModelView(
          (target?.data?.modelView as ModelView | undefined) ?? null,
        );
        setModelAsset(asset);
        return;
      }
      // 阶段 6 §11：双击进入对应格式的完整 preview。
      // 视频/音频直接预览；高位深或需 display transform 的图片
      // （EXR/HDR/PSD/TIFF/TGA）走 provider 转换后的完整预览。
      if (asset) {
        const heavyImage =
          asset.kind === "image" &&
          ["exr", "hdr", "psd", "psb", "tiff", "tga"].includes(
            asset.extension,
          );
        if (
          asset.kind === "video" ||
          asset.kind === "audio" ||
          asset.extension === "gif" ||
          asset.extension === "apng" ||
          heavyImage
        ) {
          setPreviewAsset(asset);
          return;
        }
      }
      if (target?.data?.assetId) focusBoardObject(target);
    });
    controller.onCanvas(canvas, "mouse:wheel", (event) => {
      const wheel = event.e as WheelEvent;
      const nextZoom = clampBoardZoom(
        canvas.getZoom() * 0.999 ** wheel.deltaY,
        pixelViewRef.current ? BOARD_PIXEL_ZOOM : BOARD_MAX_ZOOM,
      );
      canvas.zoomToPoint(new Point(wheel.offsetX, wheel.offsetY), nextZoom);
      scheduleZoomState(Math.round(nextZoom * 100));
      scheduleProxyRefresh();
      wheel.preventDefault();
      wheel.stopPropagation();
    });

    let panning = false;
    const nativeMiddlePan = new MiddlePanSession();
    let panButton: "middle" | "alt-left" | "locked-left" | "space-left" | null = null;
    // 空格平移的起点（客户区坐标），用于判定“轻按未拖动”。
    let spacePanStartX = 0;
    let spacePanStartY = 0;
    let selectionBeforePointer: CanvasObjectWithData | null = null;
    // Ctrl+点击加选：按下前的多选成员快照（点中非成员时 Fabric 会在
    // mouse:down 收拢多选，只能在这里抢救成员列表）。
    let selectionMembersBeforePointer: CanvasObjectWithData[] | null = null;
    let lastX = 0;
    let lastY = 0;
    let drawingStart: { x: number; y: number } | null = null;
    let drawingObject: BoardDrawingObject | null = null;
    let hudFrame: number | null = null;
    let pendingHud = "";
    let primaryPointerDown = false;
    // 主指针按下的客户区坐标：mouse:up 用它判定“纯点击”（位移 < 3px）。
    let primaryPointerDownX = 0;
    let primaryPointerDownY = 0;
    let primaryPointerRecoveryQueued = false;
    let disposed = false;
    let lastPrimaryPointer: PrimaryPointerSnapshot = {
      clientX: 0,
      clientY: 0,
      screenX: 0,
      screenY: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
    const rememberPrimaryPointer = (event: MouseEvent | PointerEvent) => {
      lastPrimaryPointer = {
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      };
    };
    const restoreSelectionBeforeGesture = () => {
      if (selectionBeforePointer) canvas.setActiveObject(selectionBeforePointer);
      else canvas.discardActiveObject();
    };
    const selectPureRefTarget = (
      active: CanvasObjectWithData | null,
      pointed: CanvasObjectWithData | undefined,
    ): CanvasObjectWithData | null => {
      const previous = selectionBeforePointer;
      const selection = active ?? previous;
      if (!pointed) return selection;
      const selectionMembers =
        selection instanceof ActiveSelection
          ? (selection.getObjects() as CanvasObjectWithData[])
          : [];
      if (selection instanceof ActiveSelection && selectionMembers.includes(pointed)) {
        canvas.setActiveObject(selection);
        return selection;
      }
      canvas.setActiveObject(pointed);
      applyBoardControls(pointed);
      return pointed;
    };
    const showHud = (message: string) => {
      pendingHud = message;
      if (hudFrame === null) {
        hudFrame = window.requestAnimationFrame(() => {
          hudFrame = null;
          setHudMessage(pendingHud);
        });
      }
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = window.setTimeout(() => setHudMessage(null), 1400);
    };
    const finishPanning = () => {
      if (!panning) return false;
      nativeMiddlePan.cancel();
      panning = false;
      panButton = null;
      canvas.selection =
        toolRef.current === "select" && !runtime.canvasMode.locked;
      canvas.defaultCursor = toolRef.current === "select" ? "default" : "crosshair";
      canvas.setCursor(canvas.defaultCursor);
      scheduleProxyRefresh();
      return true;
    };
    const consumeNativeMiddleEvent = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const startNativeMiddlePan = (event: MouseEvent) => {
      if (!nativeMiddlePan.start(event)) return;
      consumeNativeMiddleEvent(event);
      selectionBeforePointer = canvas.getActiveObject() as
        | CanvasObjectWithData
        | null;
      panning = true;
      panButton = "middle";
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.selection = false;
      canvas.defaultCursor = "grabbing";
      canvas.setCursor("grabbing");
    };
    const moveNativeMiddlePan = (event: MouseEvent) => {
      const update = nativeMiddlePan.move(event);
      if (!update) return;
      consumeNativeMiddleEvent(event);
      if (update.finished) {
        finishPanning();
        return;
      }
      canvas.relativePan(new Point(update.dx, update.dy));
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const finishNativeMiddlePan = (event: MouseEvent) => {
      if (!nativeMiddlePan.end(event)) return;
      consumeNativeMiddleEvent(event);
      finishPanning();
    };
    const preventMiddleAuxClick = (event: MouseEvent) => {
      if (isMiddleButtonPointer(event)) event.preventDefault();
    };
    const recoverPrimaryPointer = () => {
      if (!primaryPointerDown || disposed) return false;
      primaryPointerDown = false;
      canvas.upperCanvasEl.ownerDocument.dispatchEvent(
        new MouseEvent("mouseup", recoveredPrimaryMouseUp(lastPrimaryPointer)),
      );
      return true;
    };
    const queuePrimaryPointerRecovery = () => {
      if (primaryPointerRecoveryQueued) return;
      primaryPointerRecoveryQueued = true;
      window.queueMicrotask(() => {
        primaryPointerRecoveryQueued = false;
        recoverPrimaryPointer();
      });
    };
    finishContinuousGestureRef.current = (key) => {
      if (key === "alt" && panning && panButton === "alt-left") {
        finishPanning();
        return;
      }
      const kind = gestureRef.current.kind;
      const shouldFinish =
        (key === "z" && kind === "zoom") ||
        (key === "c" && kind === "crop") ||
        (key === "v" && (kind === "cropPan" || kind === "cropZoom")) ||
        (key === "control" &&
          (kind === "rotate" || kind === "scale" || kind === "opacity")) ||
        (key === "alt" &&
          (kind === "scale" || kind === "opacity" || kind === "flip")) ||
        (key === "shift" &&
          (kind === "opacity" || kind === "flip" || kind === "cropZoom"));
      if (shouldFinish) recoverPrimaryPointer();
    };
    const restoreSelectCursor = () => {
      if (
        toolRef.current === "select" &&
        !gestureRef.current.kind &&
        heldKeysRef.current.size === 0
      ) {
        canvas.defaultCursor = "default";
        canvas.setCursor("default");
      }
    };
    const handleWindowBlur = () => {
      // 失焦可能吞掉 keyup：收起空格平移状态，避免左键一直被当作平移。
      spaceHeldRef.current = false;
      if (!recoverPrimaryPointer()) finishPanning();
      restoreSelectCursor();
      // 失焦即收起右键菜单：保证独立窗口的交互抬升必然还原。
      setBoardContextMenu(null);
    };
    const handleVisibilityChange = () => {
      if (canvas.upperCanvasEl.ownerDocument.visibilityState === "hidden") {
        spaceHeldRef.current = false;
        if (!recoverPrimaryPointer()) finishPanning();
        restoreSelectCursor();
      }
    };
    const handlePointerCancel = (event: PointerEvent) => {
      rememberPrimaryPointer(event);
      if (!recoverPrimaryPointer()) finishPanning();
    };
    const spaceEventEditing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        Boolean(target?.isContentEditable)
      ) {
        return true;
      }
      const active = canvas.getActiveObject() as
        | CanvasObjectWithData
        | undefined;
      return Boolean((active as { isEditing?: boolean } | undefined)?.isEditing);
    };
    const handleSpaceKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      // Ctrl+Space 是 fitAll，Alt/Meta 组合交给系统与其它快捷键。
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (spaceEventEditing(event)) return;
      event.preventDefault();
      // 按住不放的自动重复 keydown 不重置“轻按”判定。
      if (event.repeat) return;
      spaceHeldRef.current = true;
      spacePanMovedRef.current = false;
      if (
        toolRef.current === "select" &&
        !panning &&
        heldKeysRef.current.size === 0
      ) {
        canvas.defaultCursor = "grab";
        canvas.setCursor("grab");
      }
    };
    const handleSpaceKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      if (panning && panButton === "space-left") {
        finishPanning();
      } else if (
        toolRef.current === "select" &&
        !gestureRef.current.kind &&
        heldKeysRef.current.size === 0
      ) {
        canvas.defaultCursor = "default";
        canvas.setCursor("default");
      }
      // 空格轻按（未拖动）=聚焦切换，保持原 Space 语义；Space 由本组件
      // 专用路径处理，use-board-shortcuts 的 focus 绑定已排除空格防双触发。
      if (
        !spacePanMovedRef.current &&
        !panning &&
        toolRef.current === "select" &&
        !gestureRef.current.kind
      ) {
        toggleObjectFocus();
      }
    };
    controller.onDom(canvas.upperCanvasEl, "mousedown", startNativeMiddlePan as EventListener, true);
    controller.onDom(
      canvas.upperCanvasEl,
      "auxclick",
      preventMiddleAuxClick as EventListener,
    );
    controller.onDom(
      canvas.upperCanvasEl.ownerDocument,
      "mousemove",
      moveNativeMiddlePan as EventListener,
      true,
    );
    controller.onDom(
      canvas.upperCanvasEl.ownerDocument,
      "mouseup",
      finishNativeMiddlePan as EventListener,
      true,
    );
    controller.onDom(canvas.upperCanvasEl, "pointercancel", handlePointerCancel as EventListener);
    controller.onDom(window, "blur", handleWindowBlur);
    controller.onDom(
      canvas.upperCanvasEl.ownerDocument,
      "visibilitychange",
      handleVisibilityChange,
    );
    controller.onDom(window, "keydown", handleSpaceKeyDown as EventListener);
    controller.onDom(window, "keyup", handleSpaceKeyUp as EventListener);
    controller.onCanvas(canvas, "mouse:down:before", () => {
      selectionBeforePointer = canvas.getActiveObject() as
        | CanvasObjectWithData
        | null;
      // Ctrl+点击加选需要按下前的多选成员：点中非成员时 Fabric 会在
      // mouse:down 里收拢多选（onDeselect 清空成员），先快照留底。
      selectionMembersBeforePointer =
        selectionBeforePointer instanceof ActiveSelection
          ? ([...selectionBeforePointer.getObjects()] as CanvasObjectWithData[])
          : null;
    });
    controller.onCanvas(canvas, "mouse:down", (event) => {
      const pointerEvent = event.e as MouseEvent;
      if (pointerEvent.button === 0) {
        primaryPointerDown = true;
        primaryPointerDownX = pointerEvent.clientX;
        primaryPointerDownY = pointerEvent.clientY;
        rememberPrimaryPointer(pointerEvent);
      }
      const pureRef = runtime.interactionPreset === "pureref";
      const lockedLeftPan =
        pureRef &&
        runtime.canvasMode.locked &&
        !pointerEvent.ctrlKey &&
        !pointerEvent.altKey &&
        !pointerEvent.shiftKey &&
        (pointerEvent.button === 0 || (pointerEvent.buttons & 1) !== 0);
      if (
        isPanPointerEvent(pointerEvent, pureRef, spaceHeldRef.current) ||
        lockedLeftPan
      ) {
        pointerEvent.preventDefault();
        canvas.endCurrentTransform(pointerEvent);
        restoreSelectionBeforeGesture();
        panning = true;
        panButton = isMiddleButtonPointer(pointerEvent)
          ? "middle"
          : lockedLeftPan
            ? "locked-left"
            : spaceHeldRef.current
              ? "space-left"
              : "alt-left";
        lastX = pointerEvent.clientX;
        lastY = pointerEvent.clientY;
        if (panButton === "space-left") {
          spacePanStartX = pointerEvent.clientX;
          spacePanStartY = pointerEvent.clientY;
        }
        canvas.selection = false;
        canvas.defaultCursor = "grabbing";
        canvas.setCursor("grabbing");
        return;
      }
      if (runtime.canvasMode.locked) return;
      if (toolRef.current === "eraser") {
        const point = canvas.getScenePoint(pointerEvent);
        eraseAtPoint(point);
        return;
      }
      if (pointerEvent.button !== 0) return;

      const heldKeys = heldKeysRef.current;
      const scenePoint = canvas.getScenePoint(pointerEvent);
      const activeObject = canvas.getActiveObject() as
        | CanvasObjectWithData
        | null;
      const pointedObject = event.target as CanvasObjectWithData | undefined;

      // S/D+左：PureRef 的即时颜色码与图片源坐标检查，不改变选择。
      if (pureRef && (heldKeys.has("s") || heldKeys.has("d"))) {
        canvas.endCurrentTransform(pointerEvent);
        restoreSelectionBeforeGesture();
        if (heldKeys.has("s")) {
          try {
            const element = canvasElementRef.current;
            const bounds = element?.getBoundingClientRect();
            const context = element?.getContext("2d", {
              willReadFrequently: true,
            });
            if (!element || !bounds || !context) throw new Error("NO_CANVAS");
            const pixelX = Math.max(
              0,
              Math.min(
                element.width - 1,
                Math.floor(
                  ((pointerEvent.clientX - bounds.left) /
                    Math.max(bounds.width, 1)) *
                    element.width,
                ),
              ),
            );
            const pixelY = Math.max(
              0,
              Math.min(
                element.height - 1,
                Math.floor(
                  ((pointerEvent.clientY - bounds.top) /
                    Math.max(bounds.height, 1)) *
                    element.height,
                ),
              ),
            );
            const [red, green, blue] = context.getImageData(
              pixelX,
              pixelY,
              1,
              1,
            ).data;
            const hex = `#${[red, green, blue]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("")
              .toUpperCase()}`;
            void navigator.clipboard.writeText(hex).catch(() => undefined);
            showHud(translate("board.hudColorCopied").replace("{hex}", hex));
          } catch {
            showHud(translate("board.hudPixelReadFailed"));
          }
        } else {
          const image = pointedObject instanceof FabricImage ? pointedObject : null;
          if (image) {
            const local = util.transformPoint(
              scenePoint,
              util.invertTransform(image.calcTransformMatrix()),
            );
            const sourceX = (image.cropX ?? 0) + local.x + image.width / 2;
            const sourceY = (image.cropY ?? 0) + local.y + image.height / 2;
            showHud(
              translate("board.hudImageCoords")
                .replace("{x}", sourceX.toFixed(1))
                .replace("{y}", sourceY.toFixed(1)),
            );
          } else {
            showHud(
              translate("board.hudCanvasCoords")
                .replace("{x}", scenePoint.x.toFixed(1))
                .replace("{y}", scenePoint.y.toFixed(1)),
            );
          }
        }
        return;
      }

      // Alt+Shift+左：按拖动主方向手动翻转选中对象。
      if (
        pureRef &&
        pointerEvent.altKey &&
        pointerEvent.shiftKey &&
        !pointerEvent.ctrlKey
      ) {
        const flipTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!flipTarget) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "flip",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: flipTarget,
          selection: flipTarget,
          baseOpacity: flipTarget.opacity ?? 1,
          snapshot: snapshotPureRefTarget(flipTarget),
          changed: false,
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "move";
        canvas.setCursor("move");
        canvas.requestRenderAll();
        showHud(translate("board.hudFlipHint"));
        return;
      }

      // Ctrl+Alt+Shift+左：调整选中对象透明度（不产生逐帧历史）。
      if (
        pureRef &&
        pointerEvent.ctrlKey &&
        pointerEvent.altKey &&
        pointerEvent.shiftKey
      ) {
        const opacityTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!opacityTarget) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "opacity",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: opacityTarget,
          selection: opacityTarget,
          baseOpacity: opacityTarget.opacity ?? 1,
          snapshot: snapshotPureRefTarget(opacityTarget),
          changed: false,
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "ew-resize";
        canvas.setCursor("ew-resize");
        canvas.requestRenderAll();
        showHud(translate("board.hudOpacity").replace("{percent}", String(Math.round((opacityTarget.opacity ?? 1) * 100))));
        return;
      }

      // Ctrl+Alt+左：PureRef 2.1 为左右拖动等比缩放。
      if (
        pureRef &&
        pointerEvent.ctrlKey &&
        pointerEvent.altKey &&
        !pointerEvent.shiftKey
      ) {
        const scaleTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!scaleTarget) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "scale",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: scaleTarget,
          selection: scaleTarget,
          baseOpacity: 1,
          snapshot: snapshotPureRefTarget(scaleTarget),
          changed: false,
          transform: {
            center: scaleTarget.getCenterPoint(),
            startPoint: scenePoint,
            lastPoint: scenePoint,
            baseAngle: scaleTarget.angle ?? 0,
            accumulatedAngle: 0,
            baseScaleX: scaleTarget.scaleX ?? 1,
            baseScaleY: scaleTarget.scaleY ?? 1,
          },
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "ew-resize";
        canvas.setCursor("ew-resize");
        canvas.requestRenderAll();
        showHud(translate("board.hudScaleHint"));
        return;
      }

      // Ctrl+左：直接旋转指针下对象；命中当前多选时旋转整个选区。
      if (
        pureRef &&
        pointerEvent.ctrlKey &&
        !pointerEvent.altKey
      ) {
        const rotateTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!rotateTarget) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "rotate",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: rotateTarget,
          selection: rotateTarget,
          baseOpacity: 1,
          snapshot: snapshotPureRefTarget(rotateTarget),
          changed: false,
          transform: {
            center: rotateTarget.getCenterPoint(),
            startPoint: scenePoint,
            lastPoint: scenePoint,
            baseAngle: rotateTarget.angle ?? 0,
            accumulatedAngle: 0,
            baseScaleX: rotateTarget.scaleX ?? 1,
            baseScaleY: rotateTarget.scaleY ?? 1,
          },
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "grabbing";
        canvas.setCursor("grabbing");
        canvas.requestRenderAll();
        showHud(translate("board.hudRotate").replace("{angle}", String(Math.round(normalizeSignedAngle(rotateTarget.angle ?? 0)))));
        return;
      }

      // C+左：非破坏性裁切（先画裁切矩形，松开后应用）。
      if (
        pureRef &&
        heldKeys.has("c")
      ) {
        const cropTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!(cropTarget instanceof FabricImage)) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "crop",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: cropTarget,
          selection: cropTarget,
          baseOpacity: 1,
          snapshot: snapshotPureRefTarget(cropTarget),
          changed: false,
          suppressSave: true,
        };
        canvas.selection = false;
        const rect = new Rect({
          left: scenePoint.x,
          top: scenePoint.y,
          width: 0,
          height: 0,
          stroke: "#3ab28f",
          strokeWidth: 1.5 / canvas.getZoom(),
          fill: "rgba(58, 178, 143, 0.08)",
          strokeDashArray: [4 / canvas.getZoom(), 4 / canvas.getZoom()],
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        cropRectRef.current = rect;
        canvas.add(rect);
        canvas.defaultCursor = "crosshair";
        canvas.setCursor("crosshair");
        canvas.requestRenderAll();
        showHud(translate("board.hudCropHint"));
        return;
      }

      // Shift+V+左：在裁切框内左右拖动缩放源图，显示框保持不变。
      if (
        pureRef &&
        heldKeys.has("v") &&
        pointerEvent.shiftKey
      ) {
        const cropZoomTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!(cropZoomTarget instanceof FabricImage)) return;
        const original = cropZoomTarget.getOriginalSize();
        const isCropped =
          (cropZoomTarget.width ?? original.width) < original.width ||
          (cropZoomTarget.height ?? original.height) < original.height ||
          (cropZoomTarget.cropX ?? 0) > 0 ||
          (cropZoomTarget.cropY ?? 0) > 0;
        if (!isCropped) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "cropZoom",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: cropZoomTarget,
          selection: cropZoomTarget,
          baseOpacity: 1,
          snapshot: snapshotPureRefTarget(cropZoomTarget),
          changed: false,
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "ew-resize";
        canvas.setCursor("ew-resize");
        canvas.requestRenderAll();
        showHud(translate("board.hudCropZoomHint"));
        return;
      }

      // V+左：在已裁切图片内部移动裁切区域。
      if (pureRef && heldKeys.has("v")) {
        const cropPanTarget = selectPureRefTarget(activeObject, pointedObject);
        if (!(cropPanTarget instanceof FabricImage)) return;
        const original = cropPanTarget.getOriginalSize();
        const isCropped =
          (cropPanTarget.width ?? original.width) < original.width ||
          (cropPanTarget.height ?? original.height) < original.height ||
          (cropPanTarget.cropX ?? 0) > 0 ||
          (cropPanTarget.cropY ?? 0) > 0;
        if (!isCropped) return;
        canvas.endCurrentTransform(pointerEvent);
        gestureRef.current = {
          kind: "cropPan",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: cropPanTarget,
          selection: cropPanTarget,
          baseOpacity: 1,
          snapshot: snapshotPureRefTarget(cropPanTarget),
          changed: false,
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "move";
        canvas.setCursor("move");
        canvas.requestRenderAll();
        showHud(translate("board.hudCropPanHint"));
        return;
      }

      // Z+左：连续缩放（以指针位置为中心）。
      if (pureRef && heldKeys.has("z")) {
        canvas.endCurrentTransform(pointerEvent);
        restoreSelectionBeforeGesture();
        gestureRef.current = {
          kind: "zoom",
          startX: pointerEvent.clientX,
          startY: pointerEvent.clientY,
          lastX: pointerEvent.clientX,
          lastY: pointerEvent.clientY,
          target: null,
          selection: selectionBeforePointer,
          baseOpacity: 1,
          snapshot: snapshotPureRefTarget(
            null,
            [...(canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0])] as TMat2D,
          ),
          changed: false,
          suppressSave: true,
        };
        canvas.selection = false;
        canvas.defaultCursor = "ns-resize";
        canvas.setCursor("ns-resize");
        canvas.requestRenderAll();
        showHud(translate("board.hudZoomHint"));
        return;
      }

      // Shift+拖动：约束轴向移动（记录起点，松手后轴向锁定）。
      if (pureRef && pointerEvent.shiftKey && activeObject) {
        const selected = canvas.getActiveObjects();
        if (selected.length) {
          moveStartRef.current = {
            pointer: scenePoint,
            positions: new Map(
              (selected as CanvasObjectWithData[]).map((object) => [
                object,
                { left: object.left ?? 0, top: object.top ?? 0 },
              ]),
            ),
          };
        }
      }

      if (isBoardShapeTool(toolRef.current)) {
        const point = canvas.getScenePoint(pointerEvent);
        drawingStart = { x: point.x, y: point.y };
        drawingObject = createBoardShape(
          toolRef.current,
          point,
          drawingStyleRef.current,
        );
        canvas.add(drawingObject);
      }
    });
    controller.onCanvas(canvas, "mouse:move:before", (event) => {
      const pointerEvent = event.e as MouseEvent;
      if (primaryPointerDown) {
        rememberPrimaryPointer(pointerEvent);
        if ((pointerEvent.buttons & 1) === 0) {
          queuePrimaryPointerRecovery();
        }
      }
      if (!panning) return;
      const stillPressed =
        panButton === "middle"
          ? (pointerEvent.buttons & 4) !== 0
          : panButton === "alt-left"
            ? pointerEvent.altKey && (pointerEvent.buttons & 1) !== 0
            : (pointerEvent.buttons & 1) !== 0;
      if (!stillPressed) {
        finishPanning();
        return;
      }
      // 空格平移中位移超过 2px 视为真实拖动，keyup 时不再触发聚焦切换。
      if (
        panButton === "space-left" &&
        Math.hypot(
          pointerEvent.clientX - spacePanStartX,
          pointerEvent.clientY - spacePanStartY,
        ) > 2
      ) {
        spacePanMovedRef.current = true;
      }
      pointerEvent.preventDefault();
      canvas.relativePan(
        new Point(
          pointerEvent.clientX - lastX,
          pointerEvent.clientY - lastY,
        ),
      );
      lastX = pointerEvent.clientX;
      lastY = pointerEvent.clientY;
    });
    controller.onCanvas(canvas, "mouse:move", (event) => {
      const pointerEvent = event.e as MouseEvent;
      if (panning) return;
      if (toolRef.current === "eraser" && pointerEvent.buttons === 1) {
        eraseAtPoint(canvas.getScenePoint(pointerEvent));
        return;
      }
      const gesture = gestureRef.current;
      if (gesture.kind && gesture.kind !== "crop" && gesture.target) {
        const pointer = scenePointFromClient(
          pointerEvent.clientX,
          pointerEvent.clientY,
        );
        if (gesture.kind === "rotate") {
          const transform = gesture.transform;
          if (!transform) return;
          transform.accumulatedAngle +=
            (pointerAngleDelta(transform.center, transform.lastPoint, pointer) *
              180) /
            Math.PI;
          transform.lastPoint = pointer;
          const angle = snapRotationAngle(
            transform.baseAngle + transform.accumulatedAngle,
            pointerEvent.shiftKey,
          );
          gesture.target.rotate(angle);
          gesture.target.setCoords();
          gesture.changed = Math.abs(transform.accumulatedAngle) > 0.05;
          scheduleRender();
          showHud(translate("board.hudRotate").replace("{angle}", String(Math.round(normalizeSignedAngle(angle)))));
        } else if (gesture.kind === "scale") {
          const transform = gesture.transform;
          if (!transform) return;
          const scale = scaleForHorizontalDrag(
            transform.baseScaleX,
            transform.baseScaleY,
            pointerEvent.clientX - gesture.startX,
          );
          gesture.target.set(scale);
          gesture.target.setCoords();
          gesture.changed = Math.abs(pointerEvent.clientX - gesture.startX) > 0.5;
          scheduleRender();
          showHud(
            translate("board.hudZoomPercent").replace("{percent}", String(Math.round((scale.scaleX / transform.baseScaleX) * 100))),
          );
        } else if (gesture.kind === "opacity") {
          const next = clampOpacity(
            gesture.baseOpacity +
              opacityDelta(pointerEvent.clientX - gesture.startX),
          );
          gesture.target.set("opacity", next);
          gesture.changed = Math.abs(next - gesture.baseOpacity) > 0.001;
          scheduleRender();
          showHud(translate("board.hudOpacity").replace("{percent}", String(Math.round(next * 100))));
        } else if (gesture.kind === "cropPan") {
          const image = gesture.target as FabricImage;
          const delta = cropPanDelta(
            pointerEvent.clientX - gesture.lastX,
            pointerEvent.clientY - gesture.lastY,
            image.scaleX ?? 1,
            image.scaleY ?? 1,
          );
          const original = image.getOriginalSize();
          image.set({
            cropX: Math.max(
              0,
              Math.min(
                original.width - (image.width ?? original.width),
                (image.cropX ?? 0) + delta.cropX,
              ),
            ),
            cropY: Math.max(
              0,
              Math.min(
                original.height - (image.height ?? original.height),
                (image.cropY ?? 0) + delta.cropY,
              ),
            ),
          });
          image.setCoords();
          gesture.changed =
            gesture.changed || Math.abs(delta.cropX) + Math.abs(delta.cropY) > 0.01;
          scheduleRender();
        } else if (gesture.kind === "cropZoom") {
          const image = gesture.target as FabricImage;
          const snapshot = gesture.snapshot;
          if (!snapshot) return;
          const next = cropZoomForHorizontalDrag(
            {
              cropX: snapshot.cropX ?? 0,
              cropY: snapshot.cropY ?? 0,
              width: snapshot.width,
              height: snapshot.height,
              scaleX: snapshot.scaleX,
              scaleY: snapshot.scaleY,
            },
            image.getOriginalSize(),
            pointerEvent.clientX - gesture.startX,
          );
          image.set(next);
          image.setCoords();
          gesture.changed = Math.abs(pointerEvent.clientX - gesture.startX) > 0.5;
          scheduleRender();
          showHud(
            translate("board.hudCropZoomPercent").replace("{percent}", String(Math.round((next.scaleX / snapshot.scaleX) * 100))),
          );
        } else if (gesture.kind === "flip") {
          const snapshot = gesture.snapshot;
          if (!snapshot) return;
          const axis = flipAxisForDrag(
            pointerEvent.clientX - gesture.startX,
            pointerEvent.clientY - gesture.startY,
          );
          gesture.target.set({
            flipX: axis === "x" ? !snapshot.flipX : snapshot.flipX,
            flipY: axis === "y" ? !snapshot.flipY : snapshot.flipY,
          });
          gesture.target.setCoords();
          gesture.changed = axis !== null;
          scheduleRender();
          if (axis) showHud(axis === "x" ? translate("board.flipH") : translate("board.flipV"));
        }
        gesture.lastX = pointerEvent.clientX;
        gesture.lastY = pointerEvent.clientY;
        return;
      }
      if (gesture.kind === "zoom") {
        const nextZoom = Math.min(
          4,
          Math.max(
            0.08,
            canvas.getZoom() *
              zoomFactorForDrag(pointerEvent.clientY - gesture.lastY),
          ),
        );
        canvas.zoomToPoint(
          canvas.getViewportPoint(pointerEvent),
          nextZoom,
        );
        gesture.changed = true;
        scheduleZoomState(Math.round(nextZoom * 100));
        scheduleProxyRefresh();
        gesture.lastY = pointerEvent.clientY;
        showHud(translate("board.hudZoomPercent").replace("{percent}", String(Math.round(nextZoom * 100))));
        return;
      }
      if (gesture.kind === "crop" && cropRectRef.current) {
        const point = canvas.getScenePoint(pointerEvent);
        const bounds = cropGestureRect(
          scenePointFromClient(gesture.startX, gesture.startY),
          point,
          false,
        );
        cropRectRef.current.set(bounds);
        cropRectRef.current.setCoords();
        gesture.changed = bounds.width > 4 && bounds.height > 4;
        scheduleRender();
        return;
      }
      // Shift+拖动选中对象：约束轴向移动。
      if (
        pointerEvent.shiftKey &&
        moveStartRef.current &&
        pointerEvent.buttons === 1 &&
        !drawingObject
      ) {
        const selected = canvas.getActiveObjects();
        if (selected.length) {
          const pointer = canvas.getScenePoint(pointerEvent);
          const start = moveStartRef.current;
          const axis = constrainedAxis(start.pointer, pointer);
          if (axis) {
            const dx = pointer.x - start.pointer.x;
            const dy = pointer.y - start.pointer.y;
            for (const object of selected as CanvasObjectWithData[]) {
              const base = start.positions.get(object);
              if (!base) continue;
              object.set({
                left:
                  axis === "x" && !object.lockMovementX
                    ? base.left + dx
                    : base.left,
                top:
                  axis === "y" && !object.lockMovementY
                    ? base.top + dy
                    : base.top,
              });
              object.setCoords();
            }
            scheduleRender();
          }
        }
        return;
      }
      if (!drawingObject || !drawingStart) return;
      const point = canvas.getScenePoint(pointerEvent);
      updateBoardShape(
        drawingObject,
        drawingStart,
        point,
        pointerEvent.shiftKey,
      );
      scheduleRender();
    });
    controller.onCanvas(canvas, "mouse:up", (event) => {
      const pointerEvent = event.e as MouseEvent;
      if (pointerEvent.button === 0 || (pointerEvent.buttons & 1) === 0) {
        primaryPointerDown = false;
      }
      if (panning) pointerEvent.preventDefault();
      if (finishPanning()) return;
      if (toolRef.current === "eraser") return;
      snapGestureTarget = null;
      snapCandidates = [];
      transformDescendantsRef.current = null;
      canvas.defaultCursor = "default";
      setSnapIndicator((current) =>
        current ? { axis: current.axis, value: current.value, visible: false } : current,
      );
      // Ctrl+纯点击（按下位移 < 3px）：命中对象加入/移出当前多选。两种交互
      // 预设通用；PureRef 的 Ctrl+左拖旋转手势需要位移，纯点击在此按加选
      // 处理，拖拽超过 3px 走原手势收尾，互不干扰。
      if (
        toolRef.current === "select" &&
        pointerEvent.button === 0 &&
        pointerEvent.ctrlKey &&
        !pointerEvent.shiftKey &&
        !pointerEvent.altKey &&
        !pointerEvent.metaKey &&
        Math.hypot(
          pointerEvent.clientX - primaryPointerDownX,
          pointerEvent.clientY - primaryPointerDownY,
        ) < 3
      ) {
        // findTarget 把点中的多选成员上报为整个 ActiveSelection，这里改用
        // 全场景搜索拿真正的命中对象。
        const pointed = canvas.searchPossibleTargets(
          canvas.getObjects(),
          canvas.getScenePoint(pointerEvent),
        ).target as CanvasObjectWithData | undefined;
        if (pointed) {
          // 点中非成员时 Fabric 已在 mouse:down 收拢多选：用按下前快照恢复。
          if (
            !(canvas.getActiveObject() instanceof ActiveSelection) &&
            selectionMembersBeforePointer
          ) {
            canvas.setActiveObject(
              createBoardActiveSelection(
                [...selectionMembersBeforePointer],
                canvas,
              ),
            );
          }
          toggleObjectInActiveSelection(canvas, pointed);
          // 纯点击不进入手势收尾（如 PureRef Ctrl 旋转），避免覆盖切换结果。
          gestureRef.current.kind = null;
          gestureRef.current.changed = false;
          gestureRef.current.suppressSave = false;
          gestureRef.current.target = null;
          gestureRef.current.selection = null;
          restoreCanvasInteraction(canvas);
        }
      }
      const gesture = gestureRef.current;
      if (gesture.kind) {
        // 手势结束：收尾时产生一条完整的 undo 记录（不按帧记录）。
        const finish = () => {
          const target = gesture.target;
          const kind = gesture.kind;
          let selection = gesture.selection;
          const changed = gesture.changed;
          gesture.kind = null;
          gesture.changed = false;
          gesture.suppressSave = false;
          gesture.target = null;
          gesture.selection = null;
          moveStartRef.current = null;
          if (target instanceof ActiveSelection && changed) {
            const members = target.getObjects() as CanvasObjectWithData[];
            if (kind === "opacity") {
              const multiplier = target.opacity ?? 1;
              for (const member of members) {
                member.set(
                  "opacity",
                  clampOpacity((member.opacity ?? 1) * multiplier),
                );
              }
              target.set("opacity", 1);
            }
            // ActiveSelection 本身不在文档对象数组中；先退出临时组，把
            // 旋转/缩放/翻转矩阵落实到成员，再建立等价的新选区。
            canvas.discardActiveObject();
            selection = createBoardActiveSelection(members, canvas);
            applyBoardControls(selection);
            for (const member of members) {
              member.setCoords();
              canvas.fire("object:modified", { target: member });
            }
          } else if (target && changed) {
            target.setCoords();
            canvas.fire("object:modified", { target });
          }
          if (selection) canvas.setActiveObject(selection);
          else canvas.discardActiveObject();
          restoreCanvasInteraction(canvas);
          canvas.requestRenderAll();
          scheduleProxyRefresh();
        };
        if (gesture.kind === "crop" && cropRectRef.current) {
          const rect = cropRectRef.current;
          cropRectRef.current = null;
          const target = gesture.target as FabricImage;
          if (rect.width > 4 && rect.height > 4) {
            const matrix = target.calcTransformMatrix();
            const inverse = util.invertTransform(matrix);
            const corners = [
              new Point(rect.left, rect.top),
              new Point(rect.left + rect.width, rect.top),
              new Point(rect.left + rect.width, rect.top + rect.height),
              new Point(rect.left, rect.top + rect.height),
            ].map((point) => util.transformPoint(point, inverse));
            const oldWidth = target.width;
            const oldHeight = target.height;
            const left = Math.max(
              -oldWidth / 2,
              Math.min(...corners.map((point) => point.x)),
            );
            const right = Math.min(
              oldWidth / 2,
              Math.max(...corners.map((point) => point.x)),
            );
            const top = Math.max(
              -oldHeight / 2,
              Math.min(...corners.map((point) => point.y)),
            );
            const bottom = Math.min(
              oldHeight / 2,
              Math.max(...corners.map((point) => point.y)),
            );
            const width = Math.max(0, right - left);
            const height = Math.max(0, bottom - top);
            if (width > 1 && height > 1) {
              const frameOrigin = util.transformPoint(
                new Point(left, top),
                matrix,
              );
              target.set({
                cropX: (target.cropX ?? 0) + left + oldWidth / 2,
                cropY: (target.cropY ?? 0) + top + oldHeight / 2,
                width,
                height,
              });
              target.setPositionByOrigin(frameOrigin, "left", "top");
              gesture.changed = true;
            } else {
              gesture.changed = false;
            }
          }
          canvas.remove(rect);
          finish();
          return;
        }
        finish();
        return;
      }
      if (drawingObject) {
        const bounds = drawingObject.getBoundingRect();
        if (bounds.width < 2 && bounds.height < 2) {
          canvas.remove(drawingObject);
        } else {
          drawingObject.set({ selectable: true, evented: true });
          drawingObject.setCoords();
          canvas.fire("object:modified", { target: drawingObject });
        }
        drawingObject = null;
        drawingStart = null;
        canvas.requestRenderAll();
      }
      moveStartRef.current = null;
      if (toolRef.current === "select") canvas.selection = true;
      scheduleProxyRefresh();
    });

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      canvas.setDimensions({
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
      });
      canvas.requestRenderAll();
    });
    resizeObserver.observe(hostRef.current);

    loadingRef.current = true;
    setReadyBoardId(null);
    // Race loadCanvasJSON against a hard timeout: if loadFromJSON hangs
    // (e.g., a stale image src whose <img> never fires onload/onerror),
    // the board would never become ready and pending assets would stall.
    const loadTimeout = window.setTimeout(() => loadController.abort(), 10_000);
    const loadController = new AbortController();
    void Promise.race([
      controller.loadCanvasJSON(canvas, document.canvas),
      new Promise<never>((_, reject) => {
        loadController.signal.addEventListener("abort", () =>
          reject(new Error("BOARD_LOAD_TIMEOUT")),
        );
      }),
    ]).then(() => {
      window.clearTimeout(loadTimeout);
      for (const object of canvas.getObjects() as CanvasObjectWithData[]) {
        applyBoardControls(object);
        if (ensureObjectIdentity(object)) migratedIdentity = true;
      }
      if (sanitizeHierarchy(canvas)) migratedIdentity = true;
      rebuildTransformSnapshots(canvas);
      canvas.setViewportTransform(document.viewport.transform);
      controller.setZoom(Math.round(document.viewport.zoom * 100));
      runtime.syncDocument(document);
      setCanvasLocked(runtime.canvasMode.locked);
      applyCanvasMode(canvas, runtime.canvasMode);
      loadingRef.current = false;
      setReadyBoardId(board.id);
      historyControllerRef.current.reset(
        JSON.stringify(canvas.toObject(["data"])),
      );
      controller.refreshSnapshot();
      canvas.requestRenderAll();
      scheduleProxyRefresh();
      if (migratedIdentity) {
        controller.setSaved(false);
        saveImmediately(makeDocument(canvas));
      }
    }).catch(() => {
      window.clearTimeout(loadTimeout);
      // loadFromJSON failed or timed out (e.g., stale image src from a
      // previous session that can't enliven). Clear the canvas and mark
      // ready so pending assets can still be added — the board is usable
      // even if old objects couldn't be restored.
      if (disposed) return;
      canvas.clear();
      canvas.requestRenderAll();
      loadingRef.current = false;
      setReadyBoardId(board.id);
    });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      void persistence.flush().catch(() => undefined);
      persistence.dispose();
      persistenceRef.current = null;
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
      if (zoomFrame !== null) window.cancelAnimationFrame(zoomFrame);
      importController.dispose();
      if (hudFrame !== null) window.cancelAnimationFrame(hudFrame);
      scheduleSaveRef.current = null;
      zoomUiRef.current = null;
      finishContinuousGestureRef.current = null;
      for (const animator of gifAnimatorsRef.current.values()) {
        animator.dispose();
      }
      gifAnimatorsRef.current.clear();
      controller.destroyCanvas(canvas);
      canvasRef.current = null;
    };
  }, [board.id]);

  useEffect(() => {
    controller.syncAssets(boardAssets);
  }, [boardAssets, controller]);

  useEffect(() => {
    controller.syncCallbacks({
      loadDocument: async (nextDocument, context) => {
        const canvas = canvasRef.current;
        if (!canvas || !context.isCurrent()) return;
        loadingRef.current = true;
        await controller.loadCanvasJSON(canvas, nextDocument.canvas);
        if (!context.isCurrent()) {
          loadingRef.current = false;
          return;
        }
        for (const object of canvas.getObjects() as CanvasObjectWithData[]) {
          applyBoardControls(object);
          ensureObjectIdentity(object);
        }
        canvas.setViewportTransform(nextDocument.viewport.transform);
        runtime.syncDocument(nextDocument);
        applyCanvasMode(canvas, runtime.canvasMode);
        loadingRef.current = false;
        controller.refreshSnapshot();
        canvas.requestRenderAll();
      },
      saveDocument: async () => {
        const canvas = canvasRef.current;
        if (canvas) await saveLocalDocument(makeDocument(canvas));
      },
      refreshProxies: () => canvasRef.current?.requestRenderAll(),
    });
    void controller.syncDocument(board.id, document);
  }, [board.id, controller, document]);

  useEffect(() => {
    const completeFlush = (event: Event) => {
      event.preventDefault();
      const flush = persistenceRef.current?.flush() ?? Promise.resolve();
      void flush.then(
        () => window.refCanvas.boards.confirmFlush(true),
        () => window.refCanvas.boards.confirmFlush(false),
      );
    };
    window.addEventListener("refcanvas:board-flush-request", completeFlush);
    return () => window.removeEventListener("refcanvas:board-flush-request", completeFlush);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    toolRef.current = tool;
    drawingStyleRef.current = drawingStyle;
    const interaction = boardToolInteractionState(
      tool,
      runtime.canvasMode.locked,
    );
    canvas.isDrawingMode = interaction.drawingMode;
    canvas.selection = interaction.selection;
    canvas.skipTargetFind = interaction.skipTargetFind;
    canvas.defaultCursor =
      tool === "select"
        ? "default"
        : tool === "eraser"
          ? "var(--cursor-eraser)"
          : "crosshair";
    if (tool === "pencil") {
      const brush = new PencilBrush(canvas);
      brush.color = drawingStyle.color;
      brush.width = drawingStyle.width;
      canvas.freeDrawingBrush = brush;
    }
  }, [drawingStyle, tool]);

  useEffect(() => {
    const onPresentationMode = (event: Event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const enabled = (event as CustomEvent<boolean>).detail;
      canvas.skipTargetFind = enabled || toolRef.current !== "select";
      canvas.selection = enabled ? false : toolRef.current === "select";
      canvas.defaultCursor =
        enabled
          ? "default"
          : toolRef.current === "select"
            ? "default"
            : toolRef.current === "eraser"
              ? "var(--cursor-eraser)"
              : "crosshair";
      if (enabled) {
        canvas.discardActiveObject();
        eventBindingsRef.current.onSelectAsset(null);
      }
      canvas.requestRenderAll();
    };
    return controller.onDom(
      window,
      "refcanvas:presentation-mode",
      onPresentationMode,
    );
  }, [controller]);

  const restoreHistory = (offset: -1 | 1) => {
    const canvas = canvasRef.current;
    const persistence = persistenceRef.current;
    if (!canvas || !persistence) return;
    const entry = persistence.historyEntry(offset);
    if (!entry) return;
    gestureRef.current = { ...gestureRef.current, suppressSave: false };
    loadingRef.current = true;
    void controller.loadCanvasJSON(canvas, JSON.parse(entry.snapshot)).then(() => {
      for (const object of canvas.getObjects() as CanvasObjectWithData[]) {
        ensureObjectIdentity(object);
      }
      sanitizeHierarchy(canvas);
      rebuildTransformSnapshots(canvas);
      persistence.commitHistory(entry.index);
      loadingRef.current = false;
      controller.refreshSnapshot();
      canvas.requestRenderAll();
      const nextDocument = makeDocument(canvas);
      controller.setSaved(false);
      saveImmediately(nextDocument);
    });
  };

  const deleteSelection = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const selected = canvas.getActiveObjects();
    if (!selected.length) return;
    const removedIds = new Set(
      (selected as CanvasObjectWithData[]).flatMap((object) =>
        object.data?.objectId ? [object.data.objectId] : [],
      ),
    );
    for (const object of hierarchyObjects(canvas)) {
      if (!object.data?.parentId || !removedIds.has(object.data.parentId)) continue;
      object.data = { ...(object.data ?? {}), parentId: undefined };
      canvas.fire("object:modified", { target: object });
    }
    canvas.discardActiveObject();
    canvas.remove(...selected);
    // 移除的对象不再参与笔画级撤销。
    const removedSet = new Set(selected);
    strokeHistoryRef.current = strokeHistoryRef.current.filter(
      (stroke) => !removedSet.has(stroke),
    );
    canvas.requestRenderAll();
  };

  /** 笔画级撤销：删除最近创建的一条绘图笔画。 */
  const undoLastStroke = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stroke = strokeHistoryRef.current.pop();
    if (!stroke) return;
    if (stroke.canvas === canvas) {
      canvas.remove(stroke);
      canvas.requestRenderAll();
    }
  };

  /**
   * 橡皮擦：进入擦除模式，点击现有笔画将其删除（支持框选批量擦除）。
   * 拖动时擦除鼠标经过的笔画；仍通过快捷键/工具栏退出。
   */
  const toggleEraser = () => {
    setTool((current) => toggleBoardEraserTool(current));
  };

  const eraseAtPoint = (point: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas || toolRef.current !== "eraser") return;
    const pointInScene = new Point(point.x, point.y);
    const hit = [...canvas.getObjects()]
      .reverse()
      .find(
        (object) => {
          const type = (object as CanvasObjectWithData).data?.type;
          return type?.startsWith("drawing-") && object.containsPoint(pointInScene);
        },
      );
    if (hit) {
      canvas.remove(hit);
      strokeHistoryRef.current = strokeHistoryRef.current.filter(
        (stroke) => stroke !== hit,
      );
      canvas.requestRenderAll();
    }
  };

  const duplicateSelection = async () => {
    const canvas = canvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) return;
    const clone = await active.clone(["data"]);
    clone.set({
      left: (active.left ?? 0) + 24,
      top: (active.top ?? 0) + 24,
    });
    ensureObjectIdentity(clone as CanvasObjectWithData, { fresh: true });
    (clone as CanvasObjectWithData).data = {
      ...((clone as CanvasObjectWithData).data ?? {}),
      parentId: undefined,
    };
    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
  };

  const moveSelection = (toFront: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects()) {
      if (toFront) canvas.bringObjectToFront(object);
      else canvas.sendObjectToBack(object);
      canvas.fire("object:modified", { target: object });
    }
    canvas.requestRenderAll();
  };

  const transformSelection = (mode: "rotate" | "flipX" | "flipY") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects()) {
      if (mode === "rotate") object.rotate(((object.angle ?? 0) + 90) % 360);
      if (mode === "flipX") object.set("flipX", !object.flipX);
      if (mode === "flipY") object.set("flipY", !object.flipY);
      object.setCoords();
      canvas.fire("object:modified", { target: object });
    }
    canvas.requestRenderAll();
  };

  // 上移/下移一层：逐个选中对象复用 controller 的 move-up/move-down 命令
  // （多选成员各自在堆叠中移动一层，保持相对顺序）。
  const moveSelectionOneLayer = (direction: "move-up" | "move-down") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects()) {
      const id = (object as CanvasObjectWithData).data?.objectId;
      if (id) controller.command(direction, id);
    }
  };

  const arrangeController = useState(
    () =>
      new BoardArrangeController({
        getCanvas: () => canvasRef.current,
        getAssets: () => eventBindingsRef.current.assets,
      }),
  )[0];
  const {
    arrangeCompact,
    normalizeSize,
    arrangeBy,
    uniformArea,
    uniformScale,
    resetSelectionTransform,
    alignSelection,
    distributeSelection,
  } = arrangeController;

  const normalizeHierarchyStack = (canvas: FabricCanvas) => {
    const objects = hierarchyObjects(canvas);
    const byId = new Map(
      objects.flatMap((object) =>
        object.data?.objectId ? [[object.data.objectId, object] as const] : [],
      ),
    );
    const orderedIds = flattenHierarchy(
      objects.flatMap((object) =>
        object.data?.objectId
          ? [{ id: object.data.objectId, parentId: object.data.parentId }]
          : [],
      ),
    ).map((item) => item.id);
    orderedIds.forEach((id, index) => {
      const object = byId.get(id);
      if (object) canvas.moveObjectTo(object, index);
    });
  };

  const setHierarchyParent = (
    child: CanvasObjectWithData,
    parentId: string | undefined,
  ): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    ensureObjectIdentity(child);
    const childId = child.data?.objectId;
    const items = hierarchyItems(canvas);
    if (!childId || !canSetHierarchyParent(items, childId, parentId)) {
      return false;
    }
    child.data = { ...(child.data ?? {}), parentId };
    normalizeHierarchyStack(canvas);
    rebuildTransformSnapshots(canvas);
    canvas.fire("object:modified", { target: child });
    canvas.requestRenderAll();
    controller.refreshSnapshot();
    return true;
  };

  const parentSelection = () => {
    const canvas = canvasRef.current;
    const objects = canvas?.getActiveObjects() as
      | CanvasObjectWithData[]
      | undefined;
    if (!canvas || !objects || objects.length < 2) return;
    const [parent, ...children] = objects;
    ensureObjectIdentity(parent);
    const parentId = parent.data?.objectId;
    if (!parentId) return;
    for (const child of children) setHierarchyParent(child, parentId);
    canvas.discardActiveObject();
    canvas.setActiveObject(parent);
    canvas.requestRenderAll();
  };

  const unparentSelection = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects() as CanvasObjectWithData[]) {
      if (object.data?.parentId) setHierarchyParent(object, undefined);
    }
  };

  const reorderHierarchyObject = (
    dragged: CanvasObjectWithData,
    target: CanvasObjectWithData,
    before: boolean,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || dragged === target) return;
    if (!setHierarchyParent(dragged, target.data?.parentId)) return;
    const objects = canvas.getObjects();
    const targetIndex = objects.indexOf(target);
    canvas.moveObjectTo(
      dragged,
      Math.max(0, Math.min(
        objects.length - 1,
        before ? targetIndex + 1 : targetIndex,
      )),
    );
    normalizeHierarchyStack(canvas);
    rebuildTransformSnapshots(canvas);
    canvas.fire("object:modified", { target: dragged });
    canvas.requestRenderAll();
    controller.refreshSnapshot();
  };

  const toggleLockSelection = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects()) {
      const locked = !(object.lockMovementX && object.lockMovementY);
      object.set({
        lockMovementX: locked,
        lockMovementY: locked,
        lockRotation: locked,
        lockScalingX: locked,
        lockScalingY: locked,
      });
      canvas.fire("object:modified", { target: object });
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const groupSelection = () => {
    const canvas = canvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !(active instanceof ActiveSelection)) return;
    const objects = active.getObjects();
    canvas.discardActiveObject();
    canvas.remove(...objects);
    const group = new Group(objects);
    (group as CanvasObjectWithData).data = {
      type: "group",
      objectId: crypto.randomUUID(),
      name: translate("board.groupDefaultName"),
    };
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
  };

  const ungroupSelection = () => {
    const canvas = canvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !(active instanceof Group) || active instanceof ActiveSelection) return;
    const transform = active.calcTransformMatrix();
    const objects = active.removeAll();
    canvas.remove(active);
    for (const object of objects) {
      util.sendObjectToPlane(object, transform);
      canvas.add(object);
    }
    canvas.setActiveObject(createBoardActiveSelection(objects, canvas));
    canvas.requestRenderAll();
  };

  const applyCrop = (rect: CropRect) => {
    const canvas = canvasRef.current;
    const target = canvas && cropTarget
      ? (canvas.getObjects() as CanvasObjectWithData[]).find(
          (object) => object.data?.objectId === cropTarget.id,
        )
      : undefined;
    if (!canvas || !(target instanceof FabricImage)) return;
    const original = target.getOriginalSize();
    target.set({
      cropX: Math.round(rect.x * original.width),
      cropY: Math.round(rect.y * original.height),
      width: Math.max(1, Math.round(rect.width * original.width)),
      height: Math.max(1, Math.round(rect.height * original.height)),
    });
    target.setCoords();
    canvas.fire("object:modified", { target });
    canvas.requestRenderAll();
    setCropTarget(null);
  };

  const resetSelectionCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getActiveObjects()) {
      if (!(object instanceof FabricImage)) continue;
      const original = object.getOriginalSize();
      object.set({
        cropX: 0,
        cropY: 0,
        width: original.width,
        height: original.height,
      });
      object.setCoords();
      canvas.fire("object:modified", { target: object });
    }
    canvas.requestRenderAll();
  };

  const setSelectionOpacity = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    await dialog.requestForm({
      title: translate("board.opacityTitle"),
      confirmLabel: translate("board.apply"),
      fields: [
        {
          name: "opacity",
          label: translate("board.opacityLabel"),
          type: "number",
          initialValue: String(Math.round((active?.opacity ?? 1) * 100)),
          required: true,
          min: 0,
          max: 100,
        },
      ],
      onSubmit: ({ opacity: raw }) => {
        const opacity = Number(raw) / 100;
        for (const object of canvas.getActiveObjects()) {
          object.set("opacity", opacity);
          canvas.fire("object:modified", { target: object });
        }
        canvas.requestRenderAll();
      },
    });
  };

  const editObjectComment = async (target?: CanvasObjectWithData) => {
    const canvas = canvasRef.current;
    const object = target ?? (canvas?.getActiveObject() as CanvasObjectWithData);
    if (!canvas || !object || object instanceof ActiveSelection) return;
    const name = object.data?.name ?? object.data?.type ?? translate("board.objectDefaultName");
    await dialog.requestForm({
      title: object.data?.comment ? translate("board.commentEdit") : translate("board.commentAdd"),
      description: translate("board.commentDescription").replace("{name}", name),
      confirmLabel: translate("board.commentSave"),
      fields: [
        {
          name: "comment",
          label: translate("board.commentLabel"),
          type: "textarea",
          rows: 7,
          initialValue: object.data?.comment ?? "",
          placeholder: translate("board.commentPlaceholder"),
          maxLength: 5000,
        },
      ],
      onSubmit: ({ comment }) => {
        const value = comment.trim();
        object.data = {
          ...(object.data ?? {}),
          comment: value || undefined,
          commentUpdatedAt: value ? new Date().toISOString() : undefined,
        };
        canvas.fire("object:modified", { target: object });
        canvas.requestRenderAll();
        controller.refreshSnapshot();
      },
    });
  };

  const updateAppearance = (next: BoardAppearance) => {
    runtime.appearance = next;
    setAppearance(next);
    scheduleSaveRef.current?.();
  };

  const editBoardAppearance = () => {
    setAppearancePanelOpen((open) => !open);
  };

  const fitObjects = (selectionOnly = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const objects = (
      selectionOnly ? canvas.getActiveObjects() : canvas.getObjects()
    ).filter(
      (object) => !(object as CanvasObjectWithData).data?.guideAxis,
    );
    const boxes = objects.map((object) => object.getBoundingRect());
    const viewport = fitViewport(boxes, canvas.width, canvas.height);
    if (!viewport) return;
    canvas.setViewportTransform(viewport.transform);
    controller.setZoom(Math.round(viewport.zoom * 100));
    canvas.requestRenderAll();
  };

  /** 画布整体锁定：禁止选择和编辑，view 操作保留。 */
  const toggleCanvasLock = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = {
      ...runtime.canvasMode,
      locked: !runtime.canvasMode.locked,
    };
    runtime.canvasMode = next;
    setCanvasLocked(next.locked);
    applyCanvasMode(canvas, next);
    controller.setSaved(false);
    saveImmediately(makeDocument(canvas));
  };

  /** 画布整体灰度：用 CSS filter 作用于 canvas 元素。 */
  const toggleCanvasGrayscale = async () => {
    const next = {
      ...runtime.canvasMode,
      grayscale: !runtime.canvasMode.grayscale,
    };
    runtime.canvasMode = next;
    setAppearance((current) => ({ ...current }));
    scheduleSaveRef.current?.();
  };

  /** 循环网格样式：线 → 点 → 无。 */
  const cycleGridStyle = async () => {
    const order = ["line", "dot", "none"] as const;
    const nextIndex =
      (order.indexOf(runtime.canvasMode.gridStyle as (typeof order)[number]) + 1) %
      order.length;
    runtime.canvasMode = {
      ...runtime.canvasMode,
      gridStyle: order[nextIndex],
    };
    setAppearance((current) => ({ ...current }));
    scheduleSaveRef.current?.();
  };

  /** 100% 缩放（保持视口中心），收尾与 zoomByFactor 一致。 */
  const setZoom100 = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    zoomTo100(canvas);
    controller.setZoom(100);
    zoomUiRef.current?.scheduleZoomState(100);
    zoomUiRef.current?.scheduleProxyRefresh();
  };

  /** 围绕当前视口中心按倍率缩放（钳制区间由 board-zoom 统一），调度与 mouse:wheel 一致的刷新。 */
  const zoomByFactor = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = clampBoardZoom(
      canvas.getZoom() * factor,
      pixelViewRef.current ? BOARD_PIXEL_ZOOM : BOARD_MAX_ZOOM,
    );
    canvas.zoomToPoint(
      new Point(canvas.getWidth() / 2, canvas.getHeight() / 2),
      next,
    );
    zoomUiRef.current?.scheduleZoomState(Math.round(next * 100));
    zoomUiRef.current?.scheduleProxyRefresh();
  };

  /**
   * 像素级核对开关。
   *
   * 两件事缺一不可：
   *  - 缩放上限抬到 BOARD_PIXEL_ZOOM：画布通常已缩得远小于 1:1，8 倍根本到不了。
   *  - 每个图片对象 imageSmoothing = false：否则放大只是双线性模糊，
   *    单个像素永远分不出来。
   */
  const togglePixelView = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = !pixelViewRef.current;
    pixelViewRef.current = next;
    setPixelView(next);
    for (const object of canvas.getObjects() as CanvasObjectWithData[]) {
      if (object instanceof FabricImage) {
        object.imageSmoothing = !next;
      }
    }
    canvas.requestRenderAll();
    showDropNotice(
      next
        ? translate("board.pixelViewOn")
        : translate("board.pixelViewOff"),
    );
  };

  /** Arms one-shot canvas pixel sampling; the next canvas click reports color and scene coordinates. */
  const sampleColor = () => {
    setColorSampling(true);
    showDropNotice(translate("board.samplingNotice"));
  };

  const sampleCanvasPixel = async (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!colorSampling) return;
    const target = event.target as Element | null;
    if (!target?.closest(".canvas-container")) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setColorSampling(false);
    clearDropNotice();
    const scenePoint = canvas.getScenePoint(event.nativeEvent);
    // 自上而下找第一个命中的资产对象；uv 用对象局部坐标归一化。
    // 不再从画布 getImageData 读取——refasset:// 图片以普通 <img> 跨源
    // 加载会把画布标记为 tainted，读回必然抛 SecurityError；改由主进程
    // sharp 直接解码源文件采样（color:sample-image）。
    const objects = canvas.getObjects() as CanvasObjectWithData[];
    let hit: { assetId: string; u: number; v: number } | null = null;
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const object = objects[index];
      const assetId =
        typeof object.data?.assetId === "string" ? object.data.assetId : null;
      if (!assetId || object.visible === false || (object.opacity ?? 1) < 0.05) {
        continue;
      }
      const width = object.width ?? 0;
      const height = object.height ?? 0;
      if (width <= 0 || height <= 0) continue;
      // 注意：calcTransformMatrix 的逆转得到的是「以对象中心为原点」的
      // 局部坐标（范围 -w/2..+w/2），不是以左上角为原点。
      // 实测 fabric v7：对象中心 → (0,0)，左上角 → (-w/2,-h/2)。
      // 因此不能直接把 local.x 当 0..w 用，否则左半部分会被误判为
      // 「不在对象内」而跳过，右半部分会被算成偏小的 u。
      const local = util.transformPoint(
        scenePoint,
        util.invertTransform(object.calcTransformMatrix()),
      );
      const uv = localToUv(local, width, height);
      if (!uv) continue;
      hit = { assetId, u: uv.u, v: uv.v };
      break;
    }
    let sampled: { hex: string; alpha: number; decodedWidth: number; decodedHeight: number } | null = null;
    if (hit) {
      try {
        sampled = await window.refCanvas.color.sampleImage({
          assetId: hit.assetId,
          u: hit.u,
          v: hit.v,
        });
      } catch {
        showDropNotice(translate("board.samplingReadFailed"));
        return;
      }
    }
    const hitAsset = hit
      ? boardAssets.find((item) => item.id === hit.assetId) ?? null
      : null;
    // 显示层像素：与用户眼睛看到的一致（代理 WebP，含压缩与缩放）。
    // 取不到（对象无 src）时留 null，不伪造。
    let displayHex: string | null = null;
    if (hit) {
      const hitObject = objects.find(
        (object) => object.data?.assetId === hit.assetId,
      );
      // 只有带图像源的 FabricImage 才有显示层像素；形状/文本无此概念。
      const displayUrl =
        hitObject instanceof FabricImage
          ? (hitObject as unknown as { getSrc(): string }).getSrc()
          : null;
      if (displayUrl) {
        const display = await sampleDisplayPixel(displayUrl, hit.u, hit.v).catch(
          () => null,
        );
        displayHex = display?.hex ?? null;
      }
    }
    const fallback = runtime.appearance.backgroundColor.match(
      /^#([0-9a-f]{6})$/i,
    )?.[1];
    const hex = sampled?.hex ?? (fallback ? `#${fallback}` : "#000000");
    await navigator.clipboard.writeText(hex).catch(() => undefined);
    setColorSample({
      seq: (colorSampleSeqRef.current += 1),
      hex,
      displayHex,
      alpha: sampled?.alpha ?? 255,
      canvasPoint: { x: scenePoint.x, y: scenePoint.y },
      sourcePixel: sampled && hit
        ? sourcePixelFromUv(
            hit.u,
            hit.v,
            sampled.decodedWidth,
            sampled.decodedHeight,
            hitAsset?.width ?? null,
            hitAsset?.height ?? null,
          )
        : null,
      source: {
        name: hitAsset?.title ?? null,
        width: hitAsset?.width ?? null,
        height: hitAsset?.height ?? null,
      },
    });
  };

  // 阶段 6 §11：手动重连引用。先按 fingerprint 解析（拿候选），
  // ambiguous 时让用户选择；missing 时打开文件选择器。
  const relinkBoardReference = async (assetId: string) => {
    if (!board) return;
    const resolutions = await window.refCanvas.boards.resolveReferences(
      board.id,
    );
    const resolution = resolutions.find((item) => item.assetId === assetId);
    if (!resolution) return;
    if (resolution.candidates && resolution.candidates.length > 1) {
      const values = await dialog.requestForm({
        title: translate("board.relinkTitle"),
        description: translate("board.relinkDescription"),
        confirmLabel: translate("board.relinkConfirm"),
        fields: [
          {
            name: "target",
            label: translate("board.relinkCandidateLabel"),
            type: "select" as const,
            required: true,
            options: resolution.candidates.map((candidate) => ({
              value: candidate.path,
              label: candidate.path,
            })),
          },
        ],
        onSubmit: () => undefined,
      });
      if (!values?.target) return;
      await window.refCanvas.boards.relinkReference(
        board.id,
        assetId,
        values.target,
      );
    } else {
      const target = await window.refCanvas.system.pickFile({
        title: translate("board.relinkPickTitle"),
        defaultPath: resolution.path ?? undefined,
      });
      if (!target[0]) return;
      await window.refCanvas.boards.relinkReference(board.id, assetId, target[0]);
    }
    // 重新加载引用状态（自动刷新对象显示）。
    await window.refCanvas.boards.resolveReferences(board.id);
    void eventBindingsRef.current.onReferencesChanged?.();
  };


  /** PureRef 连续功能键（Z/C/V/S/D）；文本编辑时不劫持。 */
  useBoardGestureKeys({
    interactionPreset: runtime.interactionPreset,
    onPress: (key) => {
      heldKeysRef.current.add(key);
      const canvas = canvasRef.current;
      if (canvas && !gestureRef.current.kind) {
        canvas.setCursor(key === "z" ? "ns-resize" : key === "v" ? "move" : "crosshair");
      }
    },
    onRelease: (key) => {
      heldKeysRef.current.delete(key);
      finishContinuousGestureRef.current?.(key);
      const canvas = canvasRef.current;
      if (canvas && !gestureRef.current.kind) restoreCanvasInteraction(canvas);
    },
    onBlur: () => heldKeysRef.current.clear(),
  });

  /** 应用级白板偏好：首次加载及设置窗口修改时立即应用。 */
  useEffect(() => {
    const applySettings = (settings: BoardSettings) => {
      historyControllerRef.current.setLimit(settings.undoLimit);
      if (settings.interactionPreset !== "pureref") heldKeysRef.current.clear();
      runtime.syncSettings(settings);
      controller.syncSettings(settings);
    };
    const onSettingsChanged = (event: Event) => {
      applySettings((event as CustomEvent<BoardSettings>).detail);
    };
    void window.refCanvas.system
      .getPreferences()
      .then((preferences) => applySettings(preferences.boardSettings));
    return controller.onDom(window, "refcanvas:board-settings", onSettingsChanged);
  }, [controller]);

  /** FPS 采集钩子（仅 `?fps=1` 测试模式启用，正常打包不含该路径的 UI）。 */
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("fps")) return;
    const expose = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      (window as unknown as Record<string, unknown>).__boardCanvas = () =>
        canvasRef.current;
      (window as unknown as Record<string, unknown>).__spawnBoardObjects = (
        count: number,
      ) => {
        const objects = canvas.getObjects();
        const previousBulkMutation = bulkMutationRef.current;
        bulkMutationRef.current = true;
        try {
          for (let index = 0; index < count; index += 1) {
            const rect = new Rect({
              left: index * 14,
              top: index * 9,
              width: 32,
              height: 24,
              fill: `hsl(${index % 360} 45% 55%)`,
            }) as CanvasObjectWithData;
            ensureObjectIdentity(rect);
            canvas.add(rect);
          }
        } finally {
          bulkMutationRef.current = previousBulkMutation;
        }
        canvas.requestRenderAll();
        return objects.length + count;
      };
      (window as unknown as Record<string, unknown>).__spawnBoardImages = (
        count: number,
      ) => {
        const proxy = window.document.createElement("canvas");
        proxy.width = 512;
        proxy.height = 512;
        const context = proxy.getContext("2d");
        if (context) {
          context.fillStyle = "#203c37";
          context.fillRect(0, 0, 512, 512);
          context.fillStyle = "#75d2b6";
          context.fillRect(48, 48, 416, 416);
        }
        const previousRenderOnAddRemove = canvas.renderOnAddRemove;
        const previousBulkMutation = bulkMutationRef.current;
        canvas.renderOnAddRemove = false;
        bulkMutationRef.current = true;
        try {
          for (let index = 0; index < count; index += 1) {
            const image = new FabricImage(proxy, {
              left: (index % 50) * 120,
              top: Math.floor(index / 50) * 120,
              scaleX: 0.2,
              scaleY: 0.2,
            }) as CanvasObjectWithData & FabricImage;
            image.data = {
              type: "asset",
              assetId: crypto.randomUUID(),
              objectId: crypto.randomUUID(),
              name: `4K proxy ${index + 1}`,
              boardProxySize: 512,
            };
            applyBoardControls(image);
            canvas.add(image);
          }
        } finally {
          canvas.renderOnAddRemove = previousRenderOnAddRemove;
          bulkMutationRef.current = previousBulkMutation;
        }
        canvas.requestRenderAll();
        return count;
      };
      (window as unknown as Record<string, unknown>).__sampleFps = (
        seconds = 2,
      ) =>
        new Promise((resolve) => {
          const frames: number[] = [];
          let last = performance.now();
          let running = true;
          const tick = () => {
            if (!running) return;
            const now = performance.now();
            frames.push(now - last);
            last = now;
            if (performance.now() - start < seconds * 1000) {
              window.requestAnimationFrame(tick);
            } else {
              running = false;
              const ms = frames.filter((value) => value > 0);
              const avg = ms.length
                ? 1000 / (ms.reduce((sum, value) => sum + value, 0) / ms.length)
                : 0;
              const sorted = [...ms].sort((a, b) => a - b);
              const p95 =
                sorted.length >= 5
                  ? sorted[Math.floor(sorted.length * 0.95)]
                  : (sorted[sorted.length - 1] ?? 0);
              resolve({
                averageFps: Math.round(avg * 10) / 10,
                p95FrameMs: Math.round(p95 * 10) / 10,
                frames: ms.length,
              });
            }
          };
          const start = performance.now();
          window.requestAnimationFrame(tick);
        });
      return () => {
        delete (window as unknown as Record<string, unknown>).__boardCanvas;
        delete (window as unknown as Record<string, unknown>).__spawnBoardObjects;
        delete (window as unknown as Record<string, unknown>).__spawnBoardImages;
        delete (window as unknown as Record<string, unknown>).__sampleFps;
      };
    };
    const timer = window.setTimeout(expose, 400);
    return () => window.clearTimeout(timer);
  }, [board.id]);

  /**
   * 特殊窗口模式：always-on-bottom / 透明穿透 Overlay。
   * 所有模式都必须提供任务栏与快捷键紧急退出路径（Esc / F11 仍在 App 层生效）。
   */
  const setWindowMode = async (mode: "normal" | "always-on-bottom" | "transparent-overlay" | "locked") => {
    const canvas = canvasRef.current;
    try {
      if (mode === "normal") {
        await window.refCanvas.system.setClickThrough(false);
        await window.refCanvas.system.setWindowTransparent(false);
        await window.refCanvas.system.setAlwaysOnBottom(false);
      } else if (mode === "always-on-bottom") {
        await window.refCanvas.system.setWindowTransparent(false);
        await window.refCanvas.system.setAlwaysOnBottom(true);
      } else if (mode === "transparent-overlay") {
        await window.refCanvas.system.setAlwaysOnBottom(false);
        await window.refCanvas.system.setWindowTransparent(true);
        await window.refCanvas.system.setClickThrough(true);
        showDropNotice(translate("board.clickThroughNotice"));
      } else if (mode === "locked") {
        toggleCanvasLock();
      }
      runtime.windowMode = mode;
      if (canvas) {
        runtime.document = { ...runtime.document, windowMode: mode };
        scheduleSaveRef.current?.();
      }
    } catch {
      showDropNotice(translate("board.windowModeFailed"));
    }
  };

  const focusObjects = (canvas: FabricCanvas): CanvasObjectWithData[] =>
    (canvas.getObjects() as CanvasObjectWithData[]).filter(
      (object) =>
        object.visible &&
        Boolean(object.data?.assetId) &&
        !object.data?.guideAxis,
    );

  const focusBoardObject = (object: CanvasObjectWithData) => {
    const canvas = canvasRef.current;
    if (!canvas || !object.data?.assetId) return;
    if (!focusedObjectIdRef.current) {
      preFocusViewportRef.current = [
        ...(canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0]),
      ] as TMat2D;
    }
    ensureObjectIdentity(object);
    focusedObjectIdRef.current = object.data?.objectId ?? null;
    setFocusedObjectId(focusedObjectIdRef.current);
    const viewport = calculateFocusViewport(
      object.getBoundingRect(),
      { width: canvas.width, height: canvas.height },
      72,
    );
    canvas.discardActiveObject();
    canvas.setViewportTransform([
      viewport.zoom,
      0,
      0,
      viewport.zoom,
      viewport.offsetX,
      viewport.offsetY,
    ]);
    controller.setZoom(Math.round(viewport.zoom * 100));
    canvas.requestRenderAll();
  };

  const exitObjectFocus = () => {
    const canvas = canvasRef.current;
    if (canvas && preFocusViewportRef.current) {
      canvas.setViewportTransform([...preFocusViewportRef.current] as TMat2D);
      controller.setZoom(Math.round(canvas.getZoom() * 100));
      canvas.requestRenderAll();
    }
    focusedObjectIdRef.current = null;
    preFocusViewportRef.current = null;
    setFocusedObjectId(null);
  };

  const toggleObjectFocus = () => {
    if (focusedObjectIdRef.current) {
      exitObjectFocus();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject() as CanvasObjectWithData | undefined;
    const first = active?.data?.assetId ? active : focusObjects(canvas)[0];
    if (first) focusBoardObject(first);
  };

  const stepFocusedObject = (delta: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const objects = focusObjects(canvas);
    if (!objects.length) {
      exitObjectFocus();
      return;
    }
    const current = objects.findIndex(
      (object) => object.data?.objectId === focusedObjectIdRef.current,
    );
    const next = nextCircularIndex(current, objects.length, delta);
    if (next >= 0) focusBoardObject(objects[next]);
  };

  useEffect(() => {
    focusedObjectIdRef.current = null;
    preFocusViewportRef.current = null;
    setFocusedObjectId(null);
  }, [board.id]);


  const copySelection = () => {
    const canvas = canvasRef.current;
    if (canvas) copyBoardSelection(canvas);
  };

  const pasteSelection = async () => {
    const canvas = canvasRef.current;
    if (canvas) await pasteBoardSelection(canvas);
  };

  const switchBoard = async (id: string) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        await persistenceRef.current?.flush();
      } catch {
        return;
      }
    }
    await onSwitchBoard(id);
  };

  const createBoard = async () => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        await persistenceRef.current?.flush();
      } catch {
        return;
      }
    }
    await onCreateBoard();
  };

  const sceneCenter = (canvas: FabricCanvas): Point =>
    util.transformPoint(
      canvas.getCenterPoint(),
      util.invertTransform(
        canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0],
      ),
    );

  const pasteSystemClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const asset = await window.refCanvas.system.captureClipboard();
    if (!asset) return;
    const center = sceneCenter(canvas);
    await addAsset(asset, { x: center.x, y: center.y });
    await onLibraryChanged();
  };

  const importDroppedFiles = async (
    files: File[],
    position: { x: number; y: number },
  ) => {
    const notice = await importController.importFiles(
      files,
      position,
      {
        pathsForFiles: (items) => window.refCanvas.library.pathsForFiles(items),
        importPaths: (paths) => window.refCanvas.library.importPaths(paths),
        getByPath: (path) => window.refCanvas.library.getByPath(path),
      },
      (ids, point) => addDroppedAssets(ids, point),
      onLibraryChanged,
    );
    if (!notice) return;
    showDropNotice(notice);
  };

  /** 「添加文件」通路：系统文件对话框多选后，按当前视口中心批量导入放置。 */
  const importFilesFromDialog = async () => {
    const paths = await window.refCanvas.system.pickFile({
      title: translate("board.importFilesTitle"),
      multiSelections: true,
    });
    if (!paths.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = sceneCenter(canvas);
    const notice = await importController.importPathList(
      paths,
      { x: center.x, y: center.y },
      {
        pathsForFiles: (items) => window.refCanvas.library.pathsForFiles(items),
        importPaths: (items) => window.refCanvas.library.importPaths(items),
        getByPath: (item) => window.refCanvas.library.getByPath(item),
      },
      (ids, point) => addDroppedAssets(ids, point),
      onLibraryChanged,
    );
    if (!notice) return;
    showDropNotice(notice);
  };

  const handleShortcutCommand = (
    command: BoardShortcutCommand,
    payload?: BoardShortcutPayload,
  ) => {
    switch (command) {
      case "cancelGesture": cancelPureRefGesture(); break;
      case "cancelSampling": setColorSampling(false); clearDropNotice(); break;
      case "toggleCommandPalette":
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else openCommandPalette();
        break;
      case "closeShortcutSettings": setShortcutSettingsOpen(false); break;
      case "closeCommandPalette": setCommandPaletteOpen(false); break;
      case "crop": {
        const id = boardSnapshot.activeObjectId;
        const active = id ? objectById(id) : null;
        if (active instanceof FabricImage) openCropDialog(active);
        break;
      }
      case "resetCrop": resetSelectionCrop(); break;
      case "flipX": transformSelection("flipX"); break;
      case "flipY": transformSelection("flipY"); break;
      case "toggleCanvasGrayscale": void toggleCanvasGrayscale(); break;
      case "toggleLock": toggleLockSelection(); break;
      case "exitFocus": exitObjectFocus(); break;
      case "fitAll": fitObjects(false); break;
      case "zoom100": void setZoom100(); break;
      case "selectAll": {
        const canvas = canvasRef.current;
        if (canvas) selectAllBoardObjects(canvas);
        break;
      }
      case "toggleFocus": toggleObjectFocus(); break;
      case "stepFocus":
        stepFocusedObject(payload === 1 ? 1 : -1);
        break;
      case "stepPureRefObject": {
        const canvas = canvasRef.current;
        if (!canvas) break;
        const objects = focusObjects(canvas);
        if (!objects.length) break;
        const active = canvas.getActiveObject() as CanvasObjectWithData | null;
        const current = objects.indexOf(active as CanvasObjectWithData);
        const next = nextCircularIndex(current, objects.length, payload === 1 ? 1 : -1);
        if (next >= 0) focusBoardObject(objects[next]);
        break;
      }
      case "moveLayer": moveSelection(Boolean(payload)); break;
      case "nudge": {
        const canvas = canvasRef.current;
        if (!canvas || typeof payload !== "string") break;
        const [key, rawDistance] = payload.split(":");
        const distance = Number(rawDistance);
        for (const object of canvas.getActiveObjects()) {
          if (object.lockMovementX && object.lockMovementY) continue;
          if (key === "ArrowLeft") object.set("left", (object.left ?? 0) - distance);
          else if (key === "ArrowRight") object.set("left", (object.left ?? 0) + distance);
          else if (key === "ArrowUp") object.set("top", (object.top ?? 0) - distance);
          else object.set("top", (object.top ?? 0) + distance);
          object.setCoords();
          canvas.fire("object:modified", { target: object });
        }
        canvas.requestRenderAll();
        break;
      }
      case "fitSelection": fitObjects(true); break;
      case "delete": deleteSelection(); break;
      case "editComment": void editObjectComment(); break;
      case "parent": parentSelection(); break;
      case "unparent": unparentSelection(); break;
      case "undo": restoreHistory(-1); break;
      case "redo": restoreHistory(1); break;
      case "duplicate": void duplicateSelection(); break;
      case "copy": copySelection(); break;
      case "paste":
        if (payload) void pasteSelection();
        else void pasteSystemClipboard();
        break;
      case "group": groupSelection(); break;
      case "ungroup": ungroupSelection(); break;
      case "resetTransform": resetSelectionTransform(); break;
      case "toggleGrid": updateAppearance({ ...runtime.appearance, gridVisible: !runtime.appearance.gridVisible }); break;
    }
  };

  useBoardShortcuts(
    shortcutBindings,
    {
      gestureActive: Boolean(gestureRef.current.kind),
      colorSampling,
      commandPaletteOpen,
      shortcutSettingsOpen,
      focused: Boolean(focusedObjectId),
      pureRef: runtime.interactionPreset === "pureref",
      hasSelection: boardSnapshot.selectionCount > 0,
      clipboardHasItems: hasBoardClipboard(),
    },
    handleShortcutCommand,
  );

  useEffect(() => {
    /**
     * 导出前把画布里的 <img> 图片对象临时换成 fetch+blob 拿到的
     * CORS-clean 位图。根因：白板图片经裸 <img> 加载，打包环境里
     * file:// 页面跨协议请求 refasset:// 无 Referer/Origin，协议策略
     * 无法签发 CORS 头，画布被污染，toDataURL 直接抛 SecurityError
     * 且被 void 吞掉（「导出 PNG 没反应」）。取色器已改主进程采样
     * 绕开（35c7a25）；导出 PNG 无法绕开，只能先换装干净位图。
     * 只换 _element（同尺寸，不动 width/scale/序列化 src），导出后还原。
     * GIF 动画对象的当前帧本来就是干净画布，跳过即可。
     */
    const swapBoardImagesForExport = async (
      objects: FabricObject[],
    ): Promise<() => void> => {
      const restores: Array<() => void> = [];
      const swaps: Array<Promise<void>> = [];
      const collect = (object: FabricObject): void => {
        if (object instanceof Group) {
          object.getObjects().forEach(collect);
          return;
        }
        const image = object as FabricObject & {
          _element?: unknown;
          getSrc?: () => string;
        };
        const element = image._element;
        if (!(element instanceof HTMLImageElement)) return;
        const src = typeof image.getSrc === "function" ? image.getSrc() : null;
        if (!src) return;
        swaps.push(
          loadCleanBoardImageElement(src).then((clean) => {
            if (!clean || image._element !== element) return;
            image._element = clean as typeof element;
            restores.push(() => {
              if (image._element === clean) image._element = element;
            });
          }),
        );
      };
      objects.forEach(collect);
      await Promise.allSettled(swaps);
      return () => restores.forEach((restore) => restore());
    };
    const exportPngFor = async (objects: FabricObject[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const restoreImages = await swapBoardImagesForExport(objects);
        try {
          const previousTransform: TMat2D = canvas.viewportTransform
            ? ([...canvas.viewportTransform] as TMat2D)
            : [1, 0, 0, 1, 0, 0];
          let options: Parameters<FabricCanvas["toDataURL"]>[0] = {
            format: "png",
            multiplier: 2,
            enableRetinaScaling: true,
          };
          if (objects.length) {
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            const bounds = objects.map((object) => object.getBoundingRect());
            const left = Math.min(...bounds.map((item) => item.left)) - 48;
            const top = Math.min(...bounds.map((item) => item.top)) - 48;
            const right = Math.max(
              ...bounds.map((item) => item.left + item.width),
            ) + 48;
            const bottom = Math.max(
              ...bounds.map((item) => item.top + item.height),
            ) + 48;
            options = {
              ...options,
              left,
              top,
              width: Math.max(1, right - left),
              height: Math.max(1, bottom - top),
            };
          }
          const dataUrl = canvas.toDataURL(options);
          canvas.setViewportTransform(previousTransform);
          canvas.requestRenderAll();
          const exported = await window.refCanvas.boards.exportPng(
            board.id,
            dataUrl,
          );
          if (exported) {
            window.dispatchEvent(new CustomEvent("refcanvas:toast", {
              detail: translate("board.exportPngSaved"),
            }));
          }
        } finally {
          restoreImages();
          canvas.requestRenderAll();
        }
      } catch (error) {
        console.error("[board] PNG export failed", error);
        window.dispatchEvent(new CustomEvent("refcanvas:toast", {
          detail: translate("board.exportPngFailed"),
        }));
      }
    };
    const exportPng = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      void exportPngFor(canvas.getObjects());
    };
    const exportPngSelection = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const selection = canvas.getActiveObjects();
      void exportPngFor(selection.length ? selection : canvas.getObjects());
    };
    const removeExport = controller.onDom(window, "refcanvas:export-png", exportPng);
    const removeSelection = controller.onDom(window, "refcanvas:export-png-selection", exportPngSelection);
    return () => {
      removeExport();
      removeSelection();
    };
  }, [board.id, controller]);

  /**
   * 为 GIF 图片对象挂载帧动画：解码后把当前帧画到复用画布，挂到
   * fabric.Image._element（_originalElement 仍是 URL 图片，序列化 src 不变），
   * 保留创建时的显示尺寸；播放状态来自 data.gif（随文档保存恢复）。
   */
  const attachGifAnimation = (
    image: CanvasObjectWithData & FabricImage,
    saved?: Partial<GifState>,
  ) => {
    const canvas = canvasRef.current;
    const objectId = image.data?.objectId;
    if (!canvas || !objectId) return;
    const asset = eventBindingsRef.current.assets.find(
      (item) => item.id === image.data?.assetId,
    );
    if (!asset || asset.kind !== "image" || asset.extension !== "gif") return;
    gifAnimatorsRef.current.get(objectId)?.dispose();
    const displayWidth = Math.max(1, image.width * image.scaleX);
    const displayHeight = Math.max(1, image.height * image.scaleY);
    const animator = new GifAnimator(
      asset.previewUrl,
      (frameCanvas, index) => {
        if (image.canvas !== canvas) return;
        const width = frameCanvas.width || 1;
        const height = frameCanvas.height || 1;
        image.set({
          _element: frameCanvas,
          width,
          height,
          scaleX: displayWidth / width,
          scaleY: displayHeight / height,
          dirty: true,
        });
        image.setCoords();
        canvas.requestRenderAll();
        if (image.data) {
          image.data = {
            ...image.data,
            gif: { ...(image.data.gif ?? DEFAULT_GIF_STATE), frame: index },
          };
        }
      },
      () => {
        // 解码失败：保留 URL 静态首帧（元素不替换）。
      },
    );
    const state = gifStateFromData(saved, 0);
    animator.setRate(state.rate);
    animator.setFrame(state.frame);
    if (state.playing) animator.play();
    else animator.pause();
    gifAnimatorsRef.current.set(objectId, animator);
    void animator.load();
  };

  /** 右键菜单播放/暂停入口：切换 data.gif.playing 并走 object:modified 管线。 */
  const toggleGifPlayback = (target: CanvasObjectWithData) => {
    const canvas = canvasRef.current;
    const animator = target.data?.objectId
      ? gifAnimatorsRef.current.get(target.data.objectId)
      : undefined;
    const next = !target.data?.gif?.playing;
    target.data = {
      ...(target.data ?? {}),
      gif: { ...(target.data?.gif ?? DEFAULT_GIF_STATE), playing: next },
    };
    if (next) animator?.play();
    else animator?.pause();
    if (canvas) {
      canvas.fire("object:modified", { target });
      canvas.requestRenderAll();
    }
    controller.refreshSnapshot();
  };

  const addAsset = async (
    asset: AssetRecord,
    position: { x: number; y: number },
    options: { activate?: boolean } = {},
  ): Promise<FabricObject | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const activate = options.activate ?? true;
    // 创建时自动挂到当前选中对象（若存在）。
    const parent = canvas.getActiveObject() as CanvasObjectWithData | undefined;
    const parentId =
      parent && parent.data?.objectId && !parent.data?.guideAxis
        ? parent.data.objectId
        : undefined;

    // 所有非 generic 类型都有可解码的缩略图（refasset://thumbnail 对
    // 视频 poster 帧 / 3D 渲染 / 字体样张 / 文本卡片 / DCC 图标 / EXR-HDR
    // 转码都会生成真实图）。generic 无 thumbnail 能力，保持格式卡。
    if (asset.kind !== "generic" && asset.linkState === "online") {
      try {
        const loadImage = (url: string) => FabricImage.fromURL(url);
        let loaded: { image: FabricImage; source: "proxy" | "original" };
        let initialProxySize: BoardProxySize | undefined;
        if (asset.kind === "image") {
          initialProxySize = boardProxySizeForPixels(
            Math.max(
              Math.min(asset.width ?? 300, 300),
              Math.min(asset.height ?? 230, 230),
            ) * window.devicePixelRatio,
          );
          // 小图不需要 proxy（proxy 是给大图降内存的）：原图本身就 ≤ proxy
          // 尺寸时直接加载，跳过缩略图生成（sharp worker 冷启动可达数秒）。
          const needsProxy =
            (asset.width ?? 0) > initialProxySize ||
            (asset.height ?? 0) > initialProxySize;
          loaded = asset.extension === "gif" || !needsProxy
            ? { image: await loadImage(asset.previewUrl), source: "original" as const }
            : await loadBoardImageWithFallback(
                boardProxyUrl(asset.thumbnailUrl, initialProxySize),
                asset.previewUrl,
                loadImage,
              );
        } else {
          // 非图片类型：直接用 thumbnailUrl（provider 已生成真实缩略图）。
          // 缩略图可能仍在生成（首次 404）：带 previewRetry nonce 重试，
          // 避免「只有格式卡片、内容永远不显示」。
          loaded = {
            image: await loadThumbnailWithRetry(asset.thumbnailUrl, loadImage),
            source: "original" as const,
          };
        }
        const image = loaded.image;
        const width = image.width || 1;
        const height = image.height || 1;
        const scale = Math.min(300 / width, 230 / height, 1);
        image.set({
          left: position.x,
          top: position.y,
          scaleX: scale,
          scaleY: scale,
          cornerColor: "#3ab28f",
          cornerStrokeColor: "#10241e",
          borderColor: "#3ab28f",
          transparentCorners: false,
          data: {
            type: "asset",
            assetId: asset.id,
            sourceUrl: asset.previewUrl,
            ...(asset.kind === "image" && asset.extension !== "gif" && loaded.source === "proxy"
              ? { boardProxySize: initialProxySize }
              : {}),
            objectId: crypto.randomUUID(),
            name: asset.title,
            ...(parentId ? { parentId } : {}),
            ...(asset.extension === "gif" ? { gif: { ...DEFAULT_GIF_STATE } } : {}),
          },
        });
        canvas.add(image);
        if (activate) canvas.setActiveObject(image);
        if (!bulkMutationRef.current) canvas.requestRenderAll();
        return image;
      } catch {
        // A format that Chromium cannot decode still gets a reference card.
      }
    }

    const card = new Rect({
      width: 220,
      height: 138,
      rx: 10,
      ry: 10,
      fill: "#292e30",
      stroke: "rgba(255,255,255,0.10)",
      strokeWidth: 1,
    });
    const typeLabel = new FabricText(asset.extension.toUpperCase(), {
      left: 18,
      top: 18,
      fontFamily: "Segoe UI",
      fontSize: 13,
      fill: "#73cdb2",
      fontWeight: "600",
    });
    const title = new FabricText(asset.title, {
      left: 18,
      top: 91,
      fontFamily: "Segoe UI",
      fontSize: 14,
      fill: "#edf2ef",
    });
    const group = new Group([card, typeLabel, title], {
      left: position.x,
      top: position.y,
      cornerColor: "#3ab28f",
      borderColor: "#3ab28f",
      transparentCorners: false,
    });
    (group as CanvasObjectWithData).data = {
      type: "asset",
      assetId: asset.id,
      objectId: crypto.randomUUID(),
      name: asset.title,
      ...(asset.kind === "model3d"
        ? {
            modelView: {
              position: [2.8, 2.1, 3.2] as [number, number, number],
              target: [0, 0, 0] as [number, number, number],
            },
          }
        : {}),
    };
    canvas.add(group);
    if (activate) canvas.setActiveObject(group);
    if (!bulkMutationRef.current) canvas.requestRenderAll();
    return group;
  };

  const addDroppedAssets = async (
    assetIds: string[],
    position: { x: number; y: number },
    centered = false,
  ): Promise<number> => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const ids = [...new Set(assetIds)].slice(0, 500);
    const droppedAssets = (
      await Promise.all(
        ids.map(async (id) =>
          eventBindingsRef.current.assets.find((asset) => asset.id === id) ??
          window.refCanvas.library.get(id),
        ),
      )
    ).filter((asset): asset is AssetRecord => Boolean(asset));
    if (!droppedAssets.length) return 0;
    // 导入优化规则：统计超大图（任一边 > 2048px），它们会被 proxy 自动降档
    // 加载（512/1024/2048），不占用全分辨率内存；提示用户已优化。
    const optimizedCount = droppedAssets.filter(
      (asset) =>
        asset.kind === "image" &&
        (asset.width ?? 0) > 2048 &&
        (asset.height ?? 0) > 2048,
    ).length;
    const sizes = droppedAssets.map((asset) => {
      if (asset.kind !== "image" || !asset.width || !asset.height) {
        return { width: 220, height: 138 };
      }
      const scale = Math.min(300 / asset.width, 230 / asset.height, 1);
      return {
        width: asset.width * scale,
        height: asset.height * scale,
      };
    });
    const maxRowWidth = Math.max(
      300,
      ((hostRef.current?.clientWidth ?? 960) - 120) / canvas.getZoom(),
    );
    const positions = calculateCompactLayout(sizes, maxRowWidth, 24);
    const layoutWidth = Math.max(
      ...positions.map((item, index) => item.x + sizes[index].width),
    );
    const layoutHeight = Math.max(
      ...positions.map((item, index) => item.y + sizes[index].height),
    );
    const offsetX = centered ? layoutWidth / 2 : 0;
    const offsetY = centered ? layoutHeight / 2 : 0;
    const added: FabricObject[] = [];
    const previousRenderOnAddRemove = canvas.renderOnAddRemove;
    bulkMutationRef.current = true;
    canvas.renderOnAddRemove = false;
    try {
      for (let index = 0; index < droppedAssets.length; index += 8) {
        const batch = await Promise.all(
          droppedAssets.slice(index, index + 8).map((asset, offset) => {
            const absoluteIndex = index + offset;
            return addAsset(
              asset,
              {
                x: position.x + positions[absoluteIndex].x - offsetX,
                y: position.y + positions[absoluteIndex].y - offsetY,
              },
              { activate: false },
            );
          }),
        );
        added.push(...batch.filter((object): object is FabricObject => Boolean(object)));
      }
    } finally {
      canvas.renderOnAddRemove = previousRenderOnAddRemove;
      bulkMutationRef.current = false;
    }
    if (added.length === 1) {
      canvas.setActiveObject(added[0]);
    } else if (added.length > 1) {
      const selection = createBoardActiveSelection(added, canvas);
      applyBoardControls(selection);
      canvas.setActiveObject(selection);
    }
    canvas.requestRenderAll();
    scheduleSaveRef.current?.();
    const baseNotice = assetIds.length > 500
      ? translate("board.dropLimited").replace("{count}", String(ids.length))
      : translate("board.dropPlaced").replace("{count}", String(added.length));
    showDropNotice(
      optimizedCount > 0
        ? `${baseNotice} ${translate("board.importOptimized").replace("{count}", String(optimizedCount))}`
        : baseNotice,
    );
    return added.length;
  };

  addDroppedAssetsRef.current = addDroppedAssets;

  useEffect(() => {
    const queuedIds = pendingAssetIds ?? [];
    if (!queuedIds.length) {
      pendingBatchKeyRef.current = null;
      return;
    }
    if (readyBoardId !== board.id || !canvasRef.current) return;
    const key = `${board.id}:${queuedIds.join(",")}`;
    if (pendingBatchKeyRef.current === key) return;
    pendingBatchKeyRef.current = key;
    const center = sceneCenter(canvasRef.current);
    void addDroppedAssetsRef.current(queuedIds, center, true)
      .then((added) => {
        if (added > 0) onPendingAssetsConsumed?.(queuedIds);
        else pendingBatchKeyRef.current = null;
      })
      .catch(() => {
        pendingBatchKeyRef.current = null;
      });
  }, [board.id, onPendingAssetsConsumed, pendingAssetIds, readyBoardId]);

  const addText = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = sceneCenter(canvas);
    // 空白内容进入编辑：旧行为预填占位文案，用户必须先全选删掉才能打字。
    // 空内容的 Textbox 一样能进入编辑态（同 Figma）。
    const text = new Textbox("", {
      left: center.x - 70,
      top: center.y - 20,
      width: 180,
      fontFamily: "Segoe UI",
      fontSize: 24,
      fill: "#eef3f0",
      data: { type: "text" },
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    // 光标落在开头，不预选任何字符。
    text.selectionStart = 0;
    text.selectionEnd = 0;
  };

  /**
   * 富文本便签：固定宽度换行、可附加链接与清单。存储为 Textbox，
   * data.note 保存结构化内容（richText/checklist/link/autoWidth）。
   */
  const addNote = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const values = await dialog.requestForm({
      title: translate("board.noteNewTitle"),
      description: translate("board.noteNewDescription"),
      confirmLabel: translate("boards.createConfirm"),
      fields: [
        {
          name: "text",
          label: translate("board.noteContentLabel"),
          type: "textarea",
          rows: 4,
          required: true,
          maxLength: 4_000,
        },
        { name: "link", label: translate("board.noteLinkOptionalLabel"), maxLength: 512 },
        { name: "width", label: translate("board.noteWidthLabel"), initialValue: "240", maxLength: 4 },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const canvas2 = canvasRef.current;
    if (!canvas2) return;
    const center = sceneCenter(canvas2);
    const autoWidth = !values.width;
    const note = new Textbox(values.text, {
      left: center.x - 120,
      top: center.y - 60,
      width: autoWidth ? undefined : Math.max(80, Number(values.width) || 240),
      fontFamily: "Segoe UI",
      fontSize: 18,
      fill: "#eef3f0",
      backgroundColor: "rgba(32,36,38,0.55)",
      padding: 12,
      data: {
        type: "note",
        note: {
          text: values.text,
          richText: values.text,
          checklist: [],
          link: values.link || null,
          autoWidth,
        },
      },
    });
    canvas2.add(note);
    canvas2.setActiveObject(note);
  };

  /** 编辑既有便签的富文本内容。 */
  const editSelectedNote = async () => {
    const canvas = canvasRef.current;
    const active = canvas?.getActiveObject() as CanvasObjectWithData | undefined;
    if (!canvas || !active?.data?.note) return;
    const note = active.data.note as {
      text: string;
      richText: string;
      checklist: Array<{ text: string; checked: boolean }>;
      link: string | null;
    };
    const values = await dialog.requestForm({
      title: translate("board.noteEditTitle"),
      confirmLabel: translate("collections.save"),
      fields: [
        {
          name: "text",
          label: translate("board.noteEditContentLabel"),
          type: "textarea",
          rows: 4,
          initialValue: note.text,
          required: true,
          maxLength: 4_000,
        },
        { name: "link", label: translate("board.noteLinkLabel"), initialValue: note.link ?? "", maxLength: 512 },
        { name: "checklist", label: translate("board.noteChecklistLabel"), type: "textarea", rows: 4, initialValue: note.checklist.map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`).join("\n"), maxLength: 4_000 },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const checklist = values.checklist
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const checked = /^\[x\]/i.test(line);
        return {
          checked,
          text: line.replace(/^\[[ xX]\]\s*/, ""),
        };
      });
    active.set({
      text: values.text,
      data: {
        ...(active.data ?? {}),
        note: {
          ...note,
          text: values.text,
          richText: values.text,
          checklist,
          link: values.link || null,
        },
      },
    });
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: active });
  };

  /** 选中对象时创建清单便签（快速起点）。 */
  const addChecklistNote = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const values = await dialog.requestForm({
      title: translate("board.checklistNewTitle"),
      description: translate("board.checklistNewDescription"),
      confirmLabel: translate("boards.createConfirm"),
      fields: [
        {
          name: "items",
          label: translate("board.checklistItemsLabel"),
          type: "textarea",
          rows: 5,
          required: true,
          maxLength: 4_000,
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const canvas2 = canvasRef.current;
    if (!canvas2) return;
    const center = sceneCenter(canvas2);
    const checklist = values.items
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        checked: /^\[x\]/i.test(line),
        text: line.replace(/^\[[ xX]\]\s*/, ""),
      }));
    const text = checklist.map((item) => `${item.checked ? "☑" : "☐"} ${item.text}`).join("\n");
    const note = new Textbox(text, {
      left: center.x - 120,
      top: center.y - 60,
      width: 220,
      fontFamily: "Segoe UI",
      fontSize: 16,
      fill: "#eef3f0",
      backgroundColor: "rgba(32,36,38,0.55)",
      padding: 12,
      data: {
        type: "note",
        note: { text, richText: text, checklist, link: null, autoWidth: false },
      },
    });
    canvas2.add(note);
    canvas2.setActiveObject(note);
  };

  const addRectangle = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = sceneCenter(canvas);
    const rectangle = new Rect({
      left: center.x - 100,
      top: center.y - 65,
      width: 200,
      height: 130,
      rx: 8,
      ry: 8,
      fill: "rgba(242,184,75,0.08)",
      stroke: "#f2b84b",
      strokeWidth: 3,
      data: { type: "rectangle" },
    });
    canvas.add(rectangle);
    canvas.setActiveObject(rectangle);
  };

  const addArrow = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = sceneCenter(canvas);
    const line = new Line([0, 0, 150, 0], {
      stroke: "#f2b84b",
      strokeWidth: 4,
    });
    const head = new Triangle({
      left: 150,
      top: 0,
      width: 18,
      height: 22,
      fill: "#f2b84b",
      angle: 90,
      originX: "center",
      originY: "center",
    });
    const arrow = new Group([line, head], {
      left: center.x - 75,
      top: center.y,
    });
    (arrow as CanvasObjectWithData).data = { type: "arrow" };
    canvas.add(arrow);
    canvas.setActiveObject(arrow);
  };

  const addGuide = (axis: "x" | "y") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = sceneCenter(canvas);
    const guide =
      axis === "x"
        ? new Line([center.x, -5000, center.x, 5000], {
            stroke: "#58a6c4",
            strokeWidth: 1,
            strokeDashArray: [6, 5],
            lockMovementY: true,
          })
        : new Line([-5000, center.y, 5000, center.y], {
            stroke: "#58a6c4",
            strokeWidth: 1,
            strokeDashArray: [6, 5],
            lockMovementX: true,
          });
    guide.set({
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      hasControls: false,
    });
    (guide as CanvasObjectWithData).data = {
      type: "guide",
      guideAxis: axis,
      name: axis === "x" ? translate("board.guideVertical") : translate("board.guideHorizontal"),
    };
    canvas.add(guide);
    canvas.setActiveObject(guide);
    canvas.requestRenderAll();
  };

  const { selectionCount, capabilities } = boardSnapshot;
  const hasSelection = capabilities.hasSelection;
  const hasImageSelection = capabilities.hasImage;
  const activeHasComment = capabilities.activeHasComment;
  const hasBoardObjects = boardStructure.boardObjectCount > 0;
  const boardCommands: BoardCommand[] = buildBoardCommands({
    selectionCount,
    hasSelection,
    hasImageSelection,
    activeHasComment,
    hasBoardObjects,
    boards,
    board,
    boardSnapshot,
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
    moveSelectionLayer: moveSelectionOneLayer,
    transformSelection,
    alignSelection,
    distributeSelection,
    arrangeCompact,
    arrangeBy,
    normalizeSize,
    resetSelectionTransform,
    toggleLockSelection,
    groupSelection,
    parentSelection,
    unparentSelection,
    ungroupSelection,
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
    editBoardAppearance,    capabilities,
    boardClipboard: hasBoardClipboard() ? CLIPBOARD_PRESENT : [],
    uniformArea,
    uniformScale,
    setWindowMode,
    createBoard,
    onRenameBoard,
    onDeleteBoard,
  });
  const saveShortcutBindings = (next: BoardShortcutBindings) => {
    setShortcutBindings(next);
    void window.refCanvas.system.setBoardShortcuts(next);
  };


  const selectedHasComment = capabilities.activeHasComment;

  const handleToolbarCommand = (command: BoardToolbarCommand) => {
    switch (command) {
      case "importFiles": void importFilesFromDialog(); break;
      case "select": setTool("select"); break;
      case "addText": addText(); break;
      case "addNote": void addNote(); break;
      case "addChecklist": void addChecklistNote(); break;
      case "addArrow": addArrow(); break;
      case "addRectangle": addRectangle(); break;
      case "addVerticalGuide": addGuide("x"); break;
      case "addHorizontalGuide": addGuide("y"); break;
      case "toggleDrawing": setTool((current) => toggleBoardDrawingTool(current, lastDrawingTool)); break;
      case "toggleDrawingPanel": setDrawingPanelOpen((value) => !value); break;
      case "toggleArrangePanel": setArrangePanelOpen((value) => !value); break;
      case "toggleEraser": toggleEraser(); break;
      case "undoStroke": undoLastStroke(); break;
      case "moveBottom": moveSelection(false); break;
      case "moveTop": moveSelection(true); break;
      case "moveUp": moveSelectionOneLayer("move-up"); break;
      case "moveDown": moveSelectionOneLayer("move-down"); break;
      case "rotate": transformSelection("rotate"); break;
      case "flipX": transformSelection("flipX"); break;
      case "flipY": transformSelection("flipY"); break;
      case "alignLeft": alignSelection("left"); break;
      case "alignCenterX": alignSelection("centerX"); break;
      case "alignRight": alignSelection("right"); break;
      case "alignTop": alignSelection("top"); break;
      case "alignCenterY": alignSelection("centerY"); break;
      case "alignBottom": alignSelection("bottom"); break;
      case "distributeX": distributeSelection("x"); break;
      case "distributeY": distributeSelection("y"); break;
      case "arrangeCompact": arrangeCompact(); break;
      case "normalizeWidth": normalizeSize("width"); break;
      case "normalizeHeight": normalizeSize("height"); break;
      case "uniformArea": uniformArea(); break;
      case "uniformScale": uniformScale(); break;
      case "resetTransform": resetSelectionTransform(); break;
      case "toggleLock": toggleLockSelection(); break;
      case "group": groupSelection(); break;
      case "parent": parentSelection(); break;
      case "unparent": unparentSelection(); break;
      case "ungroup": ungroupSelection(); break;
      case "crop": {
        const id = boardSnapshot.activeObjectId;
        const active = id ? objectById(id) : null;
        if (active instanceof FabricImage) openCropDialog(active);
        break;
      }
      case "resetCrop": resetSelectionCrop(); break;
      case "setOpacity": void setSelectionOpacity(); break;
      case "duplicate": void duplicateSelection(); break;
      case "editContent": void editSelectedNote(); break;
      case "editComment": void editObjectComment(); break;
      case "delete": deleteSelection(); break;
      case "undo": restoreHistory(-1); break;
      case "redo": restoreHistory(1); break;
      case "fitAll": fitObjects(false); break;
      case "toggleFocus": toggleObjectFocus(); break;
      case "fitSelection": fitObjects(true); break;
      case "exportPng": window.dispatchEvent(new Event("refcanvas:export-png-selection")); break;
      case "toggleInspector": setInspectorOpen((value) => !value); break;
      case "toggleLayers": setLayersOpen((value) => !value); break;
      case "toggleGrid": updateAppearance({ ...runtime.appearance, gridVisible: !runtime.appearance.gridVisible }); break;
      case "editAppearance": editBoardAppearance(); break;
      case "toggleCanvasLock": toggleCanvasLock(); break;
      case "toggleCanvasGrayscale": void toggleCanvasGrayscale(); break;
      case "cycleGridStyle": void cycleGridStyle(); break;
      case "zoom100": void setZoom100(); break;
      case "sampleColor": void sampleColor(); break;
      case "openCommandPalette": openCommandPalette(); break;
      case "toggleToolbarCollapsed": {
        const collapsed = !toolbarCollapsed;
        setToolbarCollapsed(collapsed);
        // 收起态不渲染 drawing-settings / arrange-settings 触发按钮，
        // 已开着的浮层必须一并关掉，否则会悬空在画布上无法再开合。
        if (collapsed) {
          setDrawingPanelOpen(false);
          setArrangePanelOpen(false);
        }
        break;
      }
    }
  };
  return (
    <section
      className="board-panel"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (!canvasRef.current) return;
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        const point = canvasRef.current.getScenePoint(event.nativeEvent);
        void importDroppedFiles(files, { x: point.x, y: point.y });
      }}
    >
      {previewAsset && (
        previewAsset.extension === "gif" || previewAsset.extension === "apng" ? (
          <div
            className="model-board-overlay"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setPreviewAsset(null);
            }}
          >
            <PreviewTransportProvider>
              <BoardGifPreviewDialog asset={previewAsset} />
            </PreviewTransportProvider>
          </div>
        ) : (
          <div
            className="model-board-overlay"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setPreviewAsset(null);
            }}
          >
            <div className="model-board-dialog">
              <header>
                <strong>{previewAsset.title}</strong>
                <button
                  className="icon-button"
                  onClick={() => setPreviewAsset(null)}
                  aria-label={translate("board.closePreview")}
                >
                  ×
                </button>
              </header>
              <AssetPreview asset={previewAsset} />
            </div>
          </div>
        )
      )}
      {modelAsset && (
        <div className="model-board-overlay">
          <div className="model-board-dialog">
            <header>
              <strong>{modelAsset.title}</strong>
              <button
                className="icon-button"
                onClick={() => setModelAsset(null)}
                aria-label={translate("board.close3DPreview")}
              >
                ×
              </button>
            </header>
            <ModelPreview
              asset={modelAsset}
              initialView={modelView}
              onCameraChange={(view) => {
                // OrbitControls 相机状态写回目标卡片 data.modelView，
                // 复用 object:modified 管线进入撤销与持久化。
                const canvas = canvasRef.current;
                const card = canvas
                  ? (
                      canvas.getObjects() as CanvasObjectWithData[]
                    ).find(
                      (object) =>
                        object.data?.type === "asset" &&
                        object.data.assetId === modelAsset.id,
                    )
                  : undefined;
                if (!canvas || !card) return;
                card.data = { ...card.data, modelView: view };
                canvas.fire("object:modified", { target: card });
                canvas.requestRenderAll();
                setModelView(view);
              }}
            />
          </div>
        </div>
      )}
      {dropNotice && (
        <div className="board-drop-notice" role="status">
          {dropNotice}
        </div>
      )}
      {cropTarget && (
        <CropDialog
          title={cropTarget.title}
          src={cropTarget.src}
          initial={cropTarget.initial}
          onApply={applyCrop}
          onClose={() => setCropTarget(null)}
        />
      )}
      {shortcutSettingsOpen && (
        <BoardShortcutSettings
          bindings={shortcutBindings}
          onChange={saveShortcutBindings}
          onClose={() => setShortcutSettingsOpen(false)}
        />
      )}
      {commandPaletteOpen && (
        <BoardCommandPalette
          commands={boardCommands}
          commandShortcut={shortcutBindings.commandPalette}
          onClose={() => setCommandPaletteOpen(false)}
          onOpenShortcutSettings={() => setShortcutSettingsOpen(true)}
        />
      )}
      <header className="board-header">
        <div className="board-title-group">
          <span className="eyebrow">{translate("board.currentBoard")}</span>
          <div className="board-switcher">
            <SelectMenu
              className="board-switcher-menu"
              value={board.id}
              ariaLabel={translate("board.switchBoard")}
              options={boards.map((item) => ({ value: item.id, label: item.title }))}
              onValueChange={(value) => void switchBoard(value)}
            />
            <button onClick={() => void createBoard()} aria-label={translate("boards.new")}>
              <Plus size={14} />
            </button>
            <button
              onClick={() => void onRenameBoard(board)}
              aria-label={translate("board.renameBoard")}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => void onDeleteBoard(board)}
              aria-label={translate("board.deleteBoard")}
              disabled={boards.length <= 1}
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={openCommandPalette}
              aria-label={translate("board.openCommandPalette")}
              data-shortcut={shortcutBindings.commandPalette}
            >
              <Search size={14} />
            </button>
          </div>
        </div>
        <span className={`save-state ${boardSnapshot.saved ? "saved" : ""}`}>
          <span />
          {boardSnapshot.saved ? translate("board.saved") : translate("board.saving")}
        </span>
      </header>

      <div
        className={`board-host ${appearance.gridVisible ? "" : "grid-hidden"} ${
          runtime.canvasMode.grayscale ? "board-grayscale" : ""
        } grid-style-${runtime.canvasMode.gridStyle} ${
          colorSampling ? "color-sampling" : ""
        }`}
        ref={hostRef}
        onPointerDownCapture={(event) => void sampleCanvasPixel(event)}
        style={
          {
            "--board-background": appearance.backgroundColor,
            "--board-grid-size": `${appearance.gridSize}px`,
          } as CSSProperties
        }
      >
        <canvas ref={canvasElementRef} />
        {!hasBoardObjects && !focusMode && (
          <div className="board-empty-state">
            <p>{translate("board.emptyHint")}</p>
            <button onClick={() => void importFilesFromDialog()}>
              {translate("board.importFiles")}
            </button>
          </div>
        )}
        <BoardToolbar
          state={{
            tool,
            drawingToolActive: isBoardDrawingTool(tool),
            drawingPanelOpen,
            arrangePanelOpen,
            selectedHasComment,
            focused: Boolean(focusedObjectId),
            layersOpen,
            inspectorOpen,
            gridVisible: appearance.gridVisible,
            canvasLocked,
            canvasGrayscale: runtime.canvasMode.grayscale,
            hasSelection,
            selectionHasNote: capabilities.hasNote,
            selectionCount,
            hasBoardObjects,
            toolbarCollapsed,
          }}
          onCommand={handleToolbarCommand}
          shortcuts={shortcutBindings}
          toolbarRef={toolbarRef}
        />
        {drawingPanelOpen && (
          <BoardDrawingPanel
            tool={tool}
            drawingStyle={drawingStyle}
            setTool={setTool}
            setLastDrawingTool={setLastDrawingTool}
            setDrawingStyle={setDrawingStyle}
            onClose={() => setDrawingPanelOpen(false)}
          />
        )}
        <BoardArrangePanel
          open={arrangePanelOpen}
          onClose={() => setArrangePanelOpen(false)}
          onApply={(options) => {
            arrangeBy(options.key, {
              reverse: options.reverse,
              gap: options.gap,
              align: options.align,
            });
          }}
        />
        <BoardSideDock
          top={cardTop}
          onToggleCollapsed={(id) =>
            setDockCollapsed((current) => ({
              ...current,
              [id]: !current[id],
            }))
          }
          onClose={(id) => {
            if (id === "layers") setLayersOpen(false);
            else if (id === "inspector") setInspectorOpen(false);
            else if (id === "color") setColorSample(null);
            else if (id === "appearance") setAppearancePanelOpen(false);
          }}
          panels={[
            ...(layersOpen
              ? [{
                  id: "layers",
                  collapsed: Boolean(dockCollapsed.layers),
                  title: translate("board.layersTitle"),
                  children: (
                    <BoardLayerPanel
                      rows={boardStructure.layers}
                      onCommand={(command, id) => { controller.command(command, id); }}
                      onReparent={(id, parentId) => {
                        const canvas = canvasRef.current;
                        const object = canvas ? hierarchyObjects(canvas).find((item) => item.data?.objectId === id) : undefined;
                        if (object) setHierarchyParent(object, parentId ?? undefined);
                      }}
                      onReorder={(id, targetId, before) => {
                        const canvas = canvasRef.current;
                        if (!canvas) return;
                        const objects = hierarchyObjects(canvas);
                        const object = objects.find((item) => item.data?.objectId === id);
                        const target = objects.find((item) => item.data?.objectId === targetId);
                        if (object && target) reorderHierarchyObject(object, target, before);
                      }}
                      onRename={(row) => {
                        void dialog.requestForm({
                          title: translate("board.renameLayer"),
                          confirmLabel: translate("board.saveName"),
                          fields: [{ name: "name", label: translate("board.layerName"), initialValue: row.name, required: true, maxLength: 120 }],
                          onSubmit: ({ name }) => { controller.rename(row.id, name); },
                        });
                      }}
                      onComment={(id) => {
                        const canvas = canvasRef.current;
                        const object = canvas ? hierarchyObjects(canvas).find((item) => item.data?.objectId === id) : undefined;
                        if (object) void editObjectComment(object);
                      }}
                    />
                  ),
                }]
              : []),
            ...(inspectorOpen
              ? [{
                  id: "inspector",
                  collapsed: Boolean(dockCollapsed.inspector),
                  title: translate("board.inspectorTitle"),
                  children: (
                    <BoardInspector
                      selectionCount={boardSnapshot.selectionCount}
                      name={boardSnapshot.inspector?.name ?? null}
                      metrics={boardSnapshot.inspector?.metrics ?? null}
                      onCommit={(key, value) => { controller.updateInspector(key, value); }}
                      sourceSize={(() => {
                        const assetId = boardSnapshot.inspector?.assetId;
                        if (!assetId) return null;
                        const asset = boardAssets.find((item) => item.id === assetId);
                        return asset && (asset.width ?? 0) > 0 && (asset.height ?? 0) > 0
                          ? { width: asset.width as number, height: asset.height as number }
                          : null;
                      })()}
                    />
                  ),
                }]
              : []),
            ...(colorSample
              ? [{
                  id: "color",
                  collapsed: Boolean(dockCollapsed.color),
                  title: translate("board.colorSampleTitle"),
                  children: <BoardColorSampleBody sample={colorSample} />,
                }]
              : []),
            ...(appearancePanelOpen
              ? [{
                  id: "appearance",
                  collapsed: Boolean(dockCollapsed.appearance),
                  title: translate("board.appearanceTitle"),
                  children: (
                    <BoardAppearancePanel
                      appearance={runtime.appearance}
                      onPreview={(backgroundColor) => {
                        // 直接改宿主 CSS 变量：走 updateAppearance 会每帧重渲染整个
                        // BoardCanvas，拖色相条时明显卡顿；且预览不该落盘。
                        hostRef.current?.style.setProperty("--board-background", backgroundColor);
                      }}
                      onCancel={() => {
                        hostRef.current?.style.setProperty(
                          "--board-background",
                          runtime.appearance.backgroundColor,
                        );
                        setAppearancePanelOpen(false);
                      }}
                      onApply={(next) => {
                        updateAppearance({ ...runtime.appearance, ...next });
                        setAppearancePanelOpen(false);
                      }}
                    />
                  ),
                }]
              : []),
          ]}
        />
        <div className="zoom-control">
          <button
            onClick={() => zoomByFactor(1 / 1.25)}
            aria-label={translate("board.zoomOut")}
          >
            <Minus size={14} />
          </button>
          <button
            className="zoom-percent"
            onClick={() => void setZoom100()}
            aria-label={translate("board.zoom100")}
          >
            {boardSnapshot.zoom}%
          </button>
          <button
            onClick={() => zoomByFactor(1.25)}
            aria-label={translate("board.zoomIn")}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => fitObjects(false)}
            aria-label={translate("board.zoomFit")}
          >
            <Maximize size={14} />
          </button>
          <button
            className={pixelView ? "active" : undefined}
            onClick={togglePixelView}
            aria-label={translate("board.pixelView")}
            aria-pressed={pixelView}
          >
            <Grid3X3 size={14} />
          </button>
        </div>
        {hudMessage && (
          <div className="board-hud" role="status" aria-live="polite">
            {hudMessage}
          </div>
        )}
        {selectedHasComment && boardSnapshot.activeComment && (
          <BoardObjectComment
            name={boardSnapshot.activeObjectName ?? translate("board.objectDefaultName")}
            comment={boardSnapshot.activeComment}
            onEdit={() => {
              const id = boardSnapshot.activeObjectId;
              const object = id ? objectById(id) : undefined;
              if (object) void editObjectComment(object);
            }}
          />
        )}
        {snapIndicator && snapIndicator.visible && (
          <div
            className={`board-snap-line snap-${snapIndicator.axis}`}
            style={
              snapIndicator.axis === "x"
                ? { left: snapIndicator.value }
                : { top: snapIndicator.value }
            }
            aria-hidden="true"
          />
        )}
        {boardContextMenu && (
          <BoardContextMenu
            menu={boardContextMenu}
            locateEnabled={Boolean(eventBindingsRef.current.onLocateAsset)}
            gridVisible={appearance.gridVisible}
            onClose={() => setBoardContextMenu(null)}
            actions={{
              align: (mode) => alignSelection(mode),
              distribute: (axis) => distributeSelection(axis),
              arrangeCompact,
              normalizeWidth: () => normalizeSize("width"),
              group: groupSelection,
              focus: (id) => {
                const object = objectById(id);
                if (object) focusBoardObject(object);
              },
              crop: (id) => {
                const object = objectById(id);
                if (object instanceof FabricImage) openCropDialog(object);
              },
              setOpacity: () => void setSelectionOpacity(),
              toggleLock: toggleLockSelection,
              duplicate: () => void duplicateSelection(),
              remove: deleteSelection,
              toggleGif: (id) => {
                const object = objectById(id);
                if (object) toggleGifPlayback(object);
              },
              locate: (assetId) => {
                void window.refCanvas.library
                  .get(assetId)
                  .then(async (loaded) => {
                    if (!loaded) {
                      showDropNotice(translate("board.locateAssetMissing"));
                      return;
                    }
                    await eventBindingsRef.current.onLocateAsset?.(loaded);
                  })
                  .catch(() => showDropNotice(translate("board.locateFailed")));
              },
              relink: (assetId) => void relinkBoardReference(assetId),
              paste: () => {
                if (hasBoardClipboard()) void pasteSelection();
                else void pasteSystemClipboard();
              },
              fitAll: () => fitObjects(false),
              toggleGrid: () =>
                updateAppearance({
                  ...runtime.appearance,
                  gridVisible: !runtime.appearance.gridVisible,
                }),
              editAppearance: () => void editBoardAppearance(),
              openCommandPalette,
            }}
          />
        )}
      </div>
    </section>
  );
}
