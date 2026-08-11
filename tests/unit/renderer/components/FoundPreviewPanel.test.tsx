// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOUND_SETTINGS_DEFAULTS,
  type DirectoryEntry,
  type RefCanvasApi,
} from "../../../../src/shared/contracts";
import { FoundPreviewPanel } from "../../../../src/renderer/components/FoundPreviewPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const entry: DirectoryEntry = {
  path: "D:\\refs\\photo.png",
  name: "photo.png",
  isDirectory: false,
  extension: "png",
};

describe("FoundPreviewPanel smoke", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("renders without crashing when entry is null", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn() },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<FoundPreviewPanel entry={null} />);
    });

    expect(host.querySelector(".found-preview-panel")).toBeTruthy();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')).toBeTruthy();
  });

  it("renders the Found tab bar with Preview and AI tabs", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: null })) },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<FoundPreviewPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.textContent).toContain("Preview");
    expect(tabs[1]?.textContent).toContain("AI");
  });

  it("shows empty state when no asset is loaded", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => { throw new Error("no"); }) },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<FoundPreviewPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector(".found-preview-panel")).toBeTruthy();
    expect(host.querySelector(".found-tab-bar")).toBeTruthy();
  });

  it("applies focus state to the active Found panel DOM", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => { throw new Error("no"); }) },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    const panel = host.querySelector(".found-preview-panel");
    expect(panel?.classList.contains("preview-session-focused")).toBe(true);
    expect(panel?.querySelector(".found-tab-bar [role='tab']")).toBeTruthy();
    expect(panel?.querySelector('[aria-label="退出聚焦预览"]')).toBeTruthy();
  });
});
