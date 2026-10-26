import { describe, expect, it } from "vitest";
import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  clampBoardZoom,
} from "../../../../src/renderer/app/board-zoom";

describe("board zoom limits", () => {
  it("allows zooming well past 400% for pixel-level inspection", () => {
    // 旧上限就是 4（400%），4K 素材核对细节时不够用。
    expect(BOARD_MAX_ZOOM).toBeGreaterThan(4);
    expect(clampBoardZoom(4)).toBe(4);
    expect(clampBoardZoom(6)).toBe(6);
    expect(clampBoardZoom(BOARD_MAX_ZOOM)).toBe(BOARD_MAX_ZOOM);
  });

  it("clamps beyond the upper limit", () => {
    expect(clampBoardZoom(BOARD_MAX_ZOOM + 5)).toBe(BOARD_MAX_ZOOM);
    expect(clampBoardZoom(1000)).toBe(BOARD_MAX_ZOOM);
  });

  it("clamps below the lower limit", () => {
    expect(clampBoardZoom(0.001)).toBe(BOARD_MIN_ZOOM);
    expect(clampBoardZoom(0)).toBe(BOARD_MIN_ZOOM);
    expect(clampBoardZoom(-3)).toBe(BOARD_MIN_ZOOM);
  });

  it("falls back to 100% for non-finite input", () => {
    expect(clampBoardZoom(Number.NaN)).toBe(1);
    expect(clampBoardZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
