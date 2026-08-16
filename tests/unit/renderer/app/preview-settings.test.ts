import { describe, expect, it } from "vitest";
import { flattenDepthPreferencePatch } from "../../../../src/renderer/app/preview-settings";

describe("flattenDepthPreferencePatch", () => {
  it("applies the default depth to the directory currently being viewed", () => {
    expect(flattenDepthPreferencePatch("D:\\refs", 3)).toEqual({
      previewSettings: {
        defaultFlattenDepth: 3,
        flattenPerFolder: { "D:\\refs": 3 },
      },
    });
    expect(flattenDepthPreferencePatch(null, 2)).toEqual({
      previewSettings: { defaultFlattenDepth: 2 },
    });
  });
});
