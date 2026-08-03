// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, RefCanvasApi } from "../../../../src/shared/contracts";
import { useAppStore } from "../../../../src/renderer/app/store";
import { AssetPanel } from "../../../../src/renderer/components/AssetPanel";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function asset(index: number): AssetRecord {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    id,
    title: `Asset ${index}`,
    kind: "image",
    path: `D:\\assets\\${index}.png`,
    extension: "png",
    size: 1_024,
    mtimeMs: index,
    fingerprint: `fingerprint-${index}`,
    contentHash: null,
    lifecycle: "active",
    deletedAt: null,
    trashPath: null,
    favorite: false,
    rating: 0,
    colorLabel: "none",
    linkState: "online",
    notes: "",
    width: 320,
    height: 180,
    duration: null,
    metadataStatus: "ready",
    metadataError: null,
    metadataUpdatedAt: null,
    bpm: null,
    customFields: {},
    customThumbnailPath: null,
    tags: [],
    collectionIds: [],
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    previewUrl: `refasset://asset/${id}`,
    thumbnailUrl: `refasset://thumbnail/${id}`,
    storageMode: "linked",
    libraryRelativePath: null,
    originalSourcePath: null,
  };
}

describe("AssetPanel responsive grid", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    useAppStore.setState({ assets: [], assetWindowOffset: 0, totalAssets: 0 });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("starts observing when imported assets create the viewport", async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = observe;
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    Object.assign(window, {
      refCanvas: {
        library: {
          getSimilarityIndex: async () => ({
            state: "idle",
            total: 0,
            processed: 0,
            indexed: 0,
            failed: 0,
          }),
          onSimilarityProgress: () => () => undefined,
        },
      } as unknown as RefCanvasApi,
    });
    useAppStore.setState({
      assets: [],
      assetWindowOffset: 0,
      totalAssets: 0,
      ensureAssetRange: vi.fn(async () => undefined),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <DialogProvider>
          <AssetPanel />
        </DialogProvider>,
      );
    });
    expect(observe).not.toHaveBeenCalled();

    await act(async () => {
      useAppStore.setState({
        assets: [asset(1), asset(2), asset(3), asset(4)],
        totalAssets: 4,
      });
    });
    expect(observe).toHaveBeenCalledOnce();

    await act(async () => {
      resizeCallback?.(
        [
          {
            contentRect: { width: 520, height: 600 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    const cards = host.querySelectorAll<HTMLElement>(".asset-card");
    expect(cards[2]?.style.left).toBe("320px");
    expect(cards[2]?.style.top).toBe("0px");
  });
});
