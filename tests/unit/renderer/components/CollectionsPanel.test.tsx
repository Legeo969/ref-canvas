// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { useAppStore } from "../../../../src/renderer/app/store";
import { CollectionsPanel } from "../../../../src/renderer/components/CollectionsPanel";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function sampleCollection(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    parentId,
    name,
    sortOrder: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function sampleItem(collectionId: string, path: string, state: string) {
  return {
    id: `item-${path}`,
    collectionId,
    identityId: null,
    mountId: null,
    relativePath: null,
    lastResolvedPath: path,
    pathKey: path.toLowerCase(),
    fingerprint: "abc123",
    state: state as "resolved" | "offline" | "missing" | "ambiguous",
    sortOrder: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function baseRefCanvas(overrides: Record<string, unknown> = {}) {
  const collections = {
    list: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    create: vi.fn(async () => sampleCollection("new-1", "新集合")),
    update: vi.fn(async () => sampleCollection("c-1", "改名")),
    delete: vi.fn(async () => undefined),
    addPaths: vi.fn(async () => []),
    removeItems: vi.fn(async () => undefined),
    resolve: vi.fn(async () => []),
    relink: vi.fn(async () => sampleItem("c-1", "D:\\new\\file.png", "resolved")),
    export: vi.fn(async () => ({
      id: "export-1",
      collectionId: "c-1",
      targetDirectory: "D:\\out",
      state: "completed",
      copied: 2,
      skipped: 1,
      failed: 0,
      manifestPath: "D:\\out\\.refcanvas-collection.json",
      errorCode: null,
      errorMessage: null,
    })),
    onChanged: () => () => undefined,
  };
  return {
    refCanvas: {
      collections,
      filesystem: {
        previewToken: vi.fn(),
      },
      library: {
        pathsForFiles: (files: File[]) => files.map((file) => file.name),
      },
      system: {
        writeClipboard: vi.fn(async () => undefined),
        pickFile: vi.fn(async () => ["D:\\new\\file.png"]),
        pickDirectory: vi.fn(async () => "D:\\out"),
      },
      ...overrides,
    } as unknown as RefCanvasApi,
    collections,
  };
}

describe("CollectionsPanel", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  it("shows an empty hint and creates a collection via the plus menu", async () => {
    const { refCanvas, collections } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections: [],
      collectionTree: {},
      collectionItems: {},
      activeCollectionId: null,
      refreshCollections: vi.fn(async () => undefined),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <CollectionsPanel />
        </DialogProvider>,
      );
    });
    expect(host.textContent).toContain("还没有集合");

    await act(async () => {
      host.querySelector('[aria-label="新建集合"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      host.querySelector('.collection-menu button[role="menuitem"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const input = host.querySelector<HTMLInputElement>(".form-dialog input");
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "镜头参考");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    expect(collections.create).toHaveBeenCalledWith({ name: "镜头参考" });
  });

  it("renders the collection tree and opens a collection to show item states", async () => {
    const collections = [
      sampleCollection("c-1", "灵感"),
      sampleCollection("c-2", "子集", "c-1"),
    ];
    const items = [
      sampleItem("c-1", "D:\\refs\\a.png", "resolved"),
      sampleItem("c-1", "D:\\refs\\b.png", "offline"),
      sampleItem("c-1", "D:\\refs\\c.png", "missing"),
      sampleItem("c-1", "D:\\refs\\d.png", "ambiguous"),
    ];
    const refreshCollections = vi.fn(async () => undefined);
    const openCollection = vi.fn((id: string) => {
      useAppStore.setState({ activeCollectionId: id });
    });
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: {
        "": [collections[0]],
        "c-1": [collections[1]],
      },
      collectionItems: { "c-1": items },
      activeCollectionId: null,
      refreshCollections,
      openCollection,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <CollectionsPanel />
        </DialogProvider>,
      );
    });

    expect(host.textContent).toContain("灵感");
    expect(host.textContent).toContain("子集");

    await act(async () => {
      host
        .querySelectorAll(".collection-row-main")[0]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openCollection).toHaveBeenCalledWith("c-1");

    // 打开后再次渲染 CollectionDetailsPanel 校验条目状态徽章。
    useAppStore.setState({ activeCollectionId: "c-1" });
    const { CollectionDetailsPanel } = await import(
      "../../../../src/renderer/components/CollectionsPanel"
    );
    const detailsHost = document.createElement("div");
    document.body.append(detailsHost);
    const detailsRoot = createRoot(detailsHost);
    roots.push(detailsRoot);
    await act(async () => {
      detailsRoot.render(
        <DialogProvider>
          <CollectionDetailsPanel />
        </DialogProvider>,
      );
    });
    expect(detailsHost.textContent).toContain("灵感");
    expect(detailsHost.textContent).toContain("可解析");
    expect(detailsHost.textContent).toContain("离线");
    expect(detailsHost.textContent).toContain("缺失");
    expect(detailsHost.textContent).toContain("歧义");
    expect(detailsHost.textContent).toContain("4 项");
  });

  it("exports a collection and shows the summary", async () => {
    const collections = [sampleCollection("c-1", "灵感")];
    const { refCanvas, collections: api } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: { "": collections },
      collectionItems: { "c-1": [sampleItem("c-1", "D:\\refs\\a.png", "resolved")] },
      activeCollectionId: "c-1",
      refreshCollections: vi.fn(async () => undefined),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <CollectionsPanel />
        </DialogProvider>,
      );
    });

    // 通过树节点菜单触发导出。
    await act(async () => {
      host
        .querySelector(".collection-row-actions .mini-icon-button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      const exportItem = Array.from(host.querySelectorAll(".collection-menu button")).find(
        (button) => button.textContent?.includes("导出"),
      );
      exportItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(api.export).toHaveBeenCalledWith("c-1", "D:\\out");
  });

  it("relinks an item and confirms a fingerprint change", async () => {
    const collections = [sampleCollection("c-1", "灵感")];
    const item = sampleItem("c-1", "D:\\refs\\a.png", "missing");
    const { refCanvas, collections: api } = baseRefCanvas();
    api.relink
      .mockRejectedValueOnce(new Error("RELINE_FINGERPRINT_CHANGED"))
      .mockResolvedValueOnce({ ...item, state: "resolved" });
    const refreshCollections = vi.fn(async () => undefined);
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: { "": collections },
      collectionItems: { "c-1": [item] },
      activeCollectionId: "c-1",
      refreshCollections,
    });

    const { CollectionDetailsPanel } = await import(
      "../../../../src/renderer/components/CollectionsPanel"
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <CollectionDetailsPanel />
        </DialogProvider>,
      );
    });

    // 打开条目右键菜单 → 重定位。
    await act(async () => {
      host
        .querySelector(".collection-item-card")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      const relinkItem = Array.from(host.querySelectorAll(".asset-context-menu button")).find(
        (button) => button.textContent?.includes("重定位"),
      );
      relinkItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // 指纹不一致 → 确认对话框。
    expect(host.textContent).toContain("指纹不一致");
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".confirm-dialog .primary-button")
        ?.click();
    });
    expect(api.relink).toHaveBeenLastCalledWith(item.id, "D:\\new\\file.png", true);
    expect(refreshCollections).toHaveBeenCalled();
  });

  it("adds dropped directory entries to the active collection", async () => {
    const collections = [sampleCollection("c-1", "灵感")];
    const { refCanvas, collections: api } = baseRefCanvas();
    const refreshCollections = vi.fn(async () => undefined);
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: { "": collections },
      collectionItems: {},
      activeCollectionId: "c-1",
      refreshCollections,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <CollectionsPanel />
        </DialogProvider>,
      );
    });

    const section = host.querySelector(".collections-section");
    const payloadByType = new Map<string, string>();
    const dataTransfer = {
      getData: (type: string) => payloadByType.get(type) ?? "",
      setData: (type: string, value: string) => {
        payloadByType.set(type, value);
      },
      files: [],
    } as unknown as DataTransfer;
    dataTransfer.setData(
      "application/x-refcanvas-directory-entry",
      JSON.stringify({ path: "D:\\refs\\shot_001.exr", isDirectory: false }),
    );
    await act(async () => {
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(over, "dataTransfer", { value: dataTransfer });
      section?.dispatchEvent(over);
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      section?.dispatchEvent(drop);
    });
    expect(api.addPaths).toHaveBeenCalledWith("c-1", ["D:\\refs\\shot_001.exr"]);
  });
});
