// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi, SequenceGroupInfo } from "../../../../src/shared/contracts";
import { FOUND_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { SequencePreviewDialog } from "../../../../src/renderer/components/SequencePreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

class BufferedImageMock {
  static instances: BufferedImageMock[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private currentSource = "";

  constructor() {
    BufferedImageMock.instances.push(this);
  }

  set src(value: string) {
    this.currentSource = value;
  }

  get src() {
    return this.currentSource;
  }
}

const sequence: SequenceGroupInfo = {
  id: "seq-1",
  directory: "D:\\refs",
  baseName: "shot",
  extension: "png",
  pattern: "standard",
  files: ["D:\\refs\\shot.0001.png", "D:\\refs\\shot.0002.png"],
  frames: [1, 2],
  start: 1,
  end: 2,
  missingFrames: [],
  width: 4,
  fps: 24,
};

describe("SequencePreviewDialog", () => {
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    BufferedImageMock.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the previous frame until the next frame has loaded", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const foundSettings = {
      ...FOUND_SETTINGS_DEFAULTS,
      autoplaySequence: false,
      sequenceFpsPresets: [24, 30],
      mp4Presets: [FOUND_SETTINGS_DEFAULTS.mp4Presets[0]],
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          previewToken: vi.fn(async (file: string) =>
            file.includes("0001") ? "token-a" : "token-b",
          ),
        },
        system: {
          getPreferences: vi.fn(async () => ({ foundSettings })),
          pickDirectory: vi.fn(async () => null),
        },
        sequences: { exportMp4: vi.fn() },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={sequence} onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const triggerLoad = (source: string) => {
      for (const image of BufferedImageMock.instances) {
        if (image.src === source) image.onload?.();
      }
    };
    await act(async () => {
      triggerLoad("refbrowse://preview/token-a");
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLImageElement>(".sequence-preview-stage img")?.src).toContain("token-a");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="下一帧"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLImageElement>(".sequence-preview-stage img")?.src).toContain("token-a");

    await act(async () => {
      triggerLoad("refbrowse://preview/token-b");
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLImageElement>(".sequence-preview-stage img")?.src).toContain("token-b");
  });

  it("uses generated high-resolution previews for EXR sequences", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const foundSettings = {
      ...FOUND_SETTINGS_DEFAULTS,
      autoplaySequence: false,
      mp4Presets: [FOUND_SETTINGS_DEFAULTS.mp4Presets[0]],
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          previewToken: vi.fn(async () => "exr-token"),
        },
        system: {
          getPreferences: vi.fn(async () => ({ foundSettings })),
          pickDirectory: vi.fn(async () => null),
        },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <SequencePreviewDialog
          sequence={{
            ...sequence,
            extension: "exr",
            files: ["D:\\refs\\shot.0001.exr"],
            frames: [1],
            end: 1,
          }}
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(BufferedImageMock.instances.some((image) =>
      image.src === "refbrowse://thumbnail/exr-token?priority=preview&size=1920",
    )).toBe(true);
  });

  it("exports the current sequence to GIF", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const exportGif = vi.fn(async () => ({
      outputPath: "D:\\out\\shot.gif",
      durationSeconds: 0.2,
      frameCount: 2,
      width: 960,
      height: 540,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: {
          getPreferences: vi.fn(async () => ({
            foundSettings: {
              ...FOUND_SETTINGS_DEFAULTS,
              autoplaySequence: false,
              mp4Presets: [FOUND_SETTINGS_DEFAULTS.mp4Presets[0]],
            },
          })),
          pickDirectory: vi.fn(async () => "D:\\out"),
        },
        sequences: { exportMp4: vi.fn(), exportGif },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={sequence} onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="导出为 GIF"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exportGif).toHaveBeenCalledWith(expect.objectContaining({
      files: sequence.files,
      fps: FOUND_SETTINGS_DEFAULTS.defaultSequenceFps,
      outputDirectory: "D:\\out",
      baseName: "shot",
    }));
  });

  it("selects FPS and enabled MP4 presets from drawers", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const foundSettings = {
      ...FOUND_SETTINGS_DEFAULTS,
      autoplaySequence: false,
      defaultSequenceFps: 25,
      sequenceFpsPresets: [24, 25, 30],
      mp4Presets: [
        { ...FOUND_SETTINGS_DEFAULTS.mp4Presets[0], enabled: true },
        { ...FOUND_SETTINGS_DEFAULTS.mp4Presets[1], enabled: true, label: "轻量转换" },
      ],
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: {
          getPreferences: vi.fn(async () => ({ foundSettings })),
          pickDirectory: vi.fn(async () => null),
        },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={sequence} onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="帧率"]')?.click();
    });
    expect(host.querySelector('[aria-label="FPS 预设抽屉"]')).toBeTruthy();
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('.sequence-drawer-grid button')]
        .find((button) => button.textContent?.includes("30 FPS"))?.click();
    });
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="帧率"]')?.textContent).toContain("30 FPS");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="导出预设"]')?.click();
    });
    expect(host.querySelector('[aria-label="MP4 转换预设抽屉"]')).toBeTruthy();
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('.sequence-drawer-grid button')]
        .find((button) => button.textContent?.includes("轻量转换"))?.click();
    });
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="导出预设"]')?.textContent).toContain("轻量转换");
  });
});
