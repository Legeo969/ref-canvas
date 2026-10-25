// @vitest-environment jsdom

import { Point, StaticCanvas, util, type StaticCanvas as FabricStaticCanvas } from "fabric";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { zoomTo100 } from "../../../../../src/renderer/features/board/controllers/viewport-controller";

// 仿 arrange-controller.test.ts:jsdom 的 getContext("2d") 返回 null,
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

const createStaticCanvas = (): FabricStaticCanvas => {
  const element = document.createElement("canvas");
  return new StaticCanvas(element, { width: 800, height: 600 });
};

describe("zoomTo100", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((type: string) =>
        type === "2d"
          ? makeProxyContext()
          : null) as typeof HTMLCanvasElement.prototype.getContext,
    );
  });

  it("恢复 1:1 缩放且视口中心对应的场景点仍在视口中心", () => {
    const canvas = createStaticCanvas();
    // 非单位 viewportTransform:模拟高分屏/已放大的视口(zoom 2.5 + 平移)。
    canvas.setViewportTransform([2.5, 0, 0, 2.5, 180, -240]);
    const renderSpy = vi.spyOn(canvas, "requestRenderAll");

    const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
    // 缩放前视口中心对应的场景点,缩放后必须仍映射回视口中心。
    const sceneCenter = util.transformPoint(
      center,
      util.invertTransform(canvas.viewportTransform),
    );

    zoomTo100(canvas);

    expect(canvas.getZoom()).toBe(1);
    const mapped = util.transformPoint(sceneCenter, canvas.viewportTransform);
    expect(mapped.x).toBeCloseTo(center.x, 6);
    expect(mapped.y).toBeCloseTo(center.y, 6);
    expect(renderSpy).toHaveBeenCalled();
  });
});
