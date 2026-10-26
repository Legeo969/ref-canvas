import { Point, type StaticCanvas, type TMat2D } from "fabric";
import { clampBoardZoom } from "../../../app/board-zoom";

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

/**
 * 100% 缩放:围绕视口中心恢复 1:1。与滚轮缩放/± 按钮同用 zoomToPoint
 * 惯例(逻辑像素 getWidth()/getHeight()),不要手工拼 viewportTransform——
 * 用 canvas.width 属性换算平移在高分屏下与逻辑像素语义有出入,会导致视角跑偏。
 */
export function zoomTo100(canvas: StaticCanvas): void {
  canvas.zoomToPoint(
    new Point(canvas.getWidth() / 2, canvas.getHeight() / 2),
    1,
  );
  canvas.requestRenderAll();
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
  const zoom = clampBoardZoom(
    Math.min((canvasWidth - 96) / width, (canvasHeight - 96) / height),
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
