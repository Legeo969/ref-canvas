import { describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "../../../src/shared/contracts";
import type { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LibraryService } from "../../../src/main/services/library-service";

describe("LibraryService custom thumbnails", () => {
  it("returns the updated asset and emits a path-scoped thumbnail change", () => {
    const asset = {
      id: "11111111-1111-4111-8111-111111111111",
      path: "D:\\refs\\model.fbx",
      thumbnailUrl: "refasset://thumbnail/11111111-1111-4111-8111-111111111111",
      customThumbnailPath: "D:\\thumbs\\model.png",
      updatedAt: "2026-08-12T10:00:00.000Z",
    } as AssetRecord;
    const setCustomThumbnail = vi.fn(() => asset);
    const database = {
      filename: ":memory:",
      setCustomThumbnail,
    } as unknown as RefCanvasDatabase;
    const library = new LibraryService(database);
    const changed = vi.fn();
    library.onLibraryChanged(changed);

    expect(library.setCustomThumbnail(asset.id, asset.customThumbnailPath)).toBe(asset);
    expect(setCustomThumbnail).toHaveBeenCalledWith(asset.id, asset.customThumbnailPath);
    expect(changed).toHaveBeenCalledWith({
      reason: "thumbnail",
      paths: [asset.path],
    });
  });
});
