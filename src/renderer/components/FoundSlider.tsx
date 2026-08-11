import { useCallback, useRef } from "react";

interface FoundSliderProps {
  /** Current value in [0, 1]. */
  value: number;
  /** Fill color override (default: var(--found-accent)). */
  fillColor?: string;
  /** Called when the user drags or clicks to seek. */
  onChange(value: number): void;
}

/**
 * Found-style seek / progress slider.
 * Track #3A3D45, fill theme accent, white circle handle 12px.
 * Spec §3 upper-row slider.
 */
export function FoundSlider({ value, fillColor, onChange }: FoundSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const commit = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(ratio);
    },
    [onChange],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      commit(event.clientX);
    },
    [commit],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (event.pressure > 0) commit(event.clientX);
    },
    [commit],
  );

  const pct = `${Math.max(0, Math.min(100, value * 100))}%`;

  return (
    <div
      className="found-slider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      role="slider"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
    >
      <div className="found-slider-track" ref={trackRef}>
        <div
          className="found-slider-fill"
          style={{ width: pct, background: fillColor }}
        />
        <div className="found-slider-handle" style={{ left: pct }} />
      </div>
    </div>
  );
}
