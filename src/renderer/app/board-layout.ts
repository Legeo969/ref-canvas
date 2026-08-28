export interface LayoutItem {
  width: number;
  height: number;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface FocusViewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export type AffineTransform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface AxisSnapTarget {
  /** New scene-space start coordinate for the moving bounds. */
  position: number;
  /** Scene-space coordinate where the guide must be drawn. */
  guide: number;
}

/** Converts a scene-space movement vector into an object's parent coordinate plane. */
export function sceneDeltaToParent(
  x: number,
  y: number,
  parentTransform?: AffineTransform,
): LayoutPosition {
  if (!parentTransform) return { x, y };
  const [a, b, c, d] = parentTransform;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < Number.EPSILON) return { x, y };
  return {
    x: (d * x - c * y) / determinant,
    y: (-b * x + a * y) / determinant,
  };
}

/** Finds the matching edge/center and keeps its actual scene-space guide axis. */
export function findAxisSnapTarget(
  movingStart: number,
  movingSize: number,
  stationaryStart: number,
  stationarySize: number,
  threshold: number,
): AxisSnapTarget | null {
  const candidates: AxisSnapTarget[] = [
    { position: stationaryStart, guide: stationaryStart },
    {
      position: stationaryStart + stationarySize / 2 - movingSize / 2,
      guide: stationaryStart + stationarySize / 2,
    },
    {
      position: stationaryStart + stationarySize - movingSize,
      guide: stationaryStart + stationarySize,
    },
  ];
  return (
    candidates.find(
      (candidate) => Math.abs(candidate.position - movingStart) <= threshold,
    ) ?? null
  );
}

/** Maps a scene-space vertical/horizontal axis to the board overlay's pixel plane. */
export function sceneAxisToViewport(
  axis: "x" | "y",
  value: number,
  viewportTransform: AffineTransform,
): number {
  return axis === "x"
    ? viewportTransform[0] * value + viewportTransform[4]
    : viewportTransform[3] * value + viewportTransform[5];
}

export function calculateCompactLayout(
  items: LayoutItem[],
  maxRowWidth: number,
  gap = 20,
): LayoutPosition[] {
  const positions: LayoutPosition[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const item of items) {
    if (x > 0 && x + item.width > maxRowWidth) {
      x = 0;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    positions.push({ x, y });
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  }

  return positions;
}

export function calculateFocusViewport(
  bounds: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  padding = 96,
): FocusViewport {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const zoom = Math.min(4, Math.max(0.08, Math.min(
    availableWidth / width,
    availableHeight / height,
  )));
  const centerX = bounds.left + width / 2;
  const centerY = bounds.top + height / 2;
  return {
    zoom,
    offsetX: viewport.width / 2 - centerX * zoom,
    offsetY: viewport.height / 2 - centerY * zoom,
  };
}

export function nextCircularIndex(
  current: number,
  length: number,
  delta: number,
): number {
  if (length <= 0) return -1;
  const start = current >= 0 ? current : delta < 0 ? 0 : -1;
  return ((start + delta) % length + length) % length;
}
