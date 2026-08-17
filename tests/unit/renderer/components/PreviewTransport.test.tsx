// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PreviewTransportProvider,
  usePreviewTransport,
  usePreviewTransportRegistration,
  type PreviewTransportActions,
  type PreviewTransportSnapshot,
} from "../../../../src/renderer/components/PreviewTransport";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const snapshot: PreviewTransportSnapshot = {
  kind: "video",
  playing: false,
  position: 0.25,
  durationSeconds: 8,
  frameIndex: 2,
  frameCount: 8,
  fps: 24,
  playbackRate: 1,
  looping: true,
  muted: false,
  volume: 0.75,
};

describe("PreviewTransportProvider", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  it("publishes renderer state and routes toolbar commands", async () => {
    const seek = vi.fn();
    const actions: PreviewTransportActions = {
      togglePlaying: vi.fn(),
      seek,
      stepFrames: vi.fn(),
      setLooping: vi.fn(),
      setPlaybackRate: vi.fn(),
      setMuted: vi.fn(),
      setVolume: vi.fn(),
      startScrub: vi.fn(),
      stopScrub: vi.fn(),
    };

    function Renderer() {
      usePreviewTransportRegistration(snapshot, actions);
      return null;
    }

    function Toolbar() {
      const transport = usePreviewTransport();
      return (
        <button onClick={() => transport.actions?.seek(0.5)}>
          {transport.snapshot?.kind}:{transport.snapshot?.position}
        </button>
      );
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewTransportProvider><Renderer /><Toolbar /></PreviewTransportProvider>);
    });

    expect(host.textContent).toBe("video:0.25");
    await act(async () => host.querySelector("button")?.click());
    expect(seek).toHaveBeenCalledWith(0.5);
  });

  it("clears a renderer registration when it unmounts", async () => {
    function Renderer() {
      usePreviewTransportRegistration(snapshot, {
        togglePlaying: vi.fn(), seek: vi.fn(), stepFrames: vi.fn(),
        setLooping: vi.fn(), setPlaybackRate: vi.fn(), setMuted: vi.fn(), setVolume: vi.fn(), startScrub: vi.fn(), stopScrub: vi.fn(),
      });
      return null;
    }
    function Readout() {
      return <span>{usePreviewTransport().snapshot?.kind ?? "empty"}</span>;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<PreviewTransportProvider><Renderer /><Readout /></PreviewTransportProvider>));
    expect(host.textContent).toBe("video");
    await act(async () => root.render(<PreviewTransportProvider><Readout /></PreviewTransportProvider>));
    expect(host.textContent).toBe("empty");
  });
});
