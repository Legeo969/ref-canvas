import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { globMatch, LibraryService } from "../../../src/main/services/library-service";

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

async function waveFile(filename: string, seconds = 4): Promise<string> {
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
  // Beat pulses every 0.5 s → 120 BPM.
  for (let beat = 0; beat < seconds * 2; beat += 1) {
    const start = 44 + beat * sampleRate;
    for (let index = 0; index < 1_000; index += 1) {
      const offset = start + index * 2;
      result.writeInt16LE(12_000, offset);
    }
  }
  await writeFile(filename, result);
  return filename;
}

describe("eagle management", () => {
  it("v9 migration adds BPM, custom fields, tag metadata and lock columns", async () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      expect(database.getSchemaVersion()).toBe(14);
      const columns = database
        .listActiveAssets()
        .length === 0
        ? []
        : [];
      expect(columns).toEqual([]);
      // Exercise the migration artifacts directly.
      database.upsertAsset({
        title: "tagged",
        kind: "image",
        path: "D:\\t.png",
        pathKey: "d:\\t.png",
        extension: "png",
        size: 1,
        mtimeMs: 1,
        fingerprint: "f",
        linkState: "online",
        notes: "",
        width: 1,
        height: 1,
        duration: null,
      });
      database.setAssetTags(database.searchAssets().items[0].id, ["concept"]);
      const tag = database.listTags().find((item) => item.name === "concept")!;
      expect(database.updateTagMeta(tag.id, { alias: "ref" }).alias).toBe("ref");
      expect(database.listTags()[0].alias).toBe("ref");
      const collection = database.createCollection("Locked");
      expect(database.setFolderLock(collection.id, "secret")).toEqual({
        collectionId: collection.id,
        locked: true,
      });
      expect(database.isFolderUnlocked(collection.id)).toBe(false);
      expect(database.unlockFolder(collection.id, "wrong")).toBe(false);
      expect(database.unlockFolder(collection.id, "secret")).toBe(true);
      expect(database.isFolderUnlocked(collection.id)).toBe(true);
      // Locked flag is still visible even after session unlock.
      expect(
        database.listCollections().find((item) => item.id === collection.id)
          ?.locked,
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("searches boolean tags, exclusions, paths, BPM, aspect ratio and custom fields", async () => {
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const directory = await tempDirectory("refcanvas-search-");
      const conceptPath = path.join(directory, "concept.png");
      const bgPath = path.join(directory, "bg.png");
      await Promise.all([
        writeFile(conceptPath, Buffer.alloc(64, 1)),
        writeFile(bgPath, Buffer.alloc(64, 2)),
      ]);
      await service.importPaths([conceptPath, bgPath]);
      // Title sort (asc): "bg" < "concept".
      const [background, concept] = database.searchAssets({
        sort: "title",
        direction: "asc",
      }).items;
      database.setAssetTags(concept.id, ["concept", "hero"]);
      database.setAssetTags(background.id, ["concept"]);
      database.updateAsset(background.id, { notes: "backdrop" });

      // Boolean AND.
      expect(
        database.searchAssets({ includeTags: ["concept", "hero"] }).items,
      ).toHaveLength(1);
      expect(
        database.searchAssets({ includeTags: ["concept"] }).items,
      ).toHaveLength(2);
      // Exclusion.
      expect(
        database.searchAssets({ excludeTags: ["hero"] }).items,
      ).toHaveLength(1);
      // Path substring.
      expect(
        database.searchAssets({ pathContains: "refcanvas-search" }).items,
      ).toHaveLength(2);
      // Filename substring.
      expect(
        database.searchAssets({ filenameContains: "bg" }).items[0].id,
      ).toBe(background.id);
      // Notes substring.
      expect(
        database.searchAssets({ notesContains: "backdrop" }).items[0].id,
      ).toBe(background.id);
      // Tag alias matches name-based search.
      const heroTag = database.listTags().find((tag) => tag.name === "hero")!;
      database.updateTagMeta(heroTag.id, { alias: "主图" });
      expect(database.searchAssets({ tag: "主图" }).items).toHaveLength(1);

      // BPM condition (audio).
      const audioPath = path.join(directory, "beat.wav");
      await waveFile(audioPath);
      await service.importPaths([audioPath]);
      const audio = database.getAssetByPath(audioPath)!;
      expect(audio.kind).toBe("audio");
      expect(audio.bpm).not.toBeNull();
      // Discrete lag quantization gives ±~3 BPM around the true 120 BPM.
      expect(audio.bpm!).toBeGreaterThan(110);
      expect(audio.bpm!).toBeLessThan(130);
      expect(
        database.searchAssets({ minBpm: 110, maxBpm: 130 })
          .items.map((item) => item.id),
      ).toContain(audio.id);

      // Exact aspect ratio.
      database.setVisualSignature(concept.id, "x", "y", { r: 1, g: 1, b: 1 });
      expect(
        database.searchAssets({ exactAspectRatio: "16:9" }).items,
      ).toBeInstanceOf(Array);

      // Custom field condition.
      const fieldsPath = path.join(directory, "field.png");
      await writeFile(fieldsPath, Buffer.alloc(32, 5));
      await service.importPaths([fieldsPath]);
      const fieldAsset = database.getAssetByPath(fieldsPath)!;
      database.setCustomThumbnail(fieldAsset.id, null);
      database.setAssetTags(fieldAsset.id, ["custom"]);
      expect(
        database.searchAssets({ customFields: [{ key: "missing", value: "x" }] })
          .items,
      ).toEqual([]);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("imports fonts and generic files with the right kinds", async () => {
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const directory = await tempDirectory("refcanvas-kinds-");
      const fontPath = path.join(directory, "Inter.ttf");
      const genericPath = path.join(directory, "notes.txt");
      await Promise.all([
        writeFile(fontPath, Buffer.alloc(128, 3)),
        writeFile(genericPath, "plain text\n"),
      ]);
      const result = await service.importPaths([fontPath, genericPath]);
      expect(result.imported).toBe(2);
      const byTitle = Object.fromEntries(
        database.searchAssets().items.map((item) => [item.title, item.kind]),
      );
      expect(byTitle["Inter"]).toBe("font");
      expect(byTitle["notes"]).toBe("generic");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("applies auto-tag rules by filename, path and extension", async () => {
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const directory = await tempDirectory("refcanvas-rules-");
      const concept = path.join(directory, "concept_v2.png");
      const bg = path.join(directory, "bg.png");
      await Promise.all([
        writeFile(concept, Buffer.alloc(32, 1)),
        writeFile(bg, Buffer.alloc(32, 2)),
      ]);
      await service.importPaths([concept, bg]);

      database.createAutoTagRule({
        name: "concept files",
        filenamePattern: "*concept*",
        pathPattern: null,
        extension: "png",
        tags: ["概念设计"],
        enabled: true,
      });
      database.createAutoTagRule({
        name: "any png",
        filenamePattern: null,
        pathPattern: null,
        extension: "png",
        tags: ["位图"],
        enabled: true,
      });
      database.createAutoTagRule({
        name: "disabled",
        filenamePattern: "*",
        pathPattern: null,
        extension: null,
        tags: ["不应出现"],
        enabled: false,
      });

      const tagged = await service.applyAutoTagRules();
      expect(tagged).toBe(2);
      const conceptAsset = database.getAssetByPath(concept)!;
      const bgAsset = database.getAssetByPath(bg)!;
      expect(conceptAsset.tags).toEqual(
        expect.arrayContaining(["概念设计", "位图"]),
      );
      expect(bgAsset.tags).toEqual(["位图"]);
      expect(conceptAsset.tags).not.toContain("不应出现");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("supports smart folder editing, duplication and custom thumbnails", async () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      const view = database.saveView("Heroes", { favorite: true });
      const renamed = database.updateSavedView(view.id, {
        title: "Favorites",
        search: { ratingMin: 4 },
      });
      expect(renamed.title).toBe("Favorites");
      expect(renamed.search.ratingMin).toBe(4);
      const copy = database.duplicateSavedView(view.id);
      expect(copy.title).toBe("Favorites 副本");
      expect(database.listSavedViews()).toHaveLength(2);

      const asset = database.upsertAsset({
        title: "custom",
        kind: "image",
        path: "D:\\c.png",
        pathKey: "d:\\c.png",
        extension: "png",
        size: 10,
        mtimeMs: 1,
        fingerprint: "f",
        linkState: "online",
        notes: "",
        width: 10,
        height: 10,
        duration: null,
      }).asset;
      const updated = database.setCustomThumbnail(asset.id, "D:\\thumb.png");
      expect(updated.customThumbnailPath).toBe("D:\\thumb.png");
      expect(database.getAsset(asset.id)!.customThumbnailPath).toBe(
        "D:\\thumb.png",
      );
    } finally {
      database.close();
    }
  });

  it("globMatch handles *, ? and case-insensitivity", () => {
    expect(globMatch("*concept*", "concept_v2.png")).toBe(true);
    expect(globMatch("*concept*", "background.png")).toBe(false);
    expect(globMatch("scene?.png", "scene1.png")).toBe(true);
    expect(globMatch("scene?.png", "scene12.png")).toBe(false);
    expect(globMatch("*FINALE*", "finale_v3.png")).toBe(true);
  });

  it("batchCollections creates, moves and reorders folders", async () => {
    const database = new RefCanvasDatabase(":memory:");
    try {
      database.batchCollections({ create: ["A", "B", "C"] });
      const created = database.listCollections();
      expect(created).toHaveLength(3);
      const a = created.find((item) => item.title === "A")!;
      const b = created.find((item) => item.title === "B")!;
      database.batchCollections({
        move: [{ id: b.id, parentId: a.id }],
        reorder: created.map((item, index) => ({
          id: item.id,
          sortOrder: index * 10,
        })),
      });
      const after = database.listCollections();
      expect(after.find((item) => item.id === b.id)?.parentId).toBe(a.id);
      expect(
        after.find((item) => item.id === a.id)?.sortOrder,
      ).toBeLessThan(after.find((item) => item.id === b.id)!.sortOrder);
    } finally {
      database.close();
    }
  });
});

describe("media notes & playback state", () => {
  it("persists time-point notes, searches them and restores playback state", async () => {
    const database = new RefCanvasDatabase(":memory:");
    const service = new LibraryService(database);
    try {
      const directory = await tempDirectory("refcanvas-notes-");
      const source = path.join(directory, "clip.mp4");
      await writeFile(source, Buffer.alloc(512, 7));
      await service.importPaths([source]);
      const asset = database.searchAssets().items[0];

      const note = database.createMediaNote(asset.id, {
        timeMs: 12_500,
        text: "镜头切换点",
      });
      expect(note.timeMs).toBe(12_500);
      expect(database.listMediaNotes(asset.id)).toHaveLength(1);
      const updated = database.updateMediaNote(note.id, { timeMs: 15_000 });
      expect(updated.timeMs).toBe(15_000);
      expect(database.listMediaNotes(asset.id)[0].text).toBe("镜头切换点");

      // Time notes participate in the local notes search.
      expect(
        database.searchAssets({ notesContains: "镜头切换点" }).items[0].id,
      ).toBe(asset.id);

      database.deleteMediaNote(note.id);
      expect(database.listMediaNotes(asset.id)).toHaveLength(0);

      // Playback state persists per asset.
      expect(database.getPlaybackState(asset.id)).toBeNull();
      database.setPlaybackState(asset.id, { playbackRate: 1.5, volume: 0.6 });
      const restored = database.setPlaybackState(asset.id, { muted: true });
      expect(restored.playbackRate).toBe(1.5);
      expect(restored.volume).toBe(0.6);
      expect(restored.muted).toBe(true);
    } finally {
      await service.close();
      database.close();
    }
  });
});
