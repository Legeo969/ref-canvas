// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaNotesOverlay } from "../../../../src/renderer/components/MediaNotesOverlay";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("MediaNotesOverlay (FND-005 备注)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function installRefCanvas(overrides: Record<string, unknown> = {}) {
    const mediaNotes = {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: "note-1",
        assetId: "asset-1",
        timeMs: 1500,
        text: "关键帧备注",
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      })),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      getPlaybackState: vi.fn(async () => null),
      setPlaybackState: vi.fn(async () => ({})),
      ...overrides,
    };
    Object.assign(window, { refCanvas: { mediaNotes } });
    return mediaNotes;
  }

  it("loads existing notes and adds a new time-point note", async () => {
    const mediaNotes = installRefCanvas();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MediaNotesOverlay asset={{ id: "asset-1" }}>
          <video data-testid="media" />
        </MediaNotesOverlay>,
      );
    });
    expect(mediaNotes.list).toHaveBeenCalledWith("asset-1");

    // 打开备注面板并输入。
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".media-note-toggle")?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".media-note-add-button")?.click();
    });
    const input = host.querySelector<HTMLInputElement>(".media-notes-add input");
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "关键帧备注");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".media-notes-add button")?.click();
    });
    expect(mediaNotes.create).toHaveBeenCalledWith("asset-1", {
      timeMs: 0,
      text: "关键帧备注",
    });
  });

  it("deletes a note", async () => {
    const mediaNotes = installRefCanvas({
      list: vi.fn(async () => [
        {
          id: "note-1",
          assetId: "asset-1",
          timeMs: 800,
          text: "标记",
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:00:00.000Z",
        },
      ]),
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MediaNotesOverlay asset={{ id: "asset-1" }}>
          <video data-testid="media" />
        </MediaNotesOverlay>,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".media-note-toggle")?.click();
    });
    expect(host.textContent).toContain("标记");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".media-note-delete")?.click();
    });
    expect(mediaNotes.delete).toHaveBeenCalledWith("note-1");
    expect(host.textContent).not.toContain("标记");
  });

  it("persists playback state on media events", async () => {
    const mediaNotes = installRefCanvas();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MediaNotesOverlay asset={{ id: "asset-1" }}>
          <video data-testid="media" />
        </MediaNotesOverlay>,
      );
    });
    const media = host.querySelector<HTMLVideoElement>('[data-testid="media"]')!;
    Object.defineProperty(media, "currentTime", { value: 2.5, writable: true });
    Object.defineProperty(media, "muted", { value: false, writable: true });
    Object.defineProperty(media, "volume", { value: 0.8, writable: true });
    await act(async () => {
      media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
    });
    expect(mediaNotes.setPlaybackState).toHaveBeenCalledWith(
      "asset-1",
      expect.objectContaining({ positionMs: 2500 }),
    );
  });
});
