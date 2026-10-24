// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCaptureCrop,
  CaptureOverlay,
} from "../../../../src/renderer/components/CaptureOverlay";
import type { CaptureCrop } from "../../../../src/shared/contracts";

// 解耦 i18n 目录聚合：这个组件只需要 translate 返回文本，不需要拉进整个
// catalog（目录聚合是全局的，别的链路加 key 时测试不该被连坐）。
vi.mock("../../../../src/renderer/app/i18n", () => ({
  translate: (key: string) => key,
}));

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
        7,
        { left: 100, top: 50, width: 320, height: 180 },
        960,
        540,
        1920,
        1080,
      ),
    ).toEqual({
      displayId: 7,
      sourceLeft: 200,
      sourceTop: 100,
      sourceWidth: 640,
      sourceHeight: 360,
      outputWidth: 640,
      outputHeight: 360,
    });
  });

  it("clamps a selection that runs past the captured screen edge", () => {
    // 覆盖窗口与显示器之间可能有 1–2px 偏差（尤其混合 DPI）：框选贴边时
    // 结果必须夹回源图范围内，否则主进程的 sharp.extract 直接报错。
    expect(
      calculateCaptureCrop(
        7,
        { left: 900, top: 500, width: 100, height: 100 },
        960,
        540,
        1920,
        1080,
      ),
    ).toEqual({
      displayId: 7,
      sourceLeft: 1800,
      sourceTop: 1000,
      sourceWidth: 120,
      sourceHeight: 80,
      outputWidth: 200,
      outputHeight: 200,
    });
  });

  it("rejects accidental clicks and invalid viewport dimensions", () => {
    expect(
      calculateCaptureCrop(
        7,
        { left: 10, top: 10, width: 1, height: 1 },
        960,
        540,
        1920,
        1080,
      ),
    ).toBeNull();
    expect(
      calculateCaptureCrop(
        7,
        { left: 10, top: 10, width: 100, height: 100 },
        0,
        540,
        1920,
        1080,
      ),
    ).toBeNull();
  });
});

describe("CaptureOverlay interactions", () => {
  // 源图 1920×1080、视口 960×540 = 2 倍 DPI：读数与裁剪都必须乘 2。
  const source = {
    displayId: 7,
    imageUrl: "refbrowse://preview/11111111-1111-4111-8111-111111111111",
    width: 1920,
    height: 1080,
  };
  const roots: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    // jsdom 的 HTMLImageElement 没有 decode()；saveSelection 里会 await 它。
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function mount(
    onComplete = vi.fn(async () => undefined),
    onCancel = vi.fn(),
    extraProps: {
      passive?: boolean;
      onSelectionActivity?: (active: boolean) => void;
    } = {},
  ) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <CaptureOverlay
          source={source}
          passive={extraProps.passive}
          onSelectionActivity={extraProps.onSelectionActivity}
          onComplete={onComplete}
          onCancel={onCancel}
        />,
      );
    });
    const overlay = host.querySelector<HTMLElement>(".capture-overlay")!;
    // jsdom 中 getBoundingClientRect 全 0，导致 crop 计算为 null；
    // 补一个虚拟视口尺寸让保存与读数流程走通。
    Object.defineProperty(overlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0 }),
    });
    // 视口尺寸在挂载后的 effect 里量过一次（jsdom 当时是 0），补一次 resize
    // 让读数换算拿到真实视口。
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    return { overlay, onComplete, onCancel, root };
  }

  async function drag(overlay: HTMLElement, from: [number, number], to: [number, number]) {
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: from[0], clientY: from[1] }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: to[0], clientY: to[1] }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
  }

  it("prevents the Enter default so the save key cannot leak to the titlebar", async () => {
    const { overlay, onComplete } = await mount();
    await drag(overlay, [100, 100], [300, 300]);

    // Enter 保存：必须阻止默认行为（否则窗口恢复焦点后焦点若落在标题栏
    // 按钮上，会泄漏成意外点击）。
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
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(onComplete).toHaveBeenCalled();
  });

  it("prevents the Escape default when cancelling", async () => {
    const { onCancel } = await mount();
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

  it("cancels on right click, like the QQ muscle memory", async () => {
    const { overlay, onCancel, onComplete } = await mount();
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 2, clientX: 50, clientY: 50 }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("saves on double click when a selection exists", async () => {
    const { overlay, onComplete } = await mount();
    await drag(overlay, [100, 100], [320, 260]);
    await act(async () => {
      overlay.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLeft: 200, sourceTop: 200, sourceWidth: 440, sourceHeight: 320 }),
    );
  });

  it("captures the full screen on double click without a selection", async () => {
    const { overlay, onComplete } = await mount();
    await act(async () => {
      overlay.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    // QQ 行为：双击空白 = 全屏截图。crop 覆盖整个视口。
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLeft: 0,
        sourceTop: 0,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    );
  });

  it("moves the selection when dragging inside it", async () => {
    const { overlay } = await mount();
    await drag(overlay, [100, 100], [400, 300]);
    const before = overlay.querySelector<HTMLElement>(".capture-selection")!;
    expect([before.style.left, before.style.top]).toEqual(["100px", "100px"]);

    // 在选区内部按下并拖动：整体移动，而不是重画新选区。
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 250, clientY: 200 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 350, clientY: 260 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });

    const after = overlay.querySelector<HTMLElement>(".capture-selection")!;
    // 向右移了 100、向下移了 60；尺寸不变。
    expect([after.style.left, after.style.top, after.style.width, after.style.height]).toEqual(
      ["200px", "160px", "300px", "200px"],
    );
  });

  it("resizes the selection when dragging a corner handle", async () => {
    const { overlay } = await mount();
    await drag(overlay, [100, 100], [400, 300]);

    // 拖右下角手柄（se）：选区左上角不动，宽高跟着变。
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 400, clientY: 300 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 500, clientY: 360 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });

    const sel = overlay.querySelector<HTMLElement>(".capture-selection")!;
    expect([sel.style.left, sel.style.top, sel.style.width, sel.style.height]).toEqual(
      ["100px", "100px", "400px", "260px"],
    );
  });

  it("keeps the selection bright by punching the shade around it", async () => {
    const { overlay } = await mount();
    // 无选区：整屏一块遮罩提示截图模式。
    expect(overlay.querySelectorAll(".capture-shade")).toHaveLength(1);

    await drag(overlay, [100, 100], [400, 300]);
    // 有选区：整屏遮罩撤掉，改由选区元素的 9999px 外扩阴影把选区挖空
    // （选区内透出底图原始亮度）。
    expect(overlay.querySelectorAll(".capture-shade")).toHaveLength(0);
    const sel = overlay.querySelector<HTMLElement>(".capture-selection")!;
    expect(sel.className).toBe("capture-selection");
  });

  it("follows the selection with the action toolbar", async () => {
    const { overlay } = await mount();
    const actions = overlay.querySelector<HTMLElement>(".capture-actions")!;
    // 无选区：固定右下角（无内联定位）。
    expect(actions.style.left).toBe("");

    await drag(overlay, [100, 100], [400, 300]);
    // 有选区：工具条贴到选区右下角（内联 left/top 覆盖 CSS 默认）。
    expect(actions.style.left).not.toBe("");
    expect(actions.style.top).not.toBe("");
    const left = parseFloat(actions.style.left);
    const top = parseFloat(actions.style.top);
    // 右对齐选区右缘（向左收回工具条宽度），位于选区下缘下方。
    expect(left).toBeGreaterThan(250);
    expect(left).toBeLessThanOrEqual(400);
    expect(top).toBeGreaterThanOrEqual(300);
  });

  it("shows the physical-pixel readout while dragging and matches the saved size", async () => {
    const { overlay, onComplete } = await mount();
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 320, clientY: 260 }),
      );
    });

    const badge = overlay.querySelector(".capture-size");
    expect(badge).not.toBeNull();
    // 960×540 视口对应 1920×1080 源图：选区 220×160 CSS 像素 → 440×320 物理像素。
    expect(badge!.textContent).toBe("440 × 320");

    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
    await act(async () => {
      overlay.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    // 读数与真正交给主进程的裁剪尺寸必须一致，否则用户看到的是假数字。
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ outputWidth: 440, outputHeight: 320 }),
    );
  });
});

describe("CaptureOverlay cross-screen arbitration", () => {
  const source = {
    displayId: 7,
    imageUrl: "refbrowse://preview/11111111-1111-4111-8111-111111111111",
    width: 1920,
    height: 1080,
  };
  const roots: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function mount(extraProps: {
    passive?: boolean;
    onSelectionActivity?: (active: boolean) => void;
    onComplete?: (crop: CaptureCrop) => Promise<void>;
    onCancel?: () => void;
  } = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onComplete = extraProps.onComplete ?? vi.fn(async () => undefined);
    const onCancel = extraProps.onCancel ?? vi.fn();
    const render = (passive: boolean) =>
      act(async () => {
        root.render(
          <CaptureOverlay
            source={source}
            passive={passive}
            onSelectionActivity={extraProps.onSelectionActivity}
            onComplete={onComplete}
            onCancel={onCancel}
          />,
        );
      });
    await render(extraProps.passive ?? false);
    const overlay = host.querySelector<HTMLElement>(".capture-overlay")!;
    Object.defineProperty(overlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0 }),
    });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    return { overlay, root, render, onComplete, onCancel };
  }

  it("ignores all pointer input while another screen is selecting", async () => {
    const onSelectionActivity = vi.fn();
    const { overlay, onComplete } = await mount({
      passive: true,
      onSelectionActivity,
    });

    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 300 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
    // passive 屏是冻结画面的纯遮罩：不框选、不广播、不保存。
    expect(overlay.querySelectorAll(".capture-selection")).toHaveLength(0);
    expect(onSelectionActivity).not.toHaveBeenCalled();

    // 双击空白 = 全屏截图也不允许从 passive 屏触发。
    await act(async () => {
      overlay.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("keeps Escape as the global way out of a passive screen", async () => {
    const { onCancel } = await mount({ passive: true });
    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("reports selection activity so other screens can follow", async () => {
    const onSelectionActivity = vi.fn();
    const { overlay } = await mount({ onSelectionActivity });

    // 从无到有开始框选：其余屏应转纯遮罩。
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 300 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
    expect(onSelectionActivity).toHaveBeenCalledWith(true);

    // 误点清框（选区太小）：其余屏应恢复可框选。
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 500, clientY: 400 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
    expect(onSelectionActivity).toHaveBeenCalledWith(false);
    expect(onSelectionActivity).toHaveBeenCalledTimes(2);
  });

  it("drops its own selection the moment it becomes passive", async () => {
    const { overlay, render } = await mount();
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 300 }),
      );
    });
    await act(async () => {
      overlay.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
    expect(overlay.querySelectorAll(".capture-selection")).toHaveLength(1);

    // 他屏开始框选：本屏选区必须消失，全局任一时刻只有一个选区。
    await render(true);
    expect(overlay.querySelectorAll(".capture-selection")).toHaveLength(0);
    expect(overlay.querySelectorAll(".capture-shade")).toHaveLength(1);
  });
});
