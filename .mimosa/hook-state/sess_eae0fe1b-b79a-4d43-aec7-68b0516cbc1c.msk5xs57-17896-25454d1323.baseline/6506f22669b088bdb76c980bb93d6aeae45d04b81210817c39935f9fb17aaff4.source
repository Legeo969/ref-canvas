// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { VideoPreview } from "../../../../src/renderer/components/VideoPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("VideoPreview frame stepping", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
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

  it("exports the video to GIF", async () => {
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
        system: { pickDirectory: vi.fn(async () => "D:\\refs") },
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
      host.querySelector<HTMLButtonElement>('button[title="导出为 GIF"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exportGif).toHaveBeenCalledWith({
      inputPath: "D:\\refs\\clip.mp4",
      outputDirectory: "D:\\refs",
      baseName: "clip",
      fps: 12,
      maxWidth: 960,
    });
  });
});
