import { RotateCcw, X } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { translate } from "../app/i18n";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropDialogProps {
  title: string;
  src: string;
  initial: CropRect;
  onApply(rect: CropRect): void;
  onClose(): void;
}

type DragState = {
  mode: "draw" | "move" | "resize";
  handle: string;
  startX: number;
  startY: number;
  initial: CropRect;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export function CropDialog({
  title,
  src,
  initial,
  onApply,
  onClose,
}: CropDialogProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [rect, setRect] = useState(initial);

  const point = (event: ReactPointerEvent): [number, number] => {
    const bounds = hostRef.current!.getBoundingClientRect();
    return [
      clamp((event.clientX - bounds.left) / bounds.width),
      clamp((event.clientY - bounds.top) / bounds.height),
    ];
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const [x, y] = point(event);
    const target = event.target as HTMLElement;
    const handle = target.dataset.handle ?? "";
    const mode = handle
      ? "resize"
      : target.closest(".crop-selection")
        ? "move"
        : "draw";
    dragRef.current = {
      mode,
      handle,
      startX: x,
      startY: y,
      initial: rect,
    };
    if (mode === "draw") {
      setRect({ x, y, width: 0.05, height: 0.05 });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [x, y] = point(event);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.mode === "draw") {
      setRect({
        x: Math.min(drag.startX, x),
        y: Math.min(drag.startY, y),
        width: Math.max(0.05, Math.abs(x - drag.startX)),
        height: Math.max(0.05, Math.abs(y - drag.startY)),
      });
      return;
    }
    if (drag.mode === "move") {
      setRect({
        ...drag.initial,
        x: clamp(
          drag.initial.x + dx,
          0,
          1 - drag.initial.width,
        ),
        y: clamp(
          drag.initial.y + dy,
          0,
          1 - drag.initial.height,
        ),
      });
      return;
    }
    let left = drag.initial.x;
    let top = drag.initial.y;
    let right = drag.initial.x + drag.initial.width;
    let bottom = drag.initial.y + drag.initial.height;
    if (drag.handle.includes("w")) left = clamp(x, 0, right - 0.05);
    if (drag.handle.includes("e")) right = clamp(x, left + 0.05, 1);
    if (drag.handle.includes("n")) top = clamp(y, 0, bottom - 0.05);
    if (drag.handle.includes("s")) bottom = clamp(y, top + 0.05, 1);
    setRect({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  };

  return (
    <div className="modal-backdrop crop-backdrop" onMouseDown={onClose}>
      <section
        className="modal-panel crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={translate("crop.named").replace("{title}", title)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{translate("crop.title")}</h2>
            <p>{title}</p>
          </div>
          <button className="icon-button" aria-label={translate("preview.close")} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="crop-workspace">
          <div
            className="crop-image-host"
            ref={hostRef}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => {
              dragRef.current = null;
            }}
          >
            <img src={src} alt="" draggable={false} />
            <div
              className="crop-selection"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            >
              {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) => (
                <span
                  className={`crop-handle handle-${handle}`}
                  data-handle={handle}
                  key={handle}
                />
              ))}
            </div>
          </div>
        </div>
        <footer className="crop-footer">
          <button
            className="secondary-button"
            onClick={() => setRect({ x: 0, y: 0, width: 1, height: 1 })}
          >
            <RotateCcw size={15} />
            {translate("crop.reset")}
          </button>
          <span>
            {Math.round(rect.width * 100)}% × {Math.round(rect.height * 100)}%
          </span>
          <button className="secondary-button" onClick={onClose}>
            {translate("crop.cancel")}
          </button>
          <button className="primary-button" onClick={() => onApply(rect)}>
            {translate("crop.apply")}
          </button>
        </footer>
      </section>
    </div>
  );
}
