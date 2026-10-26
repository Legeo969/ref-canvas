import { describe, expect, it } from "vitest";
import {
  colorReadoutFromHex,
  hexToHsv,
  hsvToHex,
  rgbToHsl,
  sourcePixelFromUv,
} from "../../../../src/renderer/app/color-readout";

describe("hex → readout", () => {
  it("reports hex, rgb and hsl for a mid grey", () => {
    const readout = colorReadoutFromHex("#808080");
    expect(readout).not.toBeNull();
    expect(readout!.hex).toBe("#808080");
    expect(readout!.rgb).toBe("rgb(128, 128, 128)");
    expect(readout!.hsl).toBe("hsl(0, 0.0%, 50.2%)");
  });

  it("computes hue for a saturated color", () => {
    const readout = colorReadoutFromHex("#FF0000");
    expect(readout!.hsl).toBe("hsl(0, 100.0%, 50.0%)");
    expect(colorReadoutFromHex("#00ff00")!.hsl).toBe("hsl(120, 100.0%, 50.0%)");
    expect(colorReadoutFromHex("#0000FF")!.hsl).toBe("hsl(240, 100.0%, 50.0%)");
  });

  it("normalizes case and accepts a missing leading hash", () => {
    expect(colorReadoutFromHex("202426")!.hex).toBe("#202426");
    expect(colorReadoutFromHex("#abcdef")!.hex).toBe("#ABCDEF");
  });

  it("returns null instead of guessing on invalid input", () => {
    expect(colorReadoutFromHex("")).toBeNull();
    expect(colorReadoutFromHex("#12345")).toBeNull();
    expect(colorReadoutFromHex("#gggggg")).toBeNull();
  });

  it("converts alpha to a percentage and defaults to opaque", () => {
    expect(colorReadoutFromHex("#000000", 255)!.alphaPercent).toBe(100);
    expect(colorReadoutFromHex("#000000", 0)!.alphaPercent).toBe(0);
    expect(colorReadoutFromHex("#000000", 128)!.alphaPercent).toBe(50);
    expect(colorReadoutFromHex("#000000")!.alphaPercent).toBe(100);
  });

  it("picks a readable contrast color", () => {
    expect(colorReadoutFromHex("#FFFFFF")!.contrastHex).toBe("#000000");
    expect(colorReadoutFromHex("#000000")!.contrastHex).toBe("#FFFFFF");
    // 采样截图里的近黑背景必须配白字。
    expect(colorReadoutFromHex("#010101")!.contrastHex).toBe("#FFFFFF");
  });
});

describe("rgbToHsl", () => {
  it("keeps grey at zero saturation", () => {
    expect(rgbToHsl([64, 64, 64])).toEqual({
      h: 0,
      s: 0,
      l: (64 / 255) * 100,
    });
  });

  it("wraps hues past 240 degrees", () => {
    expect(Math.round(rgbToHsl([255, 0, 255]).h)).toBe(300);
  });
});

describe("hsv round trip", () => {
  it("round-trips representative colors through HSV", () => {
    for (const hex of ["#202426", "#FF0000", "#00FF88", "#FFFFFF", "#000000", "#7F3FBF"]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    }
  });

  it("keeps saturation instead of collapsing greys", () => {
    // 纯白/纯黑没有色相，面板需要在 v=1 与 v=0 处仍能定位到角点。
    expect(hexToHsv("#FFFFFF")).toMatchObject({ s: 0, v: 1 });
    expect(hexToHsv("#000000")).toMatchObject({ s: 0, v: 0 });
  });

  it("returns null for an unparsable hex", () => {
    expect(hexToHsv("not-a-color")).toBeNull();
  });
});

describe("sourcePixelFromUv", () => {
  it("maps a uv point onto source pixels when decode size equals source size", () => {
    expect(sourcePixelFromUv(0.5, 0.5, 1600, 900, 1600, 900)).toEqual({
      x: 800,
      y: 450,
    });
  });

  it("refuses to label a proxy pixel as a source pixel", () => {
    // EXR/HDR 走缩略图缓存、视频取首帧：解码尺寸与源尺寸不同，坐标必须留空。
    expect(sourcePixelFromUv(0.5, 0.5, 320, 180, 4096, 2160)).toBeNull();
  });

  it("returns null when the source size is unknown", () => {
    expect(sourcePixelFromUv(0.5, 0.5, 800, 600, null, null)).toBeNull();
    expect(sourcePixelFromUv(0.5, 0.5, 800, 600, 800, null)).toBeNull();
  });

  it("clamps the right and bottom edges to the last pixel", () => {
    expect(sourcePixelFromUv(1, 1, 100, 50, 100, 50)).toEqual({ x: 99, y: 49 });
  });
});
