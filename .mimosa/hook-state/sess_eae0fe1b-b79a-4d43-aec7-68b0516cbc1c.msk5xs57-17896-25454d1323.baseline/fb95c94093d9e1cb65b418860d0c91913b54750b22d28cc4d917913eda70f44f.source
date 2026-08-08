import { describe, expect, it } from "vitest";
import {
  highlightQuery,
  highlightSegments,
  searchTerms,
} from "../../../../src/renderer/app/search-highlight";

const plain = (segments: Array<{ text: string; match: boolean }>) =>
  segments.map((segment) => `${segment.match ? "[" : ""}${segment.text}${segment.match ? "]" : ""}`).join("");

describe("searchTerms", () => {
  it("splits whitespace and deduplicates", () => {
    expect(searchTerms("构图 灯光 构图")).toEqual(["构图", "灯光"]);
  });

  it("ignores #tag queries and empty input", () => {
    expect(searchTerms("#构图")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("caps at 8 terms", () => {
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
  });
});

describe("highlightSegments", () => {
  it("returns a single unmatched segment when nothing hits", () => {
    expect(highlightSegments("hero shot", ["夜晚"])).toEqual([
      { text: "hero shot", match: false },
    ]);
  });

  it("highlights one hit with surrounding text", () => {
    expect(plain(highlightSegments("hero shot", ["hero"]))).toBe("[hero] shot");
  });

  it("highlights multiple terms in order and merges overlaps", () => {
    expect(plain(highlightSegments("hero shot hero", ["hero"]))).toBe(
      "[hero] shot [hero]",
    );
    expect(plain(highlightSegments("hero shot", ["hero", "shot"]))).toBe(
      "[hero] [shot]",
    );
    // 重叠区间合并为一段。
    expect(plain(highlightSegments("aaaa", ["aa"]))).toBe("[aaaa]");
  });

  it("is case-insensitive for latin terms", () => {
    expect(plain(highlightSegments("Hero SHOT", ["hero"]))).toBe("[Hero] SHOT");
  });

  it("matches Chinese substrings", () => {
    expect(plain(highlightSegments("夜景灯光参考", ["灯光"]))).toBe("夜景[灯光]参考");
  });

  it("handles empty text and empty terms", () => {
    expect(highlightSegments("", ["a"])).toEqual([]);
    expect(highlightSegments("text", [])).toEqual([{ text: "text", match: false }]);
  });
});

describe("highlightQuery", () => {
  it("ignores #tag queries", () => {
    expect(plain(highlightQuery("构图参考", "#构图"))).toBe("构图参考");
  });

  it("highlights plain queries", () => {
    expect(plain(highlightQuery("构图参考", "构图"))).toBe("[构图]参考");
  });
});
