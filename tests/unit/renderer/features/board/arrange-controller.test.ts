// @vitest-environment jsdom

import { ActiveSelection, Canvas, Rect, type Canvas as FabricCanvas } from "fabric";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BoardArrangeController } from "../../../../../src/renderer/features/board/controllers/arrange-controller";

// 仿 board-active-selection.test.ts:jsdom 的 getContext("2d") 返回 null,
// 用 Proxy 代理 2D context 吃掉 fabric 的全部绘制调用,绕过真实渲染。
const makeProxyContext = () =>
  new Proxy(
    { canvas: document.createElement("canvas") } as unknown as CanvasRenderingContext2D,
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return () => undefined;
      },
      set: () => true,
    },
  );

const createBoardCanvas = (): FabricCanvas => {
  const element = document.createElement("canvas");
  return new Canvas(element, { width: 800, height: 600 });
};

describe("BoardArrangeController align/distribute", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((type: string) =>
        type === "2d"
          ? makeProxyContext()
          : null) as typeof HTMLCanvasElement.prototype.getContext,
    );
  });

  it("keeps consecutive align commands moving the selection", () => {
    const canvas = createBoardCanvas();
    const a = new Rect({ left: 0, top: 0, width: 50, height: 80 });
    const b = new Rect({ left: 200, top: 120, width: 90, height: 40 });
    const c = new Rect({ left: 500, top: 300, width: 60, height: 120 });
    canvas.add(a, b, c);
    canvas.setActiveObject(new ActiveSelection([a, b, c]));
    const controller = new BoardArrangeController({
      getCanvas: () => canvas,
      getAssets: () => [],
    });

    const positions = () =>
      [a, b, c].map((object) => {
        const box = object.getBoundingRect();
        return { left: box.left, top: box.top };
      });

    // 用户路径:连点对齐按钮 left → centerX → top → bottom 两轮以上。
    const steps = [
      "left",
      "centerX",
      "top",
      "bottom",
      "left",
      "centerX",
      "top",
    ] as const;
    let before = positions();
    for (const step of steps) {
      controller.alignSelection(step);
      const after = positions();
      const moved = after.some(
        (item, index) =>
          Math.abs(item.left - before[index].left) > 0.001 ||
          Math.abs(item.top - before[index].top) > 0.001,
      );
      console.log(`align ${step}: moved=${moved}`, JSON.stringify(after));
      expect(moved, `align ${step} 应移动对象`).toBe(true);
      before = after;
    }
  });

  it("keeps consecutive distribute commands working", () => {
    const canvas = createBoardCanvas();
    const a = new Rect({ left: 0, top: 0, width: 50, height: 80 });
    const b = new Rect({ left: 200, top: 200, width: 90, height: 40 });
    const c = new Rect({ left: 500, top: 60, width: 60, height: 120 });
    canvas.add(a, b, c);
    canvas.setActiveObject(new ActiveSelection([a, b, c]));
    const controller = new BoardArrangeController({
      getCanvas: () => canvas,
      getAssets: () => [],
    });

    const positions = () =>
      [a, b, c].map((object) => {
        const box = object.getBoundingRect();
        return { left: box.left, top: box.top };
      });

    // 第一次分布:中位对象移动到等间距位置
    let before = positions();
    controller.distributeSelection("x");
    let after = positions();
    expect(
      after.some((item, index) => Math.abs(item.left - before[index].left) > 0.001),
      "第一次 distribute x 应移动对象",
    ).toBe(true);
    const spread = after;
    // 连续第二次 x 分布:散开状态下等间距已成立,断言位置保持(幂等)。
    controller.distributeSelection("x");
    after = positions();
    expect(
      after.every((item, index) => Math.abs(item.left - spread[index].left) < 0.001),
      "连续第二次 distribute x 应保持等间距",
    ).toBe(true);
    // align 打散后再分布:连续操作不得被冻结(复现用户 bug 的关键路径)。
    before = after;
    controller.alignSelection("centerX");
    controller.distributeSelection("x");
    after = positions();
    expect(
      after.some((item, index) => Math.abs(item.left - before[index].left) > 0.001),
      "align 后再次 distribute x 应移动对象",
    ).toBe(true);
    before = after;
    controller.alignSelection("top");
    controller.distributeSelection("y");
    after = positions();
    expect(
      after.some((item, index) => Math.abs(item.top - before[index].top) > 0.001),
      "align 后 distribute y 应移动对象",
    ).toBe(true);
  });
});
