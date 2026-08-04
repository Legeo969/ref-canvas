import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../../src/shared/contracts";
import { resolveNativeDragAssets } from "../../../src/main/platform/native-drag";

const makeAsset = (
  id: string,
  filename: string,
  overrides: Partial<AssetRecord> = {},
): AssetRecord => ({
  id,
  title: id,
  kind: "image",
  path: filename,
  extension: "png",
  size: 1,
  mtimeMs: 1,
  fingerprint: id,
  contentHash: null,
  lifecycle: "active",
  deletedAt: null,
  trashPath: null,
  favorite: false,
  rating: 0,
  colorLabel: "none",
  linkState: "online",
  notes: "",
  width: 1,
  height: 1,
  duration: null,
  metadataStatus: "ready",
  metadataError: null,
  metadataUpdatedAt: null,
  bpm: null,
  customFields: {},
  customThumbnailPath: null,
  tags: [],
  collectionIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  previewUrl: "",
  thumbnailUrl: "",
  ...overrides,
});

describe("resolveNativeDragAssets", () => {
  it("keeps the requested order and removes duplicate ids and paths", () => {
    const assets = new Map([
      ["a", makeAsset("a", "C:\\assets\\a.png")],
      ["b", makeAsset("b", "C:\\assets\\b.png")],
      ["copy", makeAsset("copy", "C:\\assets\\A.png")],
    ]);

    expect(
      resolveNativeDragAssets(
        ["b", "a", "b", "copy"],
        (id) => assets.get(id) ?? null,
        () => true,
      ).map((asset) => asset.id),
    ).toEqual(["b", "a"]);
  });

  it("rejects missing, trashed, offline, relative and absent files", () => {
    const assets = new Map([
      ["ok", makeAsset("ok", "C:\\assets\\ok.png")],
      [
        "trash",
        makeAsset("trash", "C:\\assets\\trash.png", {
          lifecycle: "trashed",
        }),
      ],
      [
        "offline",
        makeAsset("offline", "C:\\assets\\offline.png", {
          linkState: "missing",
        }),
      ],
      ["relative", makeAsset("relative", "relative.png")],
      ["absent", makeAsset("absent", "C:\\assets\\absent.png")],
    ]);

    expect(
      resolveNativeDragAssets(
        ["ok", "trash", "offline", "relative", "absent", "unknown"],
        (id) => assets.get(id) ?? null,
        (filename) => !filename.endsWith("absent.png"),
      ).map((asset) => asset.id),
    ).toEqual(["ok"]);
  });
});
