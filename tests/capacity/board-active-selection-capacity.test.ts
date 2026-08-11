// @vitest-environment jsdom

import { Rect, type Canvas } from "fabric";
import { describe, expect, it, vi } from "vitest";
import { applyBoardControls } from "../../src/renderer/app/board-controls";
import {
  BoardActiveSelection,
  selectAllBoardObjects,
} from "../../src/renderer/app/board-active-selection";

const controlContext = new Proxy(
  { canvas: document.createElement("canvas") } as unknown as CanvasRenderingContext2D,
  {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return () => undefined;
    },
    set: () => true,
  },
);

describe("board active-selection capacity", () => {
  it("selects 1,000 objects without rendering per-member controls", () => {
    const members = Array.from(
      { length: 1_000 },
      () => new Rect({ width: 20, height: 20 }),
    );
    const requestRenderAll = vi.fn();
    const setActiveObject = vi.fn();
    const canvas = {
      fire: vi.fn(),
      getObjects: () => members,
      requestRenderAll,
      setActiveObject,
    } as unknown as Canvas;

    selectAllBoardObjects(canvas);

    const selection = setActiveObject.mock.calls[0][0] as BoardActiveSelection;
    applyBoardControls(selection);
    const aggregateControls = vi
      .spyOn(selection, "drawControls")
      .mockImplementation(() => undefined);
    const memberControls = members.map((member) =>
      vi.spyOn(member, "_renderControls").mockImplementation(() => undefined),
    );

    selection._renderControls(controlContext);

    expect(selection).toBeInstanceOf(BoardActiveSelection);
    expect(requestRenderAll).toHaveBeenCalledTimes(1);
    expect(aggregateControls).toHaveBeenCalledOnce();
    expect(memberControls.every((render) => render.mock.calls.length === 0)).toBe(true);
  });
});
