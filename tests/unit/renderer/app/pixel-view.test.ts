import { describe, expect, it } from "vitest";
import {
  PIXEL_VIEW_THRESHOLD,
  isPixelView,
  pixelViewMaxZoom,
} from "../../../../src/renderer/app/pixel-view";

/**
 * 像素级显示是自动判定的：屏幕上一个源像素是否已占到 1 个屏幕像素以上。
 * 到那个点继续放大，插值只会把像素糊掉，所以直接切掉。
 * 判据与 zoom 的倍数无关 —— 白板的 800% 和预览的 100% 都不是同一个含义。
 */

describe("isPixelView", () => {
  it("is false while each source pixel occupies less than a screen pixel", () => {
    // 4000px 源图显示在 800px 宽：一像素只有 0.2 屏，属于缩小查看。
    expect(isPixelView(800, 4000)).toBe(false);
  });

  it("is true exactly at 1:1", () => {
    expect(isPixelView(4000, 4000)).toBe(true);
  });

  it("is true once magnified past 1:1", () => {
    expect(isPixelView(16000, 4000)).toBe(true);
  });

  it("treats the threshold as inclusive", () => {
    expect(isPixelView(PIXEL_VIEW_THRESHOLD * 1000, 1000)).toBe(true);
  });

  it("rejects degenerate input instead of guessing", () => {
    expect(isPixelView(0, 4000)).toBe(false);
    expect(isPixelView(800, 0)).toBe(false);
    expect(isPixelView(Number.NaN, 4000)).toBe(false);
    expect(isPixelView(800, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("pixelViewMaxZoom", () => {
  it("lifts the ceiling so 1:1 is reachable for a heavily downscaled image", () => {
    // 基准比例 0.2（缩小 5 倍）→ 到 1 像素占 8 屏需要 40 倍。
    // 固定 8 倍上限在这里根本到不了 1:1。
    expect(pixelViewMaxZoom(0.2)).toBe(40);
  });

  it("keeps the plain floor when the image already fills the view", () => {
    // 基准比例 1 → 60 倍才到 8 屏，但下限 8 倍仍然生效。
    expect(pixelViewMaxZoom(1)).toBe(8);
  });

  it("never goes below the floor for a magnified-at-fit image", () => {
    // 基准比例 8（适配时已放大 8 倍）→ 8/8 = 1，仍取 8 倍下限。
    expect(pixelViewMaxZoom(8)).toBe(8);
  });

  it("falls back to the floor for unusable input", () => {
    expect(pixelViewMaxZoom(0)).toBe(8);
    expect(pixelViewMaxZoom(Number.NaN)).toBe(8);
  });
});
