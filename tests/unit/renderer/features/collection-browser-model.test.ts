import { describe, expect, it } from "vitest";
import type { ReferenceCollectionItem } from "../../../../src/shared/contracts";
import {
  buildCollectionVirtualTree,
  filterCollectionItems,
  itemDisplayName,
  itemParentLabel,
  sortCollectionItems,
} from "../../../../src/renderer/features/collections/collection-browser-model";

function item(id: string, path: string, state: ReferenceCollectionItem["state"] = "resolved", createdAt = "2026-01-01T00:00:00.000Z"): ReferenceCollectionItem {
  return {
    id,
    collectionId: "c-1",
    identityId: null,
    mountId: null,
    relativePath: null,
    lastResolvedPath: path,
    pathKey: path.toLowerCase(),
    fingerprint: null,
    state,
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("collection browser model", () => {
  it("builds shared virtual folders for absolute paths", () => {
    const items = [
      item("a", "D:\\refs\\shots\\a.png"),
      item("b", "D:\\refs\\shots\\b.png", "missing"),
      item("c", "C:\\mood\\c.jpg"),
    ];
    const tree = buildCollectionVirtualTree(items);
    expect(tree.folders.get("")?.childIds).toEqual(["c:", "d:"]);
    expect(tree.folders.get("d:/refs/shots")?.itemIds).toEqual(["a", "b"]);
    expect(tree.folders.get("d:/refs/shots")?.attentionCount).toBe(1);
    expect(tree.folders.get("d:")?.fileCount).toBe(2);
    expect(tree.itemFolderIds.get("a")).toBe("d:/refs/shots");
  });

  it("filters by current virtual folder, all collection, query and state", () => {
    const items = [
      item("a", "D:\\refs\\shots\\a.png"),
      item("b", "D:\\refs\\shots\\b.png", "missing"),
      item("c", "D:\\refs\\mood\\c.jpg"),
    ];
    const tree = buildCollectionVirtualTree(items);
    expect(filterCollectionItems(items, tree, { folderId: "d:/refs/shots" }).map((value) => value.id)).toEqual(["a", "b"]);
    expect(filterCollectionItems(items, tree, { folderId: "d:/refs/shots", state: "missing" }).map((value) => value.id)).toEqual(["b"]);
    expect(filterCollectionItems(items, tree, { folderId: "d:/refs/shots", scope: "all", query: "mood" }).map((value) => value.id)).toEqual(["c"]);
  });

  it("sorts by status, newest added time, and stable name", () => {
    const items = [
      item("b", "D:\\b.png", "missing", "2026-01-01T00:00:00.000Z"),
      item("a", "D:\\a.png", "resolved", "2026-01-02T00:00:00.000Z"),
      item("c", "D:\\c.png", "offline", "2026-01-03T00:00:00.000Z"),
    ];
    expect(sortCollectionItems(items, "status").map((value) => value.id)).toEqual(["a", "c", "b"]);
    expect(sortCollectionItems(items, "added").map((value) => value.id)).toEqual(["c", "a", "b"]);
    expect(itemDisplayName(items[0])).toBe("b.png");
    expect(itemParentLabel(items[0])).toBe("D:");
  });
});
