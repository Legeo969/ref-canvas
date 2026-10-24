// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";
import { createBrowserTab } from "../../../../src/renderer/app/navigation-v3";

describe("indexed asset navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockLibrary = () => {
    Object.assign(window, {
      refCanvas: {
        library: {
          searchWindow: vi.fn(async () => ({ items: [], total: 0 })),
        },
      },
    });
  };

  const enterDirectoryMode = () => {
    useAppStore.setState({
      workspaceMode: "directory",
      navigationSource: "directory",
    });
  };

  it("returns indexed navigation to direct disk browsing", () => {
    mockLibrary();
    enterDirectoryMode();
    useAppStore.setState({ navigationSource: "library" });

    useAppStore.getState().showDirectoryWorkspace();
    expect(useAppStore.getState().workspaceMode).toBe("directory");
    expect(useAppStore.getState().navigationSource).toBe("directory");
  });

  it("restores a usable directory when switching back from a board with no path", async () => {
    const listDirectory = vi.fn(async () => ({
      entries: [],
      total: 0,
      nextCursor: null,
      scanState: "complete",
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: { listDirectory },
      },
    });
    const emptyTab = createBrowserTab("directory", "browser://empty", "空");
    const refsTab = createBrowserTab("directory", "D:\\refs", "refs");
    useAppStore.setState({
      workspaceMode: "board",
      directoryPath: null,
      activeCollectionId: null,
      activeTabId: emptyTab.id,
      browserTabs: [emptyTab, refsTab],
      directoryHistory: [],
      directoryHistoryIndex: 0,
    });

    useAppStore.getState().showDirectoryWorkspace();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAppStore.getState().workspaceMode).toBe("directory");
    expect(useAppStore.getState().directoryPath).toBe("D:\\refs");
    expect(listDirectory).toHaveBeenCalledWith("D:\\refs", expect.anything());
  });
});

describe("directory navigation request ordering", () => {
  it("ignores a stale directory response after a faster navigation", async () => {
    let resolveFirst:
      | ((page: { entries: Array<{ path: string }>; total: number }) => void)
      | undefined;
    const firstPage = new Promise<{ entries: Array<{ path: string }>; total: number }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          setObservedDirectory: vi.fn(async () => undefined),
          listDirectory: vi.fn((directory: string) => {
            if (directory === "A") return firstPage;
            return Promise.resolve({ entries: [{ path: "B\\new.png" }], total: 1 });
          }),
        },
      },
    });

    const first = useAppStore.getState().openDirectory("A");
    const second = useAppStore.getState().openDirectory("B");
    await second;
    resolveFirst?.({ entries: [{ path: "A\\old.png" }], total: 1 });
    await first;

    expect(useAppStore.getState().directoryPath).toBe("B");
    expect(useAppStore.getState().directoryEntries).toEqual([
      { path: "B\\new.png" },
    ]);
    expect(useAppStore.getState().directoryLoading).toBe(false);
    expect(useAppStore.getState().workspaceMode).toBe("directory");
  });
});
