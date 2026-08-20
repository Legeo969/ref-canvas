// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_SETTINGS_DEFAULTS,
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
    const nextPreviewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      flattenPerFolder: { "D:\\refs": 8 },
    };
    const setPreferences = vi.fn(async () => ({
      previewSettings: nextPreviewSettings,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          onSearchProgress: () => () => undefined,
        },
        system: {
          getPreferences: vi.fn(async () => ({
            previewSettings: PREVIEW_SETTINGS_DEFAULTS,
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

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-testid="directory-view-options-toggle"]',
    );
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    const depths = document.querySelector<HTMLElement>(
      '[data-testid="directory-flatten-depth"]',
    );
    expect(depths).toBeTruthy();
    const radios = Array.from(
      depths?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [],
    );
    expect(radios).toHaveLength(9);
    expect(radios[8]?.value).toBe("8");
    await act(async () => {
      radios[8]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setPreferences).toHaveBeenCalledWith({
      previewSettings: {
        defaultFlattenDepth: 8,
        flattenPerFolder: { "D:\\refs": 8 },
      },
    });
    expect(listDirectory).toHaveBeenCalledWith(
      "D:\\refs",
      expect.objectContaining({ flattenDepth: 8 }),
    );
  });

  it("opens and closes the view options popover from the breadcrumb row", async () => {
    const listDirectory = vi.fn(async () => ({
      entries: [],
      total: 0,
      nextCursor: null,
      scanState: "complete" as const,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          onSearchProgress: () => () => undefined,
        },
        system: {
          getPreferences: vi.fn(async () => ({
            previewSettings: PREVIEW_SETTINGS_DEFAULTS,
          })),
          setPreferences: vi.fn(async (patch: unknown) => patch),
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

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-testid="directory-view-options-toggle"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute("aria-label")).toBe("视图选项");
    expect(document.querySelector(".dir-view-options-popover")).toBeNull();

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    const popover = document.querySelector<HTMLElement>(".dir-view-options-popover");
    expect(popover).toBeTruthy();
    expect(popover?.getAttribute("role")).toBe("group");
    expect(popover?.getAttribute("aria-label")).toBe("视图选项");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    // Escape 关闭。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    expect(document.querySelector(".dir-view-options-popover")).toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    // 再次打开后，点击 popover 外部关闭。
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(document.querySelector(".dir-view-options-popover")).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(document.querySelector(".dir-view-options-popover")).toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles sequence merging from the view options popover", async () => {
    const setPreferences = vi.fn(
      async (patch: { previewSettings?: { collapseImageSequences?: boolean } }) => ({
        previewSettings: {
          ...PREVIEW_SETTINGS_DEFAULTS,
          ...(patch.previewSettings ?? {}),
          flattenPerFolder: { "D:\\refs": 0 },
        },
      }),
    );
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory: vi.fn(async () => ({
            entries: [],
            total: 0,
            nextCursor: null,
            scanState: "complete" as const,
          })),
          onSearchProgress: () => () => undefined,
        },
        system: {
          getPreferences: vi.fn(async () => ({
            previewSettings: PREVIEW_SETTINGS_DEFAULTS,
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

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="directory-view-options-toggle"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const sequenceToggle = document.querySelector<HTMLInputElement>(
      '[data-testid="directory-sequence-toggle"]',
    );
    expect(sequenceToggle).toBeTruthy();
    expect(sequenceToggle?.checked).toBe(true); // PREVIEW_SETTINGS_DEFAULTS.collapseImageSequences
    await act(async () => {
      sequenceToggle?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setPreferences).toHaveBeenCalledWith({
      previewSettings: { collapseImageSequences: false },
    });
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
        .querySelector(".directory-folder-row-wrap")
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

  it("opens the info-only preview on sequence double-click instead of the player", async () => {
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

    const card = host.querySelector<HTMLButtonElement>(".sequence-card");
    expect(card).toBeTruthy();
    await act(async () => {
      card?.dispatchEvent(
        new window.MouseEvent("dblclick", { bubbles: true }),
      );
      await Promise.resolve();
    });

    // 打开的是信息浮层，不是序列播放器。
    expect(document.querySelector(".directory-preview")).toBeTruthy();
    expect(document.querySelector(".directory-preview-stage")).toBeNull();
    expect(document.querySelector(".sequence-preview-shell")).toBeNull();
    expect(
      document.querySelector(".directory-preview-info h3")?.textContent,
    ).toBe("shot_0001.exr");
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

  it("yields space and arrow shortcuts while focus is inside the preview panel", async () => {
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

    const section = document.querySelector<HTMLElement>(".asset-panel")!;
    const previewRegion = document.createElement("div");
    previewRegion.className = "preview-panel";
    document.body.append(previewRegion);
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>(".directory-card"))[0]?.click();
    });
    // 焦点在预览区域：空格不打开面板内预览、方向键不移动选中。
    await act(async () => {
      previewRegion.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(document.querySelector(".directory-preview")).toBeNull();
    await act(async () => {
      previewRegion.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.querySelector(".directory-preview")).toBeNull();
    // 焦点回到目录面板：空格恢复打开面板内预览。
    await act(async () => {
      section.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(document.querySelector(".directory-preview")).toBeTruthy();
    previewRegion.remove();
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

    await act(async () => {
      host.querySelector<HTMLElement>(".dir-crumbs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const pathInput = host.querySelector<HTMLInputElement>(".dir-path-input");
    pathInput?.focus();
    await act(async () => {
      pathInput?.dispatchEvent(
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

  it("offers move-to-trash in the folder context menu too", async () => {
    // 回归：回收站入口曾在 !isDirectory 的文件专属分支里，文件夹右键没有。
    const trash = vi.fn(async () => undefined);
    const reloadDirectory = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          previewToken: vi.fn(async () => "token-folder-trash"),
          open: vi.fn(async () => undefined),
          reveal: vi.fn(async () => undefined),
          trash,
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
          path: "D:\\refs\\shot-alpha",
          name: "shot-alpha",
          isDirectory: true,
          extension: "",
        },
      ],
      directoryTotal: 1,
      reloadDirectory,
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
    const folderRow = document.querySelector<HTMLElement>(
      ".directory-folder-row",
    ) ?? document.querySelector<HTMLElement>(".directory-card-wrap");
    await act(async () => {
      folderRow?.dispatchEvent(
        new window.MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    const trashButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".asset-context-menu button",
      ),
    ).find((button) => button.textContent?.includes("回收站"));
    expect(trashButton).toBeTruthy();
    await act(async () => {
      trashButton?.click();
      await Promise.resolve();
    });
    // 确认对话框中点确认（danger 主按钮）。
    const confirm = document.querySelector<HTMLButtonElement>(
      ".primary-button",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(trash).toHaveBeenCalledWith(["D:\\refs\\shot-alpha"], undefined);
    expect(reloadDirectory).toHaveBeenCalled();
  });

  it.each([
    { extension: "png", showDownscale: true, showGifWorkbench: false, showExportMp4: false, showFrames: false },
    { extension: "tiff", showDownscale: true, showGifWorkbench: false, showExportMp4: false, showFrames: false },
    { extension: "svg", showDownscale: false, showGifWorkbench: false, showExportMp4: false, showFrames: false },
    { extension: "mp4", showDownscale: false, showGifWorkbench: true, showExportMp4: true, showFrames: true },
    { extension: "exr", showDownscale: false, showGifWorkbench: false, showExportMp4: false, showFrames: false },
    { extension: "mp3", showDownscale: false, showGifWorkbench: false, showExportMp4: false, showFrames: false },
  ])(
    "context menu export entries: Downscale / GIF 工作台 / 导出 MP4 by format ($extension)",
    async ({ extension, showDownscale, showGifWorkbench, showExportMp4, showFrames }) => {
      Object.assign(window, {
        refCanvas: {
          filesystem: {
            onSearchProgress: () => () => undefined,
            previewToken: vi.fn(async () => "token-downscale"),
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
            path: `D:\\refs\\shot.${extension}`,
            name: `shot.${extension}`,
            isDirectory: false,
            extension,
            size: 100,
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
        await Promise.resolve();
      });

      await act(async () => {
        document
          .querySelector(".directory-card-wrap")
          ?.dispatchEvent(
            new window.MouseEvent("contextmenu", {
              bubbles: true,
              clientX: 40,
              clientY: 40,
            }),
          );
      });
      const labels = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".asset-context-menu button",
        ),
      ).map((button) => button.textContent?.trim() ?? "");
      expect(labels.includes("Downscale…")).toBe(showDownscale);
      expect(labels.includes("GIF 工作台…")).toBe(showGifWorkbench);
      expect(labels.includes("导出 MP4…")).toBe(showExportMp4);
      expect(labels.includes("导出 PNG/JPG 序列帧…")).toBe(showFrames);
    },
  );

  it("opens the GIF workbench with the image sequence attached from the context menu", async () => {
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
          previewToken: vi.fn(async () => "token-sequence-gif"),
          open: vi.fn(async () => undefined),
          reveal: vi.fn(async () => undefined),
          materialize: vi.fn(async () => ({
            asset: {},
            created: false,
            copied: false,
            verified: false,
          })),
          trash: vi.fn(async () => undefined),
        },
        sequences: {
          detect: vi.fn(async () => [
            {
              id: "sequence-1",
              directory: "D:\\refs",
              baseName: "shot",
              extension: "exr",
              pattern: "standard",
              files: frames.map((frame) => frame.path),
              frames: [1, 2, 3],
              start: 1,
              end: 3,
              missingFrames: [],
              width: 4,
              fps: 24,
            },
          ]),
        },
        system: {
          writeClipboard: vi.fn(async () => undefined),
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

    const workbench: Array<{ path: string; tool: string }> = [];
    const listener = (event: Event) => {
      workbench.push(
        (event as CustomEvent<{ path: string; tool: string }>).detail,
      );
    };
    window.addEventListener("refcanvas:directory-workbench", listener);
    await act(async () => {
      document
        .querySelector(".directory-card-wrap")
        ?.dispatchEvent(
          new window.MouseEvent("contextmenu", {
            bubbles: true,
            clientX: 40,
            clientY: 40,
          }),
        );
    });
    const gifButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".asset-context-menu button"),
    ).find((button) => button.textContent?.includes("GIF 工作台"));
    await act(async () => {
      gifButton?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    window.removeEventListener("refcanvas:directory-workbench", listener);
    expect(workbench).toEqual([
      { path: "D:\\refs\\shot_0001.exr", tool: "gif" },
    ]);
    expect(
      useAppStore.getState().selectedDirectoryEntry?.sequenceGroup?.files,
    ).toEqual(frames.map((frame) => frame.path));
  });

  it("exports an image sequence to MP4 from the context menu via the preset dialog", async () => {
    const frames = [1, 2, 3].map((frame) => ({
      path: `D:\\refs\\shot_${String(frame).padStart(4, "0")}.png`,
      name: `shot_${String(frame).padStart(4, "0")}.png`,
      isDirectory: false,
      extension: "png",
    }));
    const sequencesExportMp4 = vi.fn(async () => ({
      outputPath: "D:\\out\\shot.mp4",
      durationSeconds: 0.4,
      frameCount: 3,
      width: 320,
      height: 180,
    }));
    const mediaExportMp4 = vi.fn(async () => ({
      outputPath: "D:\\out\\clip.mp4",
      durationSeconds: 1,
      width: 320,
      height: 180,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          previewToken: vi.fn(async () => "token-mp4"),
          open: vi.fn(async () => undefined),
          reveal: vi.fn(async () => undefined),
          materialize: vi.fn(async () => ({
            asset: {},
            created: false,
            copied: false,
            verified: false,
          })),
          trash: vi.fn(async () => undefined),
        },
        sequences: {
          detect: vi.fn(async () => [
            {
              id: "sequence-1",
              directory: "D:\\refs",
              baseName: "shot",
              extension: "png",
              pattern: "standard",
              files: frames.map((frame) => frame.path),
              frames: [1, 2, 3],
              start: 1,
              end: 3,
              missingFrames: [],
              width: 4,
              fps: 24,
            },
          ]),
          exportMp4: sequencesExportMp4,
        },
        media: { exportMp4: mediaExportMp4 },
        system: {
          writeClipboard: vi.fn(async () => undefined),
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

    await act(async () => {
      document
        .querySelector(".directory-card-wrap")
        ?.dispatchEvent(
          new window.MouseEvent("contextmenu", {
            bubbles: true,
            clientX: 40,
            clientY: 40,
          }),
        );
    });
    const mp4Button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".asset-context-menu button"),
    ).find((button) => button.textContent?.includes("导出 MP4"));
    expect(mp4Button).toBeTruthy();
    await act(async () => {
      mp4Button?.click();
      await Promise.resolve();
    });
    expect(document.querySelector(".form-dialog")).toBeTruthy();
    expect(document.querySelector(".form-dialog select")).toBeTruthy();
    const directoryInput = host.querySelector<HTMLInputElement>(
      ".form-dialog input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(directoryInput, "D:\\out");
      directoryInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".form-dialog button[type='submit']")
        ?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(sequencesExportMp4).toHaveBeenCalledWith({
      files: frames.map((frame) => frame.path),
      fps: 24,
      presetId: "convert-default",
      outputDirectory: "D:\\out",
      baseName: "shot",
    });
    expect(mediaExportMp4).not.toHaveBeenCalled();
  });

  it("transcodes a video to MP4 from the context menu via the preset dialog", async () => {
    const sequencesExportMp4 = vi.fn(async () => undefined);
    const mediaExportMp4 = vi.fn(async () => ({
      outputPath: "D:\\out\\clip.mp4",
      durationSeconds: 1,
      width: 320,
      height: 180,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          previewToken: vi.fn(async () => "token-video-mp4"),
          open: vi.fn(async () => undefined),
          reveal: vi.fn(async () => undefined),
          materialize: vi.fn(async () => ({
            asset: {},
            created: false,
            copied: false,
            verified: false,
          })),
          trash: vi.fn(async () => undefined),
        },
        sequences: { exportMp4: sequencesExportMp4 },
        media: { exportMp4: mediaExportMp4 },
        system: {
          writeClipboard: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\clip.mov",
          name: "clip.mov",
          isDirectory: false,
          extension: "mov",
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
      await Promise.resolve();
    });

    await act(async () => {
      document
        .querySelector(".directory-card-wrap")
        ?.dispatchEvent(
          new window.MouseEvent("contextmenu", {
            bubbles: true,
            clientX: 40,
            clientY: 40,
          }),
        );
    });
    const mp4Button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".asset-context-menu button"),
    ).find((button) => button.textContent?.includes("导出 MP4"));
    await act(async () => {
      mp4Button?.click();
      await Promise.resolve();
    });
    const directoryInput = host.querySelector<HTMLInputElement>(
      ".form-dialog input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(directoryInput, "D:\\out");
      directoryInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".form-dialog button[type='submit']")
        ?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(mediaExportMp4).toHaveBeenCalledWith({
      inputPath: "D:\\refs\\clip.mov",
      outputDirectory: "D:\\out",
      baseName: "clip",
      presetId: "convert-default",
    });
    expect(sequencesExportMp4).not.toHaveBeenCalled();
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
        revision: 1,
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

  it("adds a single file to the reference board from the context menu", async () => {
    const asset = {
      id: "33333333-3333-4333-8333-333333333333",
      title: "b.png",
      path: "D:\\refs\\b.png",
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
          open: vi.fn(async () => undefined),
          reveal: vi.fn(async () => undefined),
        },
        system: {
          writeClipboard: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      activeBoard: {
        id: "22222222-2222-4222-8222-222222222222",
        title: "参考板 01",
        createdAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
        revision: 1,
      },
      assets: [],
      pendingBoardAssetIds: [],
      workspaceMode: "directory",
      directoryPath: "D:\\refs",
      directoryEntries: [
        {
          path: "D:\\refs\\b.png",
          name: "b.png",
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
    const cardWrap = document.querySelector<HTMLElement>(
      ".directory-card-wrap",
    );
    await act(async () => {
      cardWrap?.dispatchEvent(
        new window.MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 60,
          clientY: 60,
        }),
      );
    });
    const addButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".asset-context-menu button",
      ),
    ).find((button) => button.textContent?.trim() === "加入参考板");
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton?.click();
      await Promise.resolve();
    });

    expect(materialize).toHaveBeenCalledWith("D:\\refs\\b.png");
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
      // 服务端目录优先排序（filesystem-service.sortDirectory）：目录在前。
      directoryEntries: [
        {
          path: "D:\\refs\\sub",
          name: "sub",
          isDirectory: true,
          extension: "",
        },
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
    // 文件分组头已移除（对齐迅雷），文件区直接网格：第 1 行 top 归零。
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
    await act(async () => {
      host.querySelector<HTMLElement>(".dir-crumbs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>(".dir-path-input")!;
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

  it("opens the directory when a pasted absolute path is entered in the find field", async () => {
    // 回归：查找框粘贴 D:\…\目录 这类完整地址时直接定位（打开该目录），
    // 而不是把它当作搜索关键词（关键词搜索只匹配素材文件，目录搜不到）。
    const listDirectory = vi.fn(async () => ({
      entries: [],
      total: 0,
      nextCursor: null,
    }));
    const pathType = vi.fn(async () => "directory" as const);
    const startSearch = vi.fn(async () => "search-1");
    const openDirectory = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          pathType,
          startSearch,
          cancelSearch: vi.fn(async () => true),
          getSearch: vi.fn(async () => null),
          onSearchProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: [],
      directoryTotal: 0,
      openDirectory,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
    });
    await act(async () => {
      host.querySelector<HTMLElement>(".dir-crumbs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>(".dir-path-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "D:\\AiWork\\ref-canvas\\out\\RefCanvas-win32-x64");
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pathType).toHaveBeenCalledWith(
      "D:\\AiWork\\ref-canvas\\out\\RefCanvas-win32-x64",
    );
    expect(listDirectory).not.toHaveBeenCalledWith(
      "D:\\AiWork\\ref-canvas\\out\\RefCanvas-win32-x64",
      { pageSize: 1 },
    );
    expect(openDirectory).toHaveBeenCalledWith(
      "D:\\AiWork\\ref-canvas\\out\\RefCanvas-win32-x64",
    );
    expect(startSearch).not.toHaveBeenCalled();
  });

  it("opens the parent folder and selects the file when a pasted file path is entered", async () => {
    const fileEntry = {
      path: "D:\\refs\\concept.psd",
      name: "concept.psd",
      isDirectory: false,
      extension: "psd",
      size: 128,
    };
    const listDirectory = vi.fn(async (_pathname: string) => {
      return { entries: [fileEntry], total: 1, nextCursor: null };
    });
    const pathType = vi.fn(async () => "file" as const);
    const openDirectory = vi.fn(async (_pathname: string) => {
      // 模拟真实 openDirectory：完成后首批条目进入 store。
      useAppStore.setState({ directoryEntries: [fileEntry] });
    });
    const selectDirectoryEntry = vi.fn();
    const originalActions = {
      openDirectory: useAppStore.getState().openDirectory,
      selectDirectoryEntry: useAppStore.getState().selectDirectoryEntry,
    };
    const startSearch = vi.fn(async () => "search-1");
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          pathType,
          startSearch,
          cancelSearch: vi.fn(async () => true),
          getSearch: vi.fn(async () => null),
          onSearchProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      directoryPath: "D:\\other",
      directoryEntries: [],
      directoryTotal: 0,
      openDirectory,
      selectDirectoryEntry,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
    });
    await act(async () => {
      host.querySelector<HTMLElement>(".dir-crumbs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>(".dir-path-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "D:\\refs\\concept.psd");
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // 打开的是所在目录，并选中该文件。
    expect(pathType).toHaveBeenCalledWith("D:\\refs\\concept.psd");
    expect(openDirectory).toHaveBeenCalledWith("D:\\refs");
    expect(selectDirectoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ path: "D:\\refs\\concept.psd" }),
    );
    expect(startSearch).not.toHaveBeenCalled();
    // 恢复被覆盖的 store action，避免污染后续用例。
    useAppStore.setState(originalActions);
  });

  it("falls back to keyword search for non-path input and invalid paths", async () => {
    const listDirectory = vi.fn(async () => ({
      entries: [],
      total: 0,
      nextCursor: null,
    }));
    const pathType = vi.fn(async () => "missing" as const);
    const startSearch = vi.fn(async () => "search-1");
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          pathType,
          startSearch,
          cancelSearch: vi.fn(async () => true),
          getSearch: vi.fn(async () => null),
          onSearchProgress: () => () => undefined,
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
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
    });
    await act(async () => {
      host.querySelector<HTMLElement>(".dir-crumbs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>(".dir-path-input")!;
    // 组件挂载即会加载当前目录：先清掉这次调用，后续断言只看输入触发。
    listDirectory.mockClear();
    // 普通关键词：走关键词搜索，不做路径探测。
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "concept");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(listDirectory).not.toHaveBeenCalled();
    // 回车提交一个不存在的路径：探测失败后不跳转、不清空输入。
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "D:\\no\\such\\dir");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pathType).toHaveBeenCalledWith("D:\\no\\such\\dir");
    expect(listDirectory).not.toHaveBeenCalledWith("D:\\no\\such\\dir", {
      pageSize: 1,
    });
    // 等待在途 debounce 到期：避免残留 timer 在后续用例中调用已被替换的
    // window.refCanvas mock（跨用例污染）。
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });
  });

  it("re-runs the active search with the new favorites flag when toggling favorites-only", async () => {
    // 回归：toggle 点击处理里同步重跑搜索时，本渲染闭包仍捕获旧的
    // favoritesOnly；必须显式传新值，否则服务端收藏过滤不生效。
    const snapshot = {
      id: "search-1",
      state: "completed" as const,
      rootPath: "D:\\refs",
      query: "asset",
      entries: [],
      totalFiles: 0,
      revision: "search-revision-1",
      order: "name" as const,
      processedDirectories: 1,
      totalDirectories: 1,
      failedDirectories: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    };
    const startSearch = vi.fn(async () => "search-1");
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
          startSearch,
          getSearch: vi.fn(async () => snapshot),
          getSearchPage: vi.fn(async () => ({
            entries: [],
            total: 0,
            totalFiles: 0,
            offset: 0,
            revision: "search-revision-1",
            scanState: "complete" as const,
            order: "name" as const,
            nextCursor: null,
          })),
          cancelSearch: vi.fn(async () => true),
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
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
    });
    await act(async () => {
      host.querySelector<HTMLElement>(".dir-crumbs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>(".dir-path-input")!;
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
    expect(startSearch).toHaveBeenCalledTimes(1);
    expect(startSearch).toHaveBeenNthCalledWith(
      1,
      "D:\\refs",
      "asset",
      expect.objectContaining({ favoritesOnly: false }),
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="只看收藏"]')?.click();
      await Promise.resolve();
    });
    expect(startSearch).toHaveBeenCalledTimes(2);
    expect(startSearch).toHaveBeenNthCalledWith(
      2,
      "D:\\refs",
      "asset",
      expect.objectContaining({ favoritesOnly: true }),
    );
  });

  it("exports only favorites when copying paths from a favorites-only select-all", async () => {
    // 回归：收藏视图全选后导出路径清单，selection scope 必须带
    // favoritesOnly，否则服务端按「全部文件」解析而非仅收藏。
    const entries = Array.from({ length: 3 }, (_, index) => ({
      path: `D:\\refs\\fav-${index}.png`,
      name: `fav-${index}.png`,
      isDirectory: false,
      extension: "png",
    }));
    const listDirectory = vi.fn(async () => ({
      entries,
      total: 3,
      totalFiles: 3,
      revision: "favorites",
      scanState: "complete" as const,
      nextCursor: null,
    }));
    const exportPaths = vi.fn(async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      state: "running" as const,
      action: { type: "exportPaths" as const, destination: "D:\\paths.txt" },
      total: 3,
      processed: 0,
      failed: [],
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          listDirectory,
          onSearchProgress: () => () => undefined,
          onBatchProgress: () => () => undefined,
          exportPaths,
        },
        system: { writeClipboard: vi.fn(async () => undefined) },
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
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[title="只看收藏"]')?.click();
      await Promise.resolve();
    });
    const panel = document.querySelector<HTMLElement>(".asset-panel")!;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(
        'button[title="导出 UTF-8 路径清单"]',
      )?.click();
      await Promise.resolve();
    });
    expect(exportPaths).toHaveBeenCalledWith({
      mode: "all",
      directoryPath: "D:\\refs",
      revision: "favorites",
      excludedPaths: [],
      extensions: undefined,
      favoritesOnly: true,
    });
  });

  it("renders folder group header with compact folder rows and no file header", async () => {
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
        { path: "D:\\refs\\sub-a", name: "sub-a", isDirectory: true, extension: "" },
        { path: "D:\\refs\\sub-b", name: "sub-b", isDirectory: true, extension: "" },
        { path: "D:\\refs\\a.txt", name: "a.txt", isDirectory: false, extension: "txt", size: 4 },
      ],
      directoryTotal: 3,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });

    const folderHeader = host.querySelector<HTMLButtonElement>(
      '[data-testid="directory-folder-group-header"]',
    );
    expect(folderHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(folderHeader?.textContent).toContain("文件夹");
    expect(folderHeader?.textContent).toContain("2");
    // 文件分组头已移除（对齐迅雷），文件区直接网格。
    expect(host.querySelector('[data-testid="directory-file-group-header"]')).toBeNull();
    // 文件夹区 = 紧凑多列行（FolderGlyph + 名称）；文件区 = 大卡网格。
    const folderRows = Array.from(
      host.querySelectorAll<HTMLElement>(".directory-folder-row"),
    );
    expect(folderRows).toHaveLength(2);
    expect(folderRows[0]?.textContent).toContain("sub-a");
    expect(folderRows[0]?.querySelector('[data-folder-glyph]')).toBeTruthy();
    expect(host.querySelectorAll(".directory-card-wrap")).toHaveLength(1);

    // 折叠文件夹区：文件夹紧凑行消失、文件卡片保留，头部计数不变。
    await act(async () => {
      folderHeader?.click();
      await Promise.resolve();
    });
    expect(folderHeader?.getAttribute("aria-expanded")).toBe("false");
    const names = Array.from(
      document.querySelectorAll<HTMLElement>(".directory-card .asset-title"),
    ).map((node) => node.textContent);
    expect(names).toEqual(["a.txt"]);

    // 再次展开恢复全部行。
    await act(async () => {
      folderHeader?.click();
      await Promise.resolve();
    });
    expect(host.querySelectorAll(".directory-folder-row")).toHaveLength(2);
    expect(host.querySelectorAll(".directory-card-wrap")).toHaveLength(1);
  });

  it("shows file/folder counts in the bottom status bar", async () => {
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
        { path: "D:\\refs\\sub-a", name: "sub-a", isDirectory: true, extension: "" },
        { path: "D:\\refs\\sub-b", name: "sub-b", isDirectory: true, extension: "" },
        { path: "D:\\refs\\a.txt", name: "a.txt", isDirectory: false, extension: "txt", size: 4 },
      ],
      directoryTotal: 3,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });

    const bar = host.querySelector<HTMLElement>('[data-testid="directory-status-bar"]');
    expect(bar?.textContent).toContain("文件: 1");
    expect(bar?.textContent).toContain("文件夹: 2");
  });

  it("switches between grid and list views with selection preserved", async () => {
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
        { path: "D:\\refs\\a.txt", name: "a.txt", isDirectory: false, extension: "txt", size: 4 },
        { path: "D:\\refs\\b.txt", name: "b.txt", isDirectory: false, extension: "txt", size: 4 },
      ],
      directoryTotal: 2,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });

    // 默认网格视图。
    expect(host.querySelectorAll(".directory-card-wrap").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".directory-row")).toHaveLength(0);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="directory-view-list"]')?.click();
      await Promise.resolve();
    });
    const rows = () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".directory-row"));
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.textContent).toContain("a.txt");

    // 列表行复用选择逻辑。
    await act(async () => {
      rows()[0]?.click();
    });
    expect(useAppStore.getState().selectedDirectoryEntry?.path).toBe("D:\\refs\\a.txt");
    expect(rows()[0]?.classList.contains("selected")).toBe(true);

    // 切回网格。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="directory-view-grid"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelectorAll(".directory-card-wrap").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".directory-row")).toHaveLength(0);
  });

  it("keeps list rows in view while scrolling (single-column virtual window)", async () => {
    // 回归：列表视图的虚拟窗口必须与渲染共用单列，否则滚动后索引按多列
    // 行号推算，可见窗口整体偏移、内容「丢失」。
    let resizeCallback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
      },
    );
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    const entries = Array.from({ length: 60 }, (_, index) => ({
      path: `D:\\refs\\f${String(index).padStart(2, "0")}.txt`,
      name: `f${String(index).padStart(2, "0")}.txt`,
      isDirectory: false,
      extension: "txt",
      size: 4,
    }));
    useAppStore.setState({
      directoryPath: "D:\\refs",
      directoryEntries: entries,
      directoryTotal: 60,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
    });
    // 800×400 视口：网格下内部会算多列（宽松复现窗口列数 ≠ 渲染列数）。
    await act(async () => {
      resizeCallback?.(
        [{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="directory-view-list"]')?.click();
      await Promise.resolve();
    });

    // 滚到第 40 行（40px 行高 × 40 = 1600px）。
    const viewportNode = host.querySelector<HTMLElement>(".asset-viewport")!;
    await act(async () => {
      viewportNode.scrollTop = 1600;
      viewportNode.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const rowTops = Array.from(
      host.querySelectorAll<HTMLElement>(".directory-row-wrap"),
    ).map((node) => Number.parseInt(node.style.top, 10));
    expect(rowTops.length).toBeGreaterThan(0);
    // 行位置必须落在滚动视口附近（1600 ± 400 + overscan）；5 列错位时
    // 窗口索引会跳到 8000px 之外甚至渲染为空。
    expect(Math.min(...rowTops)).toBeGreaterThanOrEqual(1200);
    expect(Math.max(...rowTops)).toBeLessThan(3200);
  });

  it("zooms card size via the slider", async () => {
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
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });

    const slider = host.querySelector<HTMLInputElement>(
      '[data-testid="directory-zoom-slider"]',
    );
    expect(slider).toBeTruthy();
    expect(host.querySelector<HTMLElement>(".directory-card-wrap")?.style.width).toBe(
      "148px",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(slider, "0.75");
      slider?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    // 0.75 缩放：卡片宽 111px、行高 max(96, round(126*0.75)) + 34 = 130px。
    // jsdom 视口宽 0 ⇒ 1 列，第 3 张卡片在第 3 行：文件头已移除 ⇒ 2×130px。
    const cards = host.querySelectorAll<HTMLElement>(".directory-card-wrap");
    expect(cards[0]?.style.width).toBe("111px");
    expect(cards[0]?.style.getPropertyValue("--directory-card-h")).toBe("130px");
    expect(cards[2]?.style.top).toBe("260px");
  });

  it("sorts loaded entries by modified time and size from the sort menu", async () => {
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
        { path: "D:\\refs\\a.txt", name: "a.txt", isDirectory: false, extension: "txt", size: 100, mtimeMs: 3000 },
        { path: "D:\\refs\\b.txt", name: "b.txt", isDirectory: false, extension: "txt", size: 300, mtimeMs: 1000 },
        { path: "D:\\refs\\c.txt", name: "c.txt", isDirectory: false, extension: "txt", size: 200, mtimeMs: 2000 },
      ],
      directoryTotal: 3,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });

    const names = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".directory-card .asset-title"),
      ).map((node) => node.textContent);

    // 默认名称序（服务端顺序）。
    expect(names()).toEqual(["a.txt", "b.txt", "c.txt"]);

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-testid="directory-sort-toggle"]',
    );
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(document.querySelector(".dir-sort-popover")).toBeTruthy();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="directory-sort-size"]')?.click();
      await Promise.resolve();
    });
    expect(names()).toEqual(["a.txt", "c.txt", "b.txt"]); // 大小升序 100/200/300

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="directory-sort-mtime"]')?.click();
      await Promise.resolve();
    });
    expect(names()).toEqual(["b.txt", "c.txt", "a.txt"]); // 修改时间升序 1000/2000/3000
  });

  it("renders folder compact rows with adaptive columns and file cards with a 75% thumbnail", async () => {
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
      directoryEntries: [
        { path: "D:\\refs\\sub-a", name: "sub-a", isDirectory: true, extension: "" },
        { path: "D:\\refs\\sub-b", name: "sub-b", isDirectory: true, extension: "" },
        { path: "D:\\refs\\sub-c", name: "sub-c", isDirectory: true, extension: "" },
        { path: "D:\\refs\\sub-d", name: "sub-d", isDirectory: true, extension: "" },
        { path: "D:\\refs\\a.txt", name: "a.txt", isDirectory: false, extension: "txt", size: 4 },
      ],
      directoryTotal: 5,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
    });

    // 520px 宽：文件夹列宽 170 ⇒ floor((520+12)/(170+12)) = 2 列；
    // 4 个文件夹占 2 行（40px/行）；第 3 个文件夹（sub-c）在第 2 行第 1 列。
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
    const folderWraps = host.querySelectorAll<HTMLElement>(".directory-folder-row-wrap");
    expect(folderWraps).toHaveLength(4);
    expect(folderWraps[2]?.style.left).toBe("0px"); // sub-c 第 2 行第 1 列
    expect(folderWraps[3]?.style.left).toBe("182px"); // (170+12) * 1
    expect(folderWraps[2]?.style.top).toBe("68px"); // 28px 文件夹头 + 1×40px
    expect(folderWraps[0]?.style.height).toBe("40px");
    // 文件大卡：预览区占卡高 75%（160 × 0.75 = 120px），文件名/元信息居中。
    const card = host.querySelector<HTMLElement>(".directory-card-wrap");
    expect(card?.style.getPropertyValue("--directory-preview-h")).toBe("120px");
    // 缩略图右上角元数据徽章、右下角扩展名徽章与文件名元素均保留。
    expect(host.querySelector(".directory-extension-badge")?.textContent).toBe("TXT");
  });

  it("keeps the view-mode toggle and settings gear in the format filter row", async () => {
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
        { path: "D:\\refs\\a.txt", name: "a.txt", isDirectory: false, extension: "txt", size: 4 },
      ],
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

    // 网格/列表切换位于筛选行内（排序控件旁边），面包屑行右侧不再包含它。
    const filterRow = host.querySelector<HTMLElement>(".dir-format-filter");
    expect(filterRow?.querySelector('[data-testid="directory-view-grid"]')).toBeTruthy();
    expect(filterRow?.querySelector('[data-testid="directory-view-list"]')).toBeTruthy();
    const pathBarRight = host.querySelector<HTMLElement>(".dir-path-bar-right");
    expect(pathBarRight?.querySelector('[data-testid="directory-view-grid"]')).toBeNull();
    // 面包屑行右侧保留缩放滑块 + 视图选项按钮。
    expect(pathBarRight?.querySelector('[data-testid="directory-zoom-slider"]')).toBeTruthy();
    expect(pathBarRight?.querySelector('[data-testid="directory-view-options-toggle"]')).toBeTruthy();

    // ⚙ 设置入口在筛选行，触发与头部 Settings2 相同的入口事件。
    const settingsButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="directory-filter-settings"]',
    );
    expect(settingsButton).toBeTruthy();
    const openSettings = vi.fn();
    window.addEventListener("refcanvas:open-settings", openSettings);
    await act(async () => {
      settingsButton?.click();
      await Promise.resolve();
    });
    window.removeEventListener("refcanvas:open-settings", openSettings);
    expect(openSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: "preview",
      }),
    );
  });

  it("removes the standalone search box and uses a single-click editable path bar", async () => {
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          onSearchProgress: () => () => undefined,
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
      root.render(<DialogProvider><DirectoryAssetPanel /></DialogProvider>);
      await Promise.resolve();
    });

    // 搜索框已移除；路径栏默认是面包屑模式。
    expect(host.querySelector(".directory-search")).toBeNull();
    expect(host.querySelector(".dir-path-input")).toBeNull();

    // 单击面包屑空白区域进入路径编辑（Windows 资源管理器式）。
    const crumbs = host.querySelector<HTMLElement>(".dir-crumbs");
    expect(crumbs).toBeTruthy();
    await act(async () => {
      crumbs?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>(".dir-path-input");
    expect(input).toBeTruthy();
    expect(input?.getAttribute("aria-label")).toBe("路径");
  });
});
