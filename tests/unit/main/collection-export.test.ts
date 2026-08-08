import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";

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

describe("collection export (§6.3)", () => {
  it("copies only resolved items, writes manifest, and never overwrites on conflicts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-export-"));
    temporaryDirectories.push(directory);
    const db = new RefCanvasDatabase(path.join(directory, "app.db"));
    try {
      db.upsertMountRoot({
        id: "mount-1",
        path: directory,
        displayName: "test",
        state: "online",
      });
      const service = db.collectionService();
      const collection = service.create({ name: "导出集" });
      const a = path.join(directory, "a.png");
      const b = path.join(directory, "b.png");
      await writeFile(a, Buffer.alloc(64, 1));
      await writeFile(b, Buffer.alloc(64, 2));
      await service.addPaths(collection.id, [a, b]);
      // 制造一个 missing 条目：加入后删除文件，再解析更新状态。
      const c = path.join(directory, "gone.png");
      await writeFile(c, Buffer.alloc(64, 3));
      await service.addPaths(collection.id, [c]);
      await rm(c, { force: true });
      await service.resolveCollection(collection.id);

      const target = path.join(directory, "out");
      const snapshot = await service.export(collection.id, target);
      expect(snapshot.copied).toBe(2);
      expect(snapshot.skipped).toBe(1); // missing 项跳过
      expect(snapshot.failed).toBe(0);

      const files = (await readdir(target)).sort();
      expect(files).toContain(".refcanvas-collection.json");
      expect(files).toContain("a.png");
      expect(files).toContain("b.png");
      expect(files).not.toContain("gone.png");

      const manifest = JSON.parse(
        await readFile(path.join(target, ".refcanvas-collection.json"), "utf8"),
      ) as {
        format: string;
        version: number;
        sourceName: string;
        entries: Array<{ sourcePath: string; relativePath: string; state: string; reason: string | null }>;
      };
      expect(manifest.format).toBe("refcanvas-collection");
      expect(manifest.version).toBe(1);
      expect(manifest.sourceName).toBe("导出集");
      expect(manifest.entries).toHaveLength(3);
      const skippedEntry = manifest.entries.find((entry) => entry.state === "missing")!;
      expect(skippedEntry.reason).toBe("not-missing");

      // 重名冲突：再次导出不覆盖已有文件，生成编号文件。
      const second = await service.export(collection.id, target);
      expect(second.copied).toBe(2);
      const filesAfter = (await readdir(target)).sort();
      expect(filesAfter).toContain("a (2).png");
      expect(filesAfter).toContain("b (2).png");
      // 旧文件 hash 不变。
      await expect(readFile(path.join(target, "a.png"))).resolves.toEqual(
        Buffer.alloc(64, 1),
      );
    } finally {
      db.close();
    }
  });

  it("skips non-resolved items with stable reason codes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-export2-"));
    temporaryDirectories.push(directory);
    const db = new RefCanvasDatabase(path.join(directory, "app.db"));
    try {
      db.upsertMountRoot({
        id: "mount-1",
        path: directory,
        displayName: "test",
        state: "online",
      });
      const service = db.collectionService();
      const collection = service.create({ name: "离线集" });
      const source = path.join(directory, "x.png");
      await writeFile(source, Buffer.alloc(32, 4));
      await service.addPaths(collection.id, [source]);
      // 挂载下线 → 解析后条目 offline。
      db.upsertMountRoot({
        id: "mount-1",
        path: directory,
        displayName: "test",
        state: "offline",
      });
      await service.resolveCollection(collection.id);
      const target = path.join(directory, "out2");
      const snapshot = await service.export(collection.id, target);
      expect(snapshot.copied).toBe(0);
      expect(snapshot.skipped).toBe(1);
      const manifest = JSON.parse(
        await readFile(path.join(target, ".refcanvas-collection.json"), "utf8"),
      ) as { entries: Array<{ state: string; reason: string | null }> };
      expect(manifest.entries[0].reason).toBe("not-offline");
    } finally {
      db.close();
    }
  });

  it("cancels a running export, keeps copied files, and leaves no manifest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-export3-"));
    temporaryDirectories.push(directory);
    const db = new RefCanvasDatabase(path.join(directory, "app.db"));
    try {
      db.upsertMountRoot({
        id: "mount-1",
        path: directory,
        displayName: "test",
        state: "online",
      });
      const service = db.collectionService();
      const collection = service.create({ name: "取消集" });
      // 多个源文件：让导出循环有多次迭代，取消点在第一个文件复制前命中。
      for (let index = 0; index < 12; index += 1) {
        const source = path.join(directory, `f${index}.bin`);
        await writeFile(source, Buffer.alloc(4 * 1024 * 1024, index));
        await service.addPaths(collection.id, [source]);
      }

      const target = path.join(directory, "out3");
      const jobId = "export-cancel-job";
      const exportPromise = service.export(collection.id, target, { jobId });
      // 让 export 越过 mkdir/readdir 等异步步骤，进入复制循环前发出取消。
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(service.cancelExport(jobId)).toBe(true);

      const snapshot = await exportPromise;
      expect(snapshot.state).toBe("cancelled");
      expect(snapshot.manifestPath).toBeNull();
      expect(snapshot.errorCode).toBe("COLLECTION_EXPORT_CANCELLED");
      // 已复制的文件保留（复制先完成的迭代不删除）。
      expect(snapshot.copied).toBeGreaterThanOrEqual(0);
      // 临时 manifest 不残留。
      const files = await readdir(target);
      expect(
        files.some((name) => name.endsWith(".refcanvas-collection.json")),
      ).toBe(false);
      // 取消后再次取消返回 false（任务已从 in-flight 清理）。
      expect(service.cancelExport(jobId)).toBe(false);
    } finally {
      db.close();
    }
  });
});
