// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi, SequenceGroupInfo } from "../../../../src/shared/contracts";
import { PREVIEW_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { SequencePreviewDialog } from "../../../../src/renderer/components/SequencePreview";

vi.mock("../../../../src/renderer/components/HdrPreview", async () => {
  const { createPortal } = await import("react-dom");
  return {
    HdrPreview: ({ path, controlsTarget, multichannelOpen, eyedropActive, onColorSample, displaySize }: { path?: string; controlsTarget?: HTMLElement | null; multichannelOpen?: boolean; eyedropActive?: boolean; onColorSample?: (color: string) => void; displaySize?: number }) => (
      <div data-testid="sequence-hdr-frame" data-path={path} data-eyedrop-active={eyedropActive ? "true" : "false"} data-display-size={displaySize}>
        <button type="button" aria-label="采样 EXR 颜色" onClick={() => onColorSample?.("#010203")}>采样</button>
        {controlsTarget && createPortal(<div className="hdr-preview-controls">
          <button aria-label="OCIO 色彩管理">OCIO</button>
          {multichannelOpen && <div aria-label="提取多通道" />}
        </div>, controlsTarget)}
      </div>
    ),
  };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

class BufferedImageMock {
  static instances: BufferedImageMock[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn(async () => undefined);
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
    vi.useRealTimers();
  });

  it("keeps the previous frame until the next frame has loaded", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: false,
      sequenceFpsPresets: [24, 30],
      mp4Presets: [PREVIEW_SETTINGS_DEFAULTS.mp4Presets[0]],
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          previewToken: vi.fn(async (file: string) =>
            file.includes("0001") ? "token-a" : "token-b",
          ),
        },
        system: {
          getPreferences: vi.fn(async () => ({ previewSettings })),
          pickDirectory: vi.fn(async () => null),
        },
        sequences: { exportMp4: vi.fn() },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    const controlsTarget = document.createElement("div");
    document.body.append(host, controlsTarget);
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
    expect(BufferedImageMock.instances.some((image) => image.src.includes("token-b") && image.decode.mock.calls.length > 0)).toBe(true);
  });

  it("uses generated high-resolution previews for EXR sequences", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: false,
      mp4Presets: [PREVIEW_SETTINGS_DEFAULTS.mp4Presets[0]],
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          previewToken: vi.fn(async () => "exr-token"),
        },
        system: {
          getPreferences: vi.fn(async () => ({ previewSettings })),
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

  it("uses 960px staging for multi-frame EXR sequences and 1920px in fullscreen", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = { ...PREVIEW_SETTINGS_DEFAULTS, autoplaySequence: false };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "exr-token") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings })), pickDirectory: vi.fn(async () => null) },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });
    const multiExr = {
      ...sequence,
      extension: "exr",
      files: ["D:\\refs\\shot.0001.exr", "D:\\refs\\shot.0002.exr"],
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const renderDialog = (fullscreen: boolean) => act(async () => {
      root?.render(<SequencePreviewDialog sequence={multiExr} embedded fullscreen={fullscreen} onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await renderDialog(false);
    expect(BufferedImageMock.instances.some((image) =>
      image.src === "refbrowse://thumbnail/exr-token?priority=preview&size=960",
    )).toBe(true);
    // HDR 前瞻预取：后续帧以 prefetch 优先级入队。
    expect(BufferedImageMock.instances.some((image) =>
      image.src === "refbrowse://thumbnail/exr-token?priority=prefetch&size=960",
    )).toBe(true);
    await act(async () => {
      BufferedImageMock.instances
        .find((image) => image.src.includes("priority=preview&size=960"))
        ?.onload?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-display-size")).toBe("960");

    await renderDialog(true);
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-display-size")).toBe("1920");
    expect(BufferedImageMock.instances.some((image) =>
      image.src === "refbrowse://thumbnail/exr-token?priority=preview&size=1920",
    )).toBe(true);
  });

  it("does not advance the HDR renderer path before the next frame is decoded", async () => {    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = { ...PREVIEW_SETTINGS_DEFAULTS, autoplaySequence: false };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async (file: string) => file.includes("0001") ? "exr-a" : "exr-b") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings })), pickDirectory: vi.fn(async () => null) },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={{ ...sequence, extension: "exr", files: ["D:\\refs\\shot.0001.exr", "D:\\refs\\shot.0002.exr"] }} onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const load = async (token: string) => act(async () => {
      [...BufferedImageMock.instances].reverse().find((image) => image.src.includes(token) && image.onload)?.onload?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await load("exr-a");
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-path")).toContain("0001");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="下一帧"]')?.click());
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-path")).toContain("0001");
    await load("exr-b");
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-path")).toContain("0002");
  });

  it("steps frames with arrow keys and pauses playback", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: true,
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings })), pickDirectory: vi.fn(async () => null) },
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
    // autoplay 打开时默认播放；按 → 应暂停并前进一帧（方向键按焦点
    // 归属路由，事件须落在预览根内）。
    const shell = host.querySelector<HTMLElement>(".sequence-preview-shell")!;
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector(".sequence-frame-count")?.textContent).toContain("0002");
    expect(host.querySelector('button[aria-label="播放"]')).toBeTruthy();
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector(".sequence-frame-count")?.textContent).toContain("0001");
  });

  it("ignores arrow keys while the sequence preview is not focused", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: false,
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings })), pickDirectory: vi.fn(async () => null) },
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
    const frameCount = () => host.querySelector(".sequence-frame-count")?.textContent ?? "";
    // 焦点在预览外（事件目标为 window）：不步进。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      await Promise.resolve();
    });
    expect(frameCount()).toContain("0001");
    // 事件目标进入预览根后恢复响应。
    const shell = host.querySelector<HTMLElement>(".sequence-preview-shell")!;
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    expect(frameCount()).toContain("0002");
  });

  it("accelerates held arrow keys and resets to single-frame steps on release", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: false,
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings })), pickDirectory: vi.fn(async () => null) },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const rangedSequence = {
      ...sequence,
      files: [
        "D:\\refs\\shot.0001.png",
        "D:\\refs\\shot.0002.png",
        "D:\\refs\\shot.0003.png",
        "D:\\refs\\shot.0004.png",
        "D:\\refs\\shot.0005.png",
      ],
      frames: [1, 2, 3, 4, 5],
      end: 5,
    };
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={rangedSequence} onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const frameCount = () => host.querySelector(".sequence-frame-count")?.textContent ?? "";
    const shell = host.querySelector<HTMLElement>(".sequence-preview-shell")!;
    // 短按 → +1 帧（0001 → 0002）。
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    expect(frameCount()).toContain("0002");
    // 长按 1.2s 后单次重复按键已升到 8 帧/键：0002 + 8 = 0005（5 帧序列）。
    await act(async () => {
      vi.advanceTimersByTime(1200);
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(frameCount()).toContain("0005");
    // 松键：重复按键回到单帧步进（0005 + 1 → 0001，取模）。
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(frameCount()).toContain("0001");
  });

  it("toggles playback with Space while the preview is focused", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: false,
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings })), pickDirectory: vi.fn(async () => null) },
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
    const playLabel = () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="播放"], button[aria-label="暂停"]')
        ?.getAttribute("aria-label");
    expect(playLabel()).toBe("播放");
    const shell = host.querySelector<HTMLElement>(".sequence-preview-shell")!;
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      await Promise.resolve();
    });
    expect(playLabel()).toBe("暂停");
    await act(async () => {
      shell.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      await Promise.resolve();
    });
    expect(playLabel()).toBe("播放");
  });

  it("exports only the frame range selected on the shared timeline to GIF", async () => {
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
            previewSettings: {
              ...PREVIEW_SETTINGS_DEFAULTS,
              autoplaySequence: false,
              mp4Presets: [PREVIEW_SETTINGS_DEFAULTS.mp4Presets[0]],
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
    const rangedSequence = {
      ...sequence,
      files: [
        "D:\\refs\\shot.0001.png",
        "D:\\refs\\shot.0002.png",
        "D:\\refs\\shot.0003.png",
        "D:\\refs\\shot.0004.png",
        "D:\\refs\\shot.0005.png",
      ],
      frames: [1, 2, 3, 4, 5],
      end: 5,
    };
    await act(async () => {
      root?.render(
        <SequencePreviewDialog
          sequence={rangedSequence}
          gifRange={{ start: 0.25, end: 0.75 }}
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="在进度条上选择 GIF 帧范围"]')?.click();
    });
    expect(document.body.querySelector('[aria-label="GIF 导出设置"]')).toBeTruthy();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="导出所选 GIF 帧"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exportGif).toHaveBeenCalledWith(expect.objectContaining({
      files: rangedSequence.files.slice(1, 4),
      fps: PREVIEW_SETTINGS_DEFAULTS.defaultSequenceFps,
      outputDirectory: "D:\\out",
      baseName: "shot",
    }));
  });

  it("puts MP4 presets and the export action in one anchored popover when embedded", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })), pickDirectory: vi.fn(async () => null) },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    const controlsTarget = document.createElement("div");
    host.append(controlsTarget);
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={sequence} embedded controlsTarget={controlsTarget} onClose={vi.fn()} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(controlsTarget.querySelector('button[aria-label="导出 MP4"]')).toBeTruthy();
    expect(controlsTarget.querySelector('button[aria-label="在进度条上选择 GIF 帧范围"]')).toBeTruthy();
    expect(host.querySelector(".sequence-export-row")).toBeNull();
    expect(controlsTarget.querySelector('button[aria-label="导出预设"]')).toBeNull();
    await act(async () => controlsTarget.querySelector<HTMLButtonElement>('button[aria-label="导出 MP4"]')?.click());
    const presetMenu = document.body.querySelector('.sequence-export-popover[aria-label="MP4 导出设置"]');
    expect(presetMenu).toBeTruthy();
    expect(presetMenu?.getAttribute("data-placement")).toBe("top-start");
    expect(presetMenu?.querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(presetMenu?.querySelector('button[aria-label="确认导出 MP4"]')).toBeTruthy();
    expect(controlsTarget.querySelector(".sequence-inline-menu")).toBeNull();
  });

  it("composes HDR controls and palette extraction into an embedded EXR sequence", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const palette = vi.fn(async () => [{ rgb: [1, 2, 3], hex: "#010203", count: 1 }]);
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "exr-token") },
        media: { palette },
        system: { getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })) },
        sequences: { exportMp4: vi.fn(), exportGif: vi.fn() },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    const controlsTarget = document.createElement("div");
    host.append(controlsTarget);
    document.body.append(host);
    root = createRoot(host);
    const onPaletteChange = vi.fn();
    const onEyedropActiveChange = vi.fn();
    const onColorSample = vi.fn();
    await act(async () => {
      root?.render(<SequencePreviewDialog sequence={{ ...sequence, extension: "exr", files: ["D:\\refs\\shot.0001.exr"] }} embedded controlsTarget={controlsTarget} multichannelOpen eyedropActive onEyedropActiveChange={onEyedropActiveChange} onColorSample={onColorSample} onClose={vi.fn()} onPaletteChange={onPaletteChange} />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    await act(async () => {
      BufferedImageMock.instances.at(-1)?.onload?.();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-path")).toBe("D:\\refs\\shot.0001.exr");
    expect(host.querySelector('[data-testid="sequence-hdr-frame"]')?.getAttribute("data-eyedrop-active")).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="采样 EXR 颜色"]')?.click());
    expect(onColorSample).toHaveBeenCalledWith("#010203");
    expect(controlsTarget.querySelector('[aria-label="OCIO 色彩管理"]')).toBeTruthy();
    expect(controlsTarget.querySelector('[aria-label="提取多通道"]')).toBeTruthy();
    expect(palette).toHaveBeenCalledWith("D:\\refs\\shot.0001.exr", expect.objectContaining({ limit: 6 }));
    expect(onPaletteChange).toHaveBeenCalled();
  });

  it("selects FPS from its drawer and MP4 presets from the export popover", async () => {
    vi.stubGlobal("Image", BufferedImageMock);
    const previewSettings = {
      ...PREVIEW_SETTINGS_DEFAULTS,
      autoplaySequence: false,
      defaultSequenceFps: 25,
      sequenceFpsPresets: [24, 25, 30],
      mp4Presets: [
        { ...PREVIEW_SETTINGS_DEFAULTS.mp4Presets[0], enabled: true },
        { ...PREVIEW_SETTINGS_DEFAULTS.mp4Presets[1], enabled: true, label: "轻量转换" },
      ],
    };
    const exportMp4 = vi.fn(async () => ({
      outputPath: "D:\\out\\shot.mp4",
      durationSeconds: 0.2,
      frameCount: 2,
      width: 1920,
      height: 1080,
    }));
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn(async () => "token") },
        system: {
          getPreferences: vi.fn(async () => ({ previewSettings })),
          pickDirectory: vi.fn(async () => "D:\\out"),
        },
        sequences: { exportMp4, exportGif: vi.fn() },
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
    const fpsMenu = document.body.querySelector('[aria-label="FPS 预设菜单"]');
    expect(fpsMenu).toBeTruthy();
    expect(fpsMenu?.getAttribute("data-placement")).toBe("top-start");
    await act(async () => {
      [...fpsMenu!.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("30 fps"))?.click();
    });
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="帧率"]')?.textContent).toContain("30 FPS");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="导出 MP4"]')?.click();
    });
    const mp4Popover = document.body.querySelector('[aria-label="MP4 导出设置"]');
    expect(mp4Popover).toBeTruthy();
    await act(async () => {
      [...mp4Popover!.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((button) => button.textContent?.includes("轻量转换"))?.click();
    });
    expect(mp4Popover?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.textContent).toContain("轻量转换");
    expect(mp4Popover?.querySelector<HTMLButtonElement>('[aria-label="确认导出 MP4"]')?.textContent).toContain("轻量转换");
    await act(async () => {
      mp4Popover?.querySelector<HTMLButtonElement>('[aria-label="确认导出 MP4"]')?.click();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(exportMp4).toHaveBeenCalledWith(expect.objectContaining({
      files: sequence.files,
      fps: 30,
      presetId: previewSettings.mp4Presets[1].id,
      outputDirectory: "D:\\out",
    }));
  });
});
