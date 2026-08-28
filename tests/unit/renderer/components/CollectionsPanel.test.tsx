// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { useAppStore } from "../../../../src/renderer/app/store";
import { CollectionDetailsPanel, CollectionsPanel } from "../../../../src/renderer/components/CollectionsPanel";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

function sampleCollection(
  id: string,
  name: string,
  parentId: string | null = null,
  sortOrder = 0,
) {
  return {
    id,
    parentId,
    name,
    sortOrder,
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
    addPaths: vi.fn(async () => ({
      added: [],
      skipped: { directories: [], missing: [] },
    })),
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
        // CollectionItemCard 反查来源元数据；测试库没有资产记录。
        getByPath: vi.fn(async () => null),
      },
      libraries: {
        capturesDirectory: vi.fn(async () => "C:\\Users\\t\\AppData\\browser-captures"),
        adoptCaptures: vi.fn(async () => ({ adopted: [], failed: [] })),
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

  it("keeps collection menus above the outside-click layer", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/renderer/styles/collections.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.collection-node\s*\{[^}]*position:\s*relative;/s,
    );
    expect(css).toMatch(/\.collection-menu\s*\{[^}]*z-index:\s*120;/s);
    expect(css).toMatch(
      /\.collection-menu-head\s*\{[^}]*position:\s*relative;/s,
    );
  });

  it("keeps collection chevrons isolated from directory tree sizing", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/renderer/styles/collections.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.collection-row\s*\{[^}]*grid-template-columns:\s*34px\s+minmax\(0,\s*1fr\)\s+auto\s+auto;/s,
    );
    expect(css).toMatch(
      /\.collection-row\s+\.collection-tree-chevron\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*34px;[^}]*min-height:\s*34px;/s,
    );
    expect(css).not.toMatch(/\.collection-row[^}]*dir-tree-chevron/s);
  });

  it("shows an empty hint and creates a collection via the plus menu", async () => {
    const { refCanvas, collections } = baseRefCanvas();
    let finishCreate: ((value: ReturnType<typeof sampleCollection>) => void) | null = null;
    collections.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        }),
    );
    const refreshCollections = vi.fn(async () => undefined);
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections: [],
      collectionTree: {},
      collectionItems: {},
      activeCollectionId: null,
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
    expect(host.textContent).toContain("还没有集合");

    await act(async () => {
      host.querySelector('[aria-label="新建集合"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const menu = host.querySelector(".collection-menu");
    const dismiss = host.querySelector(".context-menu-dismiss");
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(
      dismiss?.compareDocumentPosition(menu as Node) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(host.textContent).toContain("选文件并新建集合");
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
      await Promise.resolve();
    });
    expect(collections.create).toHaveBeenCalledWith({ name: "镜头参考" });
    expect(refreshCollections).not.toHaveBeenCalled();

    await act(async () => {
      finishCreate?.(sampleCollection("new-1", "镜头参考"));
      await Promise.resolve();
    });
    expect(refreshCollections).toHaveBeenCalledTimes(1);
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
    expect(host.querySelector('[aria-label="添加素材到 灵感"]')).toBeTruthy();

    await act(async () => {
      host
        .querySelectorAll(".collection-row-main")[0]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openCollection).toHaveBeenCalledWith("c-1");

    // 打开后再次渲染 CollectionDetailsPanel 校验条目状态徽章；
    // openCollection 已在上面的 act 中同步写入 activeCollectionId。
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
    expect(detailsHost.textContent).toContain("可用");
    expect(detailsHost.textContent).toContain("离线");
    expect(detailsHost.textContent).toContain("缺失");
    expect(detailsHost.textContent).toContain("歧义");
    expect(detailsHost.textContent).toContain("4 项");
  });

  it("only marks collections active in directory workspace", async () => {
    const collection = sampleCollection("c-1", "灵感");
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      workspaceMode: "board",
      collections: [collection],
      collectionTree: { "": [collection] },
      collectionItems: {},
      activeCollectionId: collection.id,
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

    expect(host.querySelector(".collection-row.active")).toBeNull();

    await act(async () => {
      useAppStore.setState({ workspaceMode: "directory" });
    });
    expect(host.querySelector(".collection-row.active")).toBeTruthy();
  });

  it("opens a collection on the first click even when the create menu is open", async () => {
    const collection = sampleCollection("c-1", "灵感");
    const openCollection = vi.fn();
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      workspaceMode: "directory",
      collections: [collection],
      collectionTree: { "": [collection] },
      collectionItems: {},
      activeCollectionId: null,
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

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新建集合"]')?.click();
    });
    expect(host.querySelector(".collection-menu-head")).toBeTruthy();

    const row = host.querySelector<HTMLButtonElement>(".collection-row-main");
    await act(async () => {
      row?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      row?.click();
    });
    expect(openCollection).toHaveBeenCalledWith(collection.id);
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
    // 冲突策略表单出现；默认 rename，直接提交。
    await act(async () => {
      expect(document.querySelector('.form-dialog [role="combobox"]')).toBeTruthy();
      host
        .querySelector<HTMLButtonElement>(".form-dialog button[type='submit']")
        ?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(api.export).toHaveBeenCalledWith(
      "c-1",
      "D:\\out",
      expect.objectContaining({
        jobId: expect.any(String),
        conflictAction: "rename",
      }),
    );
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
      host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click();
      await Promise.resolve();
    });
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

  it("selects the directory entry when a resolved item card is clicked", async () => {
    const collections = [sampleCollection("c-1", "灵感")];
    const item = sampleItem("c-1", "D:\\refs\\a.png", "resolved");
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: { "": collections },
      collectionItems: { "c-1": [item] },
      activeCollectionId: "c-1",
      selectedDirectoryEntry: null,
      refreshCollections: vi.fn(async () => undefined),
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

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      host
        .querySelector(".collection-item-card")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppStore.getState().selectedDirectoryEntry).toEqual({
      path: "D:\\refs\\a.png",
      name: "a.png",
      isDirectory: false,
      extension: "png",
    });

    // 选中卡片带 active 高亮类。
    expect(host.querySelector(".collection-item-card")?.className).toContain("active");
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

  it("nests a collection by dragging it onto another row", async () => {
    const collections = [
      sampleCollection("c-1", "灵感"),
      sampleCollection("c-2", "素材"),
    ];
    const { refCanvas, collections: api } = baseRefCanvas();
    api.update.mockResolvedValueOnce(sampleCollection("c-2", "素材", "c-1"));
    const refreshCollections = vi.fn(async () => undefined);
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: { "": collections },
      collectionItems: {},
      activeCollectionId: null,
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

    const rows = host.querySelectorAll<HTMLElement>(".collection-row");
    expect(rows).toHaveLength(2);
    const payloadByType = new Map<string, string>();
    const dataTransfer = {
      getData: (type: string) => payloadByType.get(type) ?? "",
      setData: (type: string, value: string) => {
        payloadByType.set(type, value);
      },
      files: [],
    } as unknown as DataTransfer;
    dataTransfer.setData("application/x-refcanvas-collection-id", "c-2");
    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      rows[0]?.dispatchEvent(drop);
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
    expect(api.update).toHaveBeenCalledWith("c-2", { parentId: "c-1" });
  });

  it("shows the Default tab and collapses the panel via the header toggle", async () => {
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections: [sampleCollection("c-1", "灵感")],
      collectionTree: { "": [sampleCollection("c-1", "灵感")] },
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

    // 「集合」tab（图标 + 标题）与集合树可见。
    const tab = host.querySelector(".collections-tab");
    expect(tab?.textContent).toContain("集合");
    expect(tab?.querySelector("svg")).toBeTruthy();
    expect(host.textContent).toContain("灵感");

    // 头部 ⌃ 折叠：内容隐藏，tab 仍保留。
    const collapse = host.querySelector<HTMLButtonElement>('[aria-label="折叠"]');
    await act(async () => collapse?.click());
    expect(host.textContent).not.toContain("灵感");
    expect(host.textContent).toContain("集合");
  });

  it("reorders a collection through the row menu", async () => {
    const collections = [
      sampleCollection("c-1", "灵感", null, 0),
      sampleCollection("c-2", "素材", null, 1),
    ];
    const { refCanvas, collections: api } = baseRefCanvas();
    api.update.mockResolvedValueOnce(sampleCollection("c-2", "素材", null, 0));
    api.update.mockResolvedValueOnce(sampleCollection("c-1", "灵感", null, 1));
    const refreshCollections = vi.fn(async () => undefined);
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections,
      collectionTree: { "": collections },
      collectionItems: {},
      activeCollectionId: null,
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

    // 打开第一个集合（灵感）的行菜单并点“下移”。
    await act(async () => {
      host
        .querySelectorAll(".collection-row")[0]
        ?.querySelector(".collection-row-actions .mini-icon-button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      const moveDown = Array.from(host.querySelectorAll(".collection-menu button")).find(
        (button) => button.textContent?.includes("下移"),
      );
      moveDown?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
    expect(api.update).toHaveBeenNthCalledWith(1, "c-1", { sortOrder: 1 });
    expect(api.update).toHaveBeenNthCalledWith(2, "c-2", { sortOrder: 0 });
  });

  it("browses source folders and exposes collection status filters", async () => {
    const collection = sampleCollection("c-1", "灵感");
    const items = [
      sampleItem("c-1", "D:\\refs\\shots\\a.png", "resolved"),
      sampleItem("c-1", "D:\\refs\\shots\\b.png", "missing"),
    ];
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    useAppStore.setState({
      collections: [collection],
      collectionTree: { "": [collection] },
      collectionItems: { "c-1": items },
      activeCollectionId: "c-1",
      refreshCollections: vi.fn(async () => undefined),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DialogProvider><CollectionDetailsPanel /></DialogProvider>);
    });
    expect(host.querySelector(".collection-folder-card")).toBeTruthy();
    expect(host.textContent).toContain("2 项");
    await act(async () => host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".collection-folder-card")?.click());
    expect(host.querySelector(".collection-item-card")).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('.collection-health-chip.state-missing')?.click());
    expect(host.querySelectorAll(".collection-item-card")).toHaveLength(1);
    expect(host.textContent).toContain("b.png");
  });
});
