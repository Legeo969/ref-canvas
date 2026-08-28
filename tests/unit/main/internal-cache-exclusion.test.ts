import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NewAsset } from "../../../src/main/persistence/database";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LocalImportEnumerator } from "../../../src/main/services/import-enumerator";
import { LibraryService } from "../../../src/main/services/library-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function asset(filename: string): NewAsset {
  return {
    title: path.basename(filename, path.extname(filename)),
    kind: "image",
    path: filename,
    pathKey: path.normalize(filename).toLocaleLowerCase("en-US"),
    extension: path.extname(filename).slice(1),
    size: 100,
    mtimeMs: 1,
    fingerprint: filename,
    linkState: "online",
    notes: "",
    width: 10,
    height: 10,
    duration: null,
    metadataStatus: "ready",
    metadataError: null,
    metadataUpdatedAt: new Date().toISOString(),
    metadataJobId: null,
  };
}

const signature = {
  visualHash: "0123456789abcdef",
  colorSignature: Buffer.alloc(48, 100).toString("base64"),
  dominantColor: { r: 100, g: 100, b: 100 },
};

describe("internal cache exclusion", () => {
  it("does not enumerate an excluded cache subtree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-enumerate-"));
    temporaryDirectories.push(root);
    const cache = path.join(root, "cache");
    const source = path.join(root, "source.png");
    const cached = path.join(cache, "thumbnail.webp");
    await mkdir(cache, { recursive: true });
    await Promise.all([writeFile(source, "source"), writeFile(cached, "cache")]);
    const filenames: string[] = [];

    await new LocalImportEnumerator().enumerate(
      [root],
      new AbortController().signal,
      async (items) => {
        filenames.push(...items.map((item) => item.filename));
      },
      [cache],
    );

    expect(filenames).toEqual([source]);
  });

  it("purges only linked cache records and keeps the watch root", () => {
    const database = new RefCanvasDatabase(":memory:");
    const cache = path.resolve("C:\\profile\\cache");
    const cached = database.upsertAsset(asset(path.join(cache, "thumbnail.webp"))).asset;
    const source = database.upsertAsset(asset("C:\\images\\source.png")).asset;
    const watchRoot = database.addWatchRoot("C:\\");

    expect(database.purgeLinkedRecordsUnderRoots([cache])).toBe(1);
    expect(database.getAsset(cached.id)).toBeNull();
    expect(database.getAsset(source.id)?.id).toBe(source.id);
    expect(database.listWatchRoots()).toEqual([watchRoot]);
    database.close();
  });

  it("does not return an excluded cache record as a similar image", async () => {
    const database = new RefCanvasDatabase(":memory:");
    const cache = path.resolve("C:\\profile\\cache");
    const source = database.upsertAsset(asset("C:\\images\\source.png")).asset;
    const normal = database.upsertAsset(asset("C:\\images\\normal.png")).asset;
    const cached = database.upsertAsset(asset(path.join(cache, "thumbnail.webp"))).asset;
    for (const id of [source.id, normal.id, cached.id]) {
      database.setVisualSignature(
        id,
        signature.visualHash,
        signature.colorSignature,
        signature.dominantColor,
      );
    }
    const service = new LibraryService(database, undefined, {
      excludedSourceRoots: [cache],
    });
    try {
      const results = await service.findSimilar(source.id, { minScore: 0 });
      expect(results.map((result) => result.asset.id)).toEqual([normal.id]);
    } finally {
      await service.close();
      database.close();
    }
  });
});
