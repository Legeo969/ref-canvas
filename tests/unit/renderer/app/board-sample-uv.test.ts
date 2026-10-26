import { describe, expect, it } from "vitest";
import { localToUv } from "../../../../src/renderer/app/board-sample-uv";

/**
 * 画布取色的坐标基准回归。
 *
 * fabric 逆变换后的局部坐标以**对象中心**为原点（范围 -w/2..+w/2），
 * 不是左上角。曾经的实现把它当 0..w 用，导致：
 *  - 点对象左半部分被判定为「在对象外」，直接取不到色
 *  - 点右半部分算出偏小一半的 u，取到偏左的像素
 * 用户实际遇到的就是后者：点粉色块（中部）却取到左侧的蓝色。
 */

describe("localToUv", () => {
  it("maps the object centre to (0.5, 0.5)", () => {
    // 这是最容易出错的一点：中心局部坐标是 (0,0)，不是 (w/2,h/2)。
    expect(localToUv({ x: 0, y: 0 }, 400, 400)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("maps the top-left corner to (0, 0)", () => {
    expect(localToUv({ x: -200, y: -200 }, 400, 400)).toEqual({ u: 0, v: 0 });
  });

  it("maps the bottom-right corner to (1, 1)", () => {
    expect(localToUv({ x: 200, y: 200 }, 400, 400)).toEqual({ u: 1, v: 1 });
  });

  it("maps the left quarter to u = 0.25 instead of rejecting it", () => {
    // 旧实现会在这里返回「不在对象内」，整个左半边取不了色。
    expect(localToUv({ x: -100, y: 0 }, 400, 400)).toEqual({ u: 0.25, v: 0.5 });
  });

  it("maps the right quarter to u = 0.75", () => {
    // 旧实现算出 0.5（偏左一半）。
    expect(localToUv({ x: 100, y: 0 }, 400, 400)).toEqual({ u: 0.75, v: 0.5 });
  });

  it("rejects points outside the object bounds", () => {
    expect(localToUv({ x: -201, y: 0 }, 400, 400)).toBeNull();
    expect(localToUv({ x: 0, y: 201 }, 400, 400)).toBeNull();
  });

  it("handles non-square objects per axis", () => {
    expect(localToUv({ x: 0, y: 0 }, 1000, 500)).toEqual({ u: 0.5, v: 0.5 });
    expect(localToUv({ x: -250, y: -125 }, 1000, 500)).toEqual({ u: 0.25, v: 0.25 });
  });

  it("returns null for degenerate sizes", () => {
    expect(localToUv({ x: 0, y: 0 }, 0, 400)).toBeNull();
    expect(localToUv({ x: 0, y: 0 }, 400, 0)).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(localToUv({ x: Number.NaN, y: 0 }, 400, 400)).toBeNull();
  });
});
