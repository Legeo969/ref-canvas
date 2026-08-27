// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_SETTINGS_DEFAULTS,
  type DirectoryEntry,
  type RefCanvasApi,
} from "../../../../src/shared/contracts";
import { PreviewPanel } from "../../../../src/renderer/components/PreviewPanel";
import { setLanguage } from "../../../../src/renderer/app/i18n";

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
      <div className={`hdr-preview preview-managed-preview${eyedropActive ? " is-sampling" : ""}`}>
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

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

const entry: DirectoryEntry = {
  path: "D:\\refs\\photo.png",
  name: "photo.png",
  isDirectory: false,
  extension: "png",
};

describe("PreviewPanel smoke", () => {
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<PreviewPanel entry={null} />);
    });

    expect(host.querySelector(".preview-panel")).toBeTruthy();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')).toBeTruthy();
  });

  it("renders the Preview tab bar with Preview and AI tabs", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: null })) },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<PreviewPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const tabs = host.querySelectorAll('[role="tab"]');
    // AI 设计总监入口由顶部功能图标承担（事件联动切模式），
    // 预览面板旁不再放 AI tab。
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.textContent).toContain("预览");
  });

  it("shows empty state when no asset is loaded", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => { throw new Error("no"); }) },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<PreviewPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector(".preview-panel")).toBeTruthy();
    expect(host.querySelector(".preview-tab-bar")).toBeTruthy();
  });

  it("applies focus state to the active Preview panel DOM", async () => {
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => { throw new Error("no"); }) },
        media: { probe: vi.fn() },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    const panel = host.querySelector(".preview-panel");
    expect(panel?.classList.contains("preview-session-focused")).toBe(true);
    expect(panel?.querySelector(".preview-tab-bar [role='tab']")).toBeTruthy();
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={svgEntry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".preview-layers-panel")?.textContent).toContain("Layers (0)");
    expect(host.querySelector(".preview-toolbar-svg")).toBeTruthy();
    expect(host.querySelectorAll('[aria-label="资产备注"]')).toHaveLength(1);
    expect(host.querySelector(".preview-toolbar-renderer-controls .image-preview-toolbar")).toBeTruthy();
    expect(host.querySelector(".preview-controls-slot")).toBeNull();
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
          getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={entry} />);
      await Promise.resolve(); await Promise.resolve();
    });

    const viewport = host.querySelector(".preview-viewport");
    const workspace = host.querySelector(".preview-workspace");
    expect(viewport).toBeTruthy();
    expect(viewport?.querySelector(".workbench-asset-label")).toBeNull();
    expect(workspace?.querySelector(".preview-filename")?.textContent).toContain(entry.name);
    expect(workspace?.querySelector(".preview-controls-slot")).toBeNull();
    expect(workspace?.querySelector(".preview-toolbar-renderer-controls .image-preview-toolbar")).toBeTruthy();
    expect(workspace?.querySelector(".preview-toolbar-image")).toBeTruthy();
    expect(workspace?.querySelectorAll('[aria-label="资产备注"]')).toHaveLength(1);
    expect(host.querySelector(".preview-tab-bar .preview-session-mode-actions")).toBeNull();
    expect(workspace?.querySelector(".preview-toolbar-tail .preview-session-mode-actions")).toBeTruthy();
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
          getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })),
          setPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })),
          pickFile: vi.fn(async () => []),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={entry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    const viewport = host.querySelector(".preview-viewport");
    const notesButton = host.querySelector<HTMLButtonElement>('[aria-label="资产备注"]')!;
    await act(async () => notesButton.click());
    expect(host.querySelector(".preview-viewport")).toBe(viewport);
    expect(host.querySelector(".preview-context-tray-notes .asset-notes-panel")).toBeTruthy();
    expect(notesButton.getAttribute("aria-pressed")).toBe("true");
    await act(async () => notesButton.click());
    expect(host.querySelector(".preview-context-tray")).toBeNull();

    const lutButton = host.querySelector<HTMLButtonElement>('[aria-label="LUT"]')!;
    await act(async () => lutButton.click());
    expect(host.querySelector(".preview-viewport")).toBe(viewport);
    expect(host.querySelector(".preview-context-tray-lut")).toBeNull();
    expect(document.body.querySelector(".preview-lut-anchor-menu .preview-color-tools")).toBeTruthy();
    expect(document.body.querySelector(".preview-lut-anchor-menu")?.getAttribute("data-placement")).toBe("top-start");
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={videoEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="导出 GIF"]')?.click());
    expect(host.querySelector(".preview-panel.tool-open")).toBeTruthy();
    expect(host.querySelector(".preview-context-tray-gif .gif-export-studio.embedded")).toBeTruthy();
    expect(host.querySelector(".preview-slider .range-start")).toBeTruthy();
    expect(host.querySelector(".preview-slider .range-end")).toBeTruthy();
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
          getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={entry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(host.querySelectorAll(".preview-color-swatches")).toHaveLength(0);
    expect(host.querySelectorAll(".preview-color-swatches")).toHaveLength(0);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="吸取颜色并显示色彩栏"]')?.click());
    expect(host.querySelector(".image-review-img")?.classList.contains("eyedrop")).toBe(false);
    expect(host.querySelectorAll(".preview-color-swatches")).toHaveLength(1);
    expect(host.querySelectorAll(".preview-color-swatch.fixed")).toHaveLength(2);
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={exrEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".preview-controls-slot")).toBeNull();
    expect(host.querySelector(".preview-toolbar-renderer-controls .hdr-preview-controls")).toBeTruthy();
    expect(host.querySelector(".hdr-channel-control")).toBeNull();
    expect(host.querySelector('[aria-label="反射球"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="全景模式"]')).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="提取多通道"]')?.click());
    expect(host.querySelector(".preview-toolbar-renderer-controls .hdr-channel-control")).toBeTruthy();
    expect(host.querySelector('[aria-label="提取多通道"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the reflection ball but not panorama for a 1:1 HDR environment map", async () => {
    // SoftBox_SoftEdge.exr 这类 1:1 柔光箱环境贴图：反射球（PMREM）可用，
    // 但非 equirectangular 2:1，不显示全景按钮。
    const softboxEntry = { ...entry, path: "D:\\refs\\SoftBox_SoftEdge.exr", name: "SoftBox_SoftEdge.exr", extension: "exr" };
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset: {
          id: "softbox-1", kind: "image", extension: "exr", path: softboxEntry.path,
          previewUrl: "refasset://asset/softbox-1", thumbnailUrl: "refasset://thumbnail/softbox-1",
          title: softboxEntry.name, linkState: "online",
        } })) },
        media: {
          probe: vi.fn(async () => ({ width: 2048, height: 2048, duration: null, extra: {} })),
        },
        mediaNotes: {
          list: vi.fn(async () => []),
          getPlaybackState: vi.fn(async () => null),
          setPlaybackState: vi.fn(),
        },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={softboxEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="反射球"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="全景模式"]')).toBeNull();
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={exrEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="吸取颜色并显示色彩栏"]')?.click());
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<PreviewPanel entry={null} />));
    const panel = host.querySelector(".preview-panel");
    await act(async () => {
      root.render(<PreviewPanel entry={{ ...entry, path: "D:\\refs\\runtime-smoke.txt", name: "runtime-smoke.txt", extension: "txt" }} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".preview-panel")).toBe(panel);
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const firstEntry = { ...entry, path: firstGroup.files[0], sequenceGroup: firstGroup };
    const secondEntry = { ...entry, path: secondGroup.files[0], sequenceGroup: secondGroup };
    await act(async () => {
      root.render(<PreviewPanel entry={firstEntry} />);
      await Promise.resolve(); await Promise.resolve();
    });
    const firstSession = host.querySelector('[data-testid="sequence-session"]');
    await act(async () => {
      root.render(<PreviewPanel entry={secondEntry} />);
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={sequenceEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(host.querySelector(".preview-slider .range-start")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="测试序列 GIF 范围"]')?.click());
    expect(host.querySelector(".preview-slider .range-start")).toBeTruthy();
    expect(host.querySelector(".preview-slider .range-end")).toBeTruthy();
    expect(host.querySelector(".preview-context-tray-gif .gif-export-studio.embedded")).toBeTruthy();
    expect(host.querySelectorAll(".preview-context-tray-gif .gif-export-options .select-menu-trigger")).toHaveLength(4);
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
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewPanel entry={sequenceEntry} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    const paletteButton = host.querySelector<HTMLButtonElement>('[aria-label="吸取颜色并显示色彩栏"]');
    const multichannelButton = host.querySelector<HTMLButtonElement>('[aria-label="提取多通道"]');
    expect(paletteButton?.disabled).toBe(false);
    expect(multichannelButton?.disabled).toBe(false);
    await act(async () => multichannelButton?.click());
    expect(host.querySelector('[data-testid="sequence-session"]')?.getAttribute("data-multichannel-open")).toBe("true");
  });
});
