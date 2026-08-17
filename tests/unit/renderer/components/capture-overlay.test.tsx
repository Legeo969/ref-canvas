// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCaptureCrop,
  CaptureOverlay,
} from "../../../../src/renderer/components/CaptureOverlay";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// jsdom 缺 PointerEvent 构造器；给 window 补一个最小实现，供 CaptureOverlay
// 的 onPointerDown/Move 派发真实指针事件用。
beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId = 1;
      pointerType = "mouse";
      isPrimary = true;
    }
    Object.defineProperty(window, "PointerEvent", {
      value: PointerEventPolyfill,
      writable: true,
      configurable: true,
    });
  }
});

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

describe("CaptureOverlay keyboard isolation", () => {
  const source = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 960, height: 540 };
  const roots: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    // jsdom 的 HTMLImageElement 没有 decode()；saveSelection 里会 await 它。
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    // jsdom 的 HTMLCanvasElement 没有 getContext()/toDataURL()；
    // saveSelection 里需要画布导出 data URL。
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: vi.fn(() => "data:image/png;base64,iVBORw0KGgo="),
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("prevents the Enter default so the save key cannot leak to the titlebar", async () => {
    const onComplete = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <CaptureOverlay source={source} onComplete={onComplete} onCancel={onCancel} />,
      );
    });

    // 模拟框选出一个有效选区。
    const overlay = host.querySelector<HTMLElement>(".capture-overlay")!;
    // jsdom 中 getBoundingClientRect 全 0，导致 crop 计算为 null 而提前 return；
    // 补一个虚拟视口尺寸让保存流程走通。
    Object.defineProperty(overlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0 }),
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 300 }),
      );
    });

    // Enter 保存：必须阻止默认行为（否则窗口恢复焦点后焦点若落在标题栏
    // 按钮上，会意外 dispatch refcanvas:open-ai-workbench 打开 AI 面板）。
    let prevented = false;
    let stopped = false;
    const enter = new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(enter, "preventDefault", {
      value: () => { prevented = true; },
    });
    Object.defineProperty(enter, "stopPropagation", {
      value: () => { stopped = true; },
    });
    await act(async () => {
      window.dispatchEvent(enter);
      await Promise.resolve();
    });
    // 核心断言：Enter 保存必须 preventDefault + stopPropagation，防止焦点
    // 落在标题栏按钮时默认行为泄漏成点击（dispatch refcanvas:open-ai-workbench）。
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(onComplete).toHaveBeenCalled();
  });

  it("prevents the Escape default when cancelling", async () => {
    const onCancel = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <CaptureOverlay source={source} onComplete={async () => undefined} onCancel={onCancel} />,
      );
    });
    let prevented = false;
    const esc = new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(esc, "preventDefault", {
      value: () => { prevented = true; },
    });
    await act(async () => {
      window.dispatchEvent(esc);
    });
    expect(prevented).toBe(true);
    expect(onCancel).toHaveBeenCalled();
  });
});
