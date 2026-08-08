import { describe, expect, it } from "vitest";
import { toolbarPanelPosition } from "../../../../src/renderer/app/board-toolbar-position";

describe("toolbarPanelPosition", () => {
  it("right-aligns the panel below its trigger", () => {
    expect(
      toolbarPanelPosition({ right: 1204, bottom: 151 }, 1920, 1040),
    ).toEqual({ x: 952, y: 159, maxHeight: 873 });
  });

  it("keeps the panel inside both viewport edges", () => {
    expect(toolbarPanelPosition({ right: 100, bottom: 980 }, 300, 1024)).toEqual(
      { x: 8, y: 972, maxHeight: 44 },
    );
    expect(toolbarPanelPosition({ right: 900, bottom: 40 }, 800, 600)).toEqual(
      { x: 540, y: 48, maxHeight: 544 },
    );
  });

  it("tracks the trigger when the sidebar changes width", () => {
    const narrowSidebar = toolbarPanelPosition(
      { right: 1430, bottom: 112 },
      1600,
      900,
    );
    const wideSidebar = toolbarPanelPosition(
      { right: 1110, bottom: 112 },
      1600,
      900,
    );
    expect(narrowSidebar.x - wideSidebar.x).toBe(320);
    expect(narrowSidebar.y).toBe(wideSidebar.y);
  });

  it("uses fullscreen CSS viewport coordinates without device-pixel scaling", () => {
    expect(
      toolbarPanelPosition({ right: 2544, bottom: 72 }, 2560, 1440),
    ).toEqual({ x: 2292, y: 80, maxHeight: 1352 });
  });
});
