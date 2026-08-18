import { describe, expect, it } from "vitest";
import { previewCacheKey } from "../../../src/main/platform/preview-cache-key";

describe("previewCacheKey", () => {
  const base = {
    realPath: "C:\\refs\\shot.exr",
    size: 100,
    mtimeMs: 123,
    variant: "thumbnail-480x320-webp" as const,
  };

  it("changes when the file identity changes", () => {
    expect(previewCacheKey(base)).not.toBe(
      previewCacheKey({ ...base, mtimeMs: 124 }),
    );
    expect(previewCacheKey(base)).not.toBe(
      previewCacheKey({ ...base, size: 101 }),
    );
    expect(previewCacheKey(base)).not.toBe(
      previewCacheKey({ ...base, variant: "thumbnail-shell-480x320-webp" }),
    );
  });

  it("never returns the source path", () => {
    expect(previewCacheKey(base)).not.toContain("C:");
    expect(previewCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
