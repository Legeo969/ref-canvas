// @vitest-environment jsdom

import { ActiveSelection, Rect, classRegistry, type Canvas } from "fabric";
import { describe, expect, it, vi } from "vitest";
import { applyBoardControls } from "../../../../src/renderer/app/board-controls";
import {
  BOARD_MEMBER_CONTROL_LIMIT,
  BoardActiveSelection,
  installBoardActiveSelection,
  optimizeBoardActiveSelection,
  selectAllBoardObjects,
} from "../../../../src/renderer/app/board-active-selection";

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

describe("BoardActiveSelection", () => {
  it("registers the optimized class for Fabric-created marquee selections", () => {
    installBoardActiveSelection();

    const SelectionClass = classRegistry.getClass<typeof ActiveSelection>(
      "ActiveSelection",
    );

    expect(new SelectionClass([])).toBeInstanceOf(BoardActiveSelection);
  });

  it("upgrades Fabric marquee selections in place without rebuilding their members", () => {
    const members = Array.from(
      { length: 2_000 },
      () => new Rect({ width: 2, height: 2 }),
    );
    const nativeSelection = new ActiveSelection(members);

    const optimized = optimizeBoardActiveSelection(nativeSelection);

    expect(optimized).toBe(nativeSelection);
    expect(optimized).toBeInstanceOf(BoardActiveSelection);
    expect(optimized.getObjects()).toEqual(members);
  });

  it("culls offscreen selection members while preserving visible members", () => {
    const visible = new Rect({ width: 20, height: 20 });
    const offscreen = new Rect({ width: 20, height: 20 });
    const selection = new BoardActiveSelection([visible, offscreen]);
    selection._set(
      "canvas",
      { skipOffscreen: true, preserveObjectStacking: false } as Canvas,
    );
    vi.spyOn(visible, "isOnScreen").mockReturnValue(true);
    vi.spyOn(offscreen, "isOnScreen").mockReturnValue(false);
    const renderVisible = vi.spyOn(visible, "render").mockImplementation(() => undefined);
    const renderOffscreen = vi.spyOn(offscreen, "render").mockImplementation(() => undefined);

    selection.drawObject(
      controlContext,
      false,
      {
        parentClipPaths: [],
        width: 1,
        height: 1,
        cacheTranslationX: 0,
        cacheTranslationY: 0,
        zoomX: 1,
        zoomY: 1,
      } as Parameters<BoardActiveSelection["drawObject"]>[2],
    );

    expect(renderVisible).toHaveBeenCalledOnce();
    expect(renderOffscreen).not.toHaveBeenCalled();
  });

  it("keeps culling when Fabric preserves object stacking", () => {
    const visible = new Rect({ width: 20, height: 20 });
    const offscreen = new Rect({ width: 20, height: 20 });
    const selection = new BoardActiveSelection([visible, offscreen]);
    const transform = vi.fn();
    const renderingContext = new Proxy(
      {
        canvas: document.createElement("canvas"),
        transform,
      } as unknown as CanvasRenderingContext2D,
      {
        get(target, property) {
          if (property in target) return target[property as keyof typeof target];
          return () => undefined;
        },
        set: () => true,
      },
    );
    selection._set(
      "canvas",
      { skipOffscreen: true, preserveObjectStacking: true } as Canvas,
    );
    visible._set("group", undefined);
    vi.spyOn(visible, "isOnScreen").mockReturnValue(true);
    vi.spyOn(offscreen, "isOnScreen").mockReturnValue(false);
    const renderVisible = vi.spyOn(visible, "render").mockImplementation(() => undefined);
    const renderOffscreen = vi.spyOn(offscreen, "render").mockImplementation(() => undefined);

    selection.drawObject(
      renderingContext,
      false,
      {
        parentClipPaths: [],
        width: 1,
        height: 1,
        cacheTranslationX: 0,
        cacheTranslationY: 0,
        zoomX: 1,
        zoomY: 1,
      } as Parameters<BoardActiveSelection["drawObject"]>[2],
    );

    expect(renderVisible).toHaveBeenCalledOnce();
    expect(renderOffscreen).not.toHaveBeenCalled();
    expect(transform).toHaveBeenCalledOnce();
  });

  it("retains member controls for normal-size selections", () => {
    const members = Array.from(
      { length: BOARD_MEMBER_CONTROL_LIMIT },
      () => new Rect({ width: 20, height: 20 }),
    );
    const selection = new BoardActiveSelection(members);
    selection.hasControls = false;
    const renders = members.map((member) =>
      vi.spyOn(member, "_renderControls").mockImplementation(() => undefined),
    );

    selection._renderControls(controlContext);

    expect(renders.every((render) => render.mock.calls.length === 1)).toBe(true);
  });

  it("renders aggregate controls but not member controls for large selections", () => {
    const members = Array.from(
      { length: BOARD_MEMBER_CONTROL_LIMIT + 1 },
      () => new Rect({ width: 20, height: 20 }),
    );
    const selection = new BoardActiveSelection(members);
    applyBoardControls(selection);
    const aggregateControls = vi
      .spyOn(selection, "drawControls")
      .mockImplementation(() => undefined);
    const memberControls = members.map((member) =>
      vi.spyOn(member, "_renderControls").mockImplementation(() => undefined),
    );

    selection._renderControls(controlContext);

    expect(aggregateControls).toHaveBeenCalledOnce();
    expect(memberControls.every((render) => render.mock.calls.length === 0)).toBe(true);
  });

  it("selects all eligible objects with one scheduled repaint", () => {
    const first = new Rect({ selectable: true });
    const second = new Rect({ selectable: true });
    const guide = new Rect({ selectable: true });
    (guide as typeof guide & { data: { guideAxis: "x" } }).data = { guideAxis: "x" };
    const requestRenderAll = vi.fn();
    const setActiveObject = vi.fn();
    const canvas = {
      fire: vi.fn(),
      getObjects: () => [first, second, guide],
      requestRenderAll,
      setActiveObject,
    } as unknown as Canvas;

    selectAllBoardObjects(canvas);

    const selection = setActiveObject.mock.calls[0][0] as BoardActiveSelection;
    expect(selection).toBeInstanceOf(BoardActiveSelection);
    expect(selection.getObjects()).toEqual([first, second]);
    expect(requestRenderAll).toHaveBeenCalledTimes(1);
  });
});
