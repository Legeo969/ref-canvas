import { describe, expect, it } from "vitest";
import { boardProxySizeForPixels, boardProxyUrl } from "../../../../src/renderer/app/board-proxy";

describe("board image proxies", () => {
  it("selects one of the bounded proxy sizes", () => {
    expect(boardProxySizeForPixels(320)).toBe(512);
    expect(boardProxySizeForPixels(900)).toBe(1024);
    expect(boardProxySizeForPixels(1600)).toBe(2048);
    expect(boardProxySizeForPixels(9000)).toBe(2048);
  });

  it("does not expose a filesystem path", () => {
    const url = boardProxyUrl(
      "refasset://thumbnail/7bfbf174-6a5e-4f75-a1d5-bc929639abc2",
      1024,
    );
    expect(url).toBe(
      "refasset://thumbnail/7bfbf174-6a5e-4f75-a1d5-bc929639abc2?variant=board&size=1024&priority=visible",
    );
    expect(url).not.toContain(":\\");
  });
});
