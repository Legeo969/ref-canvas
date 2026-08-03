import { describe, expect, it } from "vitest";
import { trimDirectoryPageCache } from "./directory-page-cache";

describe("trimDirectoryPageCache", () => {
  it("keeps at most 12 pages or 6,144 directory entries near the viewport", () => {
    const pages = new Map(
      Array.from({ length: 20 }, (_, page) => [
        page * 512,
        Array.from({ length: 512 }, (_, entry) => ({
          path: `D:\\scale\\${page * 512 + entry}.png`,
          name: `${page * 512 + entry}.png`,
          isDirectory: false,
          extension: "png",
        })),
      ] as const),
    );
    trimDirectoryPageCache(pages, 10 * 512, 12);
    expect(pages.size).toBe(12);
    expect([...pages.values()].flat()).toHaveLength(6_144);
    expect(pages.has(10 * 512)).toBe(true);
  });

  it("retains the page containing the active preview", () => {
    const pages = new Map(
      Array.from({ length: 13 }, (_, page) => [
        page * 512,
        [{
          path: page === 0 ? "D:\\preview.png" : `D:\\${page}.png`,
          name: `${page}.png`,
          isDirectory: false,
          extension: "png",
        }],
      ] as const),
    );
    trimDirectoryPageCache(pages, 12 * 512, 12, "D:\\preview.png");
    expect(pages.has(0)).toBe(true);
    expect(pages.size).toBe(12);
  });
});
