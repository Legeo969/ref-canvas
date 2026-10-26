import { describe, expect, it } from "vitest";
import {
  containBox,
  screenPointToUv,
  uvInsideContain,
} from "../../../../src/renderer/app/preview-sample";

/**
 * 屏幕点 → 源图归一化坐标。
 *
 * 关键前提：`<img>` 自身带着 `transform: translate3d(pan) rotate(θ) scale(s)`，
 * 所以 `getBoundingClientRect()` 返回的是**变换后**的轴对齐外框，
 * 不能当作布局尺寸，也不能把同一组变换再逆一次（那会把变换算两遍）。
 *
 * 调用方因此提供两样东西：
 *  - 布局框（未变换）：宽高来自 offsetWidth/offsetHeight，中心来自 rect 中心
 *    （transform-origin 为 center，中心在旋转/缩放/平移下不变）
 *  - 变换本身，仅用于逆算
 */

const identity = { rotateDeg: 0, scale: 1 };

describe("screenPointToUv", () => {
  it("maps the centre of an untransformed image to (0.5, 0.5)", () => {
    const box = { centerX: 500, centerY: 300, width: 400, height: 200 };
    expect(screenPointToUv(500, 300, box, identity)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("maps the top-left corner to (0, 0)", () => {
    const box = { centerX: 500, centerY: 300, width: 400, height: 200 };
    expect(screenPointToUv(300, 200, box, identity)).toEqual({ u: 0, v: 0 });
  });

  it("rejects points outside the image", () => {
    const box = { centerX: 500, centerY: 300, width: 400, height: 200 };
    expect(screenPointToUv(100, 300, box, identity)).toBeNull();
  });

  it("undoes zoom so the same layout fraction is returned", () => {
    // 放大 2 倍后，从中心向右 200px 仍然对应布局坐标 +100px（= u 0.75）。
    const box = { centerX: 500, centerY: 300, width: 400, height: 200 };
    expect(screenPointToUv(700, 300, box, { rotateDeg: 0, scale: 2 })).toEqual({
      u: 0.75,
      v: 0.5,
    });
  });

  it("undoes rotation", () => {
    // 旋转 90° 后，屏幕向下 +120px 对应未旋转坐标的 +x 120px。
    const box = { centerX: 500, centerY: 300, width: 400, height: 200 };
    const result = screenPointToUv(500, 420, box, { rotateDeg: 90, scale: 1 });
    expect(result?.u).toBeCloseTo(0.8, 6);
    expect(result?.v).toBeCloseTo(0.5, 6);
  });

  it("tracks pan because the rect centre already includes it", () => {
    // 平移 100px 右移后，元素中心也右移 100px；同一屏幕点在图上更靠左。
    const box = { centerX: 600, centerY: 300, width: 400, height: 200 };
    expect(screenPointToUv(600, 300, box, identity)).toEqual({ u: 0.5, v: 0.5 });
    expect(screenPointToUv(500, 300, box, identity)).toEqual({ u: 0.25, v: 0.5 });
  });

  it("returns null for a degenerate layout box", () => {
    expect(
      screenPointToUv(0, 0, { centerX: 0, centerY: 0, width: 0, height: 0 }, identity),
    ).toBeNull();
  });

  it("returns null for a non-positive scale", () => {
    const box = { centerX: 500, centerY: 300, width: 400, height: 200 };
    expect(screenPointToUv(500, 300, box, { rotateDeg: 0, scale: 0 })).toBeNull();
  });
});

describe("containBox", () => {
  it("letterboxes a wide image in a tall box", () => {
    // 图 200×100，盒 100×100 → 显示为 100×50，上下各留 0.25。
    expect(containBox(200, 100, 100, 100)).toEqual({
      left: 0,
      top: 0.25,
      width: 1,
      height: 0.5,
    });
  });

  it("pillarboxes a tall image in a wide box", () => {
    expect(containBox(100, 200, 100, 100)).toEqual({
      left: 0.25,
      top: 0,
      width: 0.5,
      height: 1,
    });
  });

  it("fills the box when the aspect ratios match", () => {
    expect(containBox(200, 100, 400, 200)).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
  });
});

describe("uvInsideContain", () => {
  it("removes the letterbox padding", () => {
    const box = { left: 0, top: 0.25, width: 1, height: 0.5 };
    expect(uvInsideContain(0.5, 0.5, box)).toEqual({ u: 0.5, v: 0.5 });
    expect(uvInsideContain(0, 0.25, box)).toEqual({ u: 0, v: 0 });
  });

  it("returns null on the padding instead of snapping to the edge", () => {
    const box = { left: 0, top: 0.25, width: 1, height: 0.5 };
    expect(uvInsideContain(0.5, 0.05, box)).toBeNull();
  });
});
