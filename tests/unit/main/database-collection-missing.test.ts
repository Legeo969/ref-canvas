import { describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";

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

  it("records a v14 collection ref by path and fingerprint", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const collection = database.createCollection("References");
      // v14 collection_refs 以 mount + relative path + fingerprint 引用磁盘文件。
      database.addCollectionRef({
        collectionId: collection.id,
        mountId: "mount-drive-d",
        relativePath: "art/reference.png",
        fingerprint: "abc123",
      });
      expect(database.listCollectionRefs(collection.id)).toHaveLength(1);
      expect(database.listCollectionRefs(collection.id)[0]).toMatchObject({
        collectionId: collection.id,
        mountId: "mount-drive-d",
        relativePath: "art/reference.png",
        fingerprint: "abc123",
        state: "resolved",
      });
    } finally {
      database.close();
    }
  });
});
