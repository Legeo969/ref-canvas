import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureSource } from "../../shared/contracts";
import { translate } from "../app/i18n";

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

export interface CaptureCrop {
  sourceLeft: number;
  sourceTop: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export function calculateCaptureCrop(
  selection: Selection,
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): CaptureCrop | null {
  if (
    selection.width < 4 ||
    selection.height < 4 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }
  const scaleX = sourceWidth / viewportWidth;
  const scaleY = sourceHeight / viewportHeight;
  return {
    sourceLeft: selection.left * scaleX,
    sourceTop: selection.top * scaleY,
    sourceWidth: selection.width * scaleX,
    sourceHeight: selection.height * scaleY,
    outputWidth: Math.max(1, Math.round(selection.width * scaleX)),
    outputHeight: Math.max(1, Math.round(selection.height * scaleY)),
  };
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
  const [error, setError] = useState<string | null>(null);

  const pointFromEvent = (event: React.PointerEvent) => {
    const bounds = hostRef.current!.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  };

  const saveSelection = useCallback(async () => {
    const host = hostRef.current;
    const image = imageRef.current;
    if (!selection || !host || !image || saving) return;
    const bounds = host.getBoundingClientRect();
    if (!image.complete) await image.decode();
    const crop = calculateCaptureCrop(
      selection,
      bounds.width,
      bounds.height,
      image.naturalWidth || source.width,
      image.naturalHeight || source.height,
    );
    if (!crop) return;
    const output = document.createElement("canvas");
    output.width = crop.outputWidth;
    output.height = crop.outputHeight;
    const context = output.getContext("2d");
    if (!context) {
      setError(translate("capture.error"));
      return;
    }
    context.drawImage(
      image,
      crop.sourceLeft,
      crop.sourceTop,
      crop.sourceWidth,
      crop.sourceHeight,
      0,
      0,
      output.width,
      output.height,
    );
    setSaving(true);
    setError(null);
    try {
      await onComplete(output.toDataURL("image/png"));
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : translate("capture.error"),
      );
    } finally {
      setSaving(false);
    }
  }, [onComplete, saving, selection, source.height, source.width]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        // 截图是模态操作：Esc 必须独占，避免默认行为/其它 window 级
        // handler（如预览面板的 Esc 关闭浮层）抢跑，也避免焦点残留触发。
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === "Enter" && selection && !saving) {
        // Enter 保存绝不能触发默认行为：窗口恢复焦点后焦点可能落在
        // 标题栏按钮（如 AI 设计入口），Enter 的默认“激活聚焦元素”会
        // 泄漏成点击，意外 dispatch refcanvas:open-ai-workbench 打开面板。
        event.preventDefault();
        event.stopPropagation();
        void saveSelection();
      }
    };
    // capture 阶段：在其它 window 级 keydown 之前独占截图按键。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, saveSelection, saving, selection]);

  return (
    <div
      className="capture-overlay"
      ref={hostRef}
      onPointerDown={(event) => {
        if (saving) return;
        if ((event.target as HTMLElement).closest("[data-capture-control]")) return;
        event.preventDefault();
        setError(null);
        const point = pointFromEvent(event);
        startRef.current = point;
        setSelection({ left: point.x, top: point.y, width: 0, height: 0 });
        event.currentTarget.setPointerCapture?.(event.pointerId);
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
      onPointerCancel={() => {
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
      <div className="capture-instructions" data-capture-control>
        {saving ? translate("capture.saving") : translate("capture.instructions")}
      </div>
      {error && <div className="capture-error" data-capture-control>{error}</div>}
      <div className="capture-actions" data-capture-control>
        <button onClick={onCancel} disabled={saving} aria-label={translate("capture.cancel")}>
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
          aria-label={translate("capture.save")}
        >
          <Check size={17} />
        </button>
      </div>
    </div>
  );
}
