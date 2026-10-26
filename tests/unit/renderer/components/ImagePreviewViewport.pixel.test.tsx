// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ImagePreviewViewport } from "../../../../src/renderer/components/ImagePreviewViewport";

/**
 * 像素级查看：开关打开后必须关掉浏览器的平滑插值，
 * 否则放大到 1:1 以上仍然是一团模糊。
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(nativeZoom?: number) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  let lastStyle: Record<string, unknown> = {};
  act(() => {
    root?.render(
      <ImagePreviewViewport
        assetKey="a"
        checkerBackground="none"
        nativeZoom={nativeZoom}
      >
        {(state) => {
          lastStyle = state.style as Record<string, unknown>;
          return <img alt="" style={state.style} />;
        }}
      </ImagePreviewViewport>,
    );
  });
  return { getStyle: () => lastStyle };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("ImagePreviewViewport pixel view", () => {
  it("uses smooth rendering by default", () => {
    const { getStyle } = render();
    expect(getStyle().imageRendering).toBe("auto");
  });

  it("turns off interpolation once pixel view is enabled", () => {
    render();
    const button = host?.querySelector<HTMLButtonElement>(
      "[aria-label='关闭插值，放大后单个像素保持锐利'], [aria-label='Turn off interpolation so single pixels stay sharp when magnified']",
    );
    expect(button).toBeTruthy();
    act(() => button?.click());
    const img = host?.querySelector("img");
    expect(img?.style.imageRendering).toBe("pixelated");
  });

  it("exposes a 1:1 zoom control", () => {
    render(5);
    const button = host?.querySelector<HTMLButtonElement>(
      "[aria-label='缩放到 1:1（1 个图像像素对应 1 个屏幕像素）'], [aria-label='Zoom to 1:1 (one image pixel per screen pixel)']",
    );
    expect(button).toBeTruthy();
    expect(button?.textContent).toBe("1:1");
  });
});
