import { EventEmitter } from "node:events";
import type { FSWatcher, Stats } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { FilesystemService } from "../../../src/main/services/filesystem-service";
import { LibraryService } from "../../../src/main/services/library-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function createService() {
  const database = new RefCanvasDatabase(":memory:");
  const directory = new FilesystemService(database, {
    fallbackTrashRoot: path.join(os.tmpdir(), "refcanvas-fs-trash"),
  });
  return { database, directory };
}

async function scaffoldTree(root: string) {
  const sub = path.join(root, "art", "concept");
  await mkdir(sub, { recursive: true });
  await mkdir(path.join(root, "empty"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "a.png"), Buffer.alloc(64, 1)),
    writeFile(path.join(root, "b.txt"), "hello"),
    writeFile(path.join(sub, "concept-01.png"), Buffer.alloc(96, 2)),
    writeFile(path.join(sub, "sketch.psd"), Buffer.alloc(128, 3)),
  ]);
}

describe("listRoots", () => {
  it("returns only reachable drive roots with names", async () => {
    const { directory } = createService();
    const roots = await directory.listRoots();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots[0]).toMatchObject({
      isDirectory: true,
      extension: "",
    });
    expect(roots[0].path).toMatch(/^[A-Z]:\\$/);
  });
});

describe("listDirectory", () => {
  it("does not create an implicit watcher while paging", async () => {
    const directoryPath = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(directoryPath);
    const watcherFactory = vi.fn();
    const database = new RefCanvasDatabase(":memory:");
    const directory = new FilesystemService(database, {
      watcherFactory,
    });
    try {
      await directory.listDirectory(directoryPath);
      expect(watcherFactory).not.toHaveBeenCalled();
    } finally {
      directory.close();
      database.close();
    }
  });

  it("falls back to mtime polling when native watch throws EINVAL", async () => {
    const directoryPath = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(directoryPath);
    let mtimeMs = 1;
    const database = new RefCanvasDatabase(":memory:");
    const directory = new FilesystemService(database, {
      watcherFactory: () => {
        throw Object.assign(new Error("invalid argument"), { code: "EINVAL" });
      },
      statDirectory: async () => ({ mtimeMs }) as Stats,
      observerPollIntervalMs: 10,
    });
    try {
      const invalidated = new Promise<void>((resolve) => {
        const unsubscribe = directory.onDirectoryProgress((snapshot) => {
          if (snapshot.state !== "invalidated") return;
          unsubscribe();
          resolve();
        });
      });
      await expect(directory.setObservedDirectory(directoryPath)).resolves.toBeUndefined();
      mtimeMs = 2;
      await expect(invalidated).resolves.toBeUndefined();
    } finally {
      directory.close();
      database.close();
    }
  });

  it("closes the previous observer when the visible directory changes", async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    const second = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(first, second);
    const observers: Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> = [];
    const database = new RefCanvasDatabase(":memory:");
    const directory = new FilesystemService(database, {
      watcherFactory: () => {
        const observer = Object.assign(new EventEmitter(), { close: vi.fn() });
        observers.push(observer);
        return observer as unknown as FSWatcher;
      },
    });
    try {
      await directory.setObservedDirectory(first);
      await directory.setObservedDirectory(second);
      expect(observers[0].close).toHaveBeenCalledOnce();
      await directory.setObservedDirectory(null);
      expect(observers[1].close).toHaveBeenCalledOnce();
    } finally {
      directory.close();
      database.close();
    }
  });

  it("lists one level without touching the asset database", async () => {
    const directoryPath = await mkdtemp(
      path.join(os.tmpdir(), "refcanvas-fs-"),
    );
    temporaryDirectories.push(directoryPath);
    await scaffoldTree(directoryPath);
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(directoryPath, { pageSize: 500 });
      const names = page.entries.map((entry) => entry.name);
      expect(names).toContain("a.png");
      expect(names).toContain("b.txt");
      expect(names).toContain("art");
      expect(names).toContain("empty");
      expect(names).not.toContain("concept-01.png");
      expect(page.nextCursor).toBeNull();
      // 浏览不产生任何素材数据库记录。
      expect(database.searchAssets().total).toBe(0);
      expect(database.listCollections()).toHaveLength(0);
    } finally {
      await directory.close?.();
      database.close();
    }
  });

  it("paginates a large directory with a cursor", async () => {
    const directoryPath = await mkdtemp(
      path.join(os.tmpdir(), "refcanvas-fs-"),
    );
    temporaryDirectories.push(directoryPath);
    await Promise.all(
      Array.from({ length: 120 }, (_, index) =>
        writeFile(
          path.join(directoryPath, `file-${String(index).padStart(4, "0")}.bin`),
          Buffer.alloc(8, index),
        ),
      ),
    );
    const { database, directory } = createService();
    try {
      const first = await directory.listDirectory(directoryPath, { pageSize: 50 });
      expect(first.entries).toHaveLength(50);
      expect(first.total).toBe(120);
      expect(first.nextCursor).toBe("50");
      const second = await directory.listDirectory(directoryPath, {
        pageSize: 50,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.entries).toHaveLength(50);
      expect(second.nextCursor).toBe("100");
      const third = await directory.listDirectory(directoryPath, {
        pageSize: 50,
        cursor: second.nextCursor ?? undefined,
      });
      expect(third.entries).toHaveLength(20);
      expect(third.nextCursor).toBeNull();
    } finally {
      await directory.close?.();
      database.close();
    }
  });

  it("fills metadata in the background", async () => {
    const directoryPath = await mkdtemp(
      path.join(os.tmpdir(), "refcanvas-fs-"),
    );
    temporaryDirectories.push(directoryPath);
    await writeFile(path.join(directoryPath, "x.bin"), Buffer.alloc(2048, 7));
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(directoryPath);
      expect(page.entries[0].size).toBeUndefined();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const refreshed = await directory.listDirectory(directoryPath);
        if (refreshed.entries[0].size !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const done = await directory.listDirectory(directoryPath);
      expect(done.entries[0].size).toBe(2048);
    } finally {
      await directory.close?.();
      database.close();
    }
  });

  it("marks confirmed frame sequences without creating library records", async () => {
    const directoryPath = await mkdtemp(
      path.join(os.tmpdir(), "refcanvas-sequence-"),
    );
    temporaryDirectories.push(directoryPath);
    await Promise.all([
      writeFile(path.join(directoryPath, "shot_0001.exr"), Buffer.alloc(8)),
      writeFile(path.join(directoryPath, "shot_0002.exr"), Buffer.alloc(8)),
      writeFile(path.join(directoryPath, "shot_0003.exr"), Buffer.alloc(8)),
      writeFile(path.join(directoryPath, "shot_0004.exr"), Buffer.alloc(8)),
      writeFile(path.join(directoryPath, "other_0001.exr"), Buffer.alloc(8)),
      writeFile(path.join(directoryPath, "other_0002.exr"), Buffer.alloc(8)),
    ]);
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(directoryPath);
      const shot = page.entries.filter((entry) => entry.name.startsWith("shot_"));
      expect(shot.every((entry) => entry.sequence?.count === 4)).toBe(true);
      expect(shot.map((entry) => entry.sequence?.frame)).toEqual([1, 2, 3, 4]);
      expect(
        page.entries.find((entry) => entry.name === "other_0001.exr")?.sequence,
      ).toBeUndefined();
      expect(database.searchAssets().total).toBe(0);
    } finally {
      await directory.close?.();
      database.close();
    }
  });
});

describe("directory search", () => {
  it("returns current-level results and streams subdirectory matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    await scaffoldTree(root);
    const { database, directory } = createService();
    try {
      const completed = new Promise<void>((resolve) => {
        const unsubscribe = directory.onSearchProgress((snapshot) => {
          if (snapshot.state !== "completed") return;
          unsubscribe();
          resolve();
        });
      });
      const id = await directory.startSearch(root, "png");
      expect(id).toBeTruthy();
      await completed;
      const snapshot = directory.getSearch(id)!;
      expect(snapshot.state).toBe("completed");
      const names = snapshot.entries.map((entry) => entry.name).sort();
      expect(names).toEqual(["a.png", "concept-01.png"]);
      expect(snapshot.failedDirectories).toHaveLength(0);
      // 搜索同样不产生任何数据库记录。
      expect(database.searchAssets().total).toBe(0);
    } finally {
      await directory.close?.();
      database.close();
    }
  });

  it("cancels an in-flight search", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    // 多层目录让搜索仍在进行中（足够多批次，单批 8 个目录 + setImmediate）。
    await Promise.all(
      Array.from({ length: 1500 }, async (_, index) => {
        const sub = path.join(root, `dir-${index}`);
        await mkdir(sub, { recursive: true });
        await writeFile(path.join(sub, "payload.bin"), Buffer.alloc(16, index));
      }),
    );
    const { database, directory } = createService();
    try {
      const id = await directory.startSearch(root, "");
      await new Promise((resolve) => setTimeout(resolve, 10));
      directory.cancelSearch(id);
      const snapshot = directory.getSearch(id)!;
      expect(snapshot.state).toBe("cancelled");
      // 取消后不再产生完成态更新。
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(directory.getSearch(id)!.state).toBe("cancelled");
    } finally {
      await directory.close?.();
      database.close();
    }
  });

  it("reports unreadable directories without aborting other roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "ok.png"), Buffer.alloc(16, 1));
    const { database, directory } = createService();
    try {
      const completed = new Promise<void>((resolve) => {
        const unsubscribe = directory.onSearchProgress((snapshot) => {
          if (snapshot.state !== "completed") return;
          unsubscribe();
          resolve();
        });
      });
      const id = await directory.startSearch(root, "");
      await completed;
      const snapshot = directory.getSearch(id)!;
      expect(snapshot.state).toBe("completed");
      expect(
        snapshot.entries.some((entry) => entry.name === "ok.png"),
      ).toBe(true);
    } finally {
      await directory.close?.();
      database.close();
    }
  });
});

describe("quick access", () => {
  it("stores display name, order and expansion state per library", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const { database, directory } = createService();
    try {
      let entries = await directory.addQuickAccess(root, "我的参考");
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("我的参考");
      expect(entries[0].sortOrder).toBe(1);
      entries = await directory.updateQuickAccess(entries[0].id, {
        expanded: true,
      });
      expect(entries[0].expanded).toBe(true);
      entries = await directory.addQuickAccess(root);
      expect(entries).toHaveLength(1);
      const listed = await directory.listQuickAccess();
      expect(listed[0].name).toBe("我的参考");
      entries = await directory.removeQuickAccess(listed[0].id);
      expect(entries).toHaveLength(0);
      // 每个资料库独立保存（同一 DB 内持久化）。
      expect(database.getSetting("quickAccessEntries", [])).toEqual([]);
    } finally {
      await directory.close?.();
      database.close();
    }
  });
});

describe("materialize", () => {
  it("creates a linked asset record on demand and reuses the same id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const file = path.join(root, "reference.png");
    await writeFile(file, Buffer.alloc(256, 3));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    const directory = new FilesystemService(database);
    try {
      const first = await service.materializePath(file);
      expect(first.created).toBe(true);
      expect(first.copied).toBe(false);
      const second = await service.materializePath(file);
      expect(second.created).toBe(false);
      expect(second.asset.id).toBe(first.asset.id);
      expect(second.asset.path).toBe(file);
      // 同路径记录复用；白板引用 id-keyed 不受影响。
      expect(database.searchAssets().items[0].id).toBe(first.asset.id);
    } finally {
      await directory.close?.();
      await service.close();
      database.close();
    }
  });

  it("honors collection and tag side-effects on materialize", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const file = path.join(root, "concept.png");
    await writeFile(file, Buffer.alloc(64, 5));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const collection = database.createCollection("概念");
      const result = await service.materializePath(file, {
        collectionIds: [collection.id],
        tags: ["草图"],
      });
      expect(result.asset.collectionIds).toEqual([collection.id]);
      expect(result.asset.tags).toEqual(["草图"]);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("managed mode copies with full hash verification", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "managed.png");
    await writeFile(source, Buffer.alloc(512, 9));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database, undefined, {
      libraryRoot: root,
    });
    try {
      const result = await service.materializePath(source, {
        storageMode: "managed",
      });
      expect(result.copied).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.asset.storageMode).toBe("managed");
      expect(result.asset.path).not.toBe(source);
      expect(await readFile(result.asset.path)).toEqual(Buffer.alloc(512, 9));
    } finally {
      await service.close();
      database.close();
    }
  });
});

describe("renameSourceFile", () => {
  it("renames the real file and syncs the record without changing its id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const original = path.join(root, "old.png");
    await writeFile(original, Buffer.alloc(128, 7));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.materializePath(original);
      const before = database.getAssetByPath(original)!;
      const result = await service.renameSourceFile(original, "new");
      expect(result.path).toBe(path.join(root, "new.png"));
      expect(result.syncedAsset).not.toBeNull();
      expect(result.syncedAsset!.id).toBe(before.id);
      expect(result.syncedAsset!.path).toBe(path.join(root, "new.png"));
      expect(database.getAssetByPath(original)).toBeNull();
      expect(database.getAssetByPath(path.join(root, "new.png"))?.id).toBe(
        before.id,
      );
    } finally {
      await service.close();
      database.close();
    }
  });

  it("appends the original extension when the new name omits it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const original = path.join(root, "old.psd");
    await writeFile(original, Buffer.alloc(64, 2));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const result = await service.renameSourceFile(original, "final");
      expect(result.path).toBe(path.join(root, "final.psd"));
    } finally {
      await service.close();
      database.close();
    }
  });

  it("rejects names with invalid filename characters", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const original = path.join(root, "a.png");
    await writeFile(original, Buffer.alloc(8));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await expect(service.renameSourceFile(original, "bad/name")).rejects.toThrow(
        "INVALID_FILENAME",
      );
      await expect(service.renameSourceFile(original, "bad:name")).rejects.toThrow(
        "INVALID_FILENAME",
      );
    } finally {
      await service.close();
      database.close();
    }
  });
});
