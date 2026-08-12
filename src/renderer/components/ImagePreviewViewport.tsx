import { Grid2X2, Maximize2, RotateCw } from "lucide-react";
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
import { SelectMenu, type SelectMenuOption } from "./SelectMenu";

export const MIN_IMAGE_ZOOM = 0.1;
export const MAX_IMAGE_ZOOM = 8;

interface Point {
  x: number;
  y: number;
}

export interface ImageViewportRenderState {
  style: CSSProperties;
  panning: boolean;
}

interface ImagePreviewViewportProps {
  assetKey: string;
  checkerBackground: string;
  children(state: ImageViewportRenderState): ReactNode;
  toolbarEnd?: ReactNode;
  interactionDisabled?: boolean;
  canvasBackground?: string;
  controlsTarget?: HTMLElement | null;
}

export function clampImageZoom(value: number): number {
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, value));
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

const fixedZoomOptions: readonly SelectMenuOption<string>[] = [
  { value: "fit", label: translate("imageReview.fitShort") },
  { value: "0.25", label: "25%" },
  { value: "0.5", label: "50%" },
  { value: "1", label: "100%" },
  { value: "2", label: "200%" },
];

export function ImagePreviewViewport({
  assetKey,
  checkerBackground,
  children,
  toolbarEnd,
  interactionDisabled = false,
  canvasBackground = "var(--found-canvas, #0F1119)",
  controlsTarget,
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

  const applyZoom = useCallback((nextValue: number, pointer?: Point) => {
    const nextZoom = clampImageZoom(nextValue);
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
  }, []);

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

  const zoomValue = fit ? "fit" : String(zoom);
  const zoomOptions = useMemo<readonly SelectMenuOption<string>[]>(() => {
    if (fit || fixedZoomOptions.some((option) => Number(option.value) === zoom)) {
      return fixedZoomOptions;
    }
    return [
      { value: zoomValue, label: `${Math.round(zoom * 100)}%` },
      ...fixedZoomOptions,
    ];
  }, [fit, zoom, zoomValue]);

  const contentStyle = useMemo<CSSProperties>(() => ({
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) rotate(${rotation}deg) scale(${zoom})`,
    transformOrigin: "center center",
    transitionDuration: panning ? "0ms" : "90ms",
  }), [pan.x, pan.y, panning, rotation, zoom]);

  const toolbar = (
    <div className="image-preview-toolbar">
      <div className="image-preview-toolbar-start">
        <SelectMenu
          value={zoomValue}
          options={zoomOptions}
          ariaLabel={translate("imageReview.fit")}
          className="image-preview-zoom-menu"
          onValueChange={(value) => {
            if (value === "fit") {
              fitView();
              return;
            }
            applyZoom(Number(value));
          }}
        />
        <button
          type="button"
          className="mini-icon-button"
          title={translate("imageReview.fit")}
          aria-label={translate("imageReview.fit")}
          onClick={fitView}
        >
          <Maximize2 size={15} />
        </button>
        <button
          type="button"
          className="mini-icon-button"
          title={translate("imageReview.rotate")}
          aria-label={translate("imageReview.rotate")}
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          <RotateCw size={15} />
        </button>
        <button
          type="button"
          className={`mini-icon-button${showChecker ? " active" : ""}`}
          title={translate("imageReview.checker")}
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
        {children({ style: contentStyle, panning })}
      </div>
      {controlsTarget ? createPortal(toolbar, controlsTarget) : toolbar}
    </div>
  );
}
