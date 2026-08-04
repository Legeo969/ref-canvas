import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import {
  LibraryManager,
  databasePathFor,
  managedStorePath,
} from "../../../src/main/services/library-manager";
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

async function makeManager(): Promise<LibraryManager> {
  const userData = await tempDirectory("refcanvas-registry-");
  const manager = new LibraryManager(userData);
  await manager.initialize();
  await manager.bootstrapLegacy();
  return manager;
}

/** 直接构造存量 managed 资产（store 文件 + DB 记录），不依赖运行时导入。 */
async function seedManaged(
  entry: { root: string },
  db: RefCanvasDatabase,
  name: string,
  content: Buffer,
): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  const store = managedStorePath(entry.root);
  await mkdir(store, { recursive: true });
  const hash = createHash("sha256").update(content).digest("hex");
  const storePath = path.join(store, `${hash}.png`);
  await writeFile(storePath, content);
  db.upsertAsset({
    title: name,
    kind: "image",
    path: storePath,
    pathKey: storePath.toLocaleLowerCase("en-US"),
    extension: "png",
    size: content.length,
    mtimeMs: 1,
    fingerprint: `fp-${hash}`,
    linkState: "online",
    notes: "",
    width: 1,
    height: 1,
    duration: null,
    contentHash: hash,
    storageMode: "managed",
    libraryRelativePath: `${hash}.png`,
    originalSourcePath: `C:\\original\\${name}.png`,
  });
  return storePath;
}

describe("LibraryManager", () => {
  it("bootstraps the legacy data directory as the linked default library", async () => {
    const manager = await makeManager();
    const current = manager.current()!;
    expect(current.legacy).toBe(true);
    expect(current.defaultStorageMode).toBe("linked");
    expect(current.isActive).toBe(true);
  });

  it("keeps the legacy library active after the registry is loaded again", async () => {
    const userData = await tempDirectory("refcanvas-registry-restart-");
    const first = new LibraryManager(userData);
    await first.initialize();
    const initial = await first.bootstrapLegacy();

    const restarted = new LibraryManager(userData);
    await restarted.initialize();
    const reopened = await restarted.bootstrapLegacy();

    expect(reopened.id).toBe(initial.id);
    expect(restarted.current()?.id).toBe(initial.id);
    expect(restarted.list()).toHaveLength(1);
  });

  it("creates a self-contained linked-default library with a manifest and database", async () => {
    const manager = await makeManager();
    const target = await tempDirectory("refcanvas-create-");
    const directory = path.join(target, "My Library");
    const entry = await manager.create({ name: "My Library", directory });

    expect(entry.defaultStorageMode).toBe("linked");
    expect(entry.legacy).toBe(false);
    const manifest = JSON.parse(
      await readFile(path.join(entry.root, "refcanvas.library.json"), "utf8"),
    );
    expect(manifest.format).toBe("refcanvas-library");
    expect(manifest.name).toBe("My Library");

    const db = new RefCanvasDatabase(databasePathFor(entry));
    try {
      expect(db.getSchemaVersion()).toBe(14);
      expect(db.listBoards()).toHaveLength(1);
    } finally {
      db.close();
    }
    // Opening the directory again reuses the same id instead of duplicating.
    const reopened = await manager.open(entry.root);
    expect(reopened.id).toBe(entry.id);
    expect(manager.list()).toHaveLength(2);
  });

  it("moves a library directory and verifies the registry follows", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-move-");
    const created = await manager.create({
      name: "Movable",
      directory: path.join(base, "source"),
    });
    const movedTo = path.join(base, "moved");
    const moved = await manager.move(created.id, movedTo);

    expect(moved.root).toBe(movedTo);
    expect(manager.getEntry(created.id).root).toBe(movedTo);
    // The manifest and database travelled with the directory.
    await expect(
      readFile(path.join(movedTo, "refcanvas.library.json")),
    ).resolves.toBeDefined();
    await expect(readFile(databasePathFor(moved))).resolves.toBeDefined();
  });

  it("reports databaseBytes as a numeric file size", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-size-");
    const entry = await manager.create({
      name: "Sized",
      directory: path.join(base, "lib"),
    });

    const summary = await manager.describe(entry.id);
    expect(typeof summary.databaseBytes).toBe("number");
    expect(summary.databaseBytes).toBeGreaterThan(0);
  });

  it("verify reports integrity, managed files and missing files", async () => {
    const manager = await makeManager();
    const directory = await tempDirectory("refcanvas-verify-");
    const entry = await manager.create({
      name: "Verify me",
      directory: path.join(directory, "lib"),
    });
    const db = new RefCanvasDatabase(databasePathFor(entry));
    const service = new LibraryService(
      db,
      path.join(entry.root, "trash", "files"),
      { libraryRoot: entry.root, defaultStorageMode: "linked" },
    );
    try {
      await seedManaged(entry, db, "photo", Buffer.alloc(256, 5));
      const report = await manager.verify(entry.id);
      expect(report.integrityOk).toBe(true);
      expect(report.assets).toBe(1);
      expect(report.managedFiles).toBe(1);
      expect(report.managedMissing).toBe(0);
      expect(report.orphanFiles).toBe(0);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("exportLibrary copies the database and the managed store", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-export-");
    const entry = await manager.create({
      name: "Exporter",
      directory: path.join(base, "lib"),
    });
    const db = new RefCanvasDatabase(databasePathFor(entry));
    const service = new LibraryService(
      db,
      path.join(entry.root, "trash", "files"),
      { libraryRoot: entry.root, defaultStorageMode: "linked" },
    );
    try {
      await seedManaged(entry, db, "sample", Buffer.alloc(128, 9));
      const destination = path.join(base, "exported");
      const report = await manager.exportLibrary(entry.id, destination);

      expect(report.assets).toBe(1);
      expect(report.files).toBe(1);
      await expect(
        readFile(path.join(destination, "data", "refcanvas.db")),
      ).resolves.toBeDefined();
      const exportedDb = new RefCanvasDatabase(
        path.join(destination, "data", "refcanvas.db"),
      );
      try {
        expect(exportedDb.getLibraryStats().total).toBe(1);
      } finally {
        exportedDb.close();
      }
      const storeFiles = await readdirStore(destination);
      expect(storeFiles).toHaveLength(1);
      // The exported library reopens and shows the same asset.
      const reopened = await manager.open(destination);
      expect(reopened.id).toBe(entry.id);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("rolls back database rows and copied files when a merge step fails", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-merge-rollback-");
    const sourceEntry = await manager.create({
      name: "Rollback source",
      directory: path.join(base, "source"),
    });
    const targetEntry = await manager.create({
      name: "Rollback target",
      directory: path.join(base, "target"),
    });
    const sourceDb = new RefCanvasDatabase(databasePathFor(sourceEntry));
    const sourceService = new LibraryService(
      sourceDb,
      path.join(sourceEntry.root, "trash", "files"),
      { libraryRoot: sourceEntry.root, defaultStorageMode: "managed" },
    );
    const first = path.join(base, "first.png");
    const second = path.join(base, "second.png");
    await writeFile(first, Buffer.alloc(128, 1));
    await writeFile(second, Buffer.alloc(128, 2));
    await sourceService.importPaths([first, second]);
    await sourceService.close();
    sourceDb.close();

    const originalInsert = RefCanvasDatabase.prototype.insertAssetWithId;
    let inserts = 0;
    const insertSpy = vi
      .spyOn(RefCanvasDatabase.prototype, "insertAssetWithId")
      .mockImplementation(function (
        this: RefCanvasDatabase,
        id,
        asset,
      ) {
        inserts += 1;
        if (inserts === 2) throw new Error("INJECTED_MERGE_FAILURE");
        return originalInsert.call(this, id, asset);
      });
    try {
      await expect(
        manager.merge(sourceEntry.id, targetEntry.id),
      ).rejects.toThrow("INJECTED_MERGE_FAILURE");
    } finally {
      insertSpy.mockRestore();
    }

    const restored = new RefCanvasDatabase(databasePathFor(targetEntry));
    try {
      expect(restored.getLibraryStats().total).toBe(0);
      expect(await readdirStore(targetEntry.root)).toEqual([]);
    } finally {
      restored.close();
    }
  });

  it("merges two libraries, deduplicating identical content and copying new files", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-merge-");
    const sourceEntry = await manager.create({
      name: "Source",
      directory: path.join(base, "source"),
    });
    const targetEntry = await manager.create({
      name: "Target",
      directory: path.join(base, "target"),
    });
    const sourceDb = new RefCanvasDatabase(databasePathFor(sourceEntry));
    const sourceService = new LibraryService(sourceDb, path.join(sourceEntry.root, "trash", "files"), {
      libraryRoot: sourceEntry.root,
      defaultStorageMode: "linked",
    });
    const targetDb = new RefCanvasDatabase(databasePathFor(targetEntry));
    const targetService = new LibraryService(targetDb, path.join(targetEntry.root, "trash", "files"), {
      libraryRoot: targetEntry.root,
      defaultStorageMode: "linked",
    });
    const shared = Buffer.alloc(512, 3);
    const unique = Buffer.alloc(512, 7);
    try {
      // 直接构造存量 managed 资产：共享内容 + 唯一内容。
      await seedManaged(sourceEntry, sourceDb, "shared", shared);
      await seedManaged(sourceEntry, sourceDb, "unique", unique);
      await seedManaged(targetEntry, targetDb, "shared", shared);

      const report = await manager.merge(sourceEntry.id, targetEntry.id);
      expect(report.mergedAssets).toBe(1);
      expect(report.deduplicated).toBe(1);
      expect(report.copiedFiles).toBe(1);
      expect(report.conflicts).toEqual([]);

      const targetStats = targetDb.getLibraryStats();
      expect(targetStats.total).toBe(2);
      // The store has one copy of the shared file (dedupe) plus the unique one.
      const storeFiles = await readdirStore(targetEntry.root);
      expect(storeFiles).toHaveLength(2);
      await expect(readFile(report.logFile!)).resolves.toBeDefined();
    } finally {
      await sourceService.close();
      await targetService.close();
      sourceDb.close();
      targetDb.close();
    }
  });

  it("refuses to move a library inside itself", async () => {
    const manager = await makeManager();
    const base = await tempDirectory("refcanvas-cycle-");
    const entry = await manager.create({
      name: "Cyclic",
      directory: path.join(base, "lib"),
    });
    await expect(
      manager.move(entry.id, path.join(entry.root, "nested")),
    ).rejects.toThrow("LIBRARY_MOVE_INVALID");
  });
});

async function readdirStore(root: string): Promise<string[]> {
  const store = managedStorePath(root);
  return import("node:fs/promises").then((fs) =>
    fs.readdir(store).catch(() => [] as string[]),
  );
}
