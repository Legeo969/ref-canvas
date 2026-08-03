// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetPage, LibraryPreferences, LibraryStats, RefCanvasApi } from "../shared/contracts";
import { useAppStore } from "./store";

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
    const search = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? first.promise
        : Promise.resolve({ items: [], total: 2, nextCursor: null });
    });
    Object.assign(window, {
      refCanvas: {
        library: { search, stats: vi.fn(async () => stats) },
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
    const search = vi.fn(async () => ({ items: [], total: 0, nextCursor: null }));
    Object.assign(window, {
      refCanvas: {
        library: {
          search,
          stats: vi.fn(async () => stats),
          setPreferences: vi.fn(async () => ({
            ...preferences,
            includeSubfolderAssets: false,
          })),
        },
      } as unknown as RefCanvasApi,
    });

    await useAppStore.getState().setPreferences({ includeSubfolderAssets: false });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      collectionId: "11111111-1111-4111-8111-111111111111",
      includeSubcollections: false,
    }));
  });
});
