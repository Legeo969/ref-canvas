// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "../../shared/contracts";
import { QuickPreview } from "./QuickPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function createAsset(index: number): AssetRecord {
  return {
    id: `asset-${index}`,
    title: `Asset ${index}`,
    kind: "image",
    path: `D:\\assets\\${index}.png`,
    extension: "png",
    size: 1024,
    mtimeMs: 1,
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
    width: 100,
    height: 100,
    duration: null,
    bpm: null,
    customFields: {},
    customThumbnailPath: null,
    tags: [],
    collectionIds: [],
    storageMode: "linked",
    libraryRelativePath: null,
    originalSourcePath: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    previewUrl: `refasset://asset/asset-${index}`,
    thumbnailUrl: `refasset://thumbnail/asset-${index}`,
  };
}

describe("QuickPreview", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  it("continues to the next asset across a cursor page boundary", async () => {
    const allAssets = Array.from({ length: 240 }, (_, index) =>
      createAsset(index),
    );
    const onLoadMore = vi.fn(async () => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    function Harness() {
      const [assets, setAssets] = useState(allAssets.slice(0, 120));
      const [activeId, setActiveId] = useState("asset-119");
      return (
        <QuickPreview
          assets={assets}
          total={allAssets.length}
          hasMore={assets.length < allAssets.length}
          activeId={activeId}
          onChange={setActiveId}
          onLoadMore={async () => {
            await onLoadMore();
            setAssets(allAssets);
          }}
          onUpdate={async () => undefined}
          onClose={() => undefined}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(document.querySelector(".quick-preview-footer > span")?.textContent).toContain(
      "121 / 240",
    );
  });

  it("updates favorite and rating without closing on select space", async () => {
    const onUpdate = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <QuickPreview
          assets={[createAsset(1)]}
          total={1}
          hasMore={false}
          activeId="asset-1"
          onChange={() => undefined}
          onLoadMore={async () => undefined}
          onUpdate={onUpdate}
          onClose={onClose}
        />,
      );
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4" }));
    });

    expect(onUpdate).toHaveBeenNthCalledWith(1, "asset-1", {
      favorite: true,
    });
    expect(onUpdate).toHaveBeenNthCalledWith(2, "asset-1", { rating: 4 });

    const select = document.querySelector(
      ".quick-preview-organize select",
    ) as HTMLSelectElement;
    await act(async () => {
      select.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
