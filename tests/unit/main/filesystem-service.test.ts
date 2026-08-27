import { EventEmitter } from "node:events";
import type { FSWatcher, Stats } from "node:fs";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import {
  FilesystemService,
  MAX_DIRECTORY_CACHE_ENTRIES,
} from "../../../src/main/services/filesystem-service";
import { MAX_RETAINED_DIRECTORY_SEARCHES } from "../../../src/shared/directory-search-retention";
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
  it("locates entries consistently when the index worker is unavailable", async () => {
    const directoryPath = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-locate-"));
    temporaryDirectories.push(directoryPath);
    await Promise.all([
      writeFile(path.join(directoryPath, "asset.png"), "png"),
      writeFile(path.join(directoryPath, "notes.txt"), "notes"),
      writeFile(path.join(directoryPath, "shot_0001.exr"), "one"),
      writeFile(path.join(directoryPath, "shot_0002.exr"), "two"),
      writeFile(path.join(directoryPath, "shot_0003.exr"), "three"),
    ]);
    const { database, directory } = createService();
    try {
      const assetPath = path.join(directoryPath, "asset.png");
      await expect(directory.locateEntry(
        directoryPath,
        process.platform === "win32" ? assetPath.toUpperCase() : assetPath,
        "fallback",
        { collapseSequences: true, extensions: ["png"] },
      )).resolves.toBe(0);
      await expect(directory.locateEntry(
        directoryPath,
        path.join(directoryPath, "notes.txt"),
        "fallback",
        { extensions: ["png"] },
      )).resolves.toBeNull();
      await expect(directory.locateEntry(
        directoryPath,
        path.join(directoryPath, "shot_0002.exr"),
        "fallback",
        { collapseSequences: true },
      )).resolves.toBeNull();
    } finally {
      directory.close();
      database.close();
    }
  });

  it("locates and pages entries in the same flattened grid order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-flatten-locate-"));
    temporaryDirectories.push(root);
    const nested = path.join(root, "nested");
    await mkdir(nested);
    const directPath = path.join(root, "direct.png");
    const targetPath = path.join(nested, "target.png");
    await Promise.all([
      writeFile(directPath, "direct"),
      writeFile(targetPath, "target"),
    ]);
    const { database, directory } = createService();
    try {
      await expect(directory.locateEntry(
        root,
        targetPath,
        "flattened",
        { collapseSequences: true, flattenDepth: 1, showHidden: false },
      )).resolves.toBe(1);
      const secondPage = await directory.listDirectory(root, {
        flattenDepth: 1,
        offset: 1,
        pageSize: 1,
      });
      expect(secondPage.entries.map((entry) => entry.path)).toEqual([targetPath]);
    } finally {
      directory.close();
      database.close();
    }
  });

  it("evicts old fallback directory snapshots at the cache limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-cache-"));
    temporaryDirectories.push(root);
    const directories = await Promise.all(
      Array.from({ length: MAX_DIRECTORY_CACHE_ENTRIES + 1 }, async (_, index) => {
        const directoryPath = path.join(root, String(index));
        await mkdir(directoryPath);
        return directoryPath;
      }),
    );
    const { database, directory } = createService();
    try {
      for (const directoryPath of directories) {
        await directory.listDirectory(directoryPath);
      }
      await writeFile(path.join(directories[0], "fresh.txt"), "fresh");

      const refreshed = await directory.listDirectory(directories[0]);
      expect(refreshed.entries.map((entry) => entry.name)).toContain("fresh.txt");
    } finally {
      directory.close();
      database.close();
    }
  });

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

  it("rejects a file path with NOT_A_DIRECTORY instead of opendir ENOTDIR", async () => {
    const directoryPath = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(directoryPath);
    const filePath = path.join(directoryPath, "朝拜.mov");
    await writeFile(filePath, Buffer.alloc(16));
    const { directory } = createService();
    try {
      await expect(directory.listDirectory(filePath)).rejects.toThrow(
        /NOT_A_DIRECTORY/,
      );
    } finally {
      directory.close();
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

  it("does not let a slow previous observer replace the current directory", async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    const second = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(first, second);
    const pending = new Map<string, (value: Stats) => void>();
    const watcherFactory = vi.fn(() =>
      Object.assign(new EventEmitter(), { close: vi.fn() }) as unknown as FSWatcher,
    );
    const database = new RefCanvasDatabase(":memory:");
    const directory = new FilesystemService(database, {
      watcherFactory,
      statDirectory: (pathname) =>
        new Promise<Stats>((resolve) => pending.set(pathname, resolve)),
    });
    try {
      const openingFirst = directory.setObservedDirectory(first);
      const openingSecond = directory.setObservedDirectory(second);
      pending.get(second)?.({ mtimeMs: 2 } as Stats);
      await openingSecond;
      pending.get(first)?.({ mtimeMs: 1 } as Stats);
      await openingFirst;

      expect(watcherFactory).toHaveBeenCalledTimes(1);
      expect(watcherFactory).toHaveBeenCalledWith(second, expect.any(Function));
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
          path.join(directoryPath, `file-item-${index}-x.bin`),
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
      expect(shot.map((entry) => entry.sequence?.frame)).toEqual([1]);
      expect(
        page.entries.find((entry) => entry.name === "other_0001.exr")?.sequence,
      ).toBeUndefined();
      expect(database.searchAssets().total).toBe(0);
      const expanded = await directory.listDirectory(directoryPath, {
        collapseSequences: false,
      });
      const frames = expanded.entries
        .filter((entry) => entry.name.startsWith("shot_"))
        .map((entry) => entry.sequence?.frame);
      expect(frames).toEqual([1, 2, 3, 4]);
    } finally {
      await directory.close?.();
      database.close();
    }
  });
});

describe("pathType", () => {
  it("distinguishes directory, file, and missing paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "a.txt");
    await writeFile(filePath, "hello");
    const { directory } = createService();
    try {
      await expect(directory.pathType(root)).resolves.toBe("directory");
      await expect(directory.pathType(filePath)).resolves.toBe("file");
      await expect(
        directory.pathType(path.join(root, "missing")),
      ).resolves.toBe("missing");
    } finally {
      directory.close();
    }
  });
});

describe("listDirectory flatten + hidden（阶段 5 §10.1）", () => {
  it("按扩展名筛选全部结果，同时保留目录导航", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-filter-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "nested"));
    await Promise.all([
      writeFile(path.join(root, "model.glb"), Buffer.alloc(4)),
      writeFile(path.join(root, "image.png"), Buffer.alloc(4)),
      writeFile(path.join(root, "notes.txt"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, { extensions: ["glb"] });
      expect(page.entries.map((entry) => entry.name)).toEqual(["nested", "model.glb"]);
      expect(page.total).toBe(2);
    } finally {
      directory.close();
      database.close();
    }
  });

  it("flattenDepth=1 展开一层子目录，条目带 depth", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const sub = path.join(root, "sub");
    await mkdir(sub);
    await Promise.all([
      writeFile(path.join(root, "top.png"), Buffer.alloc(4)),
      writeFile(path.join(sub, "inner.png"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, { flattenDepth: 1 });
      const inner = page.entries.find((entry) => entry.name === "inner.png");
      expect(inner).toBeTruthy();
      expect(inner?.depth).toBe(1);
      const top = page.entries.find((entry) => entry.name === "top.png");
      expect(top?.depth).toBe(0);
      expect(page.entries.every((entry) => !entry.isDirectory)).toBe(true);
      expect(page.entries.map((entry) => entry.name).sort()).toEqual([
        "inner.png",
        "top.png",
      ]);
    } finally {
      directory.close();
      database.close();
    }
  });

  it("flattenDepth=2 展开两层", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const deep = path.join(root, "a", "b");
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, "leaf.png"), Buffer.alloc(4));
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, { flattenDepth: 2 });
      const leaf = page.entries.find((entry) => entry.name === "leaf.png");
      expect(leaf).toBeTruthy();
      expect(leaf?.depth).toBe(2);
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0]?.isDirectory).toBe(false);
    } finally {
      directory.close();
      database.close();
    }
  });

  it("showHidden=false 过滤点开头文件；true 显示", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    await Promise.all([
      writeFile(path.join(root, "visible.png"), Buffer.alloc(4)),
      writeFile(path.join(root, ".secret.png"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    try {
      const hidden = await directory.listDirectory(root, { showHidden: false });
      expect(hidden.entries.map((entry) => entry.name)).not.toContain(".secret.png");
      const shown = await directory.listDirectory(root, { showHidden: true });
      expect(shown.entries.map((entry) => entry.name)).toContain(".secret.png");
    } finally {
      directory.close();
      database.close();
    }
  });

  it("始终隐藏 Windows 保护目录", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-system-"));
    temporaryDirectories.push(root);
    await Promise.all([
      mkdir(path.join(root, "$RECYCLE.BIN")),
      mkdir(path.join(root, "System Volume Information")),
      mkdir(path.join(root, "素材")),
    ]);
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, { showHidden: true });
      expect(page.entries.map((entry) => entry.name)).toEqual(["素材"]);
    } finally {
      directory.close();
      database.close();
    }
  });

  it("flatten 模式同样过滤隐藏文件", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const sub = path.join(root, "sub");
    await mkdir(sub);
    await writeFile(path.join(sub, ".hidden.png"), Buffer.alloc(4));
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, {
        flattenDepth: 1,
        showHidden: false,
      });
      expect(page.entries.map((entry) => entry.name)).not.toContain(".hidden.png");
    } finally {
      directory.close();
      database.close();
    }
  });

  it("flatten 模式按过滤后的素材数量计算分页游标", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const sub = path.join(root, "sub");
    await mkdir(sub);
    await Promise.all([
      writeFile(path.join(root, "image.png"), Buffer.alloc(4)),
      writeFile(path.join(root, "notes.txt"), Buffer.alloc(4)),
      writeFile(path.join(sub, "more.txt"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, {
        flattenDepth: 1,
        extensions: ["png"],
        pageSize: 1,
      });
      expect(page.entries.map((entry) => entry.name)).toEqual(["image.png"]);
      expect(page.total).toBe(1);
      expect(page.nextCursor).toBeNull();
    } finally {
      directory.close();
      database.close();
    }
  });
});

describe("directory search", () => {
  it("aggregates authorized mount roots into one paged search", async () => {
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mount-a-"));
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mount-b-"));
    temporaryDirectories.push(firstRoot, secondRoot);
    await Promise.all([
      writeFile(path.join(firstRoot, "concept-a.png"), Buffer.alloc(8)),
      writeFile(path.join(secondRoot, "concept-b.png"), Buffer.alloc(8)),
    ]);
    const { database, directory } = createService();
    try {
      const id = await directory.startSearch(firstRoot, "concept", {
        rootPaths: [firstRoot, secondRoot],
      });
      await vi.waitFor(() => {
        expect(directory.getSearch(id)?.state).toBe("completed");
      });
      const snapshot = directory.getSearch(id)!;
      expect(snapshot.rootPaths).toEqual([firstRoot, secondRoot]);
      expect(snapshot.entries.map((entry) => entry.name).sort()).toEqual([
        "concept-a.png",
        "concept-b.png",
      ]);
      const page = await directory.getSearchPage(id, { offset: 1, pageSize: 1 });
      expect(page.entries).toHaveLength(1);
      expect(page.total).toBe(2);
    } finally {
      directory.close();
      database.close();
    }
  });

  it("retains only the newest completed search snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-search-cache-"));
    temporaryDirectories.push(root);
    const { database, directory } = createService();
    const ids: string[] = [];
    try {
      for (let index = 0; index < MAX_RETAINED_DIRECTORY_SEARCHES + 2; index += 1) {
        const id = await directory.startSearch(root, `#missing-${index}`);
        ids.push(id);
        await vi.waitFor(() => {
          expect(directory.getSearch(id)?.state).toBe("completed");
        });
      }

      expect(directory.getSearch(ids[0])).toBeNull();
      expect(directory.getSearch(ids[1])).toBeNull();
      expect(directory.getSearch(ids.at(-1)!)).toMatchObject({
        state: "completed",
      });
    } finally {
      directory.close();
      database.close();
    }
  });

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

  it("limits #tag searches to the current directory tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-tag-search-"));
    temporaryDirectories.push(root);
    const nested = path.join(root, "nested");
    const outside = await mkdtemp(path.join(os.tmpdir(), "refcanvas-tag-outside-"));
    temporaryDirectories.push(outside);
    await mkdir(nested);
    const insideFile = path.join(nested, "inside.png");
    const outsideFile = path.join(outside, "outside.png");
    await Promise.all([
      writeFile(insideFile, Buffer.alloc(32, 1)),
      writeFile(outsideFile, Buffer.alloc(32, 2)),
    ]);
    const { database, directory } = createService();
    const library = new LibraryService(database);
    try {
      const inside = await library.materializePath(insideFile);
      const outsideAsset = await library.materializePath(outsideFile);
      database.setAssetTags(inside.asset.id, ["hero"]);
      database.setAssetTags(outsideAsset.asset.id, ["hero"]);
      database.updateAsset(inside.asset.id, { rating: 4 });

      const completed = new Promise<void>((resolve) => {
        const unsubscribe = directory.onSearchProgress((snapshot) => {
          if (snapshot.state !== "completed") return;
          unsubscribe();
          resolve();
        });
      });
      const id = await directory.startSearch(root, "#hero type:image rating:>=4");
      await completed;
      const snapshot = directory.getSearch(id)!;
      expect(snapshot.entries.map((entry) => entry.path)).toEqual([insideFile]);
    } finally {
      await directory.close?.();
      await library.close();
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

describe("listDirectory favoritesOnly", () => {
  it("只返回已收藏素材并隐藏文件夹", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-fav-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "art"));
    await Promise.all([
      writeFile(path.join(root, "keep.png"), Buffer.alloc(4)),
      writeFile(path.join(root, "skip.png"), Buffer.alloc(4)),
      writeFile(path.join(root, "keep.psd"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    const library = new LibraryService(database);
    try {
      const keep = await library.materializePath(path.join(root, "keep.png"));
      await library.materializePath(path.join(root, "skip.png"));
      await library.materializePath(path.join(root, "keep.psd"));
      database.updateAsset(keep.asset.id, { favorite: true });

      const page = await directory.listDirectory(root, { favoritesOnly: true });
      expect(page.entries.map((entry) => entry.name)).toEqual(["keep.png"]);
      expect(page.total).toBe(1);
      expect(page.entries.every((entry) => !entry.isDirectory)).toBe(true);
    } finally {
      await directory.close?.();
      await library.close();
      database.close();
    }
  });

  it("目录没有收藏时返回空页", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-fav-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "a.png"), Buffer.alloc(4));
    const { database, directory } = createService();
    try {
      const page = await directory.listDirectory(root, { favoritesOnly: true });
      expect(page.entries).toEqual([]);
      expect(page.total).toBe(0);
    } finally {
      await directory.close?.();
      database.close();
    }
  });

  it("flatten 模式同样只返回收藏素材", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-fav-"));
    temporaryDirectories.push(root);
    const sub = path.join(root, "sub");
    await mkdir(sub);
    await Promise.all([
      writeFile(path.join(root, "top.png"), Buffer.alloc(4)),
      writeFile(path.join(sub, "inner.png"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    const library = new LibraryService(database);
    try {
      const inner = await library.materializePath(path.join(sub, "inner.png"));
      database.updateAsset(inner.asset.id, { favorite: true });

      const page = await directory.listDirectory(root, {
        flattenDepth: 1,
        favoritesOnly: true,
      });
      expect(page.entries.map((entry) => entry.name)).toEqual(["inner.png"]);
      expect(page.total).toBe(1);
    } finally {
      await directory.close?.();
      await library.close();
      database.close();
    }
  });

  it("根目录只看收藏：子文件夹内的收藏无需 flatten 也在根目录显示（递归）", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-fav-"));
    temporaryDirectories.push(root);
    const sub = path.join(root, "art");
    await mkdir(sub);
    await Promise.all([
      writeFile(path.join(root, "top.png"), Buffer.alloc(4)),
      writeFile(path.join(sub, "inner.png"), Buffer.alloc(4)),
      writeFile(path.join(sub, "skip.png"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    const library = new LibraryService(database);
    try {
      const inner = await library.materializePath(path.join(sub, "inner.png"));
      await library.materializePath(path.join(sub, "skip.png"));
      database.updateAsset(inner.asset.id, { favorite: true });

      // 不开启 flatten（默认 0）：只看收藏仍应枚举整个子树。
      const page = await directory.listDirectory(root, { favoritesOnly: true });
      expect(page.entries.map((entry) => entry.name)).toEqual(["inner.png"]);
      expect(page.total).toBe(1);
      expect(page.entries[0]?.favorite).toBe(true);
      expect(page.entries[0]?.isDirectory).toBe(false);
      // 枚举一次即完整：标记扫描完成 + 稳定 revision + 文件计数，
      // 否则渲染端「全选/跨页批量」门槛（scanComplete && revision）永远不过。
      expect(page.scanState).toBe("complete");
      expect(page.revision).toBeTruthy();
      expect(page.totalFiles).toBe(1);
    } finally {
      await directory.close?.();
      await library.close();
      database.close();
    }
  });

  it("磁盘根目录只看收藏：全盘收藏可见（根路径前缀不多拼分隔符）", async () => {
    // 回归：favoritePathKey("D:\") 归一化后已带尾部反斜杠，范围前缀若再拼
    // path.sep 会变成 "d:\\"，任何收藏都匹配不到——根目录下「只看收藏」
    // 永远显示为空。
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-fav-"));
    temporaryDirectories.push(root);
    const sub = path.join(root, "art");
    await mkdir(sub);
    await writeFile(path.join(sub, "drive-fav.png"), Buffer.alloc(4));
    const { database, directory } = createService();
    const library = new LibraryService(database);
    try {
      const favorited = await library.materializePath(
        path.join(sub, "drive-fav.png"),
      );
      database.updateAsset(favorited.asset.id, { favorite: true });

      const driveRoot = path.parse(root).root; // 如 C:\
      const page = await directory.listDirectory(driveRoot, {
        favoritesOnly: true,
      });
      expect(page.entries.map((entry) => entry.name)).toContain("drive-fav.png");
      expect(page.total).toBeGreaterThanOrEqual(1);
    } finally {
      await directory.close?.();
      await library.close();
      database.close();
    }
  });

  it("搜索同样只返回收藏素材", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-fav-"));
    temporaryDirectories.push(root);
    await Promise.all([
      writeFile(path.join(root, "keep.png"), Buffer.alloc(4)),
      writeFile(path.join(root, "skip.png"), Buffer.alloc(4)),
    ]);
    const { database, directory } = createService();
    const library = new LibraryService(database);
    try {
      const keep = await library.materializePath(path.join(root, "keep.png"));
      database.updateAsset(keep.asset.id, { favorite: true });

      const completed = new Promise<void>((resolve) => {
        const unsubscribe = directory.onSearchProgress((snapshot) => {
          if (snapshot.state !== "completed") return;
          unsubscribe();
          resolve();
        });
      });
      const id = await directory.startSearch(root, "", { favoritesOnly: true });
      await completed;
      const snapshot = directory.getSearch(id)!;
      expect(snapshot.entries.map((entry) => entry.name)).toEqual(["keep.png"]);
      expect(snapshot.entries).toHaveLength(1);
    } finally {
      await directory.close?.();
      await library.close();
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

  it("allows tags to be applied after materialize", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const file = path.join(root, "concept.png");
    await writeFile(file, Buffer.alloc(64, 5));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const result = await service.materializePath(file);
      database.setAssetTags(result.asset.id, ["草图"]);
      const fresh = database.getAsset(result.asset.id)!;
      expect(fresh.tags).toEqual(["草图"]);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("materializes linked without ever copying the source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fs-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "linked.png");
    await writeFile(source, Buffer.alloc(512, 9));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database, undefined, {
      libraryRoot: root,
    });
    try {
      // 磁盘唯一真相：materialize 只建立 linked 引用索引，不复制源文件。
      const result = await service.materializePath(source);
      expect(result.created).toBe(true);
      expect(result.asset.path).toBe(source);
      // 源文件保持原位，未被复制或修改。
      expect((await stat(source)).size).toBe(512);
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
