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
});
