import { describe, expect, it } from "vitest";
import {
  applySelectionClick,
  rangeSelect,
  toggleSelect,
} from "./directory-selection";

const ordered = ["a", "b", "c", "d", "e"];

describe("rangeSelect", () => {
  it("selects anchor → target inclusive in either direction", () => {
    expect([...rangeSelect(ordered, "b", "d")]).toEqual(["b", "c", "d"]);
    expect([...rangeSelect(ordered, "d", "b")]).toEqual(["b", "c", "d"]);
  });

  it("falls back to single selection without a valid anchor", () => {
    expect([...rangeSelect(ordered, null, "c")]).toEqual(["c"]);
    expect([...rangeSelect(ordered, "missing", "c")]).toEqual(["c"]);
  });
});

describe("toggleSelect", () => {
  it("adds and removes targets", () => {
    expect([...toggleSelect(new Set(["a"]), "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleSelect(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
});

describe("applySelectionClick", () => {
  it("plain click selects one item and moves the anchor", () => {
    const result = applySelectionClick(new Set(["a"]), ordered, "a", "c", {
      ctrl: false,
      shift: false,
    });
    expect([...result.selection]).toEqual(["c"]);
    expect(result.anchor).toBe("c");
  });

  it("ctrl click toggles without moving the anchor", () => {
    const result = applySelectionClick(new Set(["a"]), ordered, "a", "b", {
      ctrl: true,
      shift: false,
    });
    expect([...result.selection].sort()).toEqual(["a", "b"]);
    expect(result.anchor).toBe("b");
  });

  it("shift click selects the range from the anchor", () => {
    const result = applySelectionClick(new Set(["a"]), ordered, "a", "c", {
      ctrl: false,
      shift: true,
    });
    expect([...result.selection]).toEqual(["a", "b", "c"]);
    expect(result.anchor).toBe("a");
  });
});
