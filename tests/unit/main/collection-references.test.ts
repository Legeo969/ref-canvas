import Sqlite from "better-sqlite3";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { quickFingerprint } from "../../../src/main/services/library-service";

const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeDirectory));
});

/** 打开 schema 17 数据库并返回目录根（测试写文件的边界）。 */
async function openDb(): Promise<{ db: RefCanvasDatabase; root: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-colls-"));
  temporaryDirectories.push(directory);
  const filename = path.join(directory, "app.db");
  const db = new RefCanvasDatabase(filename);
  expect(db.getSchemaVersion()).toBe(17);
  return { db, root: directory };
}

/** 测试内写入的路径必须落在 fixture 目录内（防御性校验）。 */
function withinRoot(root: string, filename: string): string {
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, filename);
  if (resolved !== rootPath && !resolved.startsWith(rootPath + path.sep)) {
    throw new Error("FIXTURE_OUT_OF_DIRECTORY");
  }
  return resolved;
}

describe("reference collections (schema 17)", () => {
  it("creates parent/child collections, renames and reorders", async () => {
    const { db } = await openDb();
    try {
      const repo = db.collections();
      const parent = repo.create({ name: "父集" });
      const child = repo.create({ parentId: parent.id, name: "子集" });
      expect(parent.parentId).toBeNull();
      expect(child.parentId).toBe(parent.id);
      expect(repo.getByParentAndName(null, "父集")?.id).toBe(parent.id);
      expect(repo.update(child.id, { name: "角色" }).name).toBe("角色");
      expect(repo.update(child.id, { sortOrder: 5 }).sortOrder).toBe(5);
      expect(repo.list().length).toBe(2);
    } finally {
      db.close();
    }
  });

  it("moving a collection under its own descendant is rejected", async () => {
    const { db } = await openDb();
    try {
      const repo = db.collections();
      const a = repo.create({ name: "A" });
      const b = repo.create({ parentId: a.id, name: "B" });
      expect(() => repo.update(a.id, { parentId: b.id })).toThrow(
        "COLLECTION_CYCLE",
      );
    } finally {
      db.close();
    }
  });

  it("duplicate add returns the original item without creating a second row", async () => {
    const { db, root } = await openDb();
    try {
      const repo = db.collections();
      const collection = repo.create({ name: "灵感" });
      const source = withinRoot(root, "a.png");
      await writeFile(source, Buffer.alloc(64, 7));
      const [first] = repo.addPaths(collection.id, [source]);
      const [second] = repo.addPaths(collection.id, [source]);
      expect(second.id).toBe(first.id);
      expect(repo.listItems(collection.id)).toHaveLength(1);
      const raw = new Sqlite(path.join(root, "app.db"), { readonly: true });
      try {
        expect(
          (raw.prepare("SELECT COUNT(*) AS c FROM collection_items").get() as { c: number }).c,
        ).toBe(1);
      } finally {
        raw.close();
      }
    } finally {
      db.close();
    }
  });

  it("same path in two collections produces independent references", async () => {
    const { db, root } = await openDb();
    try {
      const repo = db.collections();
      const a = repo.create({ name: "A" });
      const b = repo.create({ name: "B" });
      const source = withinRoot(root, "shared.png");
      await writeFile(source, Buffer.alloc(128, 3));
      const [itemA] = repo.addPaths(a.id, [source]);
      const [itemB] = repo.addPaths(b.id, [source]);
      expect(itemA.id).not.toBe(itemB.id);
      expect(itemA.collectionId).toBe(a.id);
      expect(itemB.collectionId).toBe(b.id);
    } finally {
      db.close();
    }
  });

  it("delete parent without recursive flag is rejected; recursive keeps disk files", async () => {
    const { db, root } = await openDb();
    try {
      const repo = db.collections();
      const parent = repo.create({ name: "父集" });
      const child = repo.create({ parentId: parent.id, name: "子集" });
      const source = withinRoot(root, "art.png");
      await writeFile(source, Buffer.alloc(32, 9));
      repo.addPaths(child.id, [source]);
      expect(() => repo.delete(parent.id, { recursive: false })).toThrow(
        "COLLECTION_NOT_EMPTY",
      );
      expect(repo.get(parent.id)).not.toBeNull();
      // 递归删除只删集合记录与条目，不删磁盘文件。
      repo.delete(parent.id, { recursive: true });
      expect(repo.get(parent.id)).toBeNull();
      expect(repo.get(child.id)).toBeNull();
      await expect(stat(source)).resolves.toBeDefined();
    } finally {
      db.close();
    }
  });

  it("removeItems only removes the target items in the collection", async () => {
    const { db, root } = await openDb();
    try {
      const repo = db.collections();
      const a = repo.create({ name: "A" });
      const b = repo.create({ name: "B" });
      const sourceA = withinRoot(root, "x.png");
      const sourceB = withinRoot(root, "y.png");
      await writeFile(sourceA, Buffer.alloc(16, 1));
      await writeFile(sourceB, Buffer.alloc(16, 2));
      const [itemA] = repo.addPaths(a.id, [sourceA]);
      repo.addPaths(b.id, [sourceA]);
      const [itemC] = repo.addPaths(a.id, [sourceB]);
      repo.removeItems(a.id, [itemA.id]);
      expect(repo.listItems(a.id).map((item) => item.id)).toEqual([itemC.id]);
      expect(repo.listItems(b.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe("collection reference resolution (§6.2)", () => {
  async function scaffold() {
    const { db, root } = await openDb();
    db.upsertMountRoot({
      id: "mount-1",
      path: root,
      displayName: "test",
      state: "online",
    });
    const collection = db.collections().create({ name: "素材" });
    return { db, root, collection };
  }

  async function indexedFile(
    db: RefCanvasDatabase,
    root: string,
    name: string,
    content: Buffer,
  ): Promise<string> {
    const file = withinRoot(root, name);
    await writeFile(file, content);
    const fileStat = await stat(file);
    const fingerprint = await quickFingerprint(file, fileStat.size);
    db.upsertFileIdentity({
      pathKey: path.normalize(file).toLocaleLowerCase("en-US"),
      assetId: "",
      fingerprint,
      size: fileStat.size,
      rootPath: root,
      mountId: "mount-1",
    });
    return file;
  }

  it("mount offline marks items offline without downgrading to missing", async () => {
    const { db, root, collection } = await scaffold();
    try {
      const source = await indexedFile(db, root, "photo.png", Buffer.alloc(256, 1));
      await db.collectionService().addPaths(collection.id, [source]);
      db.upsertMountRoot({
        id: "mount-1",
        path: root,
        displayName: "test",
        state: "offline",
      });
      const service = db.collectionResolution();
      const [result] = await service.resolveCollection(collection.id);
      expect(result.item.state).toBe("offline");
    } finally {
      db.close();
    }
  });

  it("file moved and unique fingerprint candidate auto-relinks", async () => {
    const { db, root, collection } = await scaffold();
    try {
      const source = await indexedFile(db, root, "a.png", Buffer.alloc(512, 5));
      await db.collectionService().addPaths(collection.id, [source]);
      // 移动到 moved/ 子目录并重新索引（原 identity 保留）。
      const movedDir = withinRoot(root, "moved");
      await mkdir(movedDir);
      const moved = withinRoot(root, "moved/a.png");
      await rename(source, moved);
      const movedStat = await stat(moved);
      const fingerprint = await quickFingerprint(moved, movedStat.size);
      db.upsertFileIdentity({
        pathKey: path.normalize(moved).toLocaleLowerCase("en-US"),
        assetId: "",
        fingerprint,
        size: movedStat.size,
        rootPath: movedDir,
        mountId: "mount-1",
      });
      const service = db.collectionResolution();
      const [result] = await service.resolveCollection(collection.id);
      expect(result.item.state).toBe("resolved");
      expect(result.relinked).toBe(true);
      expect(path.basename(result.item.lastResolvedPath)).toBe("a.png");
    } finally {
      db.close();
    }
  });

  it("two fingerprint candidates mark ambiguous without auto-picking", async () => {
    const { db, root, collection } = await scaffold();
    try {
      const source = await indexedFile(db, root, "a.png", Buffer.alloc(512, 5));
      await db.collectionService().addPaths(collection.id, [source]);
      // 原文件删除（触发指纹搜索）；两个同指纹候选都真实存在。
      await rm(source, { force: true });
      const content = Buffer.alloc(512, 5);
      const candidates: Array<{ name: string; id: string }> = [
        { name: "dup_a.png", id: "identity-dup-a" },
        { name: "dup_b.png", id: "identity-dup-b" },
      ];
      for (const candidate of candidates) {
        const file = withinRoot(root, candidate.name);
        await writeFile(file, content);
        const fileStat = await stat(file);
        const fingerprint = await quickFingerprint(file, fileStat.size);
        db.upsertFileIdentity({
          pathKey: path.normalize(file).toLocaleLowerCase("en-US"),
          assetId: "",
          fingerprint,
          size: fileStat.size,
          rootPath: root,
          mountId: "mount-1",
        });
      }
      const service = db.collectionResolution();
      const [result] = await service.resolveCollection(collection.id);
      expect(result.item.state).toBe("ambiguous");
      expect(result.relinked).toBe(false);
    } finally {
      db.close();
    }
  });

  it("missing file with no candidate marks missing", async () => {
    const { db, root, collection } = await scaffold();
    try {
      const source = await indexedFile(db, root, "gone.png", Buffer.alloc(256, 2));
      await db.collectionService().addPaths(collection.id, [source]);
      await rm(source, { force: true });
      const service = db.collectionResolution();
      const [result] = await service.resolveCollection(collection.id);
      expect(result.item.state).toBe("missing");
    } finally {
      db.close();
    }
  });

  it("resolved path matching fingerprint stays resolved without relink", async () => {
    const { db, root, collection } = await scaffold();
    try {
      const source = await indexedFile(db, root, "stay.png", Buffer.alloc(200, 9));
      await db.collectionService().addPaths(collection.id, [source]);
      // identity 引用：服务 addPaths 已建立挂载引用；再补 identityId 模拟
      // 资产身份（解析应走步骤 1 且不产生 relink）。
      db.upsertFileIdentity({
        pathKey: path.normalize(source).toLocaleLowerCase("en-US"),
        assetId: "asset-stay",
        fingerprint: await quickFingerprint(source, (await stat(source)).size),
        size: (await stat(source)).size,
        rootPath: root,
        mountId: "mount-1",
      });
      const identityRow = db.listFileIdentitiesByAsset("asset-stay")[0];
      const [item] = db.collections().listItems(collection.id);
      db.collections().updateItem(item.id, { identityId: identityRow.id });
      const service = db.collectionResolution();
      const [result] = await service.resolveCollection(collection.id);
      expect(result.item.state).toBe("resolved");
      expect(result.relinked).toBe(false);
    } finally {
      db.close();
    }
  });

  it("manual relink requires confirmation when fingerprint differs", async () => {
    const { db, root, collection } = await scaffold();
    try {
      const source = await indexedFile(db, root, "a.png", Buffer.alloc(512, 5));
      const [item] = await db.collectionService().addPaths(collection.id, [source]);
      const different = withinRoot(root, "other.png");
      await writeFile(different, Buffer.alloc(600, 9)); // 不同内容 → 不同指纹。
      await expect(
        db.collectionService().relink(item.id, different, false),
      ).rejects.toThrow("RELINE_FINGERPRINT_CHANGED");
      // 取消后条目完全不变。
      const after = db.collections().getItem(item.id)!;
      expect(after.lastResolvedPath).toBe(item.lastResolvedPath);
      expect(after.fingerprint).toBe(item.fingerprint);
      // 确认后更新身份/路径/指纹。
      const relinked = await db
        .collectionService()
        .relink(item.id, different, true);
      expect(relinked.state).toBe("resolved");
      expect(relinked.lastResolvedPath).toBe(different);
      expect(relinked.fingerprint).not.toBe(item.fingerprint);
    } finally {
      db.close();
    }
  });
});
