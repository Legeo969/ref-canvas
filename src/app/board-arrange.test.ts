import { describe, expect, it } from "vitest";
import {
  arrangeItems,
  uniformSize,
  type ArrangeableItem,
} from "./board-arrange";

const sampleItems: ArrangeableItem[] = [
  { id: "b", x: 100, y: 0, width: 200, height: 100, addedIndex: 2, title: "Beta", path: "C:\\b.png" },
  { id: "a", x: 0, y: 0, width: 100, height: 100, addedIndex: 0, title: "Alpha", path: "C:\\a.png" },
  { id: "c", x: 0, y: 300, width: 300, height: 60, addedIndex: 1, title: "Gamma", path: "C:\\c.png" },
];

describe("board arrange", () => {
  it("sorts by name with numeric-aware ordering", () => {
    const result = arrangeItems(sampleItems, { key: "name" });
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
    // First item starts at (0,0); items flow left-to-right.
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
  });

  it("sorts by added time and supports reverse", () => {
    const result = arrangeItems(sampleItems, { key: "added" });
    expect(result.map((item) => item.id)).toEqual(["a", "c", "b"]);
    const reversed = arrangeItems(sampleItems, { key: "added", reverse: true });
    expect(reversed.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by layer order and by path", () => {
    const byLayer = arrangeItems(sampleItems, { key: "layer" });
    expect(byLayer.map((item) => item.id)).toEqual(["a", "c", "b"]);
    const byPath = arrangeItems(sampleItems, { key: "path" });
    expect(byPath.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("deterministic seed shuffles reproducibly and stacks items", () => {
    const first = arrangeItems(sampleItems, { key: "random", seed: 42 });
    const second = arrangeItems(sampleItems, { key: "random", seed: 42 });
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(new Set(first.map((item) => item.id)).size).toBe(3);

    const stacked = arrangeItems(sampleItems, { key: "stack", gap: 0 });
    // Stack anchors on the first item in input order (b at x:100, y:0) and
    // offsets each subsequent item by a fixed step.
    expect(stacked[0]).toMatchObject({ x: 100, y: 0 });
    expect(stacked[1].x).toBeGreaterThan(stacked[0].x);
    expect(stacked[2].x).toBeGreaterThan(stacked[1].x);
  });

  it("uniform size scales to a target width preserving aspect", () => {
    const scaled = uniformSize(
      [{ id: "a", x: 0, y: 0, width: 200, height: 100, addedIndex: 0, title: "A", path: null }],
      { width: 400 },
    );
    // 200 -> 400 doubles both axes.
    expect(scaled[0].scaleX).toBeCloseTo(2);
    expect(scaled[0].scaleY).toBeCloseTo(2);
  });
});
