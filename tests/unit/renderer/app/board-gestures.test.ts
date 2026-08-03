import { describe, expect, it } from "vitest";
import {
  clampOpacity,
  constrainedAxis,
  cropGestureRect,
  cropPanDelta,
  opacityDelta,
  pointerAngleDelta,
  pointerDistanceRatio,
  rotationForGesture,
  restoreRotationGesture,
  snapRotationAngle,
  normalizeSignedAngle,
  scaleForGesture,
  zoomFactorForDrag,
} from "../../../../src/renderer/app/board-gestures";

describe("pointerAngleDelta", () => {
  it("measures clockwise rotation around a center", () => {
    const center = { x: 0, y: 0 };
    expect(
      pointerAngleDelta(center, { x: 10, y: 0 }, { x: 0, y: 10 }),
    ).toBeCloseTo(Math.PI / 2);
  });

  it("normalizes across the ±π boundary to the shortest path", () => {
    const center = { x: 0, y: 0 };
    const delta = pointerAngleDelta(
      center,
      { x: -10, y: 0.1 },
      { x: 10, y: 0.1 },
    );
    // 从 ~180° 到 ~0° 的最短路径是负向（~-178°），而非正向 ~182°。
    expect(Math.abs(delta)).toBeLessThan(Math.PI);
    expect(delta).toBeLessThan(0);
    expect(delta).toBeCloseTo(-Math.PI + 0.02, 1);
  });
});

describe("pointerDistanceRatio", () => {
  it("scales by the pointer distance ratio", () => {
    const center = { x: 0, y: 0 };
    expect(
      pointerDistanceRatio(center, { x: 10, y: 0 }, { x: 20, y: 0 }),
    ).toBeCloseTo(2);
    expect(
      pointerDistanceRatio(center, { x: 10, y: 0 }, { x: 5, y: 0 }),
    ).toBeCloseTo(0.5);
  });

  it("returns 1 when the start is at the center", () => {
    expect(
      pointerDistanceRatio({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 9, y: 0 }),
    ).toBe(1);
  });
});

describe("gesture transforms", () => {
  it("derives rotation from the gesture baseline without accumulating frames", () => {
    const center = { x: 0, y: 0 };
    const start = { x: 10, y: 0 };
    const current = { x: 0, y: 10 };
    expect(rotationForGesture(15, center, start, current)).toBeCloseTo(105);
    expect(rotationForGesture(15, center, start, current)).toBeCloseTo(105);
  });

  it("derives scale from the gesture baseline without accumulating frames", () => {
    const center = { x: 0, y: 0 };
    const start = { x: 10, y: 0 };
    const current = { x: 20, y: 0 };
    expect(scaleForGesture(2, 3, center, start, current)).toEqual({
      scaleX: 4,
      scaleY: 6,
    });
    expect(scaleForGesture(2, 3, center, start, current)).toEqual({
      scaleX: 4,
      scaleY: 6,
    });
  });

  it("snaps rotation on demand and normalizes HUD feedback", () => {
    expect(snapRotationAngle(68, true)).toBe(90);
    expect(snapRotationAngle(68, false)).toBe(68);
    expect(normalizeSignedAngle(270)).toBe(-90);
    expect(normalizeSignedAngle(450)).toBe(90);
  });

  it("restores the baseline angle when rotation is cancelled", () => {
    let angle = 72;
    let coordsUpdated = false;
    restoreRotationGesture(
      {
        rotate: (value) => {
          angle = value;
        },
        setCoords: () => {
          coordsUpdated = true;
        },
      },
      15,
    );
    expect(angle).toBe(15);
    expect(coordsUpdated).toBe(true);
  });
});

describe("opacityDelta / clampOpacity", () => {
  it("drags up to increase opacity", () => {
    expect(opacityDelta(-200)).toBeCloseTo(1);
    expect(opacityDelta(200)).toBeCloseTo(-1);
  });

  it("clamps into the visible range", () => {
    expect(clampOpacity(1.5)).toBe(1);
    expect(clampOpacity(0)).toBe(0.02);
    expect(clampOpacity(0.5)).toBe(0.5);
  });
});

describe("zoomFactorForDrag", () => {
  it("zooms in when dragging up", () => {
    expect(zoomFactorForDrag(-200)).toBeGreaterThan(1);
    expect(zoomFactorForDrag(200)).toBeLessThan(1);
  });
});

describe("constrainedAxis", () => {
  it("locks to the dominant axis", () => {
    expect(constrainedAxis({ x: 0, y: 0 }, { x: 30, y: 3 })).toBe("x");
    expect(constrainedAxis({ x: 0, y: 0 }, { x: 3, y: 30 })).toBe("y");
  });

  it("returns null near the start", () => {
    expect(constrainedAxis({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe("cropGestureRect", () => {
  it("computes a normalized rectangle from drag corners", () => {
    const rect = cropGestureRect(
      { x: 10, y: 20 },
      { x: 40, y: 60 },
      false,
    );
    expect(rect).toEqual({ left: 10, top: 20, width: 30, height: 40 });
  });

  it("handles negative drag direction", () => {
    const rect = cropGestureRect(
      { x: 40, y: 60 },
      { x: 10, y: 20 },
      false,
    );
    expect(rect).toEqual({ left: 10, top: 20, width: 30, height: 40 });
  });

  it("constrains to a square when requested", () => {
    const rect = cropGestureRect({ x: 0, y: 0 }, { x: 40, y: 10 }, true);
    expect(rect.width).toBe(40);
    expect(rect.height).toBe(40);
  });
});

describe("cropPanDelta", () => {
  it("divides pointer delta by object scale", () => {
    expect(cropPanDelta(20, 10, 2, 1)).toEqual({ cropX: 10, cropY: 10 });
    expect(cropPanDelta(-30, 0, 3, 3)).toEqual({ cropX: -10, cropY: 0 });
  });
});
