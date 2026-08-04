// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNavigationState } from "../../../../src/renderer/app/navigation-state";
import { useAppStore } from "../../../../src/renderer/app/store";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";
import { Sidebar } from "../../../../src/renderer/components/Sidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../../../src/renderer/components/DirectoryBrowser", () => ({
  DirectoryBrowser: () => <div data-testid="directory-browser" />,
}));

describe("Sidebar asset kinds", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  it("keeps kinds collapsed by default and separates toggle from Show all", async () => {
    const setKindFilter = vi.fn();
    useAppStore.setState({
      collections: [],
      tags: [],
      tagGroups: [],
      savedViews: [],
      collectionFilter: null,
      kindFilter: "image",
      lifecycleFilter: "active",
      favoriteFilter: undefined,
      linkStateFilter: "all",
      setKindFilter,
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

    const toggle = host.querySelector<HTMLButtonElement>(
      ".asset-kind-toggle",
    );
    const showAll = host.querySelector<HTMLButtonElement>(".asset-kind-main");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".asset-kind-children")).toBeNull();

    await act(async () => showAll?.click());
    expect(setKindFilter).toHaveBeenCalledWith("all");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle?.click());
    expect(setKindFilter).toHaveBeenCalledTimes(1);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll(".asset-kind-child")).toHaveLength(7);
    expect(readNavigationState().assetKindsExpanded).toBe(true);
  });
});
