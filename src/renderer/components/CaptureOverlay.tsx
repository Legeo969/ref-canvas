import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CaptureSource } from "../../shared/contracts";

interface CaptureOverlayProps {
  source: CaptureSource;
  onComplete(dataUrl: string): Promise<void>;
  onCancel(): void;
}

interface Selection {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function CaptureOverlay({
  source,
  onComplete,
  onCancel,
}: CaptureOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter" && selection && !saving) {
        void saveSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const pointFromEvent = (event: React.PointerEvent) => {
    const bounds = hostRef.current!.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  };

  const saveSelection = async () => {
    const host = hostRef.current;
    const image = imageRef.current;
    if (!selection || !host || !image || saving) return;
    const bounds = host.getBoundingClientRect();
    const scaleX = source.width / bounds.width;
    const scaleY = source.height / bounds.height;
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(selection.width * scaleX));
    output.height = Math.max(1, Math.round(selection.height * scaleY));
    const context = output.getContext("2d");
    if (!context) return;
    context.drawImage(
      image,
      selection.left * scaleX,
      selection.top * scaleY,
      selection.width * scaleX,
      selection.height * scaleY,
      0,
      0,
      output.width,
      output.height,
    );
    setSaving(true);
    try {
      await onComplete(output.toDataURL("image/png"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="capture-overlay"
      ref={hostRef}
      onPointerDown={(event) => {
        if (saving) return;
        const point = pointFromEvent(event);
        startRef.current = point;
        setSelection({ left: point.x, top: point.y, width: 0, height: 0 });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = startRef.current;
        if (!start) return;
        const point = pointFromEvent(event);
        setSelection({
          left: Math.min(start.x, point.x),
          top: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
        });
      }}
      onPointerUp={() => {
        startRef.current = null;
      }}
    >
      <img ref={imageRef} src={source.dataUrl} alt="" draggable={false} />
      <div className="capture-shade" />
      {selection && (
        <div
          className="capture-selection"
          style={{
            left: selection.left,
            top: selection.top,
            width: selection.width,
            height: selection.height,
          }}
        />
      )}
      <div className="capture-instructions">
        拖动框选区域 · Enter 保存 · Esc 取消
      </div>
      <div className="capture-actions">
        <button onClick={onCancel} aria-label="取消截图">
          <X size={17} />
        </button>
        <button
          className="confirm"
          onClick={() => void saveSelection()}
          disabled={
            !selection ||
            selection.width < 4 ||
            selection.height < 4 ||
            saving
          }
          aria-label="保存截图"
        >
          <Check size={17} />
        </button>
      </div>
    </div>
  );
}
