import { describe, expect, it } from "vitest";
import { pickMonitor } from "../../../src/main/platform/screen-capture";

const monitor = (
  x: number,
  y: number,
  width: number,
  height: number,
  scaleFactor: number,
) => ({ x, y, width, height, scaleFactor });

describe("pickMonitor", () => {
  it("matches a monitor whose geometry is already in logical pixels", () => {
    const primary = monitor(0, 0, 2560, 1440, 2);
    const secondary = monitor(2560, 0, 1920, 1080, 1);
    const picked = pickMonitor(
      [primary, secondary],
      { x: 0, y: 0, width: 1280, height: 720 },
      2,
    );
    expect(picked).toBe(primary);
  });

  it("matches a monitor whose geometry is in physical pixels", () => {
    const primary = monitor(0, 0, 3840, 2160, 2);
    const secondary = monitor(3840, 0, 1920, 1080, 1);
    const picked = pickMonitor(
      [primary, secondary],
      { x: 1920, y: 0, width: 1920, height: 1080 },
      1,
    );
    expect(picked).toBe(secondary);
  });

  it("prefers the scale-matching monitor when two overlap the same area", () => {
    // 缩放镜像/复制模式：两块屏几何完全重合，scaleFactor 成为裁决依据。
    const hidpi = monitor(0, 0, 3840, 2160, 2);
    const lodpi = monitor(0, 0, 1920, 1080, 1);
    expect(pickMonitor([lodpi, hidpi], { x: 0, y: 0, width: 1920, height: 1080 }, 2)).toBe(hidpi);
  });

  it("returns null instead of guessing when nothing overlaps", () => {
    expect(
      pickMonitor([monitor(0, 0, 1920, 1080, 1)], { x: 5000, y: 5000, width: 800, height: 600 }, 1),
    ).toBeNull();
    expect(pickMonitor([], { x: 0, y: 0, width: 800, height: 600 }, 1)).toBeNull();
  });
});
