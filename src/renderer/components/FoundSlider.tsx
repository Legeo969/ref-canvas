import { useCallback, useRef } from "react";

type RangeHandle = "start" | "end";

export function updateFoundSliderRange(
  range: Pick<NonNullable<FoundSliderProps["range"]>, "start" | "end">,
  value: number,
  handle: RangeHandle,
): { start: number; end: number; seek: number } {
  const ratio = Math.max(0, Math.min(1, value));
  if (handle === "start") {
    const start = Math.min(ratio, range.end - 0.001);
    return { start, end: range.end, seek: start };
  }
  const end = Math.max(ratio, range.start + 0.001);
  return { start: range.start, end, seek: end };
}

interface FoundSliderProps {
  /** Current value in [0, 1]. */
  value: number;
  /** Fill color override (default: var(--found-accent)). */
  fillColor?: string;
  /** Called when the user drags or clicks to seek. */
  onChange(value: number): void;
  range?: { start: number; end: number; onChange(start: number, end: number): void };
}

/**
 * Found-style seek / progress slider.
 * Track #3A3D45, fill theme accent, white circle handle 12px.
 * Spec §3 upper-row slider.
 */
export function FoundSlider({ value, fillColor, onChange, range }: FoundSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; handle: RangeHandle } | null>(null);

  const commit = useCallback(
    (clientX: number, lockedHandle?: RangeHandle) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (range) {
        const handle = lockedHandle ?? (Math.abs(ratio - range.start) <= Math.abs(ratio - range.end) ? "start" : "end");
        const next = updateFoundSliderRange(range, ratio, handle);
        range.onChange(next.start, next.end);
        onChange(next.seek);
      } else onChange(ratio);
    },
    [onChange, range],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const target = event.target as HTMLElement;
      const explicitHandle = target.classList.contains("range-start")
        ? "start"
        : target.classList.contains("range-end")
          ? "end"
          : undefined;
      const track = trackRef.current;
      const rect = track?.getBoundingClientRect();
      const ratio = rect ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : value;
      const handle: RangeHandle = explicitHandle ?? (
        range && Math.abs(ratio - range.start) <= Math.abs(ratio - range.end) ? "start" : "end"
      );
      dragRef.current = { pointerId: event.pointerId, handle };
      event.currentTarget.setPointerCapture(event.pointerId);
      commit(event.clientX, handle);
    },
    [commit, range, value],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId && ((event.buttons & 1) === 1 || event.pressure > 0)) {
        commit(event.clientX, drag.handle);
      }
    },
    [commit],
  );

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      let next: number | null = null;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value - 0.01;
      else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value + 0.01;
      if (next === null) return;
      event.preventDefault();
      onChange(Math.max(0, Math.min(1, next)));
    },
    [onChange, value],
  );

  const pct = `${Math.max(0, Math.min(100, value * 100))}%`;

  return (
    <div
      className="found-slider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      role="slider"
      aria-label="预览时间线"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
    >
      <div className="found-slider-track" ref={trackRef}>
        {range && <div className="found-slider-range" style={{ left: `${range.start * 100}%`, right: `${(1 - range.end) * 100}%`, background: fillColor }} />}
        {!range && <div
          className="found-slider-fill"
          style={{ width: pct, background: fillColor }}
        />}
        {range ? <>
          <div className="found-slider-handle range-start" style={{ left: `${range.start * 100}%` }} />
          <div className="found-slider-handle range-end" style={{ left: `${range.end * 100}%` }} />
        </> : <div className="found-slider-handle" style={{ left: pct }} />}
      </div>
    </div>
  );
}
