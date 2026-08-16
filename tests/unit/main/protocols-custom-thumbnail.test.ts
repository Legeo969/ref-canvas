import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { customThumbnailForPath } from "../../../src/main/platform/protocols";

describe("customThumbnailForPath", () => {
  let scratch: string | null = null;
  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
    vi.restoreAllMocks();
  });

  async function scratchFile(name: string, contents: Buffer): Promise<string> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-custom-thumb-"));
    const filename = path.join(scratch, name);
    await writeFile(filename, contents);
    return filename;
  }

  it("returns the custom thumbnail PNG for an indexed asset", async () => {
    const png = Buffer.from("custom-thumbnail-bytes");
    const customPath = await scratchFile("custom.png", png);
    const database = {
      getAssetByPath: vi.fn(() => ({
        id: "11111111-1111-4111-8111-111111111111",
        customThumbnailPath: customPath,
      })),
    } as unknown as RefCanvasDatabase;

    await expect(customThumbnailForPath(database, "D:\\refs\\model.fbx")).resolves.toEqual(png);
    expect(database.getAssetByPath).toHaveBeenCalledWith("D:\\refs\\model.fbx");
  });

  it("returns null when the asset has no custom thumbnail", async () => {
    const database = {
      getAssetByPath: vi.fn(() => ({
        id: "11111111-1111-4111-8111-111111111111",
        customThumbnailPath: null,
      })),
    } as unknown as RefCanvasDatabase;

    await expect(customThumbnailForPath(database, "D:\\refs\\model.fbx")).resolves.toBeNull();
  });

  it("returns null for an unindexed path (falls through to generated thumbnails)", async () => {
    const database = {
      getAssetByPath: vi.fn(() => null),
    } as unknown as RefCanvasDatabase;

    await expect(customThumbnailForPath(database, "D:\\refs\\not-indexed.fbx")).resolves.toBeNull();
  });

  it("returns null when the custom file is missing instead of throwing", async () => {
    const database = {
      getAssetByPath: vi.fn(() => ({
        id: "11111111-1111-4111-8111-111111111111",
        customThumbnailPath: path.join("D:\\thumbs", "missing.png"),
      })),
    } as unknown as RefCanvasDatabase;

    await expect(customThumbnailForPath(database, "D:\\refs\\model.fbx")).resolves.toBeNull();
  });
});
