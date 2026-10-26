import { describe, expect, it } from "vitest";
import {
  maxPixelZoom,
  pixelRatioAt,
  pixelScale,
} from "../../../../src/renderer/app/preview-pixel-scale";

/**
 * 像素级查看的比例换算。
 *
 * zoom 是相对「适配容器后大小」的倍数，不是相对源像素。一张 4000px 的图
 * 放进 800px 视口后，zoom=1 只代表 1 个源像素占 1/8 个屏幕像素。
 * 所以「放了 8 倍还是糊」不是上限太小，而是参照系不同。
 */

describe("pixelScale", () => {
  it("reports the screen pixels per source pixel at fit", () => {
    // 4000px 源图适配到 800px 宽：每个源像素只有 0.2 个屏幕像素。
    const scale = pixelScale(800, 4000);
    expect(scale?.ratio).toBeCloseTo(0.2, 9);
    // 要到 1:1 需要放大 5 倍。
    expect(scale?.nativeZoom).toBeCloseTo(5, 9);
  });

  it("reports native zoom below 1 when a small image is upscaled at fit", () => {
    // 100px 小图适配到 800px 已被放大 8 倍，1:1 在 zoom=0.125。
    const scale = pixelScale(800, 100);
    expect(scale?.nativeZoom).toBeCloseTo(0.125, 9);
  });

  it("is exactly 1 when the image already fits 1:1", () => {
    expect(pixelScale(4000, 4000)).toEqual({ ratio: 1, nativeZoom: 1 });
  });

  it("returns null for degenerate input", () => {
    expect(pixelScale(0, 4000)).toBeNull();
    expect(pixelScale(800, 0)).toBeNull();
  });
});

describe("pixelRatioAt", () => {
  it("multiplies the fit ratio by the zoom factor", () => {
    // 适配比例 0.2，放大 5 倍 → 正好 1:1。
    expect(pixelRatioAt(5, 800, 4000)).toBeCloseTo(1, 9);
    // 放大 8 倍 → 1 个源像素占 1.6 个屏幕像素。
    expect(pixelRatioAt(8, 800, 4000)).toBeCloseTo(1.6, 9);
  });

  it("returns null for non-positive zoom", () => {
    expect(pixelRatioAt(0, 800, 4000)).toBeNull();
    expect(pixelRatioAt(-1, 800, 4000)).toBeNull();
  });
});

describe("maxPixelZoom", () => {
  it("keeps the 8x floor for an image that fits 1:1", () => {
    expect(maxPixelZoom(4000, 4000)).toBe(8);
  });

  it("lifts the ceiling for a large image so pixels are reachable", () => {
    // 4000px 源图在 800px 视口：nativeZoom=5，要看到 1 像素=8 屏幕像素
    // 需 zoom=40，固定 8 倍上限远远不够。
    expect(maxPixelZoom(800, 4000)).toBeCloseTo(40, 9);
  });

  it("never returns less than the plain viewing floor", () => {
    expect(maxPixelZoom(800, 100)).toBe(8);
  });

  it("falls back to the plain ceiling for unusable input", () => {
    expect(maxPixelZoom(0, 4000)).toBe(8);
  });
});
