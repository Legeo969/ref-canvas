import { describe, expect, it } from "vitest";
import {
  SIDEBAR_LAYOUT_DEFAULTS,
} from "../../../../src/shared/contracts";
import {
  MAX_BOARD,
  MIN_BOARD,
  MIN_COLLECTIONS,
  MIN_DIRECTORY,
  MIN_QUICK_ACCESS,
  SPLITTER_HEIGHT,
  clampSidebarLayout,
  collectionsFloor,
  fitSidebarLayout,
} from "../../../../src/renderer/app/sidebar-layout";

describe("sidebar layout", () => {
  it("reserves the minimum for an expanded collections pane and the actual height when collapsed", () => {
    // 展开：集合可收缩到 min-height，约束只预留 100。
    expect(collectionsFloor(320, false)).toBe(MIN_COLLECTIONS);
    // 折叠：flex 0 0 auto + height auto，占多少留多少。
    expect(collectionsFloor(32, true)).toBe(32);
    expect(collectionsFloor(0, true)).toBe(1);
  });

  it("keeps the layout untouched when it already fits", () => {
    expect(fitSidebarLayout(SIDEBAR_LAYOUT_DEFAULTS, 900, MIN_COLLECTIONS))
      .toEqual(SIDEBAR_LAYOUT_DEFAULTS);
  });

  it("shrinks proportionally on overflow without breaking panel minimums", () => {
    // 默认总和 852（270+290+100+180+12）：720 可用 → 溢出 144。
    const fitted = fitSidebarLayout(SIDEBAR_LAYOUT_DEFAULTS, 720, MIN_COLLECTIONS);
    expect(fitted.quickAccessHeight).toBeGreaterThanOrEqual(MIN_QUICK_ACCESS);
    expect(fitted.directoryHeight).toBeGreaterThanOrEqual(MIN_DIRECTORY);
    expect(fitted.boardHeight).toBeGreaterThanOrEqual(MIN_BOARD);
    const total =
      fitted.quickAccessHeight +
      fitted.directoryHeight +
      fitted.boardHeight +
      SPLITTER_HEIGHT * 3 +
      MIN_COLLECTIONS;
    expect(total).toBeLessThanOrEqual(720);
    // 等比扣减：三个面板都变小而不是某一个独吞。
    expect(fitted.quickAccessHeight).toBeLessThan(270);
    expect(fitted.directoryHeight).toBeLessThan(290);
    expect(fitted.boardHeight).toBeLessThan(180);
  });

  it("clamps to panel minimums when overflow exceeds all slack", () => {
    const fitted = fitSidebarLayout(SIDEBAR_LAYOUT_DEFAULTS, 300, MIN_COLLECTIONS);
    expect(fitted).toEqual({
      quickAccessHeight: MIN_QUICK_ACCESS,
      directoryHeight: MIN_DIRECTORY,
      boardHeight: MIN_BOARD,
    });
  });

  it("never grows panels when fitting", () => {
    const fitted = fitSidebarLayout(
      { quickAccessHeight: 200, directoryHeight: 220, boardHeight: 150 },
      400,
      32,
    );
    expect(fitted.quickAccessHeight).toBeLessThanOrEqual(200);
    expect(fitted.directoryHeight).toBeLessThanOrEqual(220);
    // board 已在 420 上限之下；收紧结果也不得超过原值。
    expect(fitted.boardHeight).toBeLessThanOrEqual(150);
  });

  it("clamps restored persisted heights into legal ranges", () => {
    expect(
      clampSidebarLayout({
        quickAccessHeight: 10,
        directoryHeight: 99_999,
        boardHeight: 900,
      }),
    ).toEqual({
      quickAccessHeight: MIN_QUICK_ACCESS,
      directoryHeight: 8_192,
      boardHeight: MAX_BOARD,
    });
  });
});
