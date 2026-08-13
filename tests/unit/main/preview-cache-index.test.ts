import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewCacheIndex } from "../../../src/main/platform/preview-cache-index";
import { recordPreviewFailure, shouldCachePreviewFailure } from "../../../src/main/platform/protocols";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("PreviewCacheIndex", () => {
  it("does not persist transient preview infrastructure failures", () => {
    for (const message of [
      "PREVIEW_QUEUE_ABORTED",
      "PREVIEW_QUEUE_FULL",
      "WORKER_JOB_CANCELLED",
      "WORKER_JOB_TIMEOUT",
      "WORKER_CRASHED",
      "PROVIDER_TIMEOUT",
    ]) {
      expect(shouldCachePreviewFailure(new Error(message))).toBe(false);
    }
    expect(shouldCachePreviewFailure(new Error("EXR_DECODE_FAILED:INVALID_HEADER"))).toBe(true);
  });

  it("records only permanent thumbnail failures at the shared protocol boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-preview-index-"));
    directories.push(root);
    const index = new PreviewCacheIndex(path.join(root, "index.sqlite"));
    try {
      recordPreviewFailure(index, "transient", new Error("WORKER_CRASHED"));
      expect(index.get("transient")).toBeNull();
      recordPreviewFailure(index, "broken", new Error("EXR_DECODE_FAILED:INVALID_HEADER"));
      expect(index.get("broken")?.status).toBe("failed");
    } finally {
      index.close();
    }
  });
  it("stores successes and expires negative cache entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-preview-index-"));
    directories.push(root);
    const index = new PreviewCacheIndex(path.join(root, "index.sqlite"));
    try {
      index.recordSuccess("ok", "ok.png", 100, 1_000);
      expect(index.get("ok", 2_000)).toMatchObject({ status: "success", size: 100 });
      index.recordFailure("bad", 1_000);
      expect(index.get("bad", 2_000)?.status).toBe("failed");
      index.clearFailure("bad");
      expect(index.get("bad", 2_001)).toBeNull();
      index.recordFailure("bad", 1_000);
      expect(index.get("bad", 1_000 + 30_000 + 1)).toBeNull();
    } finally {
      index.close();
    }
  });

  it("caps long-lived failure records written by older app versions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-preview-index-"));
    directories.push(root);
    const filename = path.join(root, "index.sqlite");
    const oldIndex = new PreviewCacheIndex(filename);
    oldIndex.recordFailure("legacy", Date.now() + 24 * 60 * 60 * 1_000);
    oldIndex.close();

    const upgradedIndex = new PreviewCacheIndex(filename);
    try {
      const record = upgradedIndex.get("legacy");
      expect(record?.status).toBe("failed");
      expect(record!.retryAfterMs - Date.now()).toBeLessThanOrEqual(30_000);
    } finally {
      upgradedIndex.close();
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
