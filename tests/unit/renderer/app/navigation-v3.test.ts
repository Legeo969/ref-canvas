// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserTab,
  migrateV2ToV3,
  parseNavigationStateV3,
  readDurableNavigationStateV3,
  readNavigationStateV3,
  updateNavigationStateV3,
  type BrowserTabState,
  type NavigationStateV3,
} from "../../../../src/renderer/app/navigation-v3";
import type { NavigationStateV2 } from "../../../../src/renderer/app/navigation-state";

const v2Fixture: NavigationStateV2 = {
  version: 2,
  updatedAt: 1,
  navigationSource: "directory",
  query: "#构图",
  kindFilter: "image",
  linkStateFilter: "all",
  lifecycleFilter: "active",
  ratingFilter: 0,
  colorFilter: "none",
  visualColor: null,
  visualColorTolerance: 25,
  sort: "createdAt",
  direction: "desc",
  collapsedTagGroupIds: [],
  assetKindsExpanded: false,
  showAllTags: false,
  scrollTop: 840,
  directoryPath: "D:\\refs\\art",
  directoryHistory: ["D:\\refs\\art"],
  directoryHistoryIndex: 0,
};

function v3Fixture(): NavigationStateV3 {
  const a = createBrowserTab("directory", "D:\\refs\\art", "art");
  const b = createBrowserTab("collection", "collection-1", "灵感");
  return {
    schemaVersion: 3,
    activeWorkspace: "browser",
    activeTabId: a.id,
    tabs: [a, b],
  };
}

describe("navigation v3", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "refCanvas");
  });

  it("migrates V2 to a single directory tab preserving query and scroll", () => {
    const v3 = migrateV2ToV3(v2Fixture);
    expect(v3.schemaVersion).toBe(3);
    expect(v3.activeWorkspace).toBe("browser");
    expect(v3.tabs).toHaveLength(1);
    expect(v3.tabs[0]).toMatchObject({
      kind: "directory",
      targetId: "D:\\refs\\art",
      query: "#构图",
      scrollOffset: 840,
    });
  });

  it("falls back to an empty directory tab when V2 has no directory", () => {
    const v3 = migrateV2ToV3({ ...v2Fixture, directoryPath: null });
    expect(v3.tabs).toHaveLength(1);
    expect(v3.tabs[0].targetId).toBe("browser://empty");
  });

  it("round-trips tabs with per-tab state", () => {
    const state = v3Fixture();
    state.tabs[0].backStack = ["D:\\refs\\art\\day1"];
    state.tabs[0].typeFilters = ["png", "jpg"];
    state.tabs[0].flattenDepth = 2;
    state.tabs[0].gridSize = 320;
    state.tabs[0].selectedKeys = ["a", "b"];
    state.tabs[0].scrollOffset = 1200;
    const parsed = parseNavigationStateV3(
      JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
    )!;
    expect(parsed).toEqual(state);
  });

  it("rejects structurally invalid V3 and accepts with defaults per tab", () => {
    expect(
      parseNavigationStateV3({ schemaVersion: 3, tabs: [] }),
    ).toBeNull();
    const parsed = parseNavigationStateV3({
      schemaVersion: 3,
      activeWorkspace: "board",
      activeTabId: "missing",
      tabs: [
        { id: "t1", kind: "directory", targetId: "C:\\a", flattenDepth: 99, gridSize: 5 },
        { kind: "collection", targetId: "" },
        "garbage",
      ],
    })!;
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.activeTabId).toBe("t1");
    expect(parsed.activeWorkspace).toBe("board");
    expect(parsed.tabs[0].flattenDepth).toBe(0);
    expect(parsed.tabs[0].gridSize).toBe(96); // 越界值钳制到允许范围
  });

  it("does not treat a tab target as its own history entry", () => {
    const state = v3Fixture();
    state.tabs[0].backStack = ["D:\\refs\\art", "D:\\refs\\art\\day1"];
    const parsed = parseNavigationStateV3(
      JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
    )!;
    expect(parsed.tabs[0].backStack).toEqual(["D:\\refs\\art\\day1"]);
  });

  it("persists locally and through the durable IPC mirror", async () => {
    const state = v3Fixture();
    const setNavigationState = vi.fn(() => Promise.resolve());
    (window as unknown as { refCanvas: unknown }).refCanvas = {
      system: {
        getNavigationState: vi.fn(() => Promise.resolve(JSON.stringify(state))),
        setNavigationState,
      },
    };
    updateNavigationStateV3(state);
    await Promise.resolve();
    const read = readNavigationStateV3(() => v2Fixture);
    expect(read.tabs).toHaveLength(2);
    const durable = await readDurableNavigationStateV3(() => v2Fixture);
    expect(durable).toEqual(state);
    expect(setNavigationState).toHaveBeenCalledWith(JSON.stringify(state));
  });

  it("falls back to local when durable read fails", async () => {
    const state = v3Fixture();
    window.localStorage.setItem("refcanvas.navigation.v3", JSON.stringify(state));
    (window as unknown as { refCanvas: unknown }).refCanvas = {
      system: {
        getNavigationState: vi.fn(() => Promise.reject(new Error("boom"))),
        setNavigationState: vi.fn(() => Promise.resolve()),
      },
    };
    const read = await readDurableNavigationStateV3(() => v2Fixture);
    expect(read).toEqual(state);
  });

  it("creates tabs with stable ids and defaults", () => {
    const tab: BrowserTabState = createBrowserTab("directory", "D:\\x", "x");
    expect(tab.id).toBeTruthy();
    expect(tab.backStack).toEqual([]);
    expect(tab.forwardStack).toEqual([]);
    expect(tab.typeFilters).toEqual([]);
    expect(tab.flattenDepth).toBe(0);
    expect(tab.gridSize).toBe(200);
    expect(tab.selectedKeys).toEqual([]);
    expect(tab.scrollOffset).toBe(0);
  });
});
