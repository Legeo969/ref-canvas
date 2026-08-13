import { describe, expect, it } from "vitest";
import { updateFoundSliderRange } from "../../../../src/renderer/components/FoundSlider";

describe("FoundSlider range interaction", () => {
  it("locks the selected range handle and returns its seek position", () => {
    expect(updateFoundSliderRange({ start: 0.2, end: 0.8 }, 0.35, "start")).toEqual({
      start: 0.35,
      end: 0.8,
      seek: 0.35,
    });
    expect(updateFoundSliderRange({ start: 0.2, end: 0.8 }, 0.65, "end")).toEqual({
      start: 0.2,
      end: 0.65,
      seek: 0.65,
    });
  });
});
