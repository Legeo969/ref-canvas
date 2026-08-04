import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LibraryService } from "../../../src/main/services/library-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * §13.4 新增 API 的数据层验证：collection_refs 引用（计划 §7.2）。
 * mounts/metadata/media/providers 的 IPC 通道由集成测试覆盖。
 */
describe("collection references (stage 2d §13.4)", () => {
  it("adds a path+fingerprint reference and lists it back", async () => {
    const root = await tempDirectory("refcanvas-refs-");
    const file = path.join(root, "concept.png");
    await writeFile(file, Buffer.alloc(256, 3));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      // 注册 mount（watch root 即挂载根）。
      await service.addWatchRoot(root);
      await service.materializePath(file);
      const ref = database.resolveIdentityRef(file);
      expect(ref).not.toBeNull();
      expect(ref!.relativePath).toBe("concept.png");
      const collection = database.createCollection("参考");
      database.addCollectionRef({
        collectionId: collection.id,
        mountId: ref!.mountId,
        relativePath: ref!.relativePath,
        fingerprint: ref!.fingerprint,
      });
      const refs = database.listCollectionRefs(collection.id);
      expect(refs).toHaveLength(1);
      expect(refs[0].relativePath).toBe("concept.png");
      expect(refs[0].state).toBe("resolved");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("removes references by mount+relative path without touching files", async () => {
    const root = await tempDirectory("refcanvas-refs-");
    const file = path.join(root, "a.png");
    await writeFile(file, Buffer.alloc(64, 7));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.addWatchRoot(root);
      await service.materializePath(file);
      const ref = database.resolveIdentityRef(file)!;
      const collection = database.createCollection("合集");
      database.addCollectionRef({
        collectionId: collection.id,
        mountId: ref.mountId,
        relativePath: ref.relativePath,
        fingerprint: ref.fingerprint,
      });
      const removed = database.removeCollectionRefs(collection.id, [
        { mountId: ref.mountId, relativePath: ref.relativePath },
      ]);
      expect(removed).toBe(1);
      expect(database.listCollectionRefs(collection.id)).toHaveLength(0);
      // 磁盘文件不受影响。
      await expect(stat(file)).resolves.toBeDefined();
    } finally {
      await service.close();
      database.close();
    }
  });

  it("resolves identity only inside registered mounts", async () => {
    const root = await tempDirectory("refcanvas-refs-");
    const outside = await tempDirectory("refcanvas-outside-");
    const insideFile = path.join(root, "in.png");
    const outsideFile = path.join(outside, "out.png");
    await writeFile(insideFile, Buffer.alloc(32, 1));
    await writeFile(outsideFile, Buffer.alloc(32, 2));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.addWatchRoot(root);
      await service.materializePath(insideFile);
      await service.materializePath(outsideFile);
      // 挂载内的文件有引用键；挂载外没有。
      expect(database.resolveIdentityRef(insideFile)).not.toBeNull();
      expect(database.resolveIdentityRef(outsideFile)).toBeNull();
    } finally {
      await service.close();
      database.close();
    }
  });
});
