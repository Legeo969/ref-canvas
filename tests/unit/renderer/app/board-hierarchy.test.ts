import { describe, expect, it } from "vitest";
import { Rect, util, type TMat2D } from "fabric";
import {
  applyHierarchyTransform,
  canSetHierarchyParent,
  flattenHierarchy,
  hierarchyDescendantIds,
  hierarchyTransformDelta,
} from "../../../../src/renderer/app/board-hierarchy";

const items = [
  { id: "root" },
  { id: "child", parentId: "root" },
  { id: "grandchild", parentId: "child" },
  { id: "other" },
];

describe("board hierarchy", () => {
  it("returns all descendants without including the parent", () => {
    expect(hierarchyDescendantIds(items, "root")).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("rejects self-parenting and descendant cycles", () => {
    expect(canSetHierarchyParent(items, "root", "root")).toBe(false);
    expect(canSetHierarchyParent(items, "root", "grandchild")).toBe(false);
    expect(canSetHierarchyParent(items, "other", "child")).toBe(true);
  });

  it("flattens parents before their indented children", () => {
    expect(flattenHierarchy(items)).toEqual([
      { id: "root", depth: 0, hasChildren: true },
      { id: "child", depth: 1, hasChildren: true },
      { id: "grandchild", depth: 2, hasChildren: false },
      { id: "other", depth: 0, hasChildren: false },
    ]);
  });

  it("applies parent translation, scale, and rotation deltas to a child", () => {
    const child = new Rect({
      left: 20,
      top: 10,
      width: 30,
      height: 20,
      originX: "center",
      originY: "center",
    });
    const previous: TMat2D = [1, 0, 0, 1, 0, 0];
    const current = util.composeMatrix({
      translateX: 50,
      translateY: 30,
      scaleX: 2,
      scaleY: 2,
      angle: 90,
    });

    applyHierarchyTransform(
      child,
      hierarchyTransformDelta(previous, current),
    );

    expect(child.angle).toBeCloseTo(90);
    expect(child.scaleX).toBeCloseTo(2);
    expect(child.scaleY).toBeCloseTo(2);
    expect(child.left).toBeCloseTo(30);
    expect(child.top).toBeCloseTo(70);
  });
});
