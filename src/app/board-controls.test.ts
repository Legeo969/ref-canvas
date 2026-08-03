// @vitest-environment jsdom

import { ActiveSelection, FabricImage, Rect } from "fabric";
import { describe, expect, it } from "vitest";
import { applyBoardControls, createBoardControls, supportsBoardControls } from "./board-controls";

describe("PureRef-style board controls", () => {
  it("uses quiet corner markers and separate outside rotation zones", () => {
    const controls = createBoardControls();
    expect(Object.keys(controls)).toEqual([
      "tl", "tr", "bl", "br", "rtl", "rtr", "rbl", "rbr",
    ]);
    expect(controls.tl.sizeX).toBe(20);
    expect(controls.rtl.offsetX).toBe(-18);
    expect(controls.rtl.offsetY).toBe(-18);
    expect(controls.rbr.offsetX).toBe(18);
    expect(controls.rbr.offsetY).toBe(18);
  });

  it("applies controls to images and multi-selection without changing plain shapes", () => {
    const image = new FabricImage(document.createElement("img"));
    const rect = new Rect({ width: 20, height: 20 });
    const selection = new ActiveSelection([rect]);
    expect(supportsBoardControls(image)).toBe(true);
    expect(supportsBoardControls(selection)).toBe(true);
    expect(supportsBoardControls(rect)).toBe(false);

    applyBoardControls(image);
    expect(image.cornerSize).toBe(8);
    expect(image.touchCornerSize).toBe(28);
    expect(image.borderScaleFactor).toBe(1);
    expect(image.controls.mtr).toBeUndefined();
  });
});
