import { describe, expect, it } from "vitest";
import {
  clampOpacity,
  constrainedAxis,
  cropGestureRect,
  cropPanDelta,
  cropZoomForHorizontalDrag,
  flipAxisForDrag,
  horizontalDragFactor,
  isMiddleButtonPointer,
  isPanPointerEvent,
  MiddlePanSession,
  opacityDelta,
  pointerAngleDelta,
  pointerDistanceRatio,
  recoveredPrimaryMouseUp,
  rotationForGesture,
  restoreRotationGesture,
  snapRotationAngle,
  normalizeSignedAngle,
  scaleForGesture,
  scaleForHorizontalDrag,
  stationarySnapCandidates,
  zoomFactorForDrag,
} from "../../../../src/renderer/app/board-gestures";

describe("board panning pointer", () => {
  it("recognizes a middle-button press and held-button move", () => {
    expect(isMiddleButtonPointer({ button: 1, buttons: 4 })).toBe(true);
    expect(isMiddleButtonPointer({ button: 0, buttons: 4 })).toBe(true);
    expect(
      isPanPointerEvent({ button: 1, buttons: 4, altKey: false }, false),
    ).toBe(true);
  });

  it("keeps Alt+left panning exclusive to the PureRef preset", () => {
    const altLeft = { button: 0, buttons: 1, altKey: true };
    expect(isPanPointerEvent(altLeft, true)).toBe(true);
    expect(isPanPointerEvent(altLeft, false)).toBe(false);
    expect(
      isPanPointerEvent({ button: 2, buttons: 2, altKey: true }, true),
    ).toBe(false);
    expect(
      isPanPointerEvent(
        { button: 0, buttons: 1, altKey: true, shiftKey: true },
        true,
      ),
    ).toBe(false);
    expect(
      isPanPointerEvent(
        { button: 0, buttons: 1, altKey: true, ctrlKey: true },
        true,
      ),
    ).toBe(false);
  });

  it("tracks a native middle-button drag through press, move and release", () => {
    const session = new MiddlePanSession();
    expect(
      session.start({ button: 1, buttons: 4, clientX: 100, clientY: 80 }),
    ).toBe(true);
    expect(session.isActive).toBe(true);
    expect(session.move({ buttons: 4, clientX: 125, clientY: 68 })).toEqual({
      dx: 25,
      dy: -12,
      finished: false,
    });
    expect(session.end({ button: 1, buttons: 0 })).toBe(true);
    expect(session.isActive).toBe(false);
    expect(session.move({ buttons: 0, clientX: 140, clientY: 70 })).toBeNull();
  });

  it("recovers when Chromium reports a move with the middle button released", () => {
    const session = new MiddlePanSession();
    session.start({ button: 1, buttons: 4, clientX: 20, clientY: 30 });
    expect(session.move({ buttons: 0, clientX: 30, clientY: 40 })).toEqual({
      dx: 0,
      dy: 0,
      finished: true,
    });
    expect(session.isActive).toBe(false);
  });
});

describe("lost primary pointer recovery", () => {
  it("releases the primary button at the last observed position", () => {
    expect(
      recoveredPrimaryMouseUp({
        clientX: 120,
        clientY: 80,
        screenX: 320,
        screenY: 180,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toEqual({
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 80,
      screenX: 320,
      screenY: 180,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  });
});

describe("multi-selection snapping", () => {
  it("keeps only stationary objects as snap candidates", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const stationary = { id: "stationary" };
    const activeSelection = { id: "selection" };

    expect(
      stationarySnapCandidates(
        [first, second, stationary],
        activeSelection,
        [first, second],
      ),
    ).toEqual([stationary]);
  });
});

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

  it("matches PureRef horizontal scaling direction", () => {
    expect(horizontalDragFactor(100)).toBeGreaterThan(1);
    expect(horizontalDragFactor(-100)).toBeLessThan(1);
    const enlarged = scaleForHorizontalDrag(2, 3, 100);
    expect(enlarged.scaleX).toBeGreaterThan(2);
    expect(enlarged.scaleY).toBeGreaterThan(3);
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
  it("drags right to increase opacity", () => {
    expect(opacityDelta(200)).toBeCloseTo(1);
    expect(opacityDelta(-200)).toBeCloseTo(-1);
  });

  it("clamps into the complete 0–1 range", () => {
    expect(clampOpacity(1.5)).toBe(1);
    expect(clampOpacity(-0.5)).toBe(0);
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
  it("moves source coordinates opposite to the grabbed image", () => {
    expect(cropPanDelta(20, 10, 2, 1)).toEqual({ cropX: -10, cropY: -10 });
    expect(cropPanDelta(-30, 0, 3, 3)).toEqual({ cropX: 10, cropY: -0 });
  });
});

describe("crop zoom", () => {
  const snapshot = {
    cropX: 100,
    cropY: 50,
    width: 400,
    height: 200,
    scaleX: 2,
    scaleY: 2,
  };

  it("zooms into the crop while keeping its displayed size and center", () => {
    const result = cropZoomForHorizontalDrag(
      snapshot,
      { width: 800, height: 400 },
      100,
    );
    expect(result.width).toBeLessThan(snapshot.width);
    expect(result.height).toBeLessThan(snapshot.height);
    expect(result.width * result.scaleX).toBeCloseTo(800);
    expect(result.height * result.scaleY).toBeCloseTo(400);
    expect(result.cropX + result.width / 2).toBeCloseTo(300);
    expect(result.cropY + result.height / 2).toBeCloseTo(150);
  });

  it("does not zoom out beyond the original source", () => {
    const result = cropZoomForHorizontalDrag(
      snapshot,
      { width: 800, height: 400 },
      -10_000,
    );
    expect(result).toMatchObject({ cropX: 0, cropY: 0, width: 800, height: 400 });
  });
});

describe("manual flip direction", () => {
  it("uses the dominant drag axis after the movement threshold", () => {
    expect(flipAxisForDrag(4, 3)).toBeNull();
    expect(flipAxisForDrag(20, 3)).toBe("x");
    expect(flipAxisForDrag(3, -20)).toBe("y");
  });
});
