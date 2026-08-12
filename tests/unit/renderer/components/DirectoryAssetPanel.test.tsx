// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOUND_SETTINGS_DEFAULTS,
  type RefCanvasApi,
} from "../../../../src/shared/contracts";
import { useAppStore } from "../../../../src/renderer/app/store";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";
import { DirectoryAssetPanel, directoryThumbnailSource } from "../../../../src/renderer/components/DirectoryAssetPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 网格中嵌入已翻译的 SequenceCard 等子组件；断言基于简体中文 catalog。

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("DirectoryAssetPanel", () => {
  it("prefers a revised indexed custom thumbnail over the source preview token", () => {
    expect(directoryThumbnailSource(
      "refbrowse://thumbnail/source-token?priority=visible",
      { url: "refasset://thumbnail/asset-1", revision: "2026-08-12T09:00:00.000Z" },
    )).toBe("refasset://thumbnail/asset-1?revision=2026-08-12T09%3A00%3A00.000Z");
  });
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("retries a transient thumbnail failure without reselecting the asset", async () => {
    vi.useFakeTimers();
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          previewToken: vi.fn(async () => "retry-token"),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [{
        path: "D:\\refs\\shot.exr",
        name: "shot.exr",
        isDirectory: false,
        extension: "exr",
        size: 100,
      }],
      directoryTotal: 1,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });
    const initial = host.querySelector<HTMLImageElement>(".directory-card img");
    expect(initial?.src).toContain("refbrowse://thumbnail/retry-token");
    await act(async () => initial?.dispatchEvent(new Event("error")));
    expect(host.querySelector(".asset-placeholder")?.textContent).toContain("EXR");
    expect(host.querySelector('[role="status"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(600));
    const retried = host.querySelector<HTMLImageElement>(".directory-card img");
    expect(retried?.src).toContain("previewRetry=1");
    await act(async () => retried?.dispatchEvent(new Event("load")));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("reloads the directory immediately when subfolder depth changes", async () => {
    const listDirectory = vi.fn(async () => ({
      entries: [],
      total: 0,
      nextCursor: null,
      scanState: "complete" as const,
    }));
    const nextFoundSettings = {
      ...FOUND_SETTINGS_DEFAULTS,
      flattenPerFolder: { "D:\\refs": 8 },
    };
    const setPreferences = vi.fn(async () => ({
      foundSettings: nextFoundSettings,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          onSearchProgress: () => () => undefined,
        },
        system: {
          getPreferences: vi.fn(async () => ({
            foundSettings: FOUND_SETTINGS_DEFAULTS,
          })),
          setPreferences,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [],
      directoryTotal: 0,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
      await Promise.resolve();
    });
    listDirectory.mockClear();

    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="directory-flatten-depth"]',
    );
    expect(select).toBeTruthy();
    expect(select?.options).toHaveLength(9);
    expect(select?.options[8]?.value).toBe("8");
    await act(async () => {
      if (!select) return;
      select.value = "8";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setPreferences).toHaveBeenCalledWith({
      foundSettings: {
        defaultFlattenDepth: 8,
        flattenPerFolder: { "D:\\refs": 8 },
      },
    });
    expect(listDirectory).toHaveBeenCalledWith(
      "D:\\refs",
      expect.objectContaining({ flattenDepth: 8 }),
    );
  });

  it("opens a folder card in browse mode from the context menu", async () => {
    const setObservedDirectory = vi.fn(async () => undefined);
    const listDirectory = vi.fn(async () => ({
      entries: [
        {
          path: "D:\\refs\\assets",
          name: "assets",
          isDirectory: true,
          extension: "",
        },
      ],
      total: 1,
      nextCursor: null,
      scanState: "complete",
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          setObservedDirectory,
          listDirectory,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\assets",
          name: "assets",
          isDirectory: true,
          extension: "",
        },
      ],
      directoryTotal: 1,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    await act(async () => {
      document
        .querySelector(".directory-card-wrap")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.includes("打开目录"));
    expect(openButton).toBeTruthy();
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).some((button) => button.textContent?.includes("导入此目录到素材库")),
    ).toBe(false);
    await act(async () => {
      openButton?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(setObservedDirectory).not.toHaveBeenCalled();
    expect(listDirectory).toHaveBeenCalledWith("D:\\refs\\assets", {
      pageSize: 512,
    });
    expect(useAppStore.getState().directoryPath).toBe("D:\\refs\\assets");
  });

  it("exposes a directory entry drag payload for sidebar folder drops", async () => {
    const dragOut = vi.fn();
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          dragOut,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\shot.txt",
          name: "shot.txt",
          isDirectory: false,
          extension: "txt",
          size: 4,
        },
      ],
      directoryTotal: 1,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const card = document.querySelector<HTMLButtonElement>(".directory-card");
    expect(card).toBeTruthy();
    // jsdom 不提供 DataTransfer，用最小桩验证拖拽载荷。
    class StubDataTransfer {
      private store = new Map<string, string>();
      effectAllowed = "none";
      setData(type: string, value: string): void {
        this.store.set(type, value);
      }
      getData(type: string): string {
        return this.store.get(type) ?? "";
      }
    }
    const dataTransfer = new StubDataTransfer() as unknown as DataTransfer;
    await act(async () => {
      const event = new window.MouseEvent("dragstart", { bubbles: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      card?.dispatchEvent(event);
    });
    expect(
      dataTransfer.getData("application/x-refcanvas-directory-entry"),
    ).toBe(JSON.stringify({ path: "D:\\refs\\shot.txt", isDirectory: false }));
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dragOut).not.toHaveBeenCalled();

    await act(async () => {
      card?.dispatchEvent(
        new window.MouseEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          altKey: true,
        }),
      );
    });
    expect(dragOut).toHaveBeenCalledWith(["D:\\refs\\shot.txt"]);
  });

  it("selects a file card on click and toggles with ctrl", async () => {
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\a.txt",
          name: "a.txt",
          isDirectory: false,
          extension: "txt",
          size: 4,
        },
        {
          path: "D:\\refs\\b.txt",
          name: "b.txt",
          isDirectory: false,
          extension: "txt",
          size: 4,
        },
      ],
      directoryTotal: 2,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const cards = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(".directory-card"));
    await act(async () => {
      cards()[0]?.click();
    });
    expect(useAppStore.getState().selectedDirectoryEntry?.path).toBe(
      "D:\\refs\\a.txt",
    );
    expect(cards()[0]?.classList.contains("selected")).toBe(true);

    await act(async () => {
      cards()[1]?.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
      );
    });
    expect(cards()[0]?.classList.contains("selected")).toBe(true);
    expect(cards()[1]?.classList.contains("selected")).toBe(true);

    // 普通点击回到单选。
    await act(async () => {
      cards()[1]?.click();
    });
    expect(cards()[0]?.classList.contains("selected")).toBe(false);
    expect(cards()[1]?.classList.contains("selected")).toBe(true);
  });

  it("collapses an image sequence to one grid item", async () => {
    const frames = [1, 2, 3].map((frame) => ({
      path: `D:\\refs\\shot_${String(frame).padStart(4, "0")}.exr`,
      name: `shot_${String(frame).padStart(4, "0")}.exr`,
      isDirectory: false,
      extension: "exr",
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
        },
        sequences: {
          detect: vi.fn(async () => [
            {
              id: "sequence-1",
              pattern: "shot_####.exr",
              files: frames.map((frame) => frame.path),
              frames: [1, 2, 3],
              startFrame: 1,
              endFrame: 3,
              missingFrames: [],
              fps: 24,
            },
          ]),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: frames,
      directoryTotal: frames.length,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
      await Promise.resolve();
    });

    expect(host.querySelectorAll(".directory-card-wrap")).toHaveLength(1);
    expect(host.textContent).toContain("3 帧");
  });

  it("opens an instant preview with Space and navigates with arrow keys", async () => {
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          previewToken: vi.fn(async () => "token-1"),
          open: vi.fn(async () => undefined),
          reveal: vi.fn(async () => undefined),
          materialize: vi.fn(async () => ({
            asset: {},
            created: true,
            copied: false,
            verified: false,
          })),
          trash: vi.fn(async () => undefined),
        },
        system: {
          writeClipboard: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\a.png",
          name: "a.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
        {
          path: "D:\\refs\\b.png",
          name: "b.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
      ],
      directoryTotal: 2,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const section = document.querySelector<HTMLElement>(".asset-panel");
    expect(section).toBeTruthy();
    const cards = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(".directory-card"));

    // 选中第一项后按空格打开预览。
    await act(async () => {
      cards()[0]?.click();
    });
    await act(async () => {
      section?.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(document.querySelector(".directory-preview")).toBeTruthy();
    expect(
      document.querySelector(".directory-preview-info h3")?.textContent,
    ).toBe("a.png");

    // → 浏览到下一个文件。
    await act(async () => {
      section?.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(
      document.querySelector(".directory-preview-info h3")?.textContent,
    ).toBe("b.png");

    // ← 回到上一个。
    await act(async () => {
      section?.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(
      document.querySelector(".directory-preview-info h3")?.textContent,
    ).toBe("a.png");

    // Esc 关闭。
    await act(async () => {
      section?.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector(".directory-preview")).toBeNull();
  });

  it("handles global browse, favorite and rating shortcuts without panel focus", async () => {
    let favorite = false;
    let rating = 0;
    const materialize = vi.fn(async (path: string) => ({
      asset: {
        id: path.endsWith("b.png")
          ? "22222222-2222-4222-8222-222222222222"
          : "11111111-1111-4111-8111-111111111111",
        path,
        favorite,
        rating,
      },
      created: false,
    }));
    const update = vi.fn(async (id: string, patch: { favorite?: boolean; rating?: number }) => {
      favorite = patch.favorite ?? favorite;
      rating = patch.rating ?? rating;
      return { id, favorite, rating };
    });
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          materialize,
        },
        library: { update },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      selectedDirectoryEntry: null,
      directoryEntries: [
        {
          path: "D:\\refs\\a.png",
          name: "a.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
        {
          path: "D:\\refs\\b.png",
          name: "b.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
      ],
      directoryTotal: 2,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const press = async (key: string) => {
      await act(async () => {
        document.body.dispatchEvent(
          new window.KeyboardEvent("keydown", { key, bubbles: true }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await press("ArrowRight");
    expect(useAppStore.getState().selectedDirectoryEntry?.name).toBe("a.png");
    await press("ArrowRight");
    expect(useAppStore.getState().selectedDirectoryEntry?.name).toBe("b.png");

    await press("f");
    expect(materialize).toHaveBeenLastCalledWith("D:\\refs\\b.png");
    expect(update).toHaveBeenLastCalledWith(
      "22222222-2222-4222-8222-222222222222",
      { favorite: true },
    );
    expect(host.querySelector(".directory-metadata-badges svg")).toBeTruthy();
    expect(host.querySelector(".directory-shortcut-notice")?.textContent).toContain(
      "已收藏 b.png",
    );

    await press("4");
    expect(update).toHaveBeenLastCalledWith(
      "22222222-2222-4222-8222-222222222222",
      { rating: 4 },
    );
    expect(host.querySelector(".directory-rating-badge")?.textContent).toBe("4");

    const search = host.querySelector<HTMLInputElement>(
      '[aria-label="搜索当前目录"]',
    );
    search?.focus();
    await act(async () => {
      search?.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "5", bubbles: true }),
      );
    });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("opens quick preview on double click while context-menu Open uses Windows", async () => {
    const open = vi.fn(async () => undefined);
    const materialize = vi.fn(async () => ({
      asset: {},
      created: true,
      copied: false,
      verified: false,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          previewToken: vi.fn(async () => "token-double-click"),
          open,
          reveal: vi.fn(async () => undefined),
          materialize,
          trash: vi.fn(async () => undefined),
        },
        system: {
          writeClipboard: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\concept.psd",
          name: "concept.psd",
          isDirectory: false,
          extension: "psd",
          size: 128,
        },
      ],
      directoryTotal: 1,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const card = document.querySelector<HTMLButtonElement>(".directory-card");
    await act(async () => {
      card?.dispatchEvent(
        new window.MouseEvent("dblclick", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(document.querySelector(".directory-preview")).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".preview-close")?.click();
    });
    const cardWrap = document.querySelector<HTMLElement>(
      ".directory-card-wrap",
    );
    await act(async () => {
      cardWrap?.dispatchEvent(
        new window.MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".asset-context-menu button",
      ),
    ).find((button) => button.textContent?.trim() === "打开");
    await act(async () => {
      openButton?.click();
    });
    expect(open).toHaveBeenCalledWith("D:\\refs\\concept.psd");
  });

  it("does not expose a redundant manual index command", async () => {
    const materialize = vi.fn(async () => ({
      asset: {},
      created: true,
      copied: false,
      verified: false,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          materialize,
          previewToken: vi.fn(async () => "token-batch"),
          trash: vi.fn(async () => undefined),
        },
        library: {
          search: vi.fn(async () => ({ items: [], total: 0, nextCursor: null })),
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
        system: {
          writeClipboard: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\a.png",
          name: "a.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
        {
          path: "D:\\refs\\b.png",
          name: "b.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
      ],
      directoryTotal: 2,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const cards = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(".directory-card"));
    await act(async () => {
      cards()[0]?.click();
    });
    await act(async () => {
      cards()[1]?.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
      );
    });
    expect(document.querySelector(".batch-toolbar")?.textContent).toContain(
      "2 项已选",
    );

    const materializeButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".batch-toolbar button"),
    ).find((button) => button.title === "建立索引");
    expect(materializeButton).toBeUndefined();
    expect(materialize).not.toHaveBeenCalled();
  });

  it("adds selected disk files to the reference board", async () => {
    const asset = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "a.png",
      path: "D:\\refs\\a.png",
    };
    const materialize = vi.fn(async () => ({
      asset,
      created: true,
      copied: false,
      verified: false,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          materialize,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      activeBoard: {
        id: "22222222-2222-4222-8222-222222222222",
        title: "参考板 01",
        createdAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
      assets: [],
      pendingBoardAssetIds: [],
      workspaceMode: "directory",
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\a.png",
          name: "a.png",
          isDirectory: false,
          extension: "png",
          size: 8,
        },
      ],
      directoryTotal: 1,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".directory-card")?.click();
    });
    const addButton = document.querySelector<HTMLButtonElement>(
      '.batch-toolbar button[title="加入参考板"]',
    );
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton?.click();
      await Promise.resolve();
    });

    expect(materialize).toHaveBeenCalledWith("D:\\refs\\a.png");
    expect(useAppStore.getState().pendingBoardAssetIds).toEqual([asset.id]);
    expect(useAppStore.getState().workspaceMode).toBe("board");
  });

  it("Ctrl+A selects all files in the current view", async () => {
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\a.txt",
          name: "a.txt",
          isDirectory: false,
          extension: "txt",
          size: 4,
        },
        {
          path: "D:\\refs\\sub",
          name: "sub",
          isDirectory: true,
          extension: "",
        },
        {
          path: "D:\\refs\\b.txt",
          name: "b.txt",
          isDirectory: false,
          extension: "txt",
          size: 4,
        },
      ],
      directoryTotal: 3,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });

    const section = document.querySelector<HTMLElement>(".asset-panel");
    await act(async () => {
      section?.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.querySelector(".batch-toolbar")?.textContent).toContain(
      "2 项已选",
    );
    // 文件夹卡片不应被选中。
    const selected = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".directory-card.selected"),
    );
    expect(selected).toHaveLength(2);
  });

  it("reflows virtual cards when the directory viewport becomes wider", async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = observe;
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: Array.from({ length: 4 }, (_, index) => ({
        path: `D:\\refs\\${index + 1}.txt`,
        name: `${index + 1}.txt`,
        isDirectory: false,
        extension: "txt",
        size: 4,
      })),
      directoryTotal: 4,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });
    expect(observe).toHaveBeenCalledOnce();

    await act(async () => {
      resizeCallback?.(
        [
          {
            contentRect: { width: 520, height: 600 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    const cards = document.querySelectorAll<HTMLElement>(".directory-card-wrap");
    expect(cards[2]?.style.left).toBe("320px");
    expect(cards[2]?.style.top).toBe("0px");
  });

  it("exports an all-result search selection and reports cancellation", async () => {
    const entries = Array.from({ length: 512 }, (_, index) => ({
      path: `D:\\refs\\asset-${index}.png`,
      name: `asset-${index}.png`,
      isDirectory: false,
      extension: "png",
    }));
    const snapshot = {
      id: "search-1",
      state: "completed" as const,
      rootPath: "D:\\refs",
      query: "asset",
      entries,
      totalFiles: 600,
      revision: "search-revision-1",
      order: "name" as const,
      processedDirectories: 2,
      totalDirectories: 2,
      failedDirectories: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    };
    let batchProgress: ((value: {
      id: string;
      state: "cancelled";
      action: { type: "exportPaths"; destination: string };
      total: number;
      processed: number;
      failed: [];
    }) => void) | undefined;
    const exportPaths = vi.fn(async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      state: "running" as const,
      action: { type: "exportPaths" as const, destination: "D:\\paths.txt" },
      total: 600,
      processed: 0,
      failed: [],
    }));
    const cancelBatch = vi.fn(async () => true);
    const writeClipboard = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          onBatchProgress: (callback: typeof batchProgress) => {
            batchProgress = callback;
            return () => undefined;
          },
          startSearch: vi.fn(async () => "search-1"),
          getSearch: vi.fn(async () => snapshot),
          getSearchPage: vi.fn(async () => ({
            entries,
            total: 600,
            totalFiles: 600,
            offset: 0,
            revision: "search-revision-1",
            scanState: "complete" as const,
            order: "name" as const,
            nextCursor: "512",
          })),
          exportPaths,
          cancelBatch,
        },
        system: { writeClipboard },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [],
      directoryTotal: 0,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <DirectoryAssetPanel />
        </DialogProvider>,
      );
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="搜索当前目录"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "asset");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });
    const panel = document.querySelector<HTMLElement>(".asset-panel")!;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
      }));
    });
    expect(document.querySelector(".batch-toolbar")?.textContent).toContain(
      "600 项已选",
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>(
        'button[title="导出 UTF-8 路径清单"]',
      )?.click();
      await Promise.resolve();
    });
    expect(exportPaths).toHaveBeenCalledWith({
      mode: "search",
      searchId: "search-1",
      revision: "search-revision-1",
      excludedPaths: [],
    });
    expect(writeClipboard).not.toHaveBeenCalled();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="取消批量任务"]',
      )?.click();
    });
    expect(cancelBatch).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    await act(async () => {
      batchProgress?.({
        id: "11111111-1111-4111-8111-111111111111",
        state: "cancelled",
        action: { type: "exportPaths", destination: "D:\\paths.txt" },
        total: 600,
        processed: 25,
        failed: [],
      });
    });
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "已取消：完成 25 项",
    );
  });
});
