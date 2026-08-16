// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";
import { Sidebar } from "../../../../src/renderer/components/Sidebar";
import { setLanguage } from "../../../../src/renderer/app/i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

vi.mock("../../../../src/renderer/components/DirectoryBrowser", () => ({
  QuickAccessPane: () => <div data-testid="quick-access-pane" />,
  DirectoryTreePane: () => <div data-testid="directory-tree-pane" />,
}));

describe("Sidebar workspaces", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    window.localStorage.clear();
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

  it("composes three resizable panes plus a fixed footer", async () => {
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
    // 三面板 + 两个分隔条。
    expect(panes?.querySelector('[data-testid="quick-access-pane"]')).toBeTruthy();
    expect(panes?.querySelector('[data-testid="directory-tree-pane"]')).toBeTruthy();
    expect(panes?.querySelectorAll(".sidebar-splitter")).toHaveLength(2);
    expect(panes?.querySelector(".collections-section")).toBeTruthy();
    // 底部固定栏：搜索框 + 回收站。
    const footer = host.querySelector(".sidebar-footer");
    expect(footer).toBeTruthy();
    expect(footer?.querySelector(".sidebar-search input")).toBeTruthy();
    expect(footer?.querySelector(".sidebar-recycle-button")).toBeTruthy();
    // 集合面板「默认」tab + 空态；参考板区保留。
    expect(host.textContent).toContain("默认");
    expect(host.textContent).toContain("还没有集合");
    expect(host.textContent).toContain("参考板");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".sidebar-recycle-button")?.click();
    });
    expect(openRecycleBin).toHaveBeenCalledOnce();
  });

  it("keeps boards switching and forwards bottom search to the found panel", async () => {
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
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".sidebar-board-section .nav-row")
        ?.click();
    });
    expect(switchBoard).toHaveBeenCalledWith("board-1");

    // 底部搜索框输入 → 广播 refcanvas:directory-search（DirectoryAssetPanel 复用现有搜索）。
    const listener = vi.fn();
    window.addEventListener("refcanvas:directory-search", listener);
    const input = host.querySelector<HTMLInputElement>(".sidebar-search input");
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "布料");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "布料" }),
    );
    window.removeEventListener("refcanvas:directory-search", listener);
  });
});
