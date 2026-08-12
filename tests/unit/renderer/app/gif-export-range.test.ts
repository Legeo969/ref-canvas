import { describe, expect, it } from "vitest";
import { centeredGifRange } from "../../../../src/renderer/app/gif-export-range";

describe("centeredGifRange", () => {
  it("centers five seconds around the current playback position", () => {
    expect(centeredGifRange(50_000, 120_000)).toEqual({ startMs: 47_500, endMs: 52_500 });
  });

  it("clamps the range at both boundaries and covers short sources", () => {
    expect(centeredGifRange(1_000, 120_000)).toEqual({ startMs: 0, endMs: 5_000 });
    expect(centeredGifRange(119_000, 120_000)).toEqual({ startMs: 115_000, endMs: 120_000 });
    expect(centeredGifRange(1_000, 3_000)).toEqual({ startMs: 0, endMs: 3_000 });
  });
});
