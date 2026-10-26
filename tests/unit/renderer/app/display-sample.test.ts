// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleDisplayPixel } from "../../../../src/renderer/app/display-sample";

/**
 * 显示层取样：走 fetch + createImageBitmap，而不是 canvas.drawImage(img)。
 * 后者在 Electron 自定义协议下会因跨源把 canvas 标记为 tainted，
 * getImageData 直接抛 SecurityError——这正是旧实现的失败点。
 */

const originalFetch = globalThis.fetch;
const originalCreateImageBitmap = globalThis.createImageBitmap;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap =
    originalCreateImageBitmap;
  vi.restoreAllMocks();
});

function stubBitmap(pixels: { x: number; y: number; rgba: number[] }, width = 4, height = 4) {
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(pixels.rgba) }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData,
    imageSmoothingEnabled: false,
  } as unknown as CanvasRenderingContext2D);
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
    async () => ({ width, height, close: vi.fn() }),
  );
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["x"]),
  })) as unknown as typeof fetch;
  return { getImageData };
}

describe("sampleDisplayPixel", () => {
  it("returns the pixel at the normalized position", async () => {
    stubBitmap({ x: 2, y: 2, rgba: [18, 52, 86, 255] });
    const result = await sampleDisplayPixel("refasset://thumbnail/a", 0.5, 0.5);
    expect(result).toEqual({ hex: "#123456", alpha: 255 });
  });

  it("clamps to the last pixel at the far edge", async () => {
    stubBitmap({ x: 3, y: 3, rgba: [255, 0, 0, 128] });
    const result = await sampleDisplayPixel("refasset://thumbnail/a", 1, 1);
    expect(result).toEqual({ hex: "#FF0000", alpha: 128 });
  });

  it("pads single-digit channels to two hex digits", async () => {
    stubBitmap({ x: 0, y: 0, rgba: [1, 2, 3, 255] });
    const result = await sampleDisplayPixel("refasset://thumbnail/a", 0, 0);
    expect(result?.hex).toBe("#010203");
  });

  it("returns null instead of guessing when the fetch fails", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await sampleDisplayPixel("refasset://thumbnail/a", 0.5, 0.5)).toBeNull();
  });

  it("returns null when decoding throws", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["x"]),
    })) as unknown as typeof fetch;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => {
        throw new Error("decode failed");
      },
    );
    expect(await sampleDisplayPixel("refasset://thumbnail/a", 0.5, 0.5)).toBeNull();
  });
});
