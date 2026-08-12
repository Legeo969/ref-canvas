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

vi.mock("../../../../src/renderer/components/SequencePreview", () => ({
  SequencePreviewDialog: ({ sequence }: { sequence: { id: string } }) => (
    <div data-testid="sequence-session" data-sequence-id={sequence.id} />
  ),
}));

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

  it("renders SVG Layers and the image toolbar variant", async () => {
    const svgEntry = { ...entry, path: "D:\\refs\\mark.svg", name: "mark.svg", extension: "svg" };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "svg-1", kind: "image", extension: "svg", path: svgEntry.path,
          previewUrl: "refasset://svg", title: "mark.svg", linkState: "online",
        } })) },
        media: { probe: vi.fn() }, filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={svgEntry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".found-layers-panel")?.textContent).toContain("Layers (0)");
    expect(host.querySelector(".found-toolbar-svg")).toBeTruthy();
    expect(host.querySelectorAll('[aria-label="资产备注"]')).toHaveLength(1);
    expect(host.querySelector(".found-preview-controls-slot .image-preview-toolbar")).toBeTruthy();
  });

  it("keeps the filename and controls below an unobstructed shared viewport", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "image-1", kind: "image", extension: "png", path: entry.path,
          previewUrl: "refasset://image", thumbnailUrl: "refasset://thumb",
          title: entry.name, linkState: "online",
        } })) },
        media: { probe: vi.fn() }, filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: {
          writeClipboard: vi.fn(),
          getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={entry} />);
      await Promise.resolve(); await Promise.resolve();
    });

    const viewport = host.querySelector(".found-preview-viewport");
    const workspace = host.querySelector(".found-preview-workspace");
    expect(viewport).toBeTruthy();
    expect(viewport?.querySelector(".workbench-asset-label")).toBeNull();
    expect(workspace?.querySelector(".found-preview-filename")?.textContent).toContain(entry.name);
    expect(workspace?.querySelector(".found-preview-controls-slot")).toBeTruthy();
    expect(workspace?.querySelector(".image-preview-toolbar")).toBeTruthy();
    expect(workspace?.querySelector(".found-toolbar-image")).toBeTruthy();
    expect(workspace?.querySelectorAll('[aria-label="资产备注"]')).toHaveLength(1);
  });

  it("keeps media mounted and toggles compact tools from the shared bottom row", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "image-1", kind: "image", extension: "png", path: entry.path,
          previewUrl: "refasset://image", thumbnailUrl: "refasset://thumb",
          title: entry.name, linkState: "online",
        } })) },
        media: { probe: vi.fn() },
        mediaNotes: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: {
          writeClipboard: vi.fn(),
          getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })),
          setPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })),
          pickFile: vi.fn(async () => []),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={entry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    const viewport = host.querySelector(".found-preview-viewport");
    const notesButton = host.querySelector<HTMLButtonElement>('[aria-label="资产备注"]')!;
    await act(async () => notesButton.click());
    expect(host.querySelector(".found-preview-viewport")).toBe(viewport);
    expect(host.querySelector(".found-context-tray-notes .asset-notes-panel")).toBeTruthy();
    expect(notesButton.getAttribute("aria-pressed")).toBe("true");
    await act(async () => notesButton.click());
    expect(host.querySelector(".found-context-tray")).toBeNull();

    const lutButton = host.querySelector<HTMLButtonElement>('[aria-label="LUT"]')!;
    await act(async () => lutButton.click());
    expect(host.querySelector(".found-preview-viewport")).toBe(viewport);
    expect(host.querySelector(".found-context-tray-lut .preview-color-tools")).toBeTruthy();
  });

  it("keeps the panel DOM stable while switching selected entries", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async (path: string) => ({ asset: {
          id: path, kind: "generic", extension: "txt", path,
          previewUrl: "refasset://text", thumbnailUrl: "refasset://thumb",
          title: path.split("\\").at(-1), linkState: "online",
        } })) },
        media: { probe: vi.fn() }, filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<FoundPreviewPanel entry={null} />));
    const panel = host.querySelector(".found-preview-panel");
    await act(async () => {
      root.render(<FoundPreviewPanel entry={{ ...entry, path: "D:\\refs\\runtime-smoke.txt", name: "runtime-smoke.txt", extension: "txt" }} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".found-preview-panel")).toBe(panel);
    expect(panel?.querySelector(".directory-inspector-title")?.textContent).toContain("runtime-smoke.txt");
  });

  it("restarts the inner preview session when switching sequences", async () => {
    const firstGroup = {
      id: "sequence-a", directory: "D:\\refs", baseName: "a", extension: "png",
      pattern: "standard" as const, files: ["D:\\refs\\a.0001.png"], frames: [1],
      start: 1, end: 1, missingFrames: [], width: 4, fps: 24,
    };
    const secondGroup = { ...firstGroup, id: "sequence-b", baseName: "b", files: ["D:\\refs\\b.0001.png"] };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async (path: string) => ({ asset: {
          id: path, kind: "image", extension: "png", path,
          previewUrl: `refasset://${path}`, title: path, linkState: "online",
        } })) },
        media: { probe: vi.fn() }, filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const firstEntry = { ...entry, path: firstGroup.files[0], sequenceGroup: firstGroup };
    const secondEntry = { ...entry, path: secondGroup.files[0], sequenceGroup: secondGroup };
    await act(async () => {
      root.render(<FoundPreviewPanel entry={firstEntry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    const firstSession = host.querySelector('[data-testid="sequence-session"]');
    await act(async () => {
      root.render(<FoundPreviewPanel entry={secondEntry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    const secondSession = host.querySelector('[data-testid="sequence-session"]');
    expect(secondSession).not.toBe(firstSession);
    expect(secondSession?.getAttribute("data-sequence-id")).toBe("sequence-b");
  });
});
