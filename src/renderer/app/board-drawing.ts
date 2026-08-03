export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function constrainedEndPoint(
  start: DrawingPoint,
  end: DrawingPoint,
  constrain: boolean,
): DrawingPoint {
  if (!constrain) return end;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance) return end;
  const angle = Math.atan2(deltaY, deltaX);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(snappedAngle) * distance,
    y: start.y + Math.sin(snappedAngle) * distance,
  };
}

export function drawingBounds(
  start: DrawingPoint,
  end: DrawingPoint,
  constrainSquare: boolean,
): DrawingBounds {
  let deltaX = end.x - start.x;
  let deltaY = end.y - start.y;
  if (constrainSquare) {
    const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    deltaX = Math.sign(deltaX || 1) * size;
    deltaY = Math.sign(deltaY || 1) * size;
  }
  return {
    left: Math.min(start.x, start.x + deltaX),
    top: Math.min(start.y, start.y + deltaY),
    width: Math.abs(deltaX),
    height: Math.abs(deltaY),
  };
}
