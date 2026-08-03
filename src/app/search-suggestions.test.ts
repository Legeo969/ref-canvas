import { describe, expect, it } from "vitest";
import type { AssetRecord, CollectionRecord, TagRecord } from "../shared/contracts";
import {
  computeSearchSuggestions,
  suggestionCount,
} from "./search-suggestions";

function folder(id: string, title: string, parentId: string | null = null): CollectionRecord {
  return {
    id,
    title,
    parentId,
    sortOrder: 0,
    directAssetCount: 0,
    assetCount: 0,
    locked: false,
    createdAt: "",
  };
}

function tag(id: string, name: string): TagRecord {
  return {
    id,
    name,
    groupId: null,
    assetCount: 1,
    alias: null,
    shortcutKey: null,
  };
}

function asset(id: string, title: string): AssetRecord {
  return {
    id,
    title,
    path: `D:\\refs\\${title}.png`,
    kind: "image",
    extension: "png",
    size: 1,
    mtimeMs: 1,
    fingerprint: "",
    contentHash: null,
    lifecycle: "active",
    deletedAt: null,
    trashPath: null,
    favorite: false,
    rating: 0,
    colorLabel: "none",
    linkState: "online",
    notes: "",
    width: null,
    height: null,
    duration: null,
    bpm: null,
    customFields: {},
    customThumbnailPath: null,
    tags: [],
    collectionIds: [],
    createdAt: "",
    updatedAt: "",
    previewUrl: "",
    thumbnailUrl: "",
    storageMode: "linked",
    libraryRelativePath: null,
    originalSourcePath: null,
  };
}

const collections = [
  folder("a", "概念"),
  folder("b", "灯光", "a"),
  folder("c", "材质"),
  folder("d", "角色", "a"),
];
const tagsList = [tag("t1", "构图"), tag("t2", "夜景"), tag("t3", "灯光布光")];
const assetsList = [asset("a1", "夜景灯光参考"), asset("a2", "白天构图"), asset("a3", "角色设计")];

describe("computeSearchSuggestions", () => {
  it("matches folders by full path label", () => {
    const result = computeSearchSuggestions(collections, tagsList, assetsList, "灯光");
    expect(result.folders.map((f) => f.id)).toEqual(["b"]);
    expect(result.tags.map((t) => t.id)).toEqual(["t3"]);
    expect(result.assets.map((a) => a.id)).toEqual(["a1"]);
  });

  it("empty or #tag queries produce no suggestions", () => {
    expect(suggestionCount(computeSearchSuggestions(collections, tagsList, assetsList, "  "))).toBe(0);
    expect(suggestionCount(computeSearchSuggestions(collections, tagsList, assetsList, "#构图"))).toBe(0);
  });

  it("limits each group and applies group caps", () => {
    const manyFolders = Array.from({ length: 8 }, (_, index) =>
      folder(`f${index}`, `构图系列${index}`),
    );
    const result = computeSearchSuggestions(manyFolders, [], [], "构图", {
      folders: 3,
      tags: 2,
      assets: 2,
    });
    expect(result.folders).toHaveLength(3);
    expect(result.assets).toHaveLength(0);
  });

  it("matches case-insensitively for latin names", () => {
    const result = computeSearchSuggestions([], [], [asset("a1", "Night Hero")], "night");
    expect(result.assets.map((a) => a.id)).toEqual(["a1"]);
  });
});
