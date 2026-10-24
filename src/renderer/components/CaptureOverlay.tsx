import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureCrop, CaptureSource } from "../../shared/contracts";
import { translate } from "../app/i18n";

export type { CaptureCrop } from "../../shared/contracts";

interface CaptureOverlayProps {
  source: CaptureSource;
  /** 跨屏互斥：其余屏正在框选时本屏转纯遮罩，不可框选（Esc 仍可取消会话）。 */
  passive?: boolean;
  /** 本屏选区状态变化（开始框选 / 选区清空）时上报，主进程转发其余屏。 */
  onSelectionActivity?(active: boolean): void;
  onComplete(crop: CaptureCrop): Promise<void>;
  onCancel(): void;
}

interface Selection {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** 八向手柄：四角 + 四边中点。 */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 手柄抓取半径（CSS 像素）：比手柄本身略大，保证好抓。 */
const HANDLE_GRAB_RADIUS = 8;

type DragState =
  | { mode: "draw"; start: Point }
  | { mode: "move"; offsetX: number; offsetY: number }
  | { mode: "resize"; handle: ResizeHandle; start: Selection };

/** 视口 CSS 像素 → 源图物理像素的换算比；读数与裁剪共用同一份公式。 */
export function captureScale(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): { scaleX: number; scaleY: number } {
  return {
    scaleX: viewportWidth > 0 ? sourceWidth / viewportWidth : 1,
    scaleY: viewportHeight > 0 ? sourceHeight / viewportHeight : 1,
  };
}

export function calculateCaptureCrop(
  displayId: number,
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
  const { scaleX, scaleY } = captureScale(
    viewportWidth,
    viewportHeight,
    sourceWidth,
    sourceHeight,
  );
  // 结果必须落在整数物理像素上并夹在源图范围内：主进程拿它直接做
  // sharp.extract，浮点或越界都会让裁剪失败（框选贴着屏幕边缘时尤其常见）。
  const left = Math.min(
    Math.max(0, Math.round(selection.left * scaleX)),
    Math.max(0, Math.round(sourceWidth) - 1),
  );
  const top = Math.min(
    Math.max(0, Math.round(selection.top * scaleY)),
    Math.max(0, Math.round(sourceHeight) - 1),
  );
  return {
    // 多屏会话每屏一张底图：主进程按 displayId 取对应屏的临时 PNG。
    displayId,
    sourceLeft: left,
    sourceTop: top,
    sourceWidth: Math.min(
      Math.max(1, Math.round(selection.width * scaleX)),
      Math.round(sourceWidth) - left,
    ),
    sourceHeight: Math.min(
      Math.max(1, Math.round(selection.height * scaleY)),
      Math.round(sourceHeight) - top,
    ),
    outputWidth: Math.max(1, Math.round(selection.width * scaleX)),
    outputHeight: Math.max(1, Math.round(selection.height * scaleY)),
  };
}

/** 手柄对应的光标：给 pointermove 的悬停命中用（手柄本身 pointer-events:none）。 */
export function cursorForHandle(handle: ResizeHandle): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    default:
      return "ew-resize";
  }
}

/** 手柄中心点坐标。 */
export function handleCenter(selection: Selection, handle: ResizeHandle): Point {
  const cx = selection.left + selection.width / 2;
  const cy = selection.top + selection.height / 2;
  const right = selection.left + selection.width;
  const bottom = selection.top + selection.height;
  switch (handle) {
    case "nw": return { x: selection.left, y: selection.top };
    case "n": return { x: cx, y: selection.top };
    case "ne": return { x: right, y: selection.top };
    case "e": return { x: right, y: cy };
    case "se": return { x: right, y: bottom };
    case "s": return { x: cx, y: bottom };
    case "sw": return { x: selection.left, y: bottom };
    case "w": return { x: selection.left, y: cy };
  }
}

/**
 * 命中检测：手柄优先于选区内部，选区内部优先于选区外。
 * 返回 null 表示点在选区外，应该开始框新选区。
 */
export function hitTestSelection(
  selection: Selection,
  point: Point,
): { kind: "resize"; handle: ResizeHandle } | { kind: "move" } | null {
  for (const handle of HANDLES) {
    const c = handleCenter(selection, handle);
    if (
      Math.abs(point.x - c.x) <= HANDLE_GRAB_RADIUS &&
      Math.abs(point.y - c.y) <= HANDLE_GRAB_RADIUS
    ) {
      return { kind: "resize", handle };
    }
  }
  if (
    point.x >= selection.left &&
    point.x <= selection.left + selection.width &&
    point.y >= selection.top &&
    point.y <= selection.top + selection.height
  ) {
    return { kind: "move" };
  }
  return null;
}

/** 拖拽手柄调整选区：以按下时的选区为基准，防止累计漂移。 */
export function resizeSelection(
  start: Selection,
  handle: ResizeHandle,
  point: Point,
  viewportWidth: number,
  viewportHeight: number,
): Selection {
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  // 各边不越过对边（保持最小 1px），再夹回视口内。
  if (handle.includes("w")) left = Math.min(point.x, right - 1);
  if (handle.includes("e")) right = Math.max(point.x, left + 1);
  if (handle.includes("n")) top = Math.min(point.y, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(point.y, top + 1);
  left = Math.min(Math.max(0, left), viewportWidth);
  right = Math.min(Math.max(0, right), viewportWidth);
  top = Math.min(Math.max(0, top), viewportHeight);
  bottom = Math.min(Math.max(0, bottom), viewportHeight);
  return { left, top, width: right - left, height: bottom - top };
}

/** 整体移动选区，夹回视口内。 */
export function moveSelection(
  selection: Selection,
  point: Point,
  offsetX: number,
  offsetY: number,
  viewportWidth: number,
  viewportHeight: number,
): Selection {
  const maxLeft = Math.max(0, viewportWidth - selection.width);
  const maxTop = Math.max(0, viewportHeight - selection.height);
  return {
    left: Math.min(Math.max(0, point.x - offsetX), maxLeft),
    top: Math.min(Math.max(0, point.y - offsetY), maxTop),
    width: selection.width,
    height: selection.height,
  };
}

/** 选区右下角读数标签的位置：贴视口右/下边缘时翻到内侧，避免被裁掉。 */
export function captureSizeBadgePosition(
  selection: Selection,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; flipX: boolean; flipY: boolean } {
  const gap = 6;
  const badgeWidth = 92;
  const badgeHeight = 22;
  const right = selection.left + selection.width;
  const bottom = selection.top + selection.height;
  const flipX = right + gap + badgeWidth > viewportWidth;
  const flipY = bottom + gap + badgeHeight > viewportHeight;
  return {
    left: flipX ? Math.max(0, selection.left + gap) : right + gap,
    top: flipY ? Math.max(0, selection.top + gap) : bottom + gap,
    flipX,
    flipY,
  };
}

/** 确认/取消工具条的位置：贴着选区右下角，下方放不下就翻到选区上方。 */
export function captureToolbarPosition(
  selection: Selection,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  // 与 board.css 中两个 38px 按钮 + 间距 + padding 的尺寸一致。
  const toolbarWidth = 96;
  const toolbarHeight = 48;
  const gap = 8;
  const fitsBelow =
    selection.top + selection.height + gap + toolbarHeight <= viewportHeight - gap;
  const top = fitsBelow
    ? selection.top + selection.height + gap
    : Math.max(gap, selection.top - gap - toolbarHeight);
  const left = Math.min(
    Math.max(gap, selection.left + selection.width - toolbarWidth),
    viewportWidth - toolbarWidth - gap,
  );
  return { left, top };
}

export function CaptureOverlay({
  source,
  passive = false,
  onSelectionActivity,
  onComplete,
  onCancel,
}: CaptureOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState("crosshair");
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(
    null,
  );

  // 本屏转 passive（他屏开始框选）：清掉本屏选区。全局任一时刻只有一个
  // 选区，Enter 保存的永远是"眼前这一个"，不会出现两屏各留一个框、
  // 只有一个能保存的陷阱。
  useEffect(() => {
    if (passive) setSelection(null);
  }, [passive]);

  const pointFromEvent = (event: React.PointerEvent) => {
    const bounds = hostRef.current!.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  };

  // 视口尺寸只在挂载/窗口尺寸变化时量一次：拖动中每帧读
  // getBoundingClientRect 会强制同步布局，把拖拽拖成掉帧。
  useEffect(() => {
    const measure = () => {
      const bounds = hostRef.current?.getBoundingClientRect();
      if (bounds) setViewport({ width: bounds.width, height: bounds.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const commit = useCallback(
    async (crop: CaptureCrop | null) => {
      if (!crop || saving) return;
      setSaving(true);
      setError(null);
      try {
        await onComplete(crop);
      } catch (reason) {
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : translate("capture.error"),
        );
      } finally {
        setSaving(false);
      }
    },
    [onComplete, saving],
  );

  const cropFor = useCallback(
    (region: Selection): CaptureCrop | null => {
      const image = imageRef.current;
      const bounds = hostRef.current?.getBoundingClientRect();
      if (!image || !bounds) return null;
      // 只把物理像素矩形交给主进程去裁：渲染端不再画 canvas、不再导出
      // base64——那一步要把整块框选区域重新编码一次并跨 IPC 复制。
      return calculateCaptureCrop(
        source.displayId,
        region,
        bounds.width,
        bounds.height,
        image.naturalWidth || source.width,
        image.naturalHeight || source.height,
      );
    },
    [source.displayId, source.height, source.width],
  );

  const saveSelection = useCallback(async () => {
    if (!selection || saving) return;
    const image = imageRef.current;
    if (image && !image.complete) await image.decode();
    await commit(cropFor(selection));
  }, [commit, cropFor, saving, selection]);

  const saveFullScreen = useCallback(async () => {
    const bounds = hostRef.current?.getBoundingClientRect();
    if (!bounds || saving) return;
    const image = imageRef.current;
    if (image && !image.complete) await image.decode();
    await commit(
      cropFor({ left: 0, top: 0, width: bounds.width, height: bounds.height }),
    );
  }, [commit, cropFor, saving]);

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
        // 标题栏按钮上，Enter 的默认“激活聚焦元素”会泄漏成意外点击。
        event.preventDefault();
        event.stopPropagation();
        void saveSelection();
      }
    };
    // capture 阶段：在其它 window 级 keydown 之前独占截图按键。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, saveSelection, saving, selection]);

  const scale = viewport
    ? captureScale(
        viewport.width,
        viewport.height,
        imageRef.current?.naturalWidth || source.width,
        imageRef.current?.naturalHeight || source.height,
      )
    : null;
  const readout =
    selection && scale
      ? {
          width: Math.round(selection.width * scale.scaleX),
          height: Math.round(selection.height * scale.scaleY),
        }
      : null;
  const badge =
    selection && viewport && readout && readout.width > 0 && readout.height > 0
      ? captureSizeBadgePosition(selection, viewport.width, viewport.height)
      : null;
  const toolbar =
    selection && viewport
      ? captureToolbarPosition(selection, viewport.width, viewport.height)
      : null;

  return (
    <div
      className={`capture-overlay${passive ? " capture-overlay-passive" : ""}`}
      ref={hostRef}
      style={{ cursor: passive ? "default" : cursor }}
      onPointerDown={(event) => {
        // passive 屏（他屏正在框选）：本屏只展示冻结画面，任何指针交互
        // （含右键取消）都不响应；取消整个会话走 Esc。
        if (passive) return;
        if (saving) return;
        // 右键 = 取消：QQ 截图的肌肉记忆，给 Esc 之外的第二只手。
        if (event.button === 2) {
          event.preventDefault();
          onCancel();
          return;
        }
        // 双击的第二下不能重置选区，否则双击保存永远拿不到可用的框。
        if (event.detail >= 2) return;
        if ((event.target as HTMLElement).closest("[data-capture-control]")) return;
        event.preventDefault();
        setError(null);
        const point = pointFromEvent(event);
        // 已有选区时，按下点决定接下来做什么：
        // 手柄上 = 调整大小；选区内部 = 整体移动；选区外 = 重新框选。
        const hit = selection ? hitTestSelection(selection, point) : null;
        if (hit?.kind === "resize") {
          dragRef.current = { mode: "resize", handle: hit.handle, start: selection! };
        } else if (hit?.kind === "move") {
          dragRef.current = {
            mode: "move",
            offsetX: point.x - selection!.left,
            offsetY: point.y - selection!.top,
          };
        } else {
          dragRef.current = { mode: "draw", start: point };
          setSelection({ left: point.x, top: point.y, width: 0, height: 0 });
          // 从无到有开始新框选：其余屏转纯遮罩（跨屏选区互斥）。
          if (!selection) onSelectionActivity?.(true);
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || !viewport) {
          // 未按下时的悬停命中：决定光标是十字、移动还是某个方向的 resize。
          // 手柄 pointer-events:none，CSS :hover 摸不到它们，只能在这里算。
          if (!drag && selection && viewport) {
            const point = pointFromEvent(event);
            const hit = hitTestSelection(selection, point);
            setCursor(
              hit?.kind === "resize"
                ? cursorForHandle(hit.handle)
                : hit?.kind === "move"
                  ? "move"
                  : "crosshair",
            );
          } else if (!drag && !selection) {
            setCursor("crosshair");
          }
          return;
        }
        const point = pointFromEvent(event);
        if (drag.mode === "draw") {
          setSelection({
            left: Math.min(drag.start.x, point.x),
            top: Math.min(drag.start.y, point.y),
            width: Math.abs(point.x - drag.start.x),
            height: Math.abs(point.y - drag.start.y),
          });
        } else if (drag.mode === "move" && selection) {
          setSelection(
            moveSelection(
              selection,
              point,
              drag.offsetX,
              drag.offsetY,
              viewport.width,
              viewport.height,
            ),
          );
        } else if (drag.mode === "resize") {
          setSelection(
            resizeSelection(
              drag.start,
              drag.handle,
              point,
              viewport.width,
              viewport.height,
            ),
          );
        }
      }}
      onPointerUp={() => {
        dragRef.current = null;
        // 松手时如果选区太小（比如只是单击了一下），直接清掉，
        // 不留一个看不见的 0x0 残框；同时告诉其余屏可以恢复框选。
        if (selection && selection.width < 4 && selection.height < 4) {
          setSelection(null);
          onSelectionActivity?.(false);
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onDoubleClick={() => {
        if (saving || passive) return;
        // 有选区时双击 = 保存选区；没选区时双击 = 截全屏。
        if (selection && selection.width >= 4 && selection.height >= 4) {
          void saveSelection();
        } else {
          void saveFullScreen();
        }
      }}
      // 右键取消时别让 Chromium 的默认菜单/手势插进来。
      onContextMenu={(event) => event.preventDefault()}
    >
      <img ref={imageRef} src={source.imageUrl} alt="" draggable={false} />
      {/* 无选区时整块压暗提示进入截图模式；有选区后遮罩由选区元素的
          9999px 外扩阴影承担（选区内保持原始亮度，所见即所得）。之前
          整块黑纱盖全屏、选区内外一样暗，是「难用」最直接的来源。 */}
      {(!selection || selection.width < 1 || selection.height < 1) && (
        <div className="capture-shade" />
      )}
      {selection && (
        <div
          className="capture-selection"
          style={{
            left: selection.left,
            top: selection.top,
            width: selection.width,
            height: selection.height,
          }}
        >
          {HANDLES.map((handle) => {
            const c = handleCenter(selection, handle);
            return (
              <div
                key={handle}
                className={`capture-handle capture-handle-${handle}`}
                style={{ left: c.x - selection.left - 5, top: c.y - selection.top - 5 }}
              />
            );
          })}
        </div>
      )}
      {badge && readout && (
        <div
          className="capture-size"
          data-capture-control
          style={{ left: badge.left, top: badge.top }}
        >
          {readout.width} × {readout.height}
        </div>
      )}
      <div className="capture-instructions" data-capture-control>
        {saving
          ? translate("capture.saving")
          : passive
            ? translate("capture.passiveHint")
            : translate("capture.instructions")}
      </div>
      {error && <div className="capture-error" data-capture-control>{error}</div>}
      {/* passive 屏不提供确认/取消按钮：整个会话的保存与取消由正在框选的
          那块屏（或任意屏的 Esc）统一决定。 */}
      {!passive && (
        <div
          className="capture-actions"
          data-capture-control
          style={toolbar ? { left: toolbar.left, top: toolbar.top, right: "auto", bottom: "auto" } : undefined}
        >
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
      )}
    </div>
  );
}
