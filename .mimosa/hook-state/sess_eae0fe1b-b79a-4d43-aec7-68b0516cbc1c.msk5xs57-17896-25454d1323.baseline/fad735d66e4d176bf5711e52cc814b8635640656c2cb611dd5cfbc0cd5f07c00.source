import type { TMat2D } from "fabric";

export interface ViewportBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clientToScenePoint(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number },
  transform: TMat2D,
): { x: number; y: number } {
  return {
    x: (clientX - bounds.left - transform[4]) / transform[0],
    y: (clientY - bounds.top - transform[5]) / transform[3],
  };
}

export function fitViewport(
  boxes: ViewportBox[],
  canvasWidth: number,
  canvasHeight: number,
): { transform: TMat2D; zoom: number } | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom = Math.min(
    4,
    Math.max(
      0.08,
      Math.min((canvasWidth - 96) / width, (canvasHeight - 96) / height),
    ),
  );
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return {
    zoom,
    transform: [
      zoom,
      0,
      0,
      zoom,
      canvasWidth / 2 - centerX * zoom,
      canvasHeight / 2 - centerY * zoom,
    ],
  };
}
