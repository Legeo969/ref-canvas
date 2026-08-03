// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  migrateNavigationState,
  navigationStateForCollections,
  parseNavigationState,
  readDurableNavigationState,
  readNavigationState,
  updateNavigationState,
} from "./navigation-state";

describe("navigation state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "refCanvas");
  });

  it("round-trips the last library location and tree state", () => {
    updateNavigationState({
      query: "#构图",
      collectionFilter: "folder-2",
      kindFilter: "image",
      collapsedFolderIds: ["folder-1"],
      collapsedTagGroupIds: ["lighting"],
      assetKindsExpanded: true,
      showAllTags: true,
      scrollTop: 840,
      minDuration: 2.5,
      maxSize: 20 * 1024 * 1024,
      extension: "png",
      orientation: "portrait",
      modifiedAfter: "2026-01-01T00:00:00.000Z",
    });

    expect(readNavigationState()).toMatchObject({
      version: 2,
      navigationSource: "library",
      directoryPath: null,
      query: "#构图",
      collectionFilter: "folder-2",
      kindFilter: "image",
      collapsedFolderIds: ["folder-1"],
      collapsedTagGroupIds: ["lighting"],
      assetKindsExpanded: true,
      showAllTags: true,
      scrollTop: 840,
      minDuration: 2.5,
      maxSize: 20 * 1024 * 1024,
      extension: "png",
      orientation: "portrait",
      modifiedAfter: "2026-01-01T00:00:00.000Z",
    });
  });

  it("preserves directory browsing source and history", () => {
    updateNavigationState({
      navigationSource: "directory",
      directoryPath: "D:\\refs\\art",
      directoryHistory: ["D:\\refs\\art"],
    });
    expect(readNavigationState()).toMatchObject({
      version: 2,
      navigationSource: "directory",
      directoryPath: "D:\\refs\\art",
      directoryHistory: ["D:\\refs\\art"],
    });
  });

  it("round-trips the directory history cursor and clamps out-of-range values", () => {
    updateNavigationState({
      navigationSource: "directory",
      directoryPath: "D:\\refs\\art\\day2",
      directoryHistory: [
        "D:\\refs\\art\\day2",
        "D:\\refs\\art\\day1",
        "D:\\refs\\art",
      ],
      directoryHistoryIndex: 1,
    });
    expect(readNavigationState()).toMatchObject({
      navigationSource: "directory",
      directoryHistoryIndex: 1,
    });

    // 越界索引回落到 0（历史数组最近优先，index 0 = 当前目录）。
    const clamped = parseNavigationState(
      JSON.stringify({
        version: 2,
        directoryPath: "D:\\refs\\art",
        directoryHistory: ["D:\\refs\\art"],
        directoryHistoryIndex: 7,
      }),
    );
    expect(clamped?.directoryHistoryIndex).toBe(0);
  });

  it("defaults the cursor to 0 when legacy data has no index", () => {
    const legacy = parseNavigationState(
      JSON.stringify({
        version: 2,
        directoryPath: "D:\\refs\\art",
        directoryHistory: ["D:\\refs\\art", "D:\\refs"],
      }),
    );
    expect(legacy?.directoryHistoryIndex).toBe(0);
  });

  it("sanitizes a negative cursor to the fallback", () => {
    const parsed = parseNavigationState(
      JSON.stringify({
        version: 2,
        directoryPath: "D:\\refs",
        directoryHistory: ["D:\\refs"],
        directoryHistoryIndex: -3,
      }),
    );
    expect(parsed?.directoryHistoryIndex).toBe(0);
  });

  it("migrates a v1 payload to v2 with directory defaults", () => {
    const migrated = parseNavigationState(
      JSON.stringify({
        version: 1,
        updatedAt: 123,
        query: "mesh",
        kindFilter: "image",
        collectionFilter: "folder-9",
        collapsedFolderIds: ["folder-1"],
        scrollTop: 40,
        sort: "title",
      }),
    );

    expect(migrated).toMatchObject({
      version: 2,
      navigationSource: "library",
      directoryPath: null,
      directoryHistory: [],
      assetKindsExpanded: false,
      query: "mesh",
      collectionFilter: "folder-9",
      collapsedFolderIds: ["folder-1"],
      scrollTop: 40,
      sort: "title",
    });
  });

  it("explicit migrateNavigationState upgrades in place", () => {
    const upgraded = migrateNavigationState({
      version: 1,
      updatedAt: 5,
      query: "",
      kindFilter: "all",
      collectionFilter: null,
      linkStateFilter: "all",
      lifecycleFilter: "active",
      ratingFilter: 0,
      colorFilter: "none",
      visualColor: null,
      visualColorTolerance: 25,
      sort: "createdAt",
      direction: "desc",
      collapsedFolderIds: [],
      collapsedTagGroupIds: [],
      showAllTags: false,
      scrollTop: 0,
    });
    expect(upgraded.version).toBe(2);
    expect(upgraded.navigationSource).toBe("library");
    expect(upgraded.directoryPath).toBeNull();
    expect(upgraded.directoryHistory).toEqual([]);
    expect(upgraded.assetKindsExpanded).toBe(false);
  });

  it("defaults a v2 state without assetKindsExpanded to collapsed", () => {
    const parsed = parseNavigationState(JSON.stringify({ version: 2 }));
    expect(parsed?.assetKindsExpanded).toBe(false);
  });

  it("ignores corrupt and unsupported versions", () => {
    expect(parseNavigationState("{not-json")).toBeNull();
    expect(parseNavigationState(JSON.stringify({ version: 99 }))).toBeNull();
  });

  it("sanitizes invalid enums and unsafe numeric values", () => {
    const state = parseNavigationState(
      JSON.stringify({
        version: 2,
        kindFilter: "script",
        colorFilter: "neon",
        sort: "unknown",
        ratingFilter: 99,
        scrollTop: -20,
        visualColor: "red",
      }),
    );

    expect(state).toMatchObject({
      kindFilter: "all",
      colorFilter: "none",
      sort: "createdAt",
      ratingFilter: 0,
      scrollTop: 0,
      visualColor: null,
    });
  });

  it("falls back when the remembered folder was deleted", () => {
    const state = readNavigationState();
    const sanitized = navigationStateForCollections(
      {
        ...state,
        collectionFilter: "deleted",
        collapsedFolderIds: ["kept", "deleted"],
      },
      new Set(["kept"]),
    );

    expect(sanitized.collectionFilter).toBeNull();
    expect(sanitized.collapsedFolderIds).toEqual(["kept"]);
  });

  it("restores a newer durable SQLite state when local storage is stale", async () => {
    updateNavigationState({ kindFilter: "image" });
    const durable = {
      ...readNavigationState(),
      updatedAt: Date.now() + 10_000,
      kindFilter: "video" as const,
    };
    Object.defineProperty(window, "refCanvas", {
      configurable: true,
      value: {
        system: {
          getNavigationState: vi.fn(async () => JSON.stringify(durable)),
          setNavigationState: vi.fn(async () => undefined),
        },
      },
    });

    await expect(readDurableNavigationState()).resolves.toMatchObject({
      kindFilter: "video",
      updatedAt: durable.updatedAt,
    });
    expect(readNavigationState().kindFilter).toBe("video");
  });
});
