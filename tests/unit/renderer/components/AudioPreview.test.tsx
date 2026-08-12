// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, RefCanvasApi } from "../../../../src/shared/contracts";
import { AudioPreview } from "../../../../src/renderer/components/AudioPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AudioPreview Found metadata", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("shows Name, Format, Length and Author", async () => {
    Object.assign(window, { refCanvas: {
      media: { waveform: vi.fn(async () => ({ peaks: [0.2, 0.8], durationSeconds: 65 })) },
      mediaNotes: {
        list: vi.fn(async () => []),
        getPlaybackState: vi.fn(async () => null),
        setPlaybackState: vi.fn(async () => undefined),
        create: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as RefCanvasApi });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const asset = {
      id: "audio-1", title: "Interview", path: "D:\\refs\\interview.wav",
      extension: "wav", previewUrl: "refasset://audio", duration: 65,
      customFields: { author: "RefCanvas" },
    } as Pick<AssetRecord, "id" | "title" | "path" | "extension" | "previewUrl" | "duration" | "customFields">;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<AudioPreview asset={asset} />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(host.querySelector(".audio-meta")?.textContent).toContain("NameInterview");
    expect(host.querySelector(".audio-meta")?.textContent).toContain("FormatWAV");
    expect(host.querySelector(".audio-meta")?.textContent).toContain("Length1:05");
    expect(host.querySelector(".audio-meta")?.textContent).toContain("AuthorRefCanvas");
  });
});
