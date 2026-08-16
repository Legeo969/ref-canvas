// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { VideoPreview } from "../../../../src/renderer/components/VideoPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

describe("VideoPreview frame stepping", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("uses probed frame rate and continues from the last extracted frame", async () => {
    const frame = vi.fn(async (_path: string, options: { timeMs: number }) => ({
      source: `refbrowse://preview/${options.timeMs}`,
      path: "frame.png",
      timeMs: options.timeMs,
      jobId: "frame-job",
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({
            width: 1920,
            height: 1080,
            duration: 10,
            extra: { frameRate: 24 },
          })),
          frame,
        },
      } as unknown as RefCanvasApi,
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      () => undefined,
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{
            id: "video-1",
            path: "D:\\refs\\clip.mp4",
            previewUrl: "refbrowse://preview/video",
          }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 10,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const next = host.querySelector<HTMLButtonElement>(
      'button[aria-label="下一帧"]',
    )!;

    await act(async () => {
      next.click();
      await Promise.resolve();
    });
    await act(async () => {
      next.click();
      await Promise.resolve();
    });

    expect(frame).toHaveBeenNthCalledWith(
      1,
      "D:\\refs\\clip.mp4",
      expect.objectContaining({ timeMs: 1000 / 24 }),
    );
    expect(frame).toHaveBeenNthCalledWith(
      2,
      "D:\\refs\\clip.mp4",
      expect.objectContaining({ timeMs: 2000 / 24 }),
    );
  });

  it("ignores an extracted frame after switching to another video", async () => {
    let resolveFrame!: (value: { source: string; path: string; timeMs: number; jobId: string }) => void;
    const frame = vi.fn(() => new Promise((resolve) => { resolveFrame = resolve; }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame,
        },
      } as unknown as RefCanvasApi,
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const first = { id: "video-1", path: "D:\\refs\\first.mp4", previewUrl: "refbrowse://preview/first" };
    const second = { id: "video-2", path: "D:\\refs\\second.mp4", previewUrl: "refbrowse://preview/second" };
    await act(async () => {
      root.render(<VideoPreview asset={first} persistNotes={false} />);
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="下一帧"]')?.click());
    expect(frame).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(<VideoPreview asset={second} persistNotes={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveFrame({ source: "refbrowse://preview/stale-frame", path: "stale.png", timeMs: 42, jobId: "old" });
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLImageElement>(".video-frame-step")).toBeNull();
  });

  it("opens the configurable GIF studio and exports the selected range", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const exportGif = vi.fn(async () => ({
      outputPath: "D:\\refs\\clip.gif",
      durationSeconds: 1,
      frameCount: null,
      width: 960,
      height: 540,
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({
            width: 1920,
            height: 1080,
            duration: 1,
            extra: { frameRate: 24 },
          })),
          frame: vi.fn(),
          exportGif,
        },
        system: {
          pickDirectory: vi.fn(async () => "D:\\refs"),
          writeClipboard: vi.fn(async () => undefined),
        },
        library: { pathsForFiles: vi.fn(() => []) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{
            id: "video-1",
            path: "D:\\refs\\clip.mp4",
            previewUrl: "refbrowse://preview/video",
          }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="打开 GIF 导出工作台"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[aria-label="GIF 导出工作台"]')).toBeTruthy();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".gif-export-actions .primary-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exportGif).toHaveBeenCalledWith(expect.objectContaining({
      clips: [{ inputPath: "D:\\refs\\clip.mp4", startMs: 0, endMs: 1000 }],
      outputDirectory: "D:\\refs",
      baseName: "clip",
      fps: 12,
      maxWidth: 640,
      colors: 128,
    }));
  });

  it("updates the workbench palette while the video time changes", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const palette = vi.fn(async () => ([
      { rgb: [30, 40, 50] as [number, number, number], hex: "#1e2832", count: 10 },
    ]));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          palette,
        },
        system: { writeClipboard: vi.fn(async () => undefined) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
          onOpenTool={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    expect(palette).toHaveBeenCalledWith("D:\\refs\\clip.mp4", { timeMs: 0, limit: 6 });

    const video = host.querySelector("video")!;
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 2 });
    await act(async () => {
      video.dispatchEvent(new window.Event("timeupdate", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(palette).toHaveBeenLastCalledWith("D:\\refs\\clip.mp4", { timeMs: 2000, limit: 6 });
  });

  it("samples a video pixel from a click bound directly to the media element", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([17, 34, 51, 255]) })),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D);
    Object.assign(window, {
      refCanvas: {
        media: { probe: vi.fn(async () => ({ duration: 1, extra: { frameRate: 24 } })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onColorSample = vi.fn();
    const onEyedropActiveChange = vi.fn();
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
          eyedropActive
          onColorSample={onColorSample}
          onEyedropActiveChange={onEyedropActiveChange}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 },
      getBoundingClientRect: { configurable: true, value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }) },
    });
    await act(async () => {
      video.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 320, clientY: 180 }));
    });
    expect(drawImage).toHaveBeenCalled();
    expect(onColorSample).toHaveBeenCalledWith("#112233");
    expect(onEyedropActiveChange).toHaveBeenCalledWith(false);
  });

  it("clears the sampling reticle shortly after a successful sample", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([17, 34, 51, 255]) })),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D);
    Object.assign(window, {
      refCanvas: {
        media: { probe: vi.fn(async () => ({ duration: 1, extra: { frameRate: 24 } })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
          eyedropActive
          onColorSample={vi.fn()}
          onEyedropActiveChange={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 },
      getBoundingClientRect: { configurable: true, value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }) },
    });
    await act(async () => {
      video.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 320, clientY: 180 }));
    });
    expect(host.querySelector(".video-preview .preview-sample-reticle")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    // 闪现未结束：准星还在。
    expect(host.querySelector(".video-preview .preview-sample-reticle")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(host.querySelector(".video-preview .preview-sample-reticle")).toBeNull();
  });

  it("deactivates eyedrop when sampling has no decoded frame to read", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    Object.assign(window, {
      refCanvas: {
        media: { probe: vi.fn(async () => ({ duration: 1, extra: { frameRate: 24 } })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onEyedropActiveChange = vi.fn();
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
          eyedropActive
          onEyedropActiveChange={onEyedropActiveChange}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    // 视频未就绪（videoWidth/Height 为 0）→ 取色必须显式退出，而不是卡住。
    Object.defineProperty(video, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }),
    });
    await act(async () => {
      video.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 320, clientY: 180 }));
    });
    expect(onEyedropActiveChange).toHaveBeenCalledWith(false);
  });

  it("holds ArrowRight to scrub forward with accelerating steps, then finalizes the precise frame", async () => {
    vi.useFakeTimers();
    const frame = vi.fn(async () => ({
      source: "refbrowse://preview/token",
      path: "frame.png",
      timeMs: 0,
      jobId: "frame-job",
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame,
        },
      } as unknown as RefCanvasApi,
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    let current = 0;
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; },
    });
    // 方向键按焦点归属路由：事件须落在预览根内（点击画面后的真实形态）。
    const previewRoot = host.querySelector<HTMLElement>(".video-preview")!;
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    // 按下即走 1 帧（第 0 拍），与旧短按单帧行为一致。
    expect(current).toBeCloseTo(1 / 24, 5);
    // 按住 500ms（10 拍）后已升档，前进明显超过 10 帧。
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(current).toBeGreaterThan(10 / 24);
    const frozen = current;
    // 松键：扫览停止，并做一次最终精确抓帧。
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(frame).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(current).toBe(frozen);
  });

  it("holds ArrowLeft to scrub backward, clamped at the start", async () => {
    vi.useFakeTimers();
    const frame = vi.fn(async () => ({
      source: "refbrowse://preview/token",
      path: "frame.png",
      timeMs: 0,
      jobId: "frame-job",
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame,
        },
      } as unknown as RefCanvasApi,
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    let current = 0;
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; },
    });
    // 从开头反向扫览：立即停在 0，不进入负时间。
    const previewRoot = host.querySelector<HTMLElement>(".video-preview")!;
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      await Promise.resolve();
    });
    expect(current).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(current).toBe(0);
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(frame).not.toHaveBeenCalled();
  });

  it("ignores arrow keys while the preview is not focused (focus-ownership routing)", async () => {
    vi.useFakeTimers();
    const frame = vi.fn(async () => ({
      source: "refbrowse://preview/token",
      path: "frame.png",
      timeMs: 0,
      jobId: "frame-job",
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame,
        },
      } as unknown as RefCanvasApi,
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    let current = 0;
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; },
    });
    // 焦点在预览外（事件目标为 window，等同目录网格聚焦时）：不步进、不扫览。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      await Promise.resolve();
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(current).toBe(0);
    expect(frame).not.toHaveBeenCalled();
    // 事件目标进入预览根后恢复响应（点击画面后的真实形态）。
    const previewRoot = host.querySelector<HTMLElement>(".video-preview")!;
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    expect(current).toBeCloseTo(1 / 24, 5);
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("toggles playback on click and Space while the preview is focused", async () => {
    let paused = true;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
      paused = false;
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      paused = true;
    });
    Object.assign(window, {
      refCanvas: {
        media: { probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })) },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    // 复位：autoplay 偏好为真时挂载即触发过 play()，清掉计数与状态。
    paused = true;
    play.mockClear();
    pause.mockClear();
    // 点击画面 → 播放。
    await act(async () => {
      video.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(1);
    // 再点击 → 暂停。
    await act(async () => {
      video.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(pause).toHaveBeenCalledTimes(1);
    // 空格（焦点在预览根内）→ 播放。
    const previewRoot = host.querySelector<HTMLElement>(".video-preview")!;
    await act(async () => {
      previewRoot.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(2);
    // 空格（焦点在预览外）→ 不响应。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("never shows the browser's broken-image placeholder for a failed frame grab", async () => {
    vi.useFakeTimers();
    // media:frame 的 token 按路径复用（tokenFor），同一目标重抓返回同一
    // URL；mock 与之保持一致。
    const frame = vi.fn(async () => ({
      source: "refbrowse://preview/token",
      path: "frame.png",
      timeMs: 0,
      jobId: "frame-job",
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame,
        },
      } as unknown as RefCanvasApi,
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    let current = 0;
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; },
    });
    // 步进一次 → 抓帧返回 → 帧图渲染。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="下一帧"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(frame.mock.calls.length).toBeGreaterThanOrEqual(1);
    // 同一 URL 至多重试一次（步进 + 重试 = 2 次调用封顶），失败不会无限循环。
    expect(frame.mock.calls.length).toBeLessThanOrEqual(2);
    // 无论环境是否已自动触发过 error：手动补发，最终必须收敛到正式错误
    // 提示，破图占位（img + alt 文本）不得留存，抓帧调用不再增长。
    await act(async () => {
      host.querySelector<HTMLImageElement>(".video-frame-step")?.dispatchEvent(new Event("error"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLImageElement>(".video-frame-step")?.dispatchEvent(new Event("error"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLImageElement>(".video-frame-step")).toBeNull();
    expect(host.querySelector(".video-frame-error")).toBeTruthy();
    expect(frame.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("至臻画质：轮询生成状态，就绪后切到增强代理并恢复播放位置", async () => {
    vi.useFakeTimers();
    let paused = true;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
      paused = false;
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      paused = true;
    });
    const supremeVideoStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: "generating", progress: 0.4, needsEnhancement: true, source: null, error: null })
      .mockResolvedValueOnce({ state: "ready", progress: 1, needsEnhancement: true, source: "refbrowse://preview/supreme", error: null });
    const supremeVideoCancel = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          supremeVideoStatus,
          supremeVideoCancel,
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector("video")!;
    let current = 3.5;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(video, "duration", { configurable: true, value: 10 });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; },
    });
    paused = false;
    play.mockClear();
    pause.mockClear();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(supremeVideoStatus).toHaveBeenCalledWith("D:\\refs\\clip.mp4");
    // 生成中：原源继续播放，浮层显示进度。
    expect(video.getAttribute("src")).toBe("refbrowse://preview/video");
    expect(host.querySelector(".video-supreme-chip")?.textContent).toContain("40%");

    // 下一拍轮询 → ready → 切到代理源。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
      await Promise.resolve();
    });
    expect(video.getAttribute("src")).toBe("refbrowse://preview/supreme");
    // 切源后 loadedmetadata：恢复 3.5s 并继续播放。
    await act(async () => {
      video.dispatchEvent(new window.Event("loadedmetadata", { bubbles: true }));
      await Promise.resolve();
    });
    expect(current).toBe(3.5);
    expect(play).toHaveBeenCalled();
    // 轮询已停止：再走 2 拍不再查询。
    const settled = supremeVideoStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });
    expect(supremeVideoStatus.mock.calls.length).toBe(settled);
  });

  it("至臻画质：关闭时取消生成并切回原源", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const supremeVideoStatus = vi.fn(async () => ({
      state: "generating",
      progress: null,
      needsEnhancement: true,
      source: null,
      error: null,
    }));
    const supremeVideoCancel = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          supremeVideoStatus,
          supremeVideoCancel,
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".video-supreme-chip")).toBeTruthy();
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(supremeVideoCancel).toHaveBeenCalledWith("D:\\refs\\clip.mp4");
    expect(host.querySelector(".video-supreme-chip")).toBeNull();
    expect(host.querySelector<HTMLVideoElement>("video")?.getAttribute("src")).toBe("refbrowse://preview/video");
    expect(button.classList.contains("active")).toBe(false);
  });

  it("至臻画质：生成失败显示错误浮层并停止轮询", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const supremeVideoStatus = vi.fn(async () => ({
      state: "failed",
      progress: null,
      needsEnhancement: true,
      source: null,
      error: "SUPREME_GENERATION_FAILED",
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          supremeVideoStatus,
          supremeVideoCancel: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".video-supreme-chip.is-error")).toBeTruthy();
    expect(host.querySelector<HTMLVideoElement>("video")?.getAttribute("src")).toBe("refbrowse://preview/video");
    const settled = supremeVideoStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
      await Promise.resolve();
    });
    expect(supremeVideoStatus.mock.calls.length).toBe(settled);
  });

  it("至臻画质：源视频已是超高画质时保持原源", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const supremeVideoStatus = vi.fn(async () => ({
      state: "ready",
      progress: null,
      needsEnhancement: false,
      source: null,
      error: null,
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          supremeVideoStatus,
          supremeVideoCancel: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLVideoElement>("video")?.getAttribute("src")).toBe("refbrowse://preview/video");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')?.classList.contains("active")).toBe(true);
  });

  it("至臻画质：代理源加载失败自动回退原源", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const supremeVideoStatus = vi.fn(async () => ({
      state: "ready",
      progress: 1,
      needsEnhancement: true,
      source: "refbrowse://preview/supreme",
      error: null,
    }));
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({ duration: 10, extra: { frameRate: 24 } })),
          frame: vi.fn(),
          supremeVideoStatus,
          supremeVideoCancel: vi.fn(async () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <VideoPreview
          asset={{ id: "video-1", path: "D:\\refs\\clip.mp4", previewUrl: "refbrowse://preview/video" }}
          persistNotes={false}
        />,
      );
      await Promise.resolve();
    });
    const video = host.querySelector<HTMLVideoElement>("video")!;
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(700);
      await Promise.resolve();
    });
    expect(video.getAttribute("src")).toBe("refbrowse://preview/supreme");
    await act(async () => {
      video.dispatchEvent(new window.Event("error", { bubbles: true }));
      await Promise.resolve();
    });
    expect(video.getAttribute("src")).toBe("refbrowse://preview/video");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="至臻画质"]')?.classList.contains("active")).toBe(false);
  });
});
