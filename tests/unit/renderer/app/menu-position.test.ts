import { describe, expect, it } from "vitest";
import {
  placeTriggerMenu,
  submenuOpensLeft,
} from "../../../../src/renderer/app/menu-position";

const viewport = { width: 1200, height: 800 };

describe("placeTriggerMenu", () => {
  it("opens below the trigger, left edges aligned, when there is room", () => {
    const placement = placeTriggerMenu(
      { left: 40, right: 80, top: 100, bottom: 140 },
      { width: 216, height: 300 },
      viewport,
    );
    expect(placement.left).toBe(40);
    expect(placement.top).toBe(146);
    expect(placement.maxHeight).toBe(646);
  });

  it("shifts left so a wide menu never overflows the right edge", () => {
    // Trigger sits near the right edge; left-aligning would run the 216px menu
    // off-screen, so it must shift until its right edge rests at the margin.
    const placement = placeTriggerMenu(
      { left: 1180, right: 1192, top: 60, bottom: 100 },
      { width: 216, height: 200 },
      viewport,
    );
    expect(placement.left).toBe(viewport.width - 216 - 8); // 976
    expect(placement.left + 216).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("never positions the menu left of the margin", () => {
    const placement = placeTriggerMenu(
      { left: -50, right: -10, top: 100, bottom: 140 },
      { width: 216, height: 200 },
      viewport,
    );
    expect(placement.left).toBe(8);
  });

  it("flips above the trigger when below lacks room but above has more", () => {
    // Trigger near the bottom: 40px below, ~700px above.
    const placement = placeTriggerMenu(
      { left: 40, right: 80, top: 720, bottom: 760 },
      { width: 216, height: 300 },
      viewport,
    );
    expect(placement.top).toBeLessThan(720);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    // Flipped menu still fits its clamped height above the trigger.
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(760);
  });

  it("clamps maxHeight so a tall menu scrolls instead of running off-screen", () => {
    const placement = placeTriggerMenu(
      { left: 40, right: 80, top: 40, bottom: 80 },
      { width: 216, height: 5000 },
      viewport,
    );
    expect(placement.top).toBe(86);
    expect(placement.maxHeight).toBe(viewport.height - 80 - 6 - 8); // 706
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(
      viewport.height,
    );
  });

  it("right-aligns the menu's right edge to the trigger with an align hint", () => {
    const placement = placeTriggerMenu(
      { left: 920, right: 1068, top: 100, bottom: 140 },
      { width: 148, height: 112 },
      viewport,
      6,
      8,
      "right",
    );
    expect(placement.left).toBe(1068 - 148); // 920
    expect(placement.left + 148).toBe(1068);
  });
});

describe("submenuOpensLeft", () => {
  it("keeps submenus opening right when the right side has room", () => {
    expect(submenuOpensLeft(220, 220, viewport.width)).toBe(false);
  });

  it("flips submenus left when the right side would overflow", () => {
    expect(submenuOpensLeft(1000, 220, viewport.width)).toBe(true);
  });
});
