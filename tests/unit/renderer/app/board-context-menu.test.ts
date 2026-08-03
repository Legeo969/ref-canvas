import { describe, expect, it } from "vitest";
import {
  clampBoardContextPosition,
  resolveBoardContext,
} from "../../../../src/renderer/app/board-context-menu";

describe("resolveBoardContext", () => {
  const first = { id: "first" };
  const second = { id: "second" };

  it("uses empty, single, and multi contexts from the actual right-click target", () => {
    expect(resolveBoardContext([first], undefined, false)).toEqual({
      mode: "empty",
    });
    expect(resolveBoardContext([first], second, false)).toEqual({
      mode: "single",
      target: second,
      selectTarget: true,
    });
    expect(resolveBoardContext([first, second], first, false)).toEqual({
      mode: "multi",
    });
    expect(resolveBoardContext([first, second], {} as typeof first, true)).toEqual({
      mode: "multi",
    });
  });
});

describe("clampBoardContextPosition", () => {
  it("keeps a fixed menu inside every viewport edge", () => {
    expect(clampBoardContextPosition(-20, -10, 1200, 800)).toEqual({
      x: 8,
      y: 8,
    });
    expect(clampBoardContextPosition(1190, 790, 1200, 800)).toEqual({
      x: 968,
      y: 432,
    });
  });
});
