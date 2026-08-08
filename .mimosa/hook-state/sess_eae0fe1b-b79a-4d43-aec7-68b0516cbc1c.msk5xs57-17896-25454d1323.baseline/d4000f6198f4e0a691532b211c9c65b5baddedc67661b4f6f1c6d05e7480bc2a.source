import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
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
