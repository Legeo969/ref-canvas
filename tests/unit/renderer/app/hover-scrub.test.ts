import { describe, expect, it } from "vitest";
import { hoverScrubTime } from "../../../../src/renderer/app/hover-scrub";

describe("hoverScrubTime", () => {
  it("maps horizontal pointer position to video time and clamps it", () => {
    expect(hoverScrubTime(150, 100, 200, 20)).toBe(5);
    expect(hoverScrubTime(20, 100, 200, 20)).toBe(0);
    expect(hoverScrubTime(400, 100, 200, 20)).toBe(20);
  });
});
