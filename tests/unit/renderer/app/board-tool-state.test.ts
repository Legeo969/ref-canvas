import { describe, expect, it } from "vitest";
import {
  boardToolInteractionState,
  isBoardDrawingTool,
  toggleBoardDrawingTool,
  toggleBoardEraserTool,
} from "../../../../src/renderer/features/board/controllers/drawing-controller";

describe("board tool state", () => {
  it("keeps drawing, eraser, and selection mutually exclusive", () => {
    expect(toggleBoardEraserTool("pencil")).toBe("eraser");
    expect(toggleBoardEraserTool("eraser")).toBe("select");
    expect(toggleBoardDrawingTool("eraser", "pencil")).toBe("pencil");
    expect(toggleBoardDrawingTool("pencil", "pencil")).toBe("select");
    expect(isBoardDrawingTool("eraser")).toBe(false);
    expect(isBoardDrawingTool("line")).toBe(true);
  });

  it("disables every editing tool while the canvas is locked", () => {
    expect(boardToolInteractionState("select", true)).toEqual({
      selection: false,
      skipTargetFind: true,
      drawingMode: false,
    });
    expect(boardToolInteractionState("pencil", true)).toEqual({
      selection: false,
      skipTargetFind: true,
      drawingMode: false,
    });
    expect(boardToolInteractionState("select", false)).toEqual({
      selection: true,
      skipTargetFind: false,
      drawingMode: false,
    });
    expect(boardToolInteractionState("pencil", false)).toEqual({
      selection: false,
      skipTargetFind: true,
      drawingMode: true,
    });
  });
});
