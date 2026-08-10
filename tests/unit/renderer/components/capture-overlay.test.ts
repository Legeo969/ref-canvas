import { describe, expect, it } from "vitest";
import { calculateCaptureCrop } from "../../../../src/renderer/components/CaptureOverlay";

describe("region capture crop", () => {
  it("maps CSS-pixel selections to the physical screenshot resolution", () => {
    expect(
      calculateCaptureCrop(
        { left: 100, top: 50, width: 320, height: 180 },
        960,
        540,
        1920,
        1080,
      ),
    ).toEqual({
      sourceLeft: 200,
      sourceTop: 100,
      sourceWidth: 640,
      sourceHeight: 360,
      outputWidth: 640,
      outputHeight: 360,
    });
  });

  it("rejects accidental clicks and invalid viewport dimensions", () => {
    expect(
      calculateCaptureCrop(
        { left: 10, top: 10, width: 1, height: 1 },
        960,
        540,
        1920,
        1080,
      ),
    ).toBeNull();
    expect(
      calculateCaptureCrop(
        { left: 10, top: 10, width: 100, height: 100 },
        0,
        540,
        1920,
        1080,
      ),
    ).toBeNull();
  });
});
