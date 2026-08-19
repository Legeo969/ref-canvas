// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";
import { Sidebar } from "../../../../src/renderer/components/Sidebar";
import { setLanguage } from "../../../../src/renderer/app/i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

vi.mock("../../../../src/renderer/components/DirectoryBrowser", () => ({
  // 转发 style：断言面板高度（拖动调整 + 持久化恢复）需要读取内联高度。
  QuickAccessPane: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="quick-access-pane" style={style} />
  ),
  DirectoryTreePane: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="directory-tree-pane" style={style} />
  ),
}));

describe("Sidebar workspaces", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    window.localStorage.clear();
    // Object.assign 挂的 mock 会跨用例残留（如 getPreferences），逐用例清理。
    delete (window as { refCanvas?: unknown }).refCanvas;
    document.body.replaceChildren();
  });

  async function renderSidebar() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <Sidebar />
        </DialogProvider>,
      );
    });
    return host;
  }

  it("composes four resizable panes plus a footer", async () => {
    const openRecycleBin = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: { system: { openRecycleBin } },
    });
    useAppStore.setState({
      workspaceMode: "directory",
      boards: [
        {
          id: "board-1",
          title: "镜头参考",
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
          revision: 1,
        },
      ],
      activeBoard: null,
      tags: [],
      tagGroups: [],
    });
    window.localStorage.clear();

    const host = await renderSidebar();
    const panes = host.querySelector(".sidebar-panes");
    expect(panes).toBeTruthy();
    // 四面板（收藏 / 目录 / 集合 / 参考板）+ 三个分隔条。
    expect(panes?.querySelector('[data-testid="quick-access-pane"]')).toBeTruthy();
    expect(panes?.querySelector('[data-testid="directory-tree-pane"]')).toBeTruthy();
    expect(panes?.querySelectorAll(".sidebar-splitter")).toHaveLength(3);
    expect(panes?.querySelector(".collections-section")).toBeTruthy();
    // 参考板区是第四个可调高面板（Splitter 3 之下，默认高度 180px）。
    const boardSection = panes?.querySelector<HTMLElement>(".sidebar-board-section");
    expect(boardSection).toBeTruthy();
    expect(boardSection?.style.height).toBe("180px");
    // 底部固定栏：只保留回收站（查找框已移除）。
    const footer = host.querySelector(".sidebar-footer");
    expect(footer).toBeTruthy();
    expect(footer?.querySelector(".sidebar-search input")).toBeFalsy();
    expect(footer?.querySelector(".sidebar-recycle-button")).toBeTruthy();
    // 集合面板 tab + 空态；参考板区保留。
    expect(host.textContent).toContain("集合");
    expect(host.textContent).toContain("还没有集合");
    expect(host.textContent).toContain("参考板");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".sidebar-recycle-button")?.click();
    });
    expect(openRecycleBin).toHaveBeenCalledOnce();
  });

  it("keeps boards switching inside the resizable stack", async () => {
    const switchBoard = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: { system: { openRecycleBin: vi.fn(async () => undefined) } },
    });
    useAppStore.setState({
      workspaceMode: "board",
      boards: [
        {
          id: "board-1",
          title: "镜头参考",
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
          revision: 1,
        },
      ],
      activeBoard: null,
      tags: [],
      tagGroups: [],
      switchBoard,
    });
    window.localStorage.clear();

    const host = await renderSidebar();
    // 参考板行仍在四面板栈内（分隔条 3 之下）。
    expect(
      host
        .querySelector(".sidebar-panes")
        ?.querySelector(".sidebar-board-section .nav-row"),
    ).toBeTruthy();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".sidebar-board-section .nav-row")
        ?.click();
    });
    expect(switchBoard).toHaveBeenCalledWith("board-1");
  });

  it("restores persisted pane heights on mount and saves them when a drag ends", async () => {
    const setPreferences = vi.fn(async () => undefined);
    const getPreferences = vi.fn(async () => ({
      // CollectionsPanel 的 VisibilityToggle 也读 getPreferences：
      // previewSettings 必须完整，否则 hook 状态被置空。
      previewSettings: PREVIEW_SETTINGS_DEFAULTS,
      sidebarLayout: {
        quickAccessHeight: 200,
        directoryHeight: 220,
        boardHeight: 150,
      },
    }));
    Object.assign(window, {
      refCanvas: {
        system: {
          openRecycleBin: vi.fn(async () => undefined),
          getPreferences,
          setPreferences,
        },
      },
    });
    useAppStore.setState({
      workspaceMode: "directory",
      boards: [],
      activeBoard: null,
      tags: [],
      tagGroups: [],
    });
    window.localStorage.clear();

    const host = await renderSidebar();
    await act(async () => {
      await Promise.resolve();
    });
    const board = host.querySelector<HTMLElement>(".sidebar-board-section");
    // 恢复：mount 后应用持久化高度（而非默认 180）。
    expect(board?.style.height).toBe("150px");
    expect(setPreferences).not.toHaveBeenCalled();

    // 键盘调整分隔条 3（收集 / 参考板）：向下 = 上方收集变大、参考板变小，
    // 分隔条跟随光标方向（回归：旧实现 board + deltaY 方向相反）。
    const splitters = host.querySelectorAll<HTMLElement>(".sidebar-splitter");
    await act(async () => {
      splitters[2]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(board?.style.height).toBe("142px"); // 150 - 8
    // 调整结束即持久化全部三个高度。
    expect(setPreferences).toHaveBeenCalledWith({
      sidebarLayout: {
        quickAccessHeight: 200,
        directoryHeight: 220,
        boardHeight: 142,
      },
    });
  });

  it("keeps splitter 1 compensation with the same drag direction as splitter 3", async () => {
    Object.assign(window, {
      refCanvas: { system: { openRecycleBin: vi.fn(async () => undefined) } },
    });
    useAppStore.setState({
      workspaceMode: "directory",
      boards: [],
      activeBoard: null,
      tags: [],
      tagGroups: [],
    });
    window.localStorage.clear();

    const host = await renderSidebar();
    const panes = host.querySelector<HTMLElement>(".sidebar-panes")!;
    const splitters = host.querySelectorAll<HTMLElement>(".sidebar-splitter");
    await act(async () => {
      splitters[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    // 分隔条 1 向下 = 上方快速访问变大（270→278），目录反向补偿（290→282）。
    expect(
      panes.querySelector<HTMLElement>('[data-testid="quick-access-pane"]')?.style,
    ).toMatchObject({ height: "278px" });
    expect(
      panes.querySelector<HTMLElement>('[data-testid="directory-tree-pane"]')?.style,
    ).toMatchObject({ height: "282px" });
  });

  it("fits the default layout into a short window instead of rebounding splitter drags", async () => {
    // 回归：矮窗口（720 可用）下默认高度总和 852 已溢出。旧实现不收紧，
    // 拖「目录/集合」分隔条时 maxDirectory < 当前值，向下拖目录反而变小。
    Object.assign(window, {
      refCanvas: { system: { openRecycleBin: vi.fn(async () => undefined) } },
    });
    useAppStore.setState({
      workspaceMode: "directory",
      boards: [],
      activeBoard: null,
      tags: [],
      tagGroups: [],
    });
    window.localStorage.clear();
    const heightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(720);

    const host = await renderSidebar();
    const panes = host.querySelector<HTMLElement>(".sidebar-panes")!;
    const directoryBefore = Number.parseInt(
      panes
        .querySelector<HTMLElement>('[data-testid="directory-tree-pane"]')
        ?.style.height ?? "0",
      10,
    );
    // 默认 852 → 收紧到 ≤ 708（720 − 100 集合预留 − 12 分隔条）。
    expect(directoryBefore).toBeLessThan(290);
    const total =
      Number.parseInt(
        panes.querySelector<HTMLElement>('[data-testid="quick-access-pane"]')
          ?.style.height ?? "0",
        10,
      ) +
      directoryBefore +
      Number.parseInt(
        panes.querySelector<HTMLElement>(".sidebar-board-section")
          ?.style.height ?? "0",
        10,
      ) +
      12 +
      100;
    expect(total).toBeLessThanOrEqual(720);

    const splitters = host.querySelectorAll<HTMLElement>(".sidebar-splitter");
    await act(async () => {
      splitters[1]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const directoryAfter = Number.parseInt(
      panes
        .querySelector<HTMLElement>('[data-testid="directory-tree-pane"]')
        ?.style.height ?? "0",
      10,
    );
    // 向下拖目录绝不反弹变小（旧实现会从 290 缩到约束值 158）；
    // 收紧后集合贴最小占位时允许被 clamp 在原地。
    expect(directoryAfter).toBeGreaterThanOrEqual(directoryBefore);
    heightSpy.mockRestore();
  });
});
