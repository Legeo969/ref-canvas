// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetPage, AssetRecord, LibraryPreferences, RefCanvasApi } from "../../../../src/shared/contracts";
import { useAppStore } from "../../../../src/renderer/app/store";

const preferences: LibraryPreferences = {
  panelLayout: { sidebarWidth: 220, assetWidth: 420, detailsWidth: 320, collapsed: [] },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  useAppStore.setState({
    assets: [],
    preferences,
  });
});

describe("asset query revisions", () => {
  it("does not let an older response replace a newer folder query", async () => {
    const first = deferred<AssetPage>();
    let calls = 0;
    const searchWindow = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? first.promise
        : Promise.resolve({ items: [], total: 2 });
    });
    Object.assign(window, {
      refCanvas: {
        library: { searchWindow },
      } as unknown as RefCanvasApi,
    });

    const oldReload = useAppStore.getState().reloadAssets();
    const newReload = useAppStore.getState().reloadAssets();
    await newReload;
    first.resolve({ items: [], total: 1, nextCursor: null });
    await oldReload;

    expect(useAppStore.getState().assets).toHaveLength(0);
  });

  it("opens the asset directory and emits a reveal request for the directory panel", async () => {
    const located = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Exact board reference",
      path: "C:\\refs\\board\\asset.mp4",
      lifecycle: "active",
    } as AssetRecord;
    const listDirectory = vi.fn(async () => ({
      entries: [{ path: located.path }],
      total: 1,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: { listDirectory },
      } as unknown as RefCanvasApi,
    });

    await useAppStore.getState().locateAssetInLibrary(located);

    const state = useAppStore.getState();
    expect(listDirectory).toHaveBeenCalledWith("C:\\refs\\board", { pageSize: 512 });
    expect(state.workspaceMode).toBe("directory");
    expect(state.directoryPath).toBe("C:\\refs\\board");
    expect(state.selectedDirectoryEntry).toBeNull();
    expect(state.directoryRevealRequest).toEqual({
      id: expect.any(Number),
      path: located.path,
    });
  });
});
