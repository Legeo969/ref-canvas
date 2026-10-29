// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReferenceScopes,
  type ReferenceScopesData,
} from "../../../../src/renderer/components/ReferenceScopes";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const LABELS = {
  histogram: "直方图",
  vectorscope: "矢量示波器",
  note: "未就绪：尚未读取参考图",
};

const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 28;

function histogram(): number[] {
  return Array.from({ length: 64 }, (_, index) =>
    Math.round(1000 * Math.exp(-((index - 32) ** 2) / 90)),
  );
}

const DATA: ReferenceScopesData = {
  histogram: [histogram(), histogram(), histogram()],
  density: Array.from({ length: 17 * 17 }, (_, index) => (index % 5 === 0 ? 40 : 0)),
  densitySize: 17,
};

interface ContextRecorder {
  context: CanvasRenderingContext2D;
  calls: string[];
}

/** jsdom 没有 2d 实现：用记录调用的代理代替，顺便证明绘制路径真的走到了。 */
function contextRecorder(canvas: HTMLCanvasElement): ContextRecorder {
  const calls: string[] = [];
  const context = new Proxy({ canvas } as unknown as CanvasRenderingContext2D, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return () => {
        calls.push(String(property));
      };
    },
    set: () => true,
  });
  return { context, calls };
}

class TestResizeObserver {
  static observed: Element[] = [];

  constructor(readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    TestResizeObserver.observed.push(target);
  }

  unobserve(): void {}

  disconnect(): void {}
}

describe("ReferenceScopes", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  const render = async (data: ReferenceScopesData | null): Promise<HTMLElement> => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ReferenceScopes data={data} labels={LABELS} />));
    return host;
  };

  beforeEach(() => {
    TestResizeObserver.observed = [];
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("devicePixelRatio", 2);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: CANVAS_WIDTH,
      bottom: CANVAS_HEIGHT,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a dimmed grid with four labelled canvases when there is no data", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const host = await render(null);

    const section = host.querySelector(".reference-scopes");
    expect(section?.getAttribute("role")).toBe("group");
    expect(section?.classList.contains("is-idle")).toBe(true);
    expect(host.textContent).toContain(LABELS.note);

    const canvases = Array.from(host.querySelectorAll("canvas"));
    expect(canvases).toHaveLength(4);
    expect(canvases.map((canvas) => canvas.getAttribute("aria-label"))).toEqual([
      `${LABELS.histogram} · R`,
      `${LABELS.histogram} · G`,
      `${LABELS.histogram} · B`,
      LABELS.vectorscope,
    ]);
  });

  it("paints all four scopes at device-pixel resolution once data arrives", async () => {
    const recorders: ContextRecorder[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(
      this: HTMLCanvasElement,
    ) {
      const recorder = contextRecorder(this);
      recorders.push(recorder);
      return recorder.context;
    });

    const host = await render(DATA);
    const section = host.querySelector(".reference-scopes");
    expect(section?.classList.contains("is-idle")).toBe(false);

    const canvases = Array.from(host.querySelectorAll<HTMLCanvasElement>("canvas"));
    expect(canvases).toHaveLength(4);
    // DPR = 2：backing store 是 CSS 尺寸的两倍，绘制坐标仍是 CSS 像素。
    expect(canvases[0]?.width).toBe(CANVAS_WIDTH * 2);
    expect(canvases[0]?.height).toBe(CANVAS_HEIGHT * 2);
    expect(recorders.every((recorder) => recorder.calls.includes("clearRect"))).toBe(true);
    // 三块直方图都有面积填充，示波器有密度点。
    expect(recorders.slice(0, 3).every((recorder) => recorder.calls.includes("fill"))).toBe(true);
    expect(recorders[3]?.calls).toContain("fillRect");
    expect(TestResizeObserver.observed).toHaveLength(4);
  });

  it("falls back to window resize when ResizeObserver is unavailable", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function getContextSpy(this: HTMLCanvasElement) {
        return contextRecorder(this).context;
      });

    const host = await render(DATA);
    expect(host.querySelectorAll("canvas")).toHaveLength(4);
    expect(getContext).toHaveBeenCalled();

    // 没有 ResizeObserver 时窗口 resize 就是唯一的重绘触发点，不能抛错。
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(host.querySelector(".reference-scopes")).not.toBeNull();
  });
});
