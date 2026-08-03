import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewCacheIndex } from "./preview-cache-index";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("PreviewCacheIndex", () => {
  it("stores successes and expires negative cache entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-preview-index-"));
    directories.push(root);
    const index = new PreviewCacheIndex(path.join(root, "index.sqlite"));
    try {
      index.recordSuccess("ok", "ok.png", 100, 1_000);
      expect(index.get("ok", 2_000)).toMatchObject({ status: "success", size: 100 });
      index.recordFailure("bad", 1_000);
      expect(index.get("bad", 2_000)?.status).toBe("failed");
      expect(index.get("bad", 1_000 + 24 * 60 * 60 * 1_000 + 1)).toBeNull();
    } finally {
      index.close();
    }
  });

  it("returns least-recently-used files when over budget", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-preview-index-"));
    directories.push(root);
    const index = new PreviewCacheIndex(path.join(root, "index.sqlite"), 150);
    try {
      index.recordSuccess("old", "old.png", 100, 1_000);
      index.recordSuccess("new", "new.png", 100, 2_000);
      expect(index.prune(3_000)).toEqual(["old.png"]);
      expect(index.get("old", 3_000)).toBeNull();
      expect(index.get("new", 3_000)).not.toBeNull();
    } finally {
      index.close();
    }
  });
});
