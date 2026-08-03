import { describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "./database";

describe("collection missing-asset reconciliation", () => {
  it("removes missing linked assets from normal folder results and counts", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const asset = database.upsertAsset({
        title: "Reference",
        kind: "image",
        path: "D:\\references\\image.png",
        pathKey: "d:\\references\\image.png",
        extension: "png",
        size: 1024,
        mtimeMs: 1,
        fingerprint: "fingerprint",
        linkState: "online",
        notes: "",
        width: 100,
        height: 100,
        duration: null,
      }).asset;
      const collection = database.createCollection("References");
      database.addAssetToCollection(asset.id, collection.id);
      expect(database.searchAssets({ collectionId: collection.id }).total).toBe(1);
      expect(database.listCollections()[0].assetCount).toBe(1);

      database.setLinkState(asset.id, "missing");

      expect(database.searchAssets({ collectionId: collection.id }).total).toBe(0);
      expect(database.searchAssets({ linkState: "missing" }).total).toBe(1);
      expect(database.listCollections()[0].assetCount).toBe(0);
    } finally {
      database.close();
    }
  });

  it("prunes only empty folders marked as watch-generated", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const generated = database.createCollection("Generated");
      const manual = database.createCollection("Manual");
      database.markCollectionSource(generated.id, "D:\\watch", "Generated");

      expect(database.pruneEmptyGeneratedCollections("D:\\watch")).toEqual([
        generated.id,
      ]);
      expect(database.getCollection(generated.id)).toBeNull();
      expect(database.getCollection(manual.id)).not.toBeNull();
    } finally {
      database.close();
    }
  });
});
