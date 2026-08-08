import { describe, expect, it } from "vitest";
import { flattenDepthPreferencePatch } from "../../../../src/renderer/app/found-settings";

describe("flattenDepthPreferencePatch", () => {
  it("applies the default depth to the directory currently being viewed", () => {
    expect(flattenDepthPreferencePatch("D:\\refs", 3)).toEqual({
      foundSettings: {
        defaultFlattenDepth: 3,
        flattenPerFolder: { "D:\\refs": 3 },
      },
    });
    expect(flattenDepthPreferencePatch(null, 2)).toEqual({
      foundSettings: { defaultFlattenDepth: 2 },
    });
  });
});
