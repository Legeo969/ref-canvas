import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupOrphanThumbnails,
  pruneStaleThumbnails,
  thumbnailCacheFilename,
} from "../../../src/main/platform/thumbnail-cache";

describe("thumbnail cache identity", () => {
  const asset = {
    id: "asset-1",
    mtimeMs: 1000,
    size: 2048,
    fingerprint: "a".repeat(64),
  };

  it("is stable for the same source identity", () => {
    expect(thumbnailCacheFilename(asset)).toBe(
      thumbnailCacheFilename({ ...asset }),
    );
  });

  it("invalidates on timestamp, size, or fingerprint changes", () => {
    const baseline = thumbnailCacheFilename(asset);
    expect(thumbnailCacheFilename({ ...asset, mtimeMs: 1001 })).not.toBe(
      baseline,
    );
    expect(thumbnailCacheFilename({ ...asset, size: 2049 })).not.toBe(
      baseline,
    );
    expect(
      thumbnailCacheFilename({ ...asset, fingerprint: "b".repeat(64) }),
    ).not.toBe(baseline);
  });

  it("does not allow an asset id to create a nested path", () => {
    expect(
      thumbnailCacheFilename({ ...asset, id: "../unsafe/asset" }),
    ).not.toMatch(/[\\/]/);
  });

  it("isolates EXR channel previews from the composite cache", () => {
    expect(thumbnailCacheFilename(asset, "channel:Beauty.R")).not.toBe(
      thumbnailCacheFilename(asset),
    );
    expect(thumbnailCacheFilename(asset, "channel:Beauty.R")).not.toBe(
      thumbnailCacheFilename(asset, "channel:Beauty.G"),
    );
  });

  it("removes stale versions without touching another asset", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-thumb-"));
    try {
      await Promise.all([
        writeFile(path.join(directory, "asset-1-old.png"), "old"),
        writeFile(path.join(directory, "asset-1-current.png"), "current"),
        writeFile(path.join(directory, "asset-2-old.png"), "other"),
      ]);
      await pruneStaleThumbnails(
        directory,
        "asset-1",
        "asset-1-current.png",
      );
      expect((await readdir(directory)).sort()).toEqual([
        "asset-1-current.png",
        "asset-2-old.png",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("cleanupOrphanThumbnails", () => {
  it("removes unindexed frame/palette/media and legacy png files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-orphan-"));
    try {
      const files = [
        "current.webp",
        "frame-orphan.png",
        "frame-keep.png",
        "palette-orphan.webp",
        "media-orphan.png",
        "legacy.png",
      ];
      await Promise.all(files.map((file) => writeFile(path.join(directory, file), "data")));
      const indexedFiles = new Set([
        path.join(directory, "current.webp"),
        path.join(directory, "frame-keep.png"),
        path.join(directory, "legacy.png"),
      ]);
      const removed = await cleanupOrphanThumbnails(directory, indexedFiles);

      expect(removed.sort()).toEqual([
        path.join(directory, "frame-orphan.png"),
        path.join(directory, "legacy.png"),
        path.join(directory, "media-orphan.png"),
        path.join(directory, "palette-orphan.webp"),
      ].sort());
      expect((await readdir(directory)).sort()).toEqual([
        "current.webp",
        "frame-keep.png",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes nested legacy png files while preserving indexed webp variants", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-orphan-nested-"));
    try {
      const nested = path.join(directory, "directory");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(nested, { recursive: true });
      const webp = path.join(nested, "hash.webp");
      const png = path.join(nested, "hash.png");
      await Promise.all([
        writeFile(webp, "webp"),
        writeFile(png, "png"),
      ]);
      const removed = await cleanupOrphanThumbnails(directory, new Set([webp]));
      expect(removed).toEqual([png]);
      expect((await readdir(nested)).sort()).toEqual(["hash.webp"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
