import { describe, expect, it } from "vitest";
import { parseBoardWindowParams } from "./board-window";

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
