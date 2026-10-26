// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ImagePreviewViewport } from "../../../../src/renderer/components/ImagePreviewViewport";

/**
 * 像素级显示是自动的：没有开关，没有 1:1 按钮。
 * 显示比例到 1:1 及以上时自动关掉插值，往下缩再自动打开。
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** nativeZoom 是「1:1 对应的 zoom 倍数」。 */
function render(nativeZoom: number) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <ImagePreviewViewport
        assetKey="a"
        checkerBackground="none"
        nativeZoom={nativeZoom}
      >
        {(state) => <img alt="" style={state.style} />}
      </ImagePreviewViewport>,
    );
  });
  return host;
}

function wheel(target: HTMLElement, deltaY: number) {
  act(() => {
    target.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY,
        clientX: 400,
        clientY: 300,
      }),
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("ImagePreviewViewport automatic pixel view", () => {
  it("starts smooth because fit is below 1:1 for a downscaled image", () => {
    // nativeZoom=5 表示 1:1 在 5 倍处，适配状态远低于 1:1。
    const el = render(5);
    expect(el.querySelector("img")?.style.imageRendering).toBe("auto");
  });

  it("starts pixelated when the fitted image is already at or past 1:1", () => {
    // nativeZoom <= 1：适配时就已经不小于 1:1，不该再平滑。
    const el = render(1);
    expect(el.querySelector("img")?.style.imageRendering).toBe("pixelated");
  });

  it("switches to pixelated by zooming in, with no toggle to press", () => {
    const el = render(5);
    const stage = el.querySelector<HTMLElement>(".image-preview-viewport-stage")!;
    // 连续放大直到超过 1:1（nativeZoom=5）。
    for (let i = 0; i < 12; i += 1) wheel(stage, -120);
    expect(el.querySelector("img")?.style.imageRendering).toBe("pixelated");
  });

  it("returns to smooth rendering when zooming back out", () => {
    const el = render(5);
    const stage = el.querySelector<HTMLElement>(".image-preview-viewport-stage")!;
    for (let i = 0; i < 12; i += 1) wheel(stage, -120);
    expect(el.querySelector("img")?.style.imageRendering).toBe("pixelated");
    for (let i = 0; i < 16; i += 1) wheel(stage, 120);
    expect(el.querySelector("img")?.style.imageRendering).toBe("auto");
  });

  it("has no pixel-view toggle and no 1:1 button", () => {
    const el = render(5);
    const labels = Array.from(el.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels.some((label) => label?.includes("1:1"))).toBe(false);
    expect(labels.some((label) => label?.includes("interpolation"))).toBe(false);
    expect(labels.some((label) => label?.includes("插值"))).toBe(false);
  });
});
