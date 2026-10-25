import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isStandaloneBoardWindow,
  parseBoardWindowParams,
  shouldLiftInteraction,
} from "../../../../src/renderer/app/board-window";

const BOARD_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("parseBoardWindowParams", () => {
  it("parses a valid board window URL", () => {
    expect(
      parseBoardWindowParams(`?board=${BOARD_ID}&mode=window`),
    ).toEqual({ mode: "window", boardId: BOARD_ID });
  });

  it("returns null for non-window modes", () => {
    expect(parseBoardWindowParams("")).toBeNull();
    expect(parseBoardWindowParams("?mode=library")).toBeNull();
    expect(parseBoardWindowParams("?fps=1")).toBeNull();
  });

  it("rejects missing or malformed board ids", () => {
    expect(parseBoardWindowParams("?mode=window")).toBeNull();
    expect(parseBoardWindowParams("?mode=window&board=not-a-uuid")).toBeNull();
    expect(parseBoardWindowParams("?mode=window&board=123")).toBeNull();
  });
});

describe("isStandaloneBoardWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true only for standalone board window URLs", () => {
    vi.stubGlobal("window", {
      location: { search: `?board=${BOARD_ID}&mode=window` },
    });
    expect(isStandaloneBoardWindow()).toBe(true);
    // 主窗口（无参数 / 其它模式 / 非法 board 参数）恒不判定为独立窗口。
    vi.stubGlobal("window", { location: { search: "" } });
    expect(isStandaloneBoardWindow()).toBe(false);
    vi.stubGlobal("window", { location: { search: "?mode=library" } });
    expect(isStandaloneBoardWindow()).toBe(false);
    vi.stubGlobal("window", {
      location: { search: "?mode=window&board=not-a-uuid" },
    });
    expect(isStandaloneBoardWindow()).toBe(false);
  });
});

describe("shouldLiftInteraction", () => {
  it("lifts only while a popover is open in a standalone window", () => {
    expect(shouldLiftInteraction(true, true, false, false)).toBe(true);
    expect(shouldLiftInteraction(true, false, true, false)).toBe(true);
    expect(shouldLiftInteraction(true, false, false, true)).toBe(true);
    // 无弹层打开即还原。
    expect(shouldLiftInteraction(true, false, false, false)).toBe(false);
    // 主窗口工作区恒不抬升（不发 IPC）。
    expect(shouldLiftInteraction(false, true, true, true)).toBe(false);
  });
});
