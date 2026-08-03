import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import {
  LibraryManager,
  databasePathFor,
  managedStorePath,
} from "../../../src/main/services/library-manager";
import { LibraryService, fullFileHash } from "../../../src/main/services/library-service";

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

async function setupManagedLibrary(): Promise<{
  entry: Awaited<ReturnType<LibraryManager["create"]>>;
  service: LibraryService;
  db: RefCanvasDatabase;
  base: string;
}> {
  const userData = await tempDirectory("refcanvas-registry-");
  const manager = new LibraryManager(userData);
  await manager.initialize();
  await manager.bootstrapLegacy();
  const base = await tempDirectory("refcanvas-dual-");
  const entry = await manager.create({
    name: "Dual",
    directory: path.join(base, "lib"),
  });
  const db = new RefCanvasDatabase(databasePathFor(entry));
  const service = new LibraryService(
    db,
    path.join(entry.root, "trash", "files"),
    { libraryRoot: entry.root, defaultStorageMode: "managed" },
  );
  return { entry, service, db, base };
}

describe("dual-mode library service", () => {
  it("imports managed files with hash-verified copies and original path kept", async () => {
    const { entry, service, db, base } = await setupManagedLibrary();
    const source = path.join(base, "photo.png");
    await writeFile(source, Buffer.alloc(1_024, 5));
    try {
      const result = await service.importPaths([source]);
      const asset = db.searchAssets().items[0];

      expect(result.imported).toBe(1);
      expect(result.copied).toBe(1);
      expect(result.verified).toBe(1);
      expect(asset.storageMode).toBe("managed");
      expect(asset.originalSourcePath).toBe(source);
      expect(asset.path.startsWith(managedStorePath(entry.root))).toBe(true);
      expect(asset.libraryRelativePath).toMatch(/^files[\\/]/);
      expect(asset.contentHash).toBe(await fullFileHash(source));
      await expect(stat(source)).resolves.toBeDefined();
    } finally {
      await service.close();
      db.close();
    }
  });

  it("re-importing identical content reuses the managed copy", async () => {
    const { entry, service, db, base } = await setupManagedLibrary();
    const source = path.join(base, "photo.png");
    const secondSource = path.join(base, "copy.png");
    const content = Buffer.alloc(2_048, 8);
    await Promise.all([
      writeFile(source, content),
      writeFile(secondSource, content),
    ]);
    try {
      await service.importPaths([source]);
      const result = await service.importPaths([secondSource]);
      expect(result.imported).toBe(0);
      expect(result.reused).toBe(1);
      expect(db.searchAssets().items).toHaveLength(1);
      const storeFiles = await readdir(managedStorePath(entry.root));
      expect(storeFiles).toHaveLength(1);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("keeps linked sources untouched on import and on removal", async () => {
    const userData = await tempDirectory("refcanvas-registry-");
    const manager = new LibraryManager(userData);
    await manager.initialize();
    await manager.bootstrapLegacy();
    const legacy = manager.current()!;
    const db = new RefCanvasDatabase(databasePathFor(legacy));
    const service = new LibraryService(db, path.join(legacy.root, "trash", "files"), {
      libraryRoot: legacy.root,
      defaultStorageMode: "linked",
    });
    const source = path.join(await tempDirectory("refcanvas-linked-"), "art.png");
    const content = Buffer.alloc(640, 2);
    await writeFile(source, content);
    try {
      const result = await service.importPaths([source]);
      const asset = db.searchAssets().items[0];
      expect(result.imported).toBe(1);
      expect(asset.storageMode).toBe("linked");
      expect(asset.path).toBe(source);
      expect(asset.originalSourcePath).toBeNull();

      await service.removeFromLibrary({ mode: "ids", ids: [asset.id] });
      // Linked source file must never be modified.
      await expect(stat(source)).resolves.toBeDefined();
      expect(
        db.searchAssets({ lifecycle: "active" }).items,
      ).toHaveLength(0);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("removeFromLibrary deletes managed store files but not the record when referenced", async () => {
    const { service, db, base } = await setupManagedLibrary();
    const source = path.join(base, "kept.png");
    await writeFile(source, Buffer.alloc(300, 6));
    try {
      await service.importPaths([source]);
      const asset = db.searchAssets().items[0];
      const storeFile = asset.path;
      // Reference it from a board so the record must survive as purged.
      const board = db.createBoard("Ref board");
      db.saveBoard(board.id, {
        schemaVersion: 1,
        canvas: {
          objects: [
            {
              src: `refasset://asset/${asset.id}`,
              data: { type: "asset", assetId: asset.id },
            },
          ],
        },
      });

      await service.removeFromLibrary({ mode: "ids", ids: [asset.id] });
      const after = db.getAsset(asset.id)!;
      expect(after.lifecycle).toBe("purged");
      // The managed copy is deleted because the record is purged, not trashed.
      await expect(stat(storeFile)).rejects.toThrow();
      expect(db.getAssetReferences(asset.id)).toHaveLength(1);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("trash keeps the managed file in the library trash for restore", async () => {
    const { service, db, base } = await setupManagedLibrary();
    const source = path.join(base, "trashme.png");
    await writeFile(source, Buffer.alloc(400, 4));
    try {
      await service.importPaths([source]);
      const asset = db.searchAssets().items[0];
      const storeFile = asset.path;

      await service.trashAssets({ mode: "ids", ids: [asset.id] });
      const trashed = db.getAsset(asset.id)!;
      expect(trashed.lifecycle).toBe("trashed");
      await expect(stat(storeFile)).rejects.toThrow();
      await expect(stat(trashed.trashPath!)).resolves.toBeDefined();

      await service.restoreAssets([asset.id]);
      const restored = db.getAsset(asset.id)!;
      expect(restored.lifecycle).toBe("active");
      expect(restored.storageMode).toBe("managed");
      await expect(stat(restored.path)).resolves.toBeDefined();
    } finally {
      await service.close();
      db.close();
    }
  });

  it("reconciles an offline cross-directory move by fingerprint and relinks", async () => {
    const userData = await tempDirectory("refcanvas-registry-");
    const manager = new LibraryManager(userData);
    await manager.initialize();
    await manager.bootstrapLegacy();
    const legacy = manager.current()!;
    const db = new RefCanvasDatabase(databasePathFor(legacy));
    const service = new LibraryService(db, path.join(legacy.root, "trash", "files"), {
      libraryRoot: legacy.root,
      defaultStorageMode: "linked",
    });
    const base = await tempDirectory("refcanvas-watch-");
    const watchRoot = path.join(base, "watch");
    const movedDir = path.join(watchRoot, "moved");
    await mkdir(watchRoot, { recursive: true });
    await mkdir(movedDir, { recursive: true });
    const originalPath = path.join(watchRoot, "concept.png");
    const movedPath = path.join(movedDir, "renamed.png");
    await writeFile(originalPath, Buffer.alloc(1_280, 9));
    try {
      // Register the watch root without starting the live watcher, so the
      // offline-move scenario is deterministic.
      db.addWatchRoot(watchRoot);
      await service.importPaths([originalPath]);
      const asset = db.getAssetByPath(originalPath)!;

      // Simulate a move that happened while the app was closed: the identity
      // index still points at the old path and the new path is under the root.
      await rename(originalPath, movedPath);
      const report = await service.reconcileRoots();

      expect(report.relinked).toBeGreaterThanOrEqual(1);
      const after = db.getAsset(asset.id)!;
      expect(after.path).toBe(movedPath);
      expect(after.linkState).toBe("online");
      expect(db.getAssetByPath(originalPath)).toBeNull();
      expect(
        db.searchAssets({ lifecycle: "active" }).items,
      ).toHaveLength(1);
    } finally {
      await service.close();
      db.close();
    }
  });

  it("parks ambiguous moves in the reconcile queue and resolves them by choice", async () => {
    const userData = await tempDirectory("refcanvas-registry-");
    const manager = new LibraryManager(userData);
    await manager.initialize();
    await manager.bootstrapLegacy();
    const legacy = manager.current()!;
    const db = new RefCanvasDatabase(databasePathFor(legacy));
    const service = new LibraryService(db, path.join(legacy.root, "trash", "files"), {
      libraryRoot: legacy.root,
      defaultStorageMode: "linked",
    });
    const base = await tempDirectory("refcanvas-ambig-");
    const watchRoot = path.join(base, "watch");
    const subA = path.join(watchRoot, "a");
    const subB = path.join(watchRoot, "b");
    await mkdir(watchRoot, { recursive: true });
    await Promise.all([mkdir(subA), mkdir(subB)]);
    const content = Buffer.alloc(2_560, 3);
    const originalPath = path.join(watchRoot, "scene.png");
    const candidateA = path.join(subA, "scene.png");
    const candidateB = path.join(subB, "scene.png");
    await writeFile(originalPath, content);
    try {
      db.addWatchRoot(watchRoot);
      await service.importPaths([originalPath]);
      const asset = db.getAssetByPath(originalPath)!;

      // The file moves to a/ while an identical copy lands in b/ — two
      // fingerprint candidates, so the move is ambiguous.
      await rename(originalPath, candidateA);
      await writeFile(candidateB, content);
      const report = await service.reconcileRoots();

      expect(report.ambiguous).toBeGreaterThanOrEqual(1);
      expect(report.missing).toBe(0);
      const snapshot = service.getReconcileSnapshot();
      const entry = snapshot.pending.find((item) => item.assetId === asset.id);
      expect(entry).toBeDefined();

      // User picks the entry they recognize; the chosen file becomes the path.
      const resolved = await service.resolveReconcileConflict(
        entry!.id,
        asset.id,
      );
      expect(resolved.id).toBe(asset.id);
      expect(resolved.path).toBe(entry!.filename);
      expect(resolved.linkState).toBe("online");
      const afterResolve = service.getReconcileSnapshot();
      expect(
        afterResolve.pending.some((item) => item.id === entry!.id),
      ).toBe(false);
    } finally {
      await service.close();
      db.close();
    }
  });
});
