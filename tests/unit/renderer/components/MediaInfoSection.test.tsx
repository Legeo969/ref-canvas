// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { MediaInfoSection } from "../../../../src/renderer/components/MediaInfoSection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("MediaInfoSection", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("renders EXR channel objects and window metadata", async () => {
    Object.assign(window, {
      refCanvas: {
        media: {
          probe: vi.fn(async () => ({
            width: 2048,
            height: 1024,
            duration: null,
            extra: {
              channels: [{ name: "R" }, { name: "G" }, { name: "B" }],
              bitDepth: 16,
              compression: "zip",
              colorSpace: "ACEScg",
              dataWindow: { xMin: 0, yMin: 0, xMax: 2047, yMax: 1023 },
              displayWindow: { xMin: -8, yMin: -8, xMax: 2055, yMax: 1031 },
              chromaticities: {
                redX: 0.7,
                redY: 0.3,
                greenX: 0.2,
                greenY: 0.8,
                blueX: 0.1,
                blueY: 0,
                whiteX: 0.3,
                whiteY: 0.3,
              },
              pixelAspectRatio: 1,
            },
          })),
        },
      } as unknown as RefCanvasApi,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MediaInfoSection
          asset={{
            id: "exr-1",
            path: "D:\\refs\\plate.exr",
            kind: "image",
            extension: "exr",
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain("R, G, B");
    expect(host.textContent).not.toContain("[object Object]");
    expect(host.textContent).toContain("0, 0 → 2047, 1023");
    expect(host.textContent).toContain("R 0.70,0.30");
  });
});
