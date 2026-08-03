// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";

/**
 * 库模式筛选入口必须把 navigationSource 重置为 "library"：
 * 目录浏览（Found 式）时点击侧边栏任何筛选项都应切回资料库，
 * 否则素材区仍显示目录浏览（"点击没反应"）。
 */
describe("library filter navigation reset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockLibrary = () => {
    Object.assign(window, {
      refCanvas: {
        library: {
          searchWindow: vi.fn(async () => ({ items: [], total: 0 })),
          stats: vi.fn(async () => ({
            total: 0,
            missing: 0,
            trashed: 0,
            favorites: 0,
            duplicates: 0,
            trashBytes: 0,
            byKind: {
              image: 0,
              video: 0,
              audio: 0,
              pdf: 0,
              model3d: 0,
              dcc: 0,
              font: 0,
              generic: 0,
            },
          })),
        },
      },
    });
  };

  const enterDirectoryMode = () => {
    useAppStore.setState({
      navigationSource: "directory",
      kindFilter: "all",
      collectionFilter: null,
    });
  };

  it("setKindFilter switches back from directory to library", async () => {
    mockLibrary();
    enterDirectoryMode();
    expect(useAppStore.getState().navigationSource).toBe("directory");
    await useAppStore.getState().setKindFilter("image");
    expect(useAppStore.getState().navigationSource).toBe("library");
    expect(useAppStore.getState().kindFilter).toBe("image");
  });

  it("setTagFilter switches back from directory to library", async () => {
    mockLibrary();
    enterDirectoryMode();
    await useAppStore.getState().setTagFilter("构图");
    expect(useAppStore.getState().navigationSource).toBe("library");
    expect(useAppStore.getState().query).toBe("#构图");
  });

  it("showTrash and showFavorites switch back to library", async () => {
    mockLibrary();
    enterDirectoryMode();
    await useAppStore.getState().showTrash();
    expect(useAppStore.getState().navigationSource).toBe("library");
    expect(useAppStore.getState().lifecycleFilter).toBe("trashed");

    enterDirectoryMode();
    await useAppStore.getState().showFavorites();
    expect(useAppStore.getState().navigationSource).toBe("library");
    expect(useAppStore.getState().favoriteFilter).toBe(true);
  });

  it("setSort and setAdvancedFilters switch back to library", async () => {
    mockLibrary();
    enterDirectoryMode();
    await useAppStore.getState().setSort("title", "asc");
    expect(useAppStore.getState().navigationSource).toBe("library");

    enterDirectoryMode();
    await useAppStore.getState().setAdvancedFilters({ minWidth: 100 });
    expect(useAppStore.getState().navigationSource).toBe("library");
    expect(useAppStore.getState().minWidth).toBe(100);
  });
});
