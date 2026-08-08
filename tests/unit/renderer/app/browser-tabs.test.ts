// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";

describe("browser tabs (FND-002 §5.2)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "refCanvas");
  });

  function installRefCanvas() {
    const listDirectory = vi.fn(async (path: string) => ({
      entries: [
        { path: `${path}\\a.png`, name: "a.png", extension: "png", size: 100, isDirectory: false },
      ],
      total: 1,
      nextCursor: null,
      scanState: "complete",
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          listRoots: vi.fn(async () => []),
          onDirectoryProgress: () => () => undefined,
        },
        system: {
          getAppInfo: vi.fn(async () => ({})),
          markRendererInteractive: vi.fn(async () => undefined),
        },
        mounts: { list: vi.fn(async () => []) },
        boards: { list: vi.fn(async () => []) },
        library: {
          listTags: vi.fn(async () => []),
          listTagGroups: vi.fn(async () => []),
          listSavedViews: vi.fn(async () => []),
          getPreferences: vi.fn(async () => ({})),
          searchWindow: vi.fn(async () => ({ items: [], total: 0, offset: 0 })),
          stats: vi.fn(async () => ({})),
          onImportProgress: () => () => undefined,
          onLibraryChanged: () => () => undefined,
        },
        collections: {
          list: vi.fn(async () => []),
          listItems: vi.fn(async () => []),
          onChanged: () => () => undefined,
        },
      },
    });
    return listDirectory;
  }

  it("creates tabs, switches between them without mixing state, and closes the last one into an empty tab", async () => {
    const listDirectory = installRefCanvas();
    // 手动初始化标签状态（不跑 initialize）。
    useAppStore.setState({
      browserTabs: [],
      activeTabId: "",
      directoryPath: null,
      directoryHistory: [],
      directoryHistoryIndex: 0,
    });

    await useAppStore.getState().createBrowserTabForPath("D:\\a");
    let state = useAppStore.getState();
    expect(state.browserTabs).toHaveLength(1);
    expect(state.directoryPath).toBe("D:\\a");
    expect(listDirectory).toHaveBeenCalledWith("D:\\a", expect.anything());

    await useAppStore.getState().createBrowserTabForPath("D:\\b");
    state = useAppStore.getState();
    expect(state.browserTabs).toHaveLength(2);
    expect(state.activeTabId).toBe(state.browserTabs[1].id);
    expect(state.directoryPath).toBe("D:\\b");

    // 切回第一个标签 → 恢复 D:\a。
    await useAppStore.getState().switchBrowserTab(state.browserTabs[0].id);
    state = useAppStore.getState();
    expect(state.directoryPath).toBe("D:\\a");
    expect(state.activeTabId).toBe(state.browserTabs[0].id);

    // 重排：把第二个标签拖到第一个位置。
    useAppStore.getState().reorderBrowserTab(state.browserTabs[1].id, state.browserTabs[0].id);
    state = useAppStore.getState();
    expect(state.browserTabs[0].targetId).toBe("D:\\b");

    // 关闭标签直到只剩一个 → 关闭最后一个自动创建空目录标签。
    await useAppStore.getState().closeBrowserTab(state.browserTabs[1].id);
    state = useAppStore.getState();
    expect(state.browserTabs).toHaveLength(1);
    const lastId = state.browserTabs[0].id;
    await useAppStore.getState().closeBrowserTab(lastId);
    state = useAppStore.getState();
    expect(state.browserTabs).toHaveLength(1);
    expect(state.browserTabs[0].targetId).toBe("browser://empty");
  });

  it("openDirectory reuses an existing tab instead of creating a duplicate", async () => {
    const listDirectory = installRefCanvas();
    useAppStore.setState({
      browserTabs: [],
      activeTabId: "",
      directoryPath: null,
      directoryHistory: [],
      directoryHistoryIndex: 0,
    });
    await useAppStore.getState().createBrowserTabForPath("D:\\x");
    await useAppStore.getState().createBrowserTabForPath("D:\\y");
    const tabsAfterCreate = useAppStore.getState().browserTabs.length;
    expect(tabsAfterCreate).toBe(2);

    // openDirectory 同一路径 → 切换到已有标签，不新建。
    await useAppStore.getState().openDirectory("D:\\x");
    const state = useAppStore.getState();
    expect(state.browserTabs).toHaveLength(2);
    expect(state.directoryPath).toBe("D:\\x");
    expect(listDirectory).toHaveBeenCalledWith("D:\\x", expect.anything());
  });
});
