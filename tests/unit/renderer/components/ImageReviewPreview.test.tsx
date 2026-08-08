// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUND_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { ImageReviewPreview } from "../../../../src/renderer/components/ImageReviewPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

function assetFixture(extension = "png") {
  return {
    id: "asset-1",
    title: "a.png",
    previewUrl: "refbrowse://preview/token-1",
    thumbnailUrl: "refbrowse://thumbnail/token-1",
    extension,
    kind: "image" as const,
  };
}

describe("ImageReviewPreview (FND-005)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function installRefCanvas() {
    Object.assign(window, {
      refCanvas: {
        filesystem: { previewToken: vi.fn() },
        system: {
          writeClipboard: vi.fn(async () => undefined),
          getPreferences: vi.fn(async () => ({
            foundSettings: FOUND_SETTINGS_DEFAULTS,
          })),
        },
      },
    });
  }

  function render(extension = "png") {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    return { host, root, asset: assetFixture(extension) };
  }

  it("shows zoom, rotate, fit, 100% and checker controls", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    expect(host.querySelector("[aria-label='放大']")).toBeTruthy();
    expect(host.querySelector("[aria-label='缩小']")).toBeTruthy();
    expect(host.querySelector("[aria-label='适配窗口']")).toBeTruthy();
    expect(host.querySelector("[aria-label='100% 原始大小']")).toBeTruthy();
    expect(host.querySelector("[aria-label='旋转 90°']")).toBeTruthy();
    expect(host.querySelector("[aria-label='棋盘透明背景']")).toBeTruthy();
    expect(host.querySelector("[aria-label='像素取色']")).toBeTruthy();
    expect(host.querySelector("[aria-label='提取主色板']")).toBeTruthy();
  });

  it("enables the eyedropper mode on click", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='像素取色']")?.click();
    });
    expect(host.querySelector(".image-review-img")?.classList.contains("eyedrop")).toBe(true);
  });

  it("shows the layers panel only for layered formats", async () => {
    installRefCanvas();
    const { host, root, asset } = render("psd");
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    const layersButton = host.querySelector("[aria-label='图层']");
    expect(layersButton).toBeTruthy();
    await act(async () => {
      layersButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("保留合成图预览");
  });

  it("does not show the layers panel for plain images", async () => {
    installRefCanvas();
    const { host, root, asset } = render("jpg");
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    expect(host.querySelector("[aria-label='图层']")).toBeNull();
  });
});
