// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetPage, AssetRecord, AssetSearchWindowInput, LibraryPreferences, LibraryStats, RefCanvasApi } from "../../../../src/shared/contracts";
import { MAX_RESIDENT_ASSET_PAGES, ASSET_PAGE_SIZE, useAppStore } from "../../../../src/renderer/app/store";

const stats: LibraryStats = {
  total: 0,
  missing: 0,
  trashed: 0,
  favorites: 0,
  duplicates: 0,
  trashBytes: 0,
  byKind: { image: 0, video: 0, audio: 0, pdf: 0, model3d: 0, dcc: 0, font: 0, generic: 0 },
};

const preferences: LibraryPreferences = {
  layoutMode: "grid",
  cardSize: "medium",
  thumbnailBackground: "checker",
  includeSubfolderAssets: true,
  panelLayout: { sidebarWidth: 220, assetWidth: 420, detailsWidth: 320, collapsed: [] },
  defaultStorageMode: "linked",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  useAppStore.setState({
    assets: [],
    totalAssets: 0,
    nextCursor: null,
    collectionFilter: "11111111-1111-4111-8111-111111111111",
    preferences,
    selectedIds: new Set(),
    excludedIds: new Set(),
    allMatchingSelected: false,
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
        library: { searchWindow, stats: vi.fn(async () => stats) },
      } as unknown as RefCanvasApi,
    });

    const oldReload = useAppStore.getState().reloadAssets();
    const newReload = useAppStore.getState().reloadAssets();
    await newReload;
    first.resolve({ items: [], total: 1, nextCursor: null });
    await oldReload;

    expect(useAppStore.getState().totalAssets).toBe(2);
  });

  it("reloads the active collection when includeSubfolderAssets changes", async () => {
    const searchWindow = vi.fn(async () => ({ items: [], total: 0 }));
    Object.assign(window, {
      refCanvas: {
        library: {
          searchWindow,
          stats: vi.fn(async () => stats),
          setPreferences: vi.fn(async () => ({
            ...preferences,
            includeSubfolderAssets: false,
          })),
        },
      } as unknown as RefCanvasApi,
    });

    await useAppStore.getState().setPreferences({ includeSubfolderAssets: false });

    expect(searchWindow).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({
        collectionId: "11111111-1111-4111-8111-111111111111",
        includeSubcollections: false,
      }),
      includeTotal: true,
    }));
  });

  it("keeps at most twelve 200-item pages while navigating by absolute index", async () => {
    const total = 500_000;
    const searchWindow = vi.fn(async (input: AssetSearchWindowInput) => ({
      items: Array.from(
        { length: Math.min(input.pageSize, total - input.offset) },
        (_, index) => ({ id: `asset-${input.offset + index}` }) as AssetRecord,
      ),
      total: input.includeTotal ? total : null,
    }));
    Object.assign(window, {
      refCanvas: {
        library: { searchWindow, stats: vi.fn(async () => stats) },
      } as unknown as RefCanvasApi,
    });

    await useAppStore.getState().reloadAssets();
    for (let page = 1; page <= 15; page += 1) {
      const start = page * ASSET_PAGE_SIZE;
      await useAppStore.getState().ensureAssetRange(start, start);
      expect(useAppStore.getState().assets.length).toBeLessThanOrEqual(
        MAX_RESIDENT_ASSET_PAGES * ASSET_PAGE_SIZE,
      );
    }

    const state = useAppStore.getState();
    expect(state.assets).toHaveLength(2_400);
    expect(state.assetAt(3_000)?.id).toBe("asset-3000");
    expect(searchWindow.mock.calls[0][0].includeTotal).toBe(true);
    expect(searchWindow.mock.calls.slice(1).every(([input]) => !input.includeTotal)).toBe(true);
  });

  it("locates a board asset in an unfiltered library result", async () => {
    const located = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Exact board reference",
      lifecycle: "active",
    } as AssetRecord;
    const searchWindow = vi.fn(async () => ({ items: [located], total: 1 }));
    Object.assign(window, {
      refCanvas: {
        library: { searchWindow, stats: vi.fn(async () => stats) },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      navigationSource: "directory",
      query: "old query",
      kindFilter: "video",
      favoriteFilter: true,
      ratingFilter: 5,
    });

    await useAppStore.getState().locateAssetInLibrary(located);

    const state = useAppStore.getState();
    expect(searchWindow).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({
        query: located.title,
        kind: "all",
        favorite: undefined,
        ratingMin: undefined,
      }),
      offset: 0,
      includeTotal: true,
    }));
    expect(state.navigationSource).toBe("library");
    expect(state.selectedAsset?.id).toBe(located.id);
    expect(state.selectedIds).toEqual(new Set([located.id]));
  });
});
