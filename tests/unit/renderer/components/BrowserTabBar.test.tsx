// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../../src/renderer/app/store";
import { BrowserTabBar } from "../../../../src/renderer/components/BrowserTabBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("BrowserTabBar (FND-002)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  function tab(id: string, targetId: string, title: string) {
    return {
      id,
      kind: "directory" as const,
      targetId,
      title,
      backStack: [],
      forwardStack: [],
      query: "",
      typeFilters: [],
      flattenDepth: 0 as 0 | 1 | 2,
      gridSize: 200,
      selectedKeys: [],
      scrollOffset: 0,
    };
  }

  it("renders tabs and switches on click", async () => {
    const tabs = [tab("a", "D:\\x", "x"), tab("b", "D:\\y", "y")];
    const switchBrowserTab = vi.fn(async () => undefined);
    useAppStore.setState({ browserTabs: tabs, activeTabId: "a", switchBrowserTab });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<BrowserTabBar />);
    });
    expect(host.textContent).toContain("x");
    expect(host.textContent).toContain("y");

    await act(async () => {
      host.querySelectorAll(".browser-tab")[1]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(switchBrowserTab).toHaveBeenCalledWith("b");
  });

  it("closes a tab via its close button", async () => {
    const tabs = [tab("a", "D:\\x", "x"), tab("b", "D:\\y", "y")];
    const closeBrowserTab = vi.fn(async () => undefined);
    useAppStore.setState({ browserTabs: tabs, activeTabId: "a", closeBrowserTab });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<BrowserTabBar />);
    });
    await act(async () => {
      host
        .querySelectorAll(".browser-tab")[0]
        ?.querySelector(".browser-tab-close")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closeBrowserTab).toHaveBeenCalledWith("a");
  });

  it("reorders tabs on drag drop", async () => {
    const tabs = [tab("a", "D:\\x", "x"), tab("b", "D:\\y", "y")];
    const reorderBrowserTab = vi.fn();
    useAppStore.setState({ browserTabs: tabs, activeTabId: "a", reorderBrowserTab });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<BrowserTabBar />);
    });
    const [first, second] = host.querySelectorAll<HTMLElement>(".browser-tab");
    const payloadByType = new Map<string, string>();
    const dataTransfer = {
      getData: (type: string) => payloadByType.get(type) ?? "",
      setData: (type: string, value: string) => {
        payloadByType.set(type, value);
      },
      files: [],
    } as unknown as DataTransfer;
    await act(async () => {
      const start = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      first?.dispatchEvent(start);
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      second?.dispatchEvent(drop);
    });
    expect(reorderBrowserTab).toHaveBeenCalledWith("a", "b");
  });
});
