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
  SequencePreviewDialog: ({ sequence, controlsTarget, multichannelOpen, onGifExportToggle }: { sequence: { id: string; extension?: string }; controlsTarget?: HTMLElement | null; multichannelOpen?: boolean; onGifExportToggle?: () => void }) => (
    <div data-testid="sequence-session" data-sequence-id={sequence.id} data-controls-target={Boolean(controlsTarget)} data-multichannel-open={Boolean(multichannelOpen)}>
      <button aria-label="测试序列 GIF 范围" onClick={onGifExportToggle}>GIF</button>
    </div>
  ),
}));

vi.mock("../../../../src/renderer/components/HdrPreview", async () => {
  const { createPortal } = await import("react-dom");
  return {
    HdrPreview: ({
      controlsTarget,
      multichannelOpen,
      eyedropActive,
    }: {
      controlsTarget?: HTMLElement | null;
      multichannelOpen?: boolean;
      eyedropActive?: boolean;
    }) => (
      <div className={`hdr-preview found-managed-preview${eyedropActive ? " is-sampling" : ""}`}>
        {controlsTarget && createPortal(
          <div className="hdr-preview-controls">
            {multichannelOpen && <div className="hdr-channel-control" aria-label="EXR 通道选择器" />}
          </div>,
          controlsTarget,
        )}
      </div>
    ),
  };
});

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
    expect(host.querySelector(".found-toolbar-renderer-controls .image-preview-toolbar")).toBeTruthy();
    expect(host.querySelector(".found-preview-controls-slot")).toBeNull();
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
    expect(workspace?.querySelector(".found-preview-controls-slot")).toBeNull();
    expect(workspace?.querySelector(".found-toolbar-renderer-controls .image-preview-toolbar")).toBeTruthy();
    expect(workspace?.querySelector(".found-toolbar-image")).toBeTruthy();
    expect(workspace?.querySelectorAll('[aria-label="资产备注"]')).toHaveLength(1);
    expect(host.querySelector(".found-tab-bar .preview-session-mode-actions")).toBeNull();
    expect(workspace?.querySelector(".found-toolbar-tail .preview-session-mode-actions")).toBeTruthy();
    expect(workspace?.querySelectorAll(".preview-color-swatches")).toHaveLength(0);
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
    expect(host.querySelector(".found-context-tray-lut")).toBeNull();
    expect(document.body.querySelector(".found-lut-anchor-menu .preview-color-tools")).toBeTruthy();
    expect(document.body.querySelector(".found-lut-anchor-menu")?.getAttribute("data-placement")).toBe("top-start");
  });

  it("opens GIF export as an embedded range tool below the video preview", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const videoEntry = { ...entry, path: "D:\\refs\\clip.mp4", name: "clip.mp4", extension: "mp4" };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "video-1", kind: "video", extension: "mp4", path: videoEntry.path,
          previewUrl: "refasset://video", thumbnailUrl: "refasset://thumb",
          title: videoEntry.name, linkState: "online",
        } })) },
        media: { probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })), palette: vi.fn(async () => []) },
        mediaNotes: { list: vi.fn(async () => []), getPlaybackState: vi.fn(async () => null), setPlaybackState: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={videoEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="导出 GIF"]')?.click());
    expect(host.querySelector(".found-preview-panel.tool-open")).toBeTruthy();
    expect(host.querySelector(".found-context-tray-gif .gif-export-studio.embedded")).toBeTruthy();
    expect(host.querySelector(".found-slider .range-start")).toBeTruthy();
    expect(host.querySelector(".found-slider .range-end")).toBeTruthy();
    expect(host.querySelector(".gif-dual-range")).toBeNull();
    expect(host.querySelector(".quick-preview-backdrop")).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("uses the shared color-bar action for eyedropper mode and one palette", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "image-1", kind: "image", extension: "png", path: entry.path,
          previewUrl: "refasset://image", thumbnailUrl: "refasset://thumb",
          title: entry.name, linkState: "online",
        } })) },
        media: { palette: vi.fn(async () => ([
          { rgb: [17, 34, 51], hex: "#112233", count: 10 },
          { rgb: [68, 85, 102], hex: "#445566", count: 8 },
        ])) },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
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
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(host.querySelectorAll(".preview-color-swatches")).toHaveLength(0);
    expect(host.querySelectorAll(".found-color-swatches")).toHaveLength(0);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="色彩栏"]')?.click());
    expect(host.querySelector(".image-review-img")?.classList.contains("eyedrop")).toBe(false);
    expect(host.querySelectorAll(".found-color-swatches")).toHaveLength(1);
    expect(host.querySelectorAll(".found-color-swatch.fixed")).toHaveLength(2);
    expect(host.querySelector('[aria-label="吸取颜色"]')).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="吸取颜色"]')?.click());
    expect(host.querySelector(".image-review-img")?.classList.contains("eyedrop")).toBe(true);
    await act(async () => host.querySelector(".image-review-img")?.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector(".image-review-img")?.classList.contains("eyedrop")).toBe(true);
  });

  it("opens the real EXR channel controls inside the shared toolbar", async () => {
    const exrEntry = { ...entry, path: "D:\\refs\\beauty.exr", name: "beauty.exr", extension: "exr" };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "exr-1", kind: "image", extension: "exr", path: exrEntry.path,
          previewUrl: "refasset://asset/exr-1", thumbnailUrl: "refasset://thumbnail/exr-1",
          title: exrEntry.name, linkState: "online",
        } })) },
        media: {
          probe: vi.fn(async () => ({
            width: 2048,
            height: 1024,
            duration: null,
            extra: {
              defaultLayer: "Beauty",
              layers: [{ name: "Beauty", components: ["R", "G", "B", "A"] }],
            },
          })),
          exportDisplayChannel: vi.fn(),
        },
        mediaNotes: {
          list: vi.fn(async () => []),
          getPlaybackState: vi.fn(async () => null),
          setPlaybackState: vi.fn(),
        },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={exrEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".found-preview-controls-slot")).toBeNull();
    expect(host.querySelector(".found-toolbar-renderer-controls .hdr-preview-controls")).toBeTruthy();
    expect(host.querySelector(".hdr-channel-control")).toBeNull();
    expect(host.querySelector('[aria-label="反射球"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="全景模式"]')).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="提取多通道"]')?.click());
    expect(host.querySelector(".found-toolbar-renderer-controls .hdr-channel-control")).toBeTruthy();
    expect(host.querySelector('[aria-label="提取多通道"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses the in-preview sampler for HDR instead of the native EyeDropper", async () => {
    const exrEntry = { ...entry, path: "D:\\refs\\beauty.exr", name: "beauty.exr", extension: "exr" };
    const nativeOpen = vi.fn();
    Object.assign(window, {
      EyeDropper: class { open = nativeOpen; },
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "exr-1", kind: "image", extension: "exr", path: exrEntry.path,
          previewUrl: "refasset://asset/exr-1", thumbnailUrl: "refasset://thumbnail/exr-1",
          title: exrEntry.name, linkState: "online",
        } })) },
        media: { probe: vi.fn(async () => ({ width: 2048, height: 1024, extra: {} })), palette: vi.fn(async () => []) },
        mediaNotes: {
          list: vi.fn(async () => []),
          getPlaybackState: vi.fn(async () => null),
          setPlaybackState: vi.fn(async () => undefined),
        },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={exrEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="色彩栏"]')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="吸取颜色"]')?.click());

    expect(host.querySelector(".hdr-preview.is-sampling")).toBeTruthy();
    expect(nativeOpen).not.toHaveBeenCalled();
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

  it("uses the shared sequence progress bar as the GIF frame range selector", async () => {
    const group = {
      id: "gif-sequence", directory: "D:\\refs", baseName: "shot", extension: "png",
      pattern: "standard" as const, files: ["D:\\refs\\shot.0001.png", "D:\\refs\\shot.0002.png"], frames: [1, 2],
      start: 1, end: 2, missingFrames: [], width: 4, fps: 24,
    };
    const sequenceEntry = { ...entry, path: group.files[0], name: "shot.0001.png", sequenceGroup: group };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "gif-sequence-asset", kind: "image", extension: "png", path: sequenceEntry.path,
          previewUrl: "refasset://sequence", title: sequenceEntry.name, linkState: "online",
        } })) },
        media: { probe: vi.fn(), palette: vi.fn(async () => []) },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={sequenceEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(host.querySelector(".found-slider .range-start")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="测试序列 GIF 范围"]')?.click());
    expect(host.querySelector(".found-slider .range-start")).toBeTruthy();
    expect(host.querySelector(".found-slider .range-end")).toBeTruthy();
    expect(host.querySelector(".found-context-tray-gif .gif-export-studio.embedded")).toBeTruthy();
    expect(host.querySelectorAll(".found-context-tray-gif .gif-export-options select")).toHaveLength(4);
  });

  it("exposes active HDR capabilities for an EXR sequence", async () => {
    const group = {
      id: "exr-sequence", directory: "D:\\refs", baseName: "beauty", extension: "exr",
      pattern: "standard" as const, files: ["D:\\refs\\beauty.0001.exr"], frames: [1],
      start: 1, end: 1, missingFrames: [], width: 4, fps: 24,
    };
    const sequenceEntry = { ...entry, path: group.files[0], name: "beauty.0001.exr", extension: "exr", sequenceGroup: group };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "exr-sequence-asset", kind: "image", extension: "exr", path: sequenceEntry.path,
          previewUrl: "refasset://exr", thumbnailUrl: "refasset://exr-thumb", title: sequenceEntry.name, linkState: "online",
        } })) },
        media: { probe: vi.fn(async () => ({ width: 1920, height: 1080, extra: { layers: [] } })), palette: vi.fn(async () => []) },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<FoundPreviewPanel entry={sequenceEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    const paletteButton = host.querySelector<HTMLButtonElement>('[aria-label="色彩栏"]');
    const multichannelButton = host.querySelector<HTMLButtonElement>('[aria-label="提取多通道"]');
    expect(paletteButton?.disabled).toBe(false);
    expect(multichannelButton?.disabled).toBe(false);
    await act(async () => multichannelButton?.click());
    expect(host.querySelector('[data-testid="sequence-session"]')?.getAttribute("data-multichannel-open")).toBe("true");
  });
});
