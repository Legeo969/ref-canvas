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
      database.upsertMountRoot({
        id: "mount-drive-d",
        path: "D:\\",
        displayName: "D:",
      });
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

  it("updates the fingerprint when a ref at the same path changes", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const collection = database.createCollection("References");
      database.upsertMountRoot({
        id: "mount-drive-d",
        path: "D:\\",
        displayName: "D:",
      });
      database.addCollectionRef({
        collectionId: collection.id,
        mountId: "mount-drive-d",
        relativePath: "art/reference.png",
        fingerprint: "abc123",
      });
      // 同路径文件内容变化：fingerprint 必须更新，不产生重复引用。
      database.addCollectionRef({
        collectionId: collection.id,
        mountId: "mount-drive-d",
        relativePath: "art/reference.png",
        fingerprint: "new-hash",
      });
      const refs = database.listCollectionRefs(collection.id);
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        fingerprint: "new-hash",
        state: "resolved",
      });
    } finally {
      database.close();
    }
  });

  it("generates a stable identity id for file identity rows", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      database.upsertFileIdentity({
        pathKey: "d:\\art\\reference.png",
        assetId: "asset-1",
        fingerprint: "fp",
        size: 10,
        rootPath: "D:\\",
      });
      const identities = database.listFileIdentitiesByRoot("D:\\");
      expect(identities).toHaveLength(1);
      expect(identities[0].id).toMatch(/^[0-9a-f-]{8,}$/);
    } finally {
      database.close();
    }
  });

  it("rejects a file identity referencing an unknown mount", () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      // mount_id 引用不存在的 mount 时，v14 触发器必须拒绝插入。
      expect(() =>
        database.upsertFileIdentity({
          pathKey: "d:\\art\\reference.png",
          assetId: "asset-1",
          fingerprint: "fp",
          size: 10,
          rootPath: "D:\\",
          mountId: "no-such-mount",
        }),
      ).toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      database.close();
    }
  });
});
