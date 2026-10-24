// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  migrateNavigationState,
  parseNavigationState,
  readDurableNavigationState,
  readNavigationState,
  updateNavigationState,
} from "../../../../src/renderer/app/navigation-state";

describe("navigation state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "refCanvas");
  });

  it("round-trips the scroll offset and ignores legacy filter keys", () => {
    updateNavigationState({ scrollTop: 840 });

    expect(readNavigationState()).toMatchObject({
      version: 2,
      navigationSource: "directory",
      directoryPath: null,
      scrollTop: 840,
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
        scrollTop: 40,
      }),
    );

    expect(migrated).toMatchObject({
      version: 2,
      navigationSource: "directory",
      directoryPath: null,
      directoryHistory: [],
      scrollTop: 40,
    });
  });

  it("explicit migrateNavigationState upgrades in place", () => {
    const upgraded = migrateNavigationState({
      version: 1,
      updatedAt: 5,
      scrollTop: 0,
    });
    expect(upgraded.version).toBe(2);
    expect(upgraded.navigationSource).toBe("directory");
    expect(upgraded.directoryPath).toBeNull();
    expect(upgraded.directoryHistory).toEqual([]);
  });

  it("ignores corrupt and unsupported versions", () => {
    expect(parseNavigationState("{not-json")).toBeNull();
    expect(parseNavigationState(JSON.stringify({ version: 99 }))).toBeNull();
  });

  it("sanitizes unsafe numeric values", () => {
    const state = parseNavigationState(
      JSON.stringify({
        version: 2,
        scrollTop: -20,
      }),
    );

    expect(state).toMatchObject({
      scrollTop: 0,
    });
  });

  it("restores a newer durable SQLite state when local storage is stale", async () => {
    updateNavigationState({ scrollTop: 100 });
    const durable = {
      ...readNavigationState(),
      updatedAt: Date.now() + 10_000,
      scrollTop: 900,
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
      scrollTop: 900,
      updatedAt: durable.updatedAt,
    });
    expect(readNavigationState().scrollTop).toBe(900);
  });
});
