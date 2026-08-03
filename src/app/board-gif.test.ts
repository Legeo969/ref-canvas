import { describe, expect, it } from "vitest";
import {
  DEFAULT_GIF_STATE,
  gifStateFromData,
  nextFrameIndex,
} from "./board-gif";

describe("nextFrameIndex", () => {
  it("stays on the current frame until its duration elapses", () => {
    expect(nextFrameIndex(0, 4, 50, 100, 1)).toBeNull();
    expect(nextFrameIndex(0, 4, 100, 100, 1)).toBe(1);
  });

  it("wraps around at the last frame", () => {
    expect(nextFrameIndex(3, 4, 120, 100, 1)).toBe(0);
  });

  it("respects the playback rate", () => {
    expect(nextFrameIndex(0, 4, 50, 100, 2)).toBe(1);
    expect(nextFrameIndex(0, 4, 50, 100, 0.5)).toBeNull();
  });

  it("never advances for single-frame inputs", () => {
    expect(nextFrameIndex(0, 1, 10_000, 100, 1)).toBeNull();
  });
});

describe("gifStateFromData", () => {
  it("defaults to playing, frame 0, rate 1", () => {
    expect(gifStateFromData(undefined, 5)).toEqual(DEFAULT_GIF_STATE);
    expect(gifStateFromData({}, 5)).toEqual(DEFAULT_GIF_STATE);
  });

  it("preserves explicit state", () => {
    expect(gifStateFromData({ playing: false, frame: 2, rate: 2 }, 5)).toEqual({
      playing: false,
      frame: 2,
      rate: 2,
    });
  });

  it("clamps frame into range and rate into bounds", () => {
    expect(gifStateFromData({ frame: 99, rate: 100 }, 3)).toEqual({
      playing: true,
      frame: 2,
      rate: 8,
    });
    expect(gifStateFromData({ frame: -1, rate: 0 }, 3)).toEqual({
      playing: true,
      frame: 0,
      rate: 0.25,
    });
  });
});
