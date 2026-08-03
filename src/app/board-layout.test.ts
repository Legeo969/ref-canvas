import { describe, expect, it } from "vitest";
import {
  calculateCompactLayout,
  calculateFocusViewport,
  nextCircularIndex,
} from "./board-layout";

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
});
