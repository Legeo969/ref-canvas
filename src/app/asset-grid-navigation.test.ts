import { describe, expect, it } from "vitest";
import { assetGridNavigationTarget } from "./asset-grid-navigation";

const target = (
  key: Parameters<typeof assetGridNavigationTarget>[0]["key"],
  currentIndex: number,
  overrides: Partial<
    Omit<
      Parameters<typeof assetGridNavigationTarget>[0],
      "key" | "currentIndex"
    >
  > = {},
) =>
  assetGridNavigationTarget({
    key,
    currentIndex,
    itemCount: 20,
    columns: 4,
    visibleRows: 3,
    canLoadMore: false,
    ...overrides,
  });

describe("assetGridNavigationTarget", () => {
  it("moves by card, row, page and list edge", () => {
    expect(target("ArrowRight", 5)?.index).toBe(6);
    expect(target("ArrowDown", 5)?.index).toBe(9);
    expect(target("ArrowUp", 5)?.index).toBe(1);
    expect(target("PageDown", 5)?.index).toBe(17);
    expect(target("PageUp", 15)?.index).toBe(3);
    expect(target("Home", 15)?.index).toBe(0);
    expect(target("End", 2)?.index).toBe(19);
  });

  it("starts at the first card and clamps at loaded boundaries", () => {
    expect(target("ArrowDown", -1)).toEqual({
      index: 0,
      requestMore: false,
    });
    expect(target("ArrowLeft", 0)?.index).toBe(0);
    expect(target("PageUp", 2)?.index).toBe(0);
  });

  it("requests the next cursor page only when movement passes loaded items", () => {
    expect(
      target("ArrowDown", 18, { canLoadMore: true }),
    ).toEqual({ index: 19, requestMore: true });
    expect(
      target("ArrowDown", 18, { canLoadMore: false }),
    ).toEqual({ index: 19, requestMore: false });
    expect(target("End", 18, { canLoadMore: true })).toEqual({
      index: 19,
      requestMore: false,
    });
  });
});
