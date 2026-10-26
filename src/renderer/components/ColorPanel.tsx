import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { hueSwatch, hsvToHex, type Hsv } from "../app/color-readout";
import { translate } from "../app/i18n";

/**
 * 可复用颜色面板：SV 平面 + 色相条，受控（hsv / onChange）。
 * 取色结果面板和白板外观设置共用同一套交互，避免两处各写一遍。
 *
 * 拖拽监听挂在 window 上：指针按住后移出元素仍需跟随，这是取色类
 * 控件的常规行为，不能只在元素内响应 pointermove。
 */
interface ColorPanelProps {
  hsv: Hsv;
  onChange(next: Hsv): void;
  /** 面板下方附加内容（读数行、输入框等由调用方决定）。 */
  children?: ReactNode;
}

export function ColorPanel({ hsv, onChange, children }: ColorPanelProps) {
  const planeRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<"plane" | "hue" | null>(null);
  // 最新回调与状态放进 ref：window 级监听只注册一次，避免每次拖动重建。
  const stateRef = useRef({ hsv, onChange });
  stateRef.current = { hsv, onChange };

  useEffect(() => {
    const ratio = (client: number, start: number, size: number) =>
      Math.max(0, Math.min(1, (client - start) / Math.max(1, size)));
    const onMove = (event: PointerEvent) => {
      const mode = dragRef.current;
      if (!mode) return;
      const target = mode === "plane" ? planeRef.current : hueRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const x = ratio(event.clientX, rect.left, rect.width);
      if (mode === "plane") {
        const y = ratio(event.clientY, rect.top, rect.height);
        stateRef.current.onChange({
          ...stateRef.current.hsv,
          s: x,
          v: 1 - y,
        });
      } else {
        stateRef.current.onChange({ ...stateRef.current.hsv, h: x * 360 });
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const startDrag = useCallback(
    (mode: "plane" | "hue") => (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.focus();
      dragRef.current = mode;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
      );
      if (mode === "plane") {
        const y = Math.max(
          0,
          Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)),
        );
        onChange({ ...hsv, s: x, v: 1 - y });
      } else {
        onChange({ ...hsv, h: x * 360 });
      }
    },
    [hsv, onChange],
  );

  const hex = hsvToHex(hsv);

  return (
    <div className="color-panel">
      <div
        ref={planeRef}
        className="color-panel-plane"
        style={{ backgroundColor: hueSwatch(hsv.h) }}
        role="slider"
        tabIndex={0}
        aria-label={translate("board.colorPlane")}
        aria-valuetext={hex}
        aria-valuenow={Math.round(hsv.v * 100)}
        onPointerDown={startDrag("plane")}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          const next: Record<string, Hsv> = {
            ArrowLeft: { ...hsv, s: Math.max(0, hsv.s - step) },
            ArrowRight: { ...hsv, s: Math.min(1, hsv.s + step) },
            ArrowUp: { ...hsv, v: Math.min(1, hsv.v + step) },
            ArrowDown: { ...hsv, v: Math.max(0, hsv.v - step) },
          };
          const target = next[event.key];
          if (!target) return;
          event.preventDefault();
          onChange(target);
        }}
      >
        <span
          className="color-panel-plane-handle"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            borderColor: hsv.v > 0.5 && hsv.s < 0.6 ? "#111" : "#fff",
          }}
          aria-hidden="true"
        />
      </div>
      <div
        ref={hueRef}
        className="color-panel-hue"
        role="slider"
        tabIndex={0}
        aria-label={translate("board.colorHue")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={startDrag("hue")}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.key === "ArrowRight" ? step : -step;
          onChange({ ...hsv, h: ((hsv.h + delta) % 360 + 360) % 360 });
        }}
      >
        <span
          className="color-panel-hue-handle"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: hueSwatch(hsv.h) }}
          aria-hidden="true"
        />
      </div>
      {children}
    </div>
  );
}
