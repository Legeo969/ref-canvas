import { describe, expect, it } from "vitest";
import { parseAssetSearchQuery } from "../../../src/shared/search-query";

describe("parseAssetSearchQuery", () => {
  it("parses tags, type, rating, path, dimensions, size and dates", () => {
    expect(parseAssetSearchQuery(
      'hero #approved type:image rating:>=4 path:"concept art" width:>=1920 size:<=10mb after:2026-01-01',
    )).toMatchObject({
      input: {
        query: "hero",
        tag: "approved",
        kind: "image",
        ratingMin: 4,
        pathContains: "concept art",
        minWidth: 1920,
        maxSize: 10 * 1024 * 1024,
        modifiedAfter: "2026-01-01",
      },
      unsupported: [],
    });
  });

  it("uses includeTags for multiple tag conditions and reports unknown filters", () => {
    expect(parseAssetSearchQuery("#red #print owner:me")).toMatchObject({
      input: { includeTags: ["red", "print"] },
      unsupported: ["owner:me"],
    });
  });
});
