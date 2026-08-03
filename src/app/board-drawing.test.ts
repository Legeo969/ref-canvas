import { describe, expect, it } from "vitest";
import { constrainedEndPoint, drawingBounds } from "./board-drawing";

describe("board drawing geometry", () => {
  it("keeps unconstrained line endpoints unchanged", () => {
    expect(
      constrainedEndPoint({ x: 10, y: 20 }, { x: 55, y: 47 }, false),
    ).toEqual({ x: 55, y: 47 });
  });

  it("snaps constrained lines to 45 degree increments", () => {
    const end = constrainedEndPoint(
      { x: 0, y: 0 },
      { x: 100, y: 12 },
      true,
    );
    expect(end.x).toBeCloseTo(Math.hypot(100, 12));
    expect(end.y).toBeCloseTo(0);
  });

  it("creates a square in the original drag direction", () => {
    expect(
      drawingBounds({ x: 100, y: 100 }, { x: 40, y: 130 }, true),
    ).toEqual({
      left: 40,
      top: 100,
      width: 60,
      height: 60,
    });
  });
});
