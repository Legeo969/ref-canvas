import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_ZOOM,
  MIN_IMAGE_ZOOM,
  clampImageZoom,
  zoomPanAtPoint,
} from "../../../../src/renderer/components/ImagePreviewViewport";

describe("ImagePreviewViewport math", () => {
  it("clamps zoom to the Preview-style 10% to 800% range", () => {
    expect(clampImageZoom(0.01)).toBe(MIN_IMAGE_ZOOM);
    expect(clampImageZoom(2)).toBe(2);
    expect(clampImageZoom(20)).toBe(MAX_IMAGE_ZOOM);
  });

  it("keeps the image point below the cursor stable while zooming", () => {
    const nextPan = zoomPanAtPoint(
      { x: 0, y: 0 },
      { x: 100, y: -40 },
      1,
      2,
    );
    expect(nextPan).toEqual({ x: -100, y: 40 });
    expect((100 - nextPan.x) / 2).toBe(100);
    expect((-40 - nextPan.y) / 2).toBe(-40);
  });
});
