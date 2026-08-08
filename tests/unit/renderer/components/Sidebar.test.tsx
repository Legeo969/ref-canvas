// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";
import { Sidebar } from "../../../../src/renderer/components/Sidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../../../src/renderer/components/DirectoryBrowser", () => ({
  DirectoryBrowser: () => <div data-testid="directory-browser" />,
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

  it("keeps disk browsing and boards as the only primary areas", async () => {
    const switchBoard = vi.fn(async () => undefined);
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
        },
      ],
      activeBoard: null,
      tags: [],
      tagGroups: [],
      switchBoard,
    });
    window.localStorage.clear();

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

    const sidebar = host.querySelector(".sidebar");
    expect(sidebar?.firstElementChild?.getAttribute("data-testid")).toBe(
      "directory-browser",
    );
    expect(host.textContent).toContain("参考板");
    expect(host.textContent).toContain("引用集合");
    expect(host.textContent).toContain("还没有集合");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".sidebar-recycle-button")?.click();
    });
    expect(openRecycleBin).toHaveBeenCalledOnce();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".sidebar-board-section .nav-row")
        ?.click();
    });
    expect(switchBoard).toHaveBeenCalledWith("board-1");

  });
});
