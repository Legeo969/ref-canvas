import { ActiveSelection, Rect } from "fabric";
import { describe, expect, it } from "vitest";
import {
  calculateCompactLayout,
  calculateFocusViewport,
  findAxisSnapTarget,
  nextCircularIndex,
  sceneAxisToViewport,
  sceneDeltaToParent,
} from "../../../../src/renderer/app/board-layout";

describe("calculateCompactLayout", () => {
  it("packs items in stable order and wraps rows at the viewport width", () => {
    expect(
      calculateCompactLayout(
        [
          { width: 100, height: 80 },
          { width: 120, height: 60 },
          { width: 90, height: 70 },
        ],
        250,
        10,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 0, y: 90 },
    ]);
  });

  it("keeps an oversized item on its own row without negative positions", () => {
    expect(
      calculateCompactLayout(
        [
          { width: 320, height: 100 },
          { width: 80, height: 80 },
        ],
        240,
        20,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 120 },
    ]);
  });

  it("centers one object inside a padded focus viewport", () => {
    expect(
      calculateFocusViewport(
        { left: 100, top: 50, width: 400, height: 200 },
        { width: 1000, height: 700 },
        100,
      ),
    ).toEqual({
      zoom: 2,
      offsetX: -100,
      offsetY: 50,
    });
  });

  it("steps through focus items in a circular order", () => {
    expect(nextCircularIndex(-1, 3, 1)).toBe(0);
    expect(nextCircularIndex(2, 3, 1)).toBe(0);
    expect(nextCircularIndex(0, 3, -1)).toBe(2);
    expect(nextCircularIndex(-1, 0, 1)).toBe(-1);
  });

  it("converts scene movement into a rotated and non-uniformly scaled parent", () => {
    const angle = Math.PI / 6;
    const scaleX = 2;
    const scaleY = 0.5;
    const transform = [
      Math.cos(angle) * scaleX,
      Math.sin(angle) * scaleX,
      -Math.sin(angle) * scaleY,
      Math.cos(angle) * scaleY,
      120,
      -40,
    ] as const;
    const local = sceneDeltaToParent(35, -12, transform);

    expect(transform[0] * local.x + transform[2] * local.y).toBeCloseTo(35);
    expect(transform[1] * local.x + transform[3] * local.y).toBeCloseTo(-12);
  });

  it("moves a transformed ActiveSelection member by the requested scene delta", () => {
    const first = new Rect({ left: 0, top: 0, width: 100, height: 60 });
    const second = new Rect({ left: 220, top: 90, width: 80, height: 120 });
    const selection = new ActiveSelection([first, second]);
    selection.set({ angle: 28, scaleX: 1.8, scaleY: 0.65 });
    selection.setCoords();
    const before = first.getBoundingRect();
    const delta = sceneDeltaToParent(
      48,
      -21,
      selection.calcTransformMatrix(),
    );

    first.set({
      left: (first.left ?? 0) + delta.x,
      top: (first.top ?? 0) + delta.y,
    });
    first.setCoords();
    selection.triggerLayout();
    selection.setCoords();

    const after = first.getBoundingRect();
    expect(after.left - before.left).toBeCloseTo(48);
    expect(after.top - before.top).toBeCloseTo(-21);
  });

  it("returns the real center and trailing-edge guide axes", () => {
    expect(findAxisSnapTarget(140, 120, 100, 200, 1)).toEqual({
      position: 140,
      guide: 200,
    });
    expect(findAxisSnapTarget(180, 120, 100, 200, 1)).toEqual({
      position: 180,
      guide: 300,
    });
  });

  it("maps scene axes through zoom and viewport translation", () => {
    const viewport = [2, 0, 0, 2, 40, -30] as const;
    expect(sceneAxisToViewport("x", 125, viewport)).toBe(290);
    expect(sceneAxisToViewport("y", 80, viewport)).toBe(130);
  });
});
