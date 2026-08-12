// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewColorBar } from "../../../../src/renderer/components/PreviewColorBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("PreviewColorBar", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

  it("extracts, expands, collapses, and clears image colors", async () => {
    Object.assign(window, { refCanvas: { media: { palette: vi.fn(async () => ([
      { rgb: [0, 255, 0], hex: "#00ff00", count: 10 },
    ])) }, system: { writeClipboard: vi.fn() } } });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => root.render(<PreviewColorBar assetPath="D:\\refs\\a.png" />));
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="吸取颜色"]')?.click(); await Promise.resolve(); });
    expect(host.querySelector('[aria-label="当前画面色彩栏"]')).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="收起图片颜色"]')?.click());
    expect(host.querySelector('[aria-label="当前画面色彩栏"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="展开图片颜色"]')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="清空颜色"]')?.click());
    expect(host.querySelector('[aria-label="当前画面色彩栏"]')).toBeNull();
  });
});
