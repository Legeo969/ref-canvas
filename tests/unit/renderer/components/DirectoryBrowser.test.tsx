// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryChangedEvent } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DirectoryBrowser } from "../../../../src/renderer/components/DirectoryBrowser";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

describe("DirectoryBrowser", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("shows local drive roots and toggles a favorite directory", async () => {
    const listRoots = vi.fn(async () => [
      { path: "C:\\", name: "C:", isDirectory: true, extension: "" },
      { path: "D:\\", name: "D:", isDirectory: true, extension: "" },
    ]);
    const addQuickAccess = vi.fn(async () => undefined);
    const openDirectory = vi.fn(async () => undefined);
    useAppStore.setState({
      navigationSource: "directory",
      directoryPath: null,
      quickAccess: [],
      addQuickAccess,
      openDirectory,
    });
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listRoots,
          onDirectoryProgress: () => () => undefined,
        },
      },
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryBrowser />
        </DialogProvider>,
      );
    });

    expect(listRoots).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("快速访问");
    expect(host.textContent).toContain("C:");
    expect(host.textContent).toContain("D:");
    expect(host.textContent).not.toContain("挂载");

    const rootMain = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("D:"),
    );
    await act(async () => rootMain?.click());
    expect(openDirectory).toHaveBeenCalledWith("D:\\");

    const favorite = host.querySelector<HTMLButtonElement>(
      '[aria-label="收藏 D:"]',
    );
    await act(async () => favorite?.click());
    expect(addQuickAccess).toHaveBeenCalledWith("D:\\", "D:");
  });

  it("loads expanded folders and refreshes them after filesystem events", async () => {
    let libraryChanged:
      | ((event: LibraryChangedEvent) => void)
      | undefined;
    let showChild = true;
    const listRoots = vi.fn(async () => [
      { path: "D:\\assets", name: "制作盘", isDirectory: true, extension: "" },
    ]);
    const listDirectory = vi.fn(async () => ({
      entries: showChild
        ? [
            {
              path: "D:\\assets\\old-folder",
              name: "old-folder",
              isDirectory: true,
              extension: "",
            },
          ]
        : [],
      total: showChild ? 1 : 0,
      nextCursor: null,
    }));
    useAppStore.setState({
      navigationSource: "directory",
      directoryPath: null,
      quickAccess: [],
    });
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listRoots,
          listDirectory,
          onDirectoryProgress: () => () => undefined,
        },
        library: {
          onLibraryChanged: (callback: (event: LibraryChangedEvent) => void) => {
            libraryChanged = callback;
            return () => undefined;
          },
        },
      },
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryBrowser />
        </DialogProvider>,
      );
    });
    const expand = host.querySelector<HTMLButtonElement>(
      '[aria-label="展开磁盘"]',
    );
    await act(async () => {
      expand?.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("old-folder");
    expect(listDirectory).toHaveBeenLastCalledWith("D:\\assets", {
      pageSize: 512,
    });

    showChild = false;
    await act(async () => {
      libraryChanged?.({ reason: "watch", paths: ["D:\\assets"] });
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("old-folder");
  });
});
