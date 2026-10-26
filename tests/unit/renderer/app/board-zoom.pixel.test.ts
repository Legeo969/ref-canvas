import { describe, expect, it } from "vitest";
import {
  BOARD_MAX_ZOOM,
  BOARD_PIXEL_ZOOM,
  clampBoardZoom,
} from "../../../../src/renderer/app/board-zoom";

/**
 * 白板像素级查看的两个前提：
 *  1. 缩放上限必须能超过普通查看的 8 倍 —— 画布通常已缩小，8 倍到不了 1:1；
 *  2. 图片对象必须关闭平滑 —— 否则放大只是双线性模糊。
 * 第 2 条在 BoardCanvas 里作用于对象，这里覆盖第 1 条的钳制语义。
 */

describe("clampBoardZoom", () => {
  it("keeps the plain viewing ceiling by default", () => {
    expect(clampBoardZoom(100)).toBe(BOARD_MAX_ZOOM);
  });

  it("allows pixel-view zoom past the plain ceiling when a higher max is given", () => {
    // 旧签名不接受上限，像素级根本没法突破 8 倍。
    expect(clampBoardZoom(100, BOARD_PIXEL_ZOOM)).toBe(BOARD_PIXEL_ZOOM);
    expect(clampBoardZoom(32, BOARD_PIXEL_ZOOM)).toBe(32);
  });

  it("still refuses to go below the minimum in pixel view", () => {
    expect(clampBoardZoom(0.001, BOARD_PIXEL_ZOOM)).toBe(0.08);
  });

  it("falls back to the plain ceiling for an unusable max", () => {
    expect(clampBoardZoom(100, 0)).toBe(BOARD_MAX_ZOOM);
    expect(clampBoardZoom(100, Number.NaN)).toBe(BOARD_MAX_ZOOM);
  });

  it("keeps zoom 1 for non-finite input", () => {
    expect(clampBoardZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("pixel zoom ceiling is genuinely well above the viewing ceiling", () => {
    // 8 倍对 4000px 素材远远不够；这里确认常量本身没有被写回小值。
    expect(BOARD_PIXEL_ZOOM).toBeGreaterThan(BOARD_MAX_ZOOM * 4);
  });
});
