import { Grid2X2, RotateCw } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { translate } from "../app/i18n";

export const MIN_IMAGE_ZOOM = 0.1;
export const MAX_IMAGE_ZOOM = 8;

/**
 * 缩放上限：普通查看 8 倍，但必须够到「1 像素 = 8 屏幕像素」。
 * 大图适配后可能已缩到 1:8，固定 8 倍上限永远看不到真实像素。
 */
export function maxZoomForPixelRatio(nativeZoom: number): number {
  if (!Number.isFinite(nativeZoom) || nativeZoom <= 0) return MAX_IMAGE_ZOOM;
  return Math.max(MAX_IMAGE_ZOOM, nativeZoom * 8);
}

interface Point {
  x: number;
  y: number;
}

export interface ImageViewportRenderState {
  style: CSSProperties;
  panning: boolean;
  /** 当前位移/旋转/缩放，供子元素做坐标反算（如取色）。 */
  transform: { panX: number; panY: number; rotateDeg: number; scale: number };
}

interface ImagePreviewViewportProps {
  assetKey: string;
  checkerBackground: string;
  children(state: ImageViewportRenderState): ReactNode;
  toolbarEnd?: ReactNode;
  interactionDisabled?: boolean;
  canvasBackground?: string;
  controlsTarget?: HTMLElement | null;
  /**
   * 当前 zoom 值对应 1:1 像素时的倍数（源图尺寸 / 适配尺寸）。
   * 缺省时按「适配尺寸 = 源图尺寸」处理。
   */
  nativeZoom?: number;
}

export function clampImageZoom(value: number, max = MAX_IMAGE_ZOOM): number {
  const upper = Number.isFinite(max) && max > 0 ? max : MAX_IMAGE_ZOOM;
  return Math.min(upper, Math.max(MIN_IMAGE_ZOOM, value));
}

/** Keep the content point under the pointer stationary while zoom changes. */
export function zoomPanAtPoint(
  pan: Point,
  pointerFromCenter: Point,
  previousZoom: number,
  nextZoom: number,
): Point {
  const ratio = nextZoom / previousZoom;
  return {
    x: pointerFromCenter.x - (pointerFromCenter.x - pan.x) * ratio,
    y: pointerFromCenter.y - (pointerFromCenter.y - pan.y) * ratio,
  };
}

export function ImagePreviewViewport({
  assetKey,
  checkerBackground,
  children,
  toolbarEnd,
  interactionDisabled = false,
  canvasBackground = "var(--preview-canvas, #0F1119)",
  controlsTarget,
  nativeZoom = 1,
}: ImagePreviewViewportProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    start: Point;
    pan: Point;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [showChecker, setShowChecker] = useState(false);
  const [panning, setPanning] = useState(false);

  const maxZoom = useMemo(() => maxZoomForPixelRatio(nativeZoom), [nativeZoom]);

  const fitView = useCallback(() => {
    setFit(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    fitView();
    setRotation(0);
    setShowChecker(false);
  }, [assetKey, fitView]);

  useEffect(() => {
    const onFit = () => fitView();
    window.addEventListener("refcanvas:preview-fit", onFit);
    return () => window.removeEventListener("refcanvas:preview-fit", onFit);
  }, [fitView]);

  const applyZoom = useCallback(
    (nextValue: number, pointer?: Point) => {
      const nextZoom = clampImageZoom(nextValue, maxZoom);
      setFit(false);
      setZoom((previousZoom) => {
        if (pointer) {
          setPan((currentPan) =>
            zoomPanAtPoint(currentPan, pointer, previousZoom, nextZoom),
          );
        } else if (nextZoom <= 1) {
          setPan({ x: 0, y: 0 });
        }
        return nextZoom;
      });
    },
    [maxZoom],
  );

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (interactionDisabled) return;
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointer = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
    const normalizedDelta = Math.max(-120, Math.min(120, event.deltaY));
    const factor = Math.exp(-normalizedDelta * 0.0018);
    applyZoom(zoom * factor, pointer);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionDisabled || event.button !== 0 || (fit && zoom <= 1)) return;
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.pan.x + event.clientX - drag.start.x,
      y: drag.pan.y + event.clientY - drag.start.y,
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
  };

  const contentStyle = useMemo<CSSProperties>(() => {
    // 自动像素级：显示比例到 1:1 及以上就关掉平滑。
    // 不需要开关 —— 放大到那个点，插值就只会把像素糊掉。
    // zoom 是相对适配尺寸的倍数，nativeZoom 是 1:1 处的倍数。
    const pixelView = zoom >= nativeZoom;
    return {
      transform: `translate3d(${pan.x}px, ${pan.y}px, 0) rotate(${rotation}deg) scale(${zoom})`,
      transformOrigin: "center center",
      transitionDuration: panning ? "0ms" : "90ms",
      imageRendering: pixelView ? "pixelated" : "auto",
    };
  }, [pan.x, pan.y, panning, rotation, zoom, nativeZoom]);

  const toolbar = (
    <div className="image-preview-toolbar">
      <div className="image-preview-toolbar-start">
        {!controlsTarget && <button
          type="button"
          className={`preview-tool-label image-preview-fit-button${fit ? " active" : ""}`}
          aria-label={translate("imageReview.fit")}
          onClick={fitView}
        >Fit</button>}
        <button
          type="button"
          className="mini-icon-button"
          aria-label={translate("imageReview.rotate")}
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          <RotateCw size={15} />
        </button>
        <button
          type="button"
          className={`mini-icon-button${showChecker ? " active" : ""}`}
          aria-label={translate("imageReview.checker")}
          aria-pressed={showChecker}
          onClick={() => setShowChecker((value) => !value)}
        >
          <Grid2X2 size={15} />
        </button>
      </div>
      {toolbarEnd && <div className="image-preview-toolbar-end">{toolbarEnd}</div>}
    </div>
  );

  return (
    <div className="image-preview-viewport">
      <div
        ref={stageRef}
        className={`image-preview-viewport-stage${panning ? " is-panning" : ""}`}
        style={{ background: showChecker ? checkerBackground : canvasBackground }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={fitView}
      >
        {children({
          style: contentStyle,
          panning,
          transform: { panX: pan.x, panY: pan.y, rotateDeg: rotation, scale: zoom },
        })}
      </div>
      {controlsTarget ? createPortal(toolbar, controlsTarget) : toolbar}
    </div>
  );
}
