import { describe, expect, it } from "vitest";
import { gifFrameIndexForPosition } from "../../../../src/renderer/components/GIFPreview";

describe("GIF preview transport", () => {
  it("seeks by elapsed duration for variable-duration frames", () => {
    const frames = [
      { durationMs: 100 },
      { durationMs: 800 },
      { durationMs: 100 },
    ];
    expect(gifFrameIndexForPosition(frames, 0)).toBe(0);
    expect(gifFrameIndexForPosition(frames, 0.5)).toBe(1);
    expect(gifFrameIndexForPosition(frames, 0.95)).toBe(2);
    expect(gifFrameIndexForPosition(frames, 1)).toBe(2);
  });
});
