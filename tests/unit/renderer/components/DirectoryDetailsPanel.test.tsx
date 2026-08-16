// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOUND_SETTINGS_DEFAULTS,
  type AssetRecord,
  type DirectoryEntry,
  type RefCanvasApi,
} from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { DirectoryDetailsPanel } from "../../../../src/renderer/components/DirectoryDetailsPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 面板按钮已迁移到 i18n；断言基于简体中文。

const entry: DirectoryEntry = {
  path: "D:\\refs\\clip.mp4",
  name: "clip.mp4",
  isDirectory: false,
  extension: "mp4",
};

const asset = {
  id: "video-1",
  title: "clip.mp4",
  kind: "video",
  path: entry.path,
  extension: "mp4",
  linkState: "online",
  previewUrl: "refbrowse://preview/video",
  thumbnailUrl: "refbrowse://thumbnail/video",
  duration: 10,
} as AssetRecord;

describe("DirectoryDetailsPanel workbench", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("copies live palette colors inline without opening a color workbench", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const color = {
      rgb: [218, 133, 120] as [number, number, number],
      hex: "#da8578",
      count: 30,
    };
    const writeClipboard = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset })) },
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          palette: vi.fn(async () => [color]),
        },
        mediaNotes: {
          list: vi.fn(async () => []),
          getPlaybackState: vi.fn(async () => null),
          setPlaybackState: vi.fn(async () => undefined),
          create: vi.fn(),
          delete: vi.fn(),
        },
        filesystem: { open: vi.fn(), reveal: vi.fn() },
        system: {
          getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })),
          writeClipboard,
        },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DirectoryDetailsPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const liveColor = host.querySelector<HTMLButtonElement>(
      '.video-step-controls [aria-label="复制颜色 #da8578"]',
    );
    expect(liveColor).toBeTruthy();
    await act(async () => {
      liveColor?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeClipboard).toHaveBeenCalledWith("#da8578");
    expect(host.querySelector('[aria-label="色彩提取"]')).toBeNull();
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="全屏预览"]')).toBeTruthy();
  });

  it("switches AI inside the workbench and binds the current material", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    Object.assign(window, {
      refCanvas: {
        metadata: { ensure: vi.fn(async () => ({ asset })) },
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          palette: vi.fn(async () => []),
        },
        mediaNotes: {
          list: vi.fn(async () => []),
          getPlaybackState: vi.fn(async () => null),
          setPlaybackState: vi.fn(async () => undefined),
        },
        filesystem: {
          open: vi.fn(),
          reveal: vi.fn(),
          previewToken: vi.fn(async () => "source-token"),
        },
        library: { pathsForFiles: vi.fn(() => []) },
        ai: {
          listProviders: vi.fn(async () => [{ kind: "mock", label: "Mock", available: true, detail: null }]),
          getSettings: vi.fn(async () => ({
            comfyuiAddress: "http://127.0.0.1:8188",
            comfyuiWorkflowPath: null,
            comfyuiBinding: null,
            remoteBaseUrl: null,
            remoteConfigured: false,
            defaultProvider: "mock",
            enabledProviders: ["mock"],
          })),
          listJobs: vi.fn(async () => []),
          onChanged: vi.fn(() => () => undefined),
        },
        system: {
          getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })),
          writeClipboard: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<DirectoryDetailsPanel entry={entry} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((button) => button.textContent?.includes("AI 设计监督"))?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector(".ai-panel.embedded")).toBeTruthy();
    expect(host.querySelector(".ai-panel-backdrop:not(.embedded)")).toBeNull();
    expect(
      [...host.querySelectorAll<HTMLElement>(".ai-input-thumb")]
        .some((thumb) => thumb.title === entry.path),
    ).toBe(true);
    expect(host.querySelector(".workbench-preview-shell")).toBeNull();
  });
});
