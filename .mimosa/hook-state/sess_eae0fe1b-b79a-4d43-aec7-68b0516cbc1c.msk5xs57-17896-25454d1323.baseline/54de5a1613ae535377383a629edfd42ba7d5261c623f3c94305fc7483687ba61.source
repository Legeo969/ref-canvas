import { describe, expect, it } from "vitest";
import {
  inspectorMetrics,
  inspectorPatch,
  parseInspectorNumber,
} from "../../../../src/renderer/app/board-inspector";

const image = {
  left: 120,
  top: -40.25,
  width: 100,
  height: 50,
  scaleX: 2,
  scaleY: 0.5,
  angle: 15,
  opacity: 0.8,
};

describe("inspectorMetrics", () => {
  it("converts fabric props to form values (width = size × scale)", () => {
    expect(inspectorMetrics(image)).toEqual({
      x: 120,
      y: -40.2,
      width: 200,
      height: 25,
      rotation: 15,
      opacity: 0.8,
    });
  });
});

describe("inspectorPatch", () => {
  it("passes position, rotation and opacity through", () => {
    expect(
      inspectorPatch(image, { x: 5, y: 6, rotation: 90, opacity: 0.4 }),
    ).toEqual({ left: 5, top: 6, angle: 90, opacity: 0.4 });
  });

  it("converts width/height edits into scale factors", () => {
    expect(inspectorPatch(image, { width: 300 })).toEqual({ scaleX: 3 });
    expect(inspectorPatch(image, { height: 12.5 })).toEqual({ scaleY: 0.25 });
  });

  it("clamps dimensions and opacity", () => {
    // 尺寸下限 0.5px → scaleX = 0.5 / 100。
    expect(inspectorPatch(image, { width: 0 })).toEqual({ scaleX: 0.005 });
    expect(inspectorPatch(image, { opacity: 3 })).toEqual({ opacity: 1 });
    expect(inspectorPatch(image, { opacity: 0 })).toEqual({ opacity: 0.02 });
  });

  it("ignores width edits when the object has zero raw size", () => {
    expect(inspectorPatch({ ...image, width: 0 }, { width: 10 })).toEqual({});
  });

  it("returns empty patch for empty input", () => {
    expect(inspectorPatch(image, {})).toEqual({});
  });
});

describe("parseInspectorNumber", () => {
  it("parses valid numbers and rejects invalid input", () => {
    expect(parseInspectorNumber("12.5")).toBe(12.5);
    expect(parseInspectorNumber("-3")).toBe(-3);
    expect(parseInspectorNumber("")).toBeUndefined();
    expect(parseInspectorNumber("abc")).toBeUndefined();
  });
});
