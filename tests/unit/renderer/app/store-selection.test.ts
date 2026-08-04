import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../../../src/shared/contracts";
import { useAppStore } from "../../../../src/renderer/app/store";

const selectedAsset: AssetRecord = {
  id: "asset-1",
  title: "Asset",
  kind: "image",
  path: "D:\\assets\\asset.png",
  extension: "png",
  size: 1,
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
  width: 1,
  height: 1,
  duration: null,
  metadataStatus: "ready",
  metadataError: null,
  metadataUpdatedAt: null,
  bpm: null,
  customFields: {},
  customThumbnailPath: null,
  tags: [],
  collectionIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  previewUrl: "refasset://asset/asset-1",
  thumbnailUrl: "refasset://thumbnail/asset-1",
};

describe("asset grid selection", () => {
  it("does not publish a new state when replacing the existing single selection", () => {
    useAppStore.setState({
      assets: [selectedAsset],
      selectedAsset,
      selectedIds: new Set([selectedAsset.id]),
      allMatchingSelected: false,
      excludedIds: new Set(),
      selectionAnchorId: selectedAsset.id,
    });
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useAppStore.getState().selectAssetInGrid(selectedAsset.id, "replace");
      expect(notifications).toBe(0);
    } finally {
      unsubscribe();
    }
  });
});
