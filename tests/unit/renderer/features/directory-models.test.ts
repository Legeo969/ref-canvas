import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "../../../../src/shared/contracts";
import {
  calculateDirectoryVirtualWindow,
  indexDirectoryPages,
  visibleDirectoryWindow,
} from "../../../../src/renderer/features/directory/directory-virtual-grid";
import { applyDirectorySelection } from "../../../../src/renderer/features/directory/directory-selection-model";
import { adjacentDirectoryPreviewPath } from "../../../../src/renderer/features/directory/directory-preview-coordinator";
import { resolveDirectorySelectionScope } from "../../../../src/renderer/features/directory/directory-query-model";

const entry = (path: string, isDirectory = false): DirectoryEntry => ({
  path,
  name: path,
  extension: isDirectory ? "" : "png",
  isDirectory,
  size: 1,
  mtimeMs: 1,
});

describe("directory domain models", () => {
  it("calculates a bounded overscanned virtual window", () => {
    const window = calculateDirectoryVirtualWindow({
      width: 320,
      height: 320,
      scrollTop: 1600,
      total: 1_000,
    });
    expect(window.columns).toBe(2);
    expect(window.startRow).toBe(8);
    expect(window.endRow).toBe(15);
    expect(window.startIndex).toBe(16);
    expect(window.endIndex).toBe(30);
  });

  it("list view forces a single column so the window tracks rows exactly", () => {
    // 回归：网格布局按卡片宽自适应出多列；列表视图必须与渲染共用单列，
    // 否则滚动后 startIndex 按多列行号推算、内容错位「丢失」。
    const multiColumn = calculateDirectoryVirtualWindow({
      width: 800,
      height: 400,
      scrollTop: 1600,
      total: 10_000,
      cardWidth: 148,
      gap: 12,
      rowHeight: 40,
    });
    expect(multiColumn.columns).toBe(5);

    const listWindow = calculateDirectoryVirtualWindow({
      width: 800,
      height: 400,
      scrollTop: 1600,
      total: 10_000,
      cardWidth: 148,
      gap: 12,
      rowHeight: 40,
      columns: 1,
    });
    expect(listWindow.columns).toBe(1);
    // 1600 / 40 = 第 40 行：首可见索引就是 40，而不是 40 × 5。
    expect(listWindow.firstVisibleRow).toBe(40);
    expect(listWindow.startIndex).toBe(38);
    expect(listWindow.startIndex).toBeLessThan(40 * 5);
    // (1600+400)/40 = 50 可见末行 + 3 overscan → endRow 53，索引 53。
    expect(listWindow.endIndex).toBe(53);
    expect(listWindow.endIndex).toBeLessThan(40 * 5);
  });

  it("indexes sparse pages without copying Fabric or React state", () => {
    const indexed = indexDirectoryPages(new Map([
      [0, [entry("a"), entry("b")]],
      [4, [entry("e")]],
    ]));
    expect(visibleDirectoryWindow(indexed, { startIndex: 1, endIndex: 5 }))
      .toEqual([
        { entry: entry("b"), absoluteIndex: 1 },
        { entry: null, absoluteIndex: 2 },
        { entry: null, absoluteIndex: 3 },
        { entry: entry("e"), absoluteIndex: 4 },
      ]);
  });

  it("owns all-matching exclusions and replacement selection", () => {
    const base = {
      selectedPaths: new Set<string>(),
      allMatchingSelected: true,
      excludedPaths: new Set<string>(),
      anchor: null,
    };
    const excluded = applyDirectorySelection({
      state: base,
      orderedPaths: ["a", "b"],
      path: "b",
      ctrl: true,
      shift: false,
    });
    expect([...excluded.excludedPaths]).toEqual(["b"]);
    const replaced = applyDirectorySelection({
      state: excluded,
      orderedPaths: ["a", "b"],
      path: "a",
      ctrl: false,
      shift: false,
    });
    expect(replaced.allMatchingSelected).toBe(false);
    expect([...replaced.selectedPaths]).toEqual(["a"]);
  });

  it("coordinates circular preview navigation while skipping folders", () => {
    expect(adjacentDirectoryPreviewPath(
      [entry("folder", true), entry("a"), entry("b")],
      "a",
      -1,
    )).toBe("b");
  });

  it("freezes a completed query selection and rejects incomplete scans", () => {
    const base = {
      allMatchingSelected: true,
      searchId: "search-1",
      searchComplete: true,
      searchRevision: "revision-1",
      directoryPath: "D:\\refs",
      directoryScanComplete: true,
      directoryRevision: "directory-revision",
      excludedPaths: new Set(["D:\\refs\\skip.png"]),
    };
    expect(resolveDirectorySelectionScope(base)).toEqual({
      mode: "search",
      searchId: "search-1",
      revision: "revision-1",
      excludedPaths: ["D:\\refs\\skip.png"],
    });
    expect(resolveDirectorySelectionScope({
      ...base,
      searchComplete: false,
    })).toBeNull();
  });
});
