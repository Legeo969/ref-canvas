import { describe, expect, it } from "vitest";
import { extractDominantPalette } from "../../../../src/renderer/app/color-palette";

describe("preview color palette", () => {
  it("ignores transparent pixels and returns deterministic dominant colors", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      250, 4, 2, 255,
      0, 0, 255, 255,
      0, 255, 0, 0,
    ]);
    const first = extractDominantPalette(pixels, 2);
    const second = extractDominantPalette(pixels, 2);
    expect(first).toEqual(second);
    expect(first[0].hex).toMatch(/^#f[0-9a-f]{5}$/);
    expect(first.some((color) => color.rgb[2] > 200)).toBe(true);
    expect(first.some((color) => color.rgb[1] > 200)).toBe(false);
  });
});
