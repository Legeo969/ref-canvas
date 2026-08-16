// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetRecord } from "../../../../src/shared/contracts";
import { AssetPreview } from "../../../../src/renderer/components/AssetPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function asset(kind: AssetRecord["kind"], extension: string): AssetRecord {
  return {
    id: `${kind}-1`,
    title: "Large imported asset",
    kind,
    path: `D:\\assets\\large.${extension}`,
    extension,
    size: 2_000_000_000,
    mtimeMs: 1,
    fingerprint: "fingerprint",
    contentHash: null,
    lifecycle: "active",
    deletedAt: null,
    trashPath: null,
    favorite: false,
    rating: 0,
    colorLabel: "none",
    linkState: "online",
    notes: "",
    width: null,
    height: null,
    duration: null,
    metadataStatus: "ready",
    metadataError: null,
    metadataUpdatedAt: null,
    bpm: null,
    customFields: {},
    customThumbnailPath: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    previewUrl: `refasset://asset/${kind}-1`,
    thumbnailUrl: `refasset://thumbnail/${kind}-1`,
  };
}

describe("AssetPreview lightweight mode", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  it.each([
    ["model3d", "glb"],
    ["video", "mp4"],
    ["pdf", "pdf"],
  ] as const)("uses only the proxy thumbnail for %s details", async (kind, extension) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AssetPreview asset={asset(kind, extension)} lightweight />);
    });

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      `refasset://thumbnail/${kind}-1?priority=preview`,
    );
    expect(host.querySelector("canvas, video, audio, iframe")).toBeNull();
  });

  it.each(["exr", "hdr", "tga", "tiff"])(
    "uses the converted proxy for %s instead of browser decoding the source",
    async (extension) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => {
        root.render(<AssetPreview asset={asset("image", extension)} />);
      });

      expect(host.querySelector("img")?.getAttribute("src")).toBe(
        "refasset://thumbnail/image-1?priority=preview",
      );
    },
  );

  it("renders PSD/PSB as an image review from the flattened provider preview", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AssetPreview asset={asset("dcc", "psd")} />);
    });

    expect(host.querySelector(".image-review")).toBeTruthy();
    expect(host.querySelector(".image-review-img")?.getAttribute("src")).toBe(
      "refasset://thumbnail/dcc-1?size=1920&priority=preview",
    );
    expect(host.querySelector(".preview-unavailable")).toBeNull();
  });
});
