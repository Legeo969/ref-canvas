import {
  mkdir,
  mkdtemp,
  stat,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import {
  fullFileHash,
  imageVisualSignature,
  LibraryService,
  quickFingerprint,
  visualSimilarity,
} from "../../../src/main/services/library-service";

const temporaryDirectories: string[] = [];

function waveFile(seconds: number): Buffer {
  const sampleRate = 8_000;
  const dataSize = sampleRate * 2 * seconds;
  const result = Buffer.alloc(44 + dataSize);
  result.write("RIFF", 0);
  result.writeUInt32LE(36 + dataSize, 4);
  result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write("data", 36);
  result.writeUInt32LE(dataSize, 40);
  return result;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("quickFingerprint", () => {
  it("scores identical visual signatures above unrelated signatures", () => {
    const same = {
      visualHash: "0f0f0f0f0f0f0f0f",
      colorSignature: Buffer.alloc(48, 80).toString("base64"),
    };
    const different = {
      visualHash: "f0f0f0f0f0f0f0f0",
      colorSignature: Buffer.alloc(48, 220).toString("base64"),
    };

    expect(visualSimilarity(same, same)).toBe(100);
    expect(visualSimilarity(same, different)).toBeLessThan(40);
  });

  it("indexes images incrementally and ranks resized copies as similar", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-similar-"));
    temporaryDirectories.push(directory);
    const first = path.join(directory, "first.png");
    const resized = path.join(directory, "resized.png");
    const different = path.join(directory, "different.png");
    const artwork = Buffer.from(`
      <svg width="96" height="72" xmlns="http://www.w3.org/2000/svg">
        <rect width="96" height="72" fill="#19364c"/>
        <circle cx="34" cy="32" r="20" fill="#e0a34b"/>
        <path d="M58 12 L88 58 L52 60 Z" fill="#70c8a0"/>
      </svg>
    `);
    await sharp(artwork).png().toFile(first);
    await sharp(artwork).resize(192, 144).png().toFile(resized);
    await sharp({
      create: {
        width: 96,
        height: 72,
        channels: 3,
        background: { r: 230, g: 230, b: 230 },
      },
    }).png().toFile(different);

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.importPaths([first, resized, different]);
      const completed = new Promise<void>((resolve) => {
        const unsubscribe = service.onSimilarityProgress((snapshot) => {
          if (snapshot.state !== "completed") return;
          unsubscribe();
          resolve();
        });
      });
      service.startSimilarityIndex();
      await completed;

      const source = database.getAssetByPath(first)!;
      const results = await service.findSimilar(source.id, {
        minScore: 80,
      });
      expect(results[0].asset.path).toBe(resized);
      expect(results[0].score).toBeGreaterThan(95);
      expect(
        visualSimilarity(
          await imageVisualSignature(first),
          await imageVisualSignature(resized),
        ),
      ).toBeGreaterThan(95);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("is stable for identical content", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const first = path.join(directory, "first.bin");
    const second = path.join(directory, "second.bin");
    const content = Buffer.alloc(160_000, 17);
    await Promise.all([writeFile(first, content), writeFile(second, content)]);

    await expect(quickFingerprint(first, content.length)).resolves.toBe(
      await quickFingerprint(second, content.length),
    );
  });

  it("detects changes at the end of a large file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const first = path.join(directory, "first.bin");
    const second = path.join(directory, "second.bin");
    const content = Buffer.alloc(160_000, 17);
    const changed = Buffer.from(content);
    changed[changed.length - 1] = 18;
    await Promise.all([writeFile(first, content), writeFile(second, changed)]);

    expect(await quickFingerprint(first, content.length)).not.toBe(
      await quickFingerprint(second, changed.length),
    );
  });

  it("repairs a moved asset by fingerprint without changing its id", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const originalDirectory = path.join(directory, "original");
    const movedDirectory = path.join(directory, "moved");
    await Promise.all([
      mkdir(originalDirectory),
      mkdir(movedDirectory),
    ]);
    const originalPath = path.join(originalDirectory, "mesh.obj");
    const movedPath = path.join(movedDirectory, "mesh.obj");
    await writeFile(originalPath, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.importPaths([originalPath]);
      const original = database.searchAssets().items[0];
      await rename(originalPath, movedPath);
      await service.refreshLinkStates();
      const result = await service.searchAndRelink(original.id, directory);

      expect(result.status).toBe("relinked");
      expect(result.asset.id).toBe(original.id);
      expect(result.asset.path).toBe(movedPath);
      expect(result.asset.linkState).toBe("online");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("preserves imported folder hierarchy and assigns files to leaf folders", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const root = path.join(directory, "Temple Project");
    const exterior = path.join(root, "Architecture", "Exterior");
    const interior = path.join(root, "Architecture", "Interior");
    await Promise.all([
      mkdir(exterior, { recursive: true }),
      mkdir(interior, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, "cover.png"), Buffer.alloc(32, 1)),
      writeFile(path.join(exterior, "gate.png"), Buffer.alloc(32, 2)),
      writeFile(path.join(interior, "hall.png"), Buffer.alloc(32, 3)),
    ]);

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const result = await service.importPaths([root]);
      const folders = database.listCollections();
      const project = folders.find((item) => item.title === "Temple Project")!;
      const architecture = folders.find(
        (item) => item.title === "Architecture" && item.parentId === project.id,
      )!;
      const exteriorFolder = folders.find(
        (item) => item.title === "Exterior" && item.parentId === architecture.id,
      )!;

      expect(result.imported).toBe(3);
      expect(project.assetCount).toBe(3);
      expect(project.directAssetCount).toBe(1);
      expect(
        database.searchAssets({ collectionId: exteriorFolder.id }).items[0].title,
      ).toBe("gate");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("nests an imported tree under a parent folder via parentFolderId", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-parent-"));
    temporaryDirectories.push(directory);
    const root = path.join(directory, "Inbox");
    const set = path.join(root, "Set A");
    const setB = path.join(root, "Set B");
    await Promise.all([
      mkdir(set, { recursive: true }),
      mkdir(setB, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(set, "a.png"), Buffer.alloc(32, 1)),
      writeFile(path.join(setB, "b.png"), Buffer.alloc(32, 2)),
    ]);

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const target = database.createCollection("收件箱");
      await service.importPaths([root], {
        hierarchyMode: "collections",
        parentFolderId: target.id,
      });
      const folders = database.listCollections();
      const inbox = folders.find((item) => item.id === target.id)!;
      // 源目录根名（Inbox）作为收件箱的第一个子文件夹，Set A/B 挂在其下。
      const rootFolder = folders.find(
        (item) => item.title === "Inbox" && item.parentId === inbox.id,
      )!;
      const setAFolder = folders.find(
        (item) => item.title === "Set A" && item.parentId === rootFolder.id,
      )!;
      const setBFolder = folders.find(
        (item) => item.title === "Set B" && item.parentId === rootFolder.id,
      )!;
      expect(setAFolder.assetCount).toBe(1);
      expect(setBFolder.assetCount).toBe(1);
      expect(rootFolder.assetCount).toBe(2);
      expect(rootFolder.directAssetCount).toBe(0);
      expect(inbox.assetCount).toBe(2);
      expect(inbox.directAssetCount).toBe(0);
      expect(database.searchAssets({ collectionId: setAFolder.id }).items[0].title).toBe("a");
      expect(
        database.searchAssets({
          collectionId: setBFolder.id,
          includeSubcollections: false,
        }).items[0].title,
      ).toBe("b");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("fails a parentFolderId import when the folder was deleted", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-parent-"));
    temporaryDirectories.push(directory);
    const root = path.join(directory, "Missing Parent");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "a.png"), Buffer.alloc(32, 1));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const result = await service.importPaths([root], {
        parentFolderId: "00000000-0000-4000-8000-000000000000",
      });
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].reason).toBe("COLLECTION_PARENT_NOT_FOUND");
      expect(database.listCollections()).toHaveLength(0);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("extracts media duration, invalidates changed files, and rebuilds old metadata", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-media-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "voice.wav");
    await writeFile(filename, waveFile(1));
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.importPaths([filename]);
      expect(database.getAssetByPath(filename)?.duration).toBeCloseTo(1, 2);

      await writeFile(filename, waveFile(2));
      await service.importPaths([filename]);
      expect(database.getAssetByPath(filename)?.duration).toBeCloseTo(2, 2);

      const completed = new Promise<void>((resolve) => {
        const unsubscribe = service.onMediaMetadataProgress((snapshot) => {
          if (snapshot.state !== "completed") return;
          unsubscribe();
          resolve();
        });
      });
      expect(service.startMediaMetadataRebuild()).toMatchObject({
        state: "running",
        total: 1,
      });
      await completed;
      expect(service.getMediaMetadataRebuild()).toMatchObject({
        state: "completed",
        processed: 1,
        updated: 1,
        failed: 0,
      });
    } finally {
      await service.close();
      database.close();
    }
  });

  it("starts the first watched folder immediately and can stop watching it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-watch-"));
    temporaryDirectories.push(directory);
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      await service.addWatchRoot(directory);
      const first = path.join(directory, "first.png");
      await writeFile(first, Buffer.alloc(64, 7));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (database.getAssetByPath(first)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(database.getAssetByPath(first)).not.toBeNull();

      const root = database.listWatchRoots()[0];
      await service.removeWatchRoot(root.id);
      const second = path.join(directory, "second.png");
      await writeFile(second, Buffer.alloc(64, 8));
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(database.listWatchRoots()).toHaveLength(0);
      expect(database.getAssetByPath(first)).not.toBeNull();
      expect(database.getAssetByPath(second)).toBeNull();
    } finally {
      await service.close();
      database.close();
    }
  });

  it("moves source files to the managed trash and restores without overwriting", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const source = path.join(directory, "reference.png");
    const conflicting = path.join(directory, "reference (restored 1).png");
    const trashRoot = path.join(directory, "trash");
    await writeFile(source, Buffer.alloc(128, 4));

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database, trashRoot);
    try {
      await service.importPaths([source]);
      const asset = database.searchAssets().items[0];
      await service.trashAssets({ mode: "ids", ids: [asset.id] });
      const trashed = database.getAsset(asset.id)!;

      await expect(stat(source)).rejects.toThrow();
      await expect(stat(trashed.trashPath!)).resolves.toBeDefined();

      await writeFile(source, Buffer.alloc(32, 7));
      await writeFile(conflicting, Buffer.alloc(32, 8));
      await service.restoreAssets([asset.id]);
      const restored = database.getAsset(asset.id)!;

      expect(restored.lifecycle).toBe("active");
      expect(restored.path).toBe(path.join(directory, "reference (restored 2).png"));
      await expect(stat(restored.path)).resolves.toBeDefined();
    } finally {
      await service.close();
      database.close();
    }
  });

  it("forgets a trashed record without deleting its file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const source = path.join(directory, "keep.png");
    const trashRoot = path.join(directory, "trash");
    await writeFile(source, Buffer.alloc(128, 6));

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database, trashRoot);
    try {
      await service.importPaths([source]);
      const asset = database.searchAssets().items[0];
      await service.trashAssets({ mode: "ids", ids: [asset.id] });
      const trashPath = database.getAsset(asset.id)!.trashPath!;

      await expect(service.forgetTrashedAssets([asset.id])).resolves.toBe(1);
      expect(database.getAsset(asset.id)).toBeNull();
      await expect(stat(trashPath)).resolves.toBeDefined();
    } finally {
      await service.close();
      database.close();
    }
  });

  it("does not treat a quick fingerprint collision as an exact duplicate", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const first = path.join(directory, "first.png");
    const second = path.join(directory, "second.png");
    const firstContent = Buffer.alloc(200_000, 3);
    const secondContent = Buffer.from(firstContent);
    secondContent.fill(9, 80_000, 120_000);
    await Promise.all([
      writeFile(first, firstContent),
      writeFile(second, secondContent),
    ]);

    expect(await quickFingerprint(first, firstContent.length)).toBe(
      await quickFingerprint(second, secondContent.length),
    );
    expect(await fullFileHash(first)).not.toBe(await fullFileHash(second));

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database, path.join(directory, "trash"));
    try {
      await service.importPaths([first, second]);
      await expect(service.findDuplicates()).resolves.toEqual([]);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("merges exact duplicates, rewrites board references, and trashes extra files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-"));
    temporaryDirectories.push(directory);
    const firstPath = path.join(directory, "first.png");
    const secondPath = path.join(directory, "second.png");
    const trashRoot = path.join(directory, "trash");
    const content = Buffer.alloc(1_024, 11);
    await Promise.all([
      writeFile(firstPath, content),
      writeFile(secondPath, content),
    ]);

    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database, trashRoot);
    try {
      await service.importPaths([firstPath, secondPath]);
      const [first, second] = database.searchAssets({
        sort: "title",
        direction: "asc",
      }).items;
      const board = database.createBoard("Duplicate board");
      database.saveBoard(board.id, {
        schemaVersion: 1,
        canvas: {
          objects: [
            {
              src: `refasset://asset/${second.id}`,
              data: { type: "asset", assetId: second.id },
            },
          ],
        },
      });
      const groups = await service.findDuplicates();
      await service.mergeDuplicates(first.id, [second.id]);

      expect(groups).toHaveLength(1);
      expect(database.getAsset(second.id)?.lifecycle).toBe("trashed");
      expect(database.getAssetReferences(first.id)).toHaveLength(1);
      await expect(stat(secondPath)).rejects.toThrow();
      await expect(stat(database.getAsset(second.id)!.trashPath!)).resolves.toBeDefined();
    } finally {
      await service.close();
      database.close();
    }
  });
});
