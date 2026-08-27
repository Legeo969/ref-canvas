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
    expect(host.textContent).toContain("收藏");
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

  it("only marks directory entries active in directory workspace", async () => {
    const listRoots = vi.fn(async () => [
      { path: "D:\\", name: "D:", isDirectory: true, extension: "" },
    ]);
    useAppStore.setState({
      workspaceMode: "board",
      navigationSource: "directory",
      directoryPath: "D:\\",
      activeCollectionId: null,
      quickAccess: [
        {
          id: "qa-1",
          path: "D:\\",
          name: "D:",
          sortOrder: 1,
          expanded: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
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

    expect(host.querySelector(".dir-root-row")?.classList.contains("active")).toBe(false);
    expect(
      host.querySelector(".quick-access-row")?.classList.contains("active"),
    ).toBe(false);

    await act(async () => {
      useAppStore.setState({ workspaceMode: "directory" });
    });
    expect(host.querySelector(".dir-root-row")?.classList.contains("active")).toBe(true);
    expect(
      host.querySelector(".quick-access-row")?.classList.contains("active"),
    ).toBe(true);
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

  it("collapses and expands the quick access section", async () => {
    const listRoots = vi.fn(async () => []);
    useAppStore.setState({
      navigationSource: "directory",
      directoryPath: null,
      quickAccess: [
        {
          id: "qa-1",
          path: "D:\\assets",
          name: "制作盘",
          sortOrder: 1,
          expanded: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
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

    // 默认展开：收藏条目可见 + 路径副文字显示父目录（D:\assets → D:）。
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="折叠"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("制作盘");
    expect(host.querySelector(".quick-access-path")?.textContent).toBe("D:");

    // 折叠后条目隐藏，标题仍在。
    await act(async () => toggle?.click());
    expect(host.textContent).not.toContain("制作盘");
    expect(host.textContent).toContain("收藏");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="展开"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    // 重新展开恢复条目。
    const expand = host.querySelector<HTMLButtonElement>('[aria-label="展开"]');
    await act(async () => expand?.click());
    expect(host.textContent).toContain("制作盘");
  });

  it("toggles the master hidden-files switch via the eye button", async () => {
    const listRoots = vi.fn(async () => []);
    const getPreferences = vi.fn(async () => ({
      previewSettings: { showHiddenFiles: false },
    }));
    const setPreferences = vi.fn(async () => ({
      previewSettings: { showHiddenFiles: true },
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
          onDirectoryProgress: () => () => undefined,
        },
        system: { getPreferences, setPreferences },
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

    // 默认：未显示隐藏文件（eye 未亮起）。
    const eye = host.querySelector<HTMLButtonElement>(".visibility-toggle");
    expect(eye?.getAttribute("aria-pressed")).toBe("false");

    // 点按 → 写入偏好（showHiddenFiles: true）+ 广播事件 → 图标亮起。
    await act(async () => {
      eye?.click();
      await Promise.resolve();
    });
    expect(setPreferences).toHaveBeenCalledWith({
      previewSettings: { showHiddenFiles: true },
    });
    expect(eye?.getAttribute("aria-pressed")).toBe("true");
    expect(eye?.className).toContain("active");
  });
});
