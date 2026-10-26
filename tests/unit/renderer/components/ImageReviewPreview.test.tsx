// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { ImageReviewPreview } from "../../../../src/renderer/components/ImageReviewPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

function assetFixture(extension = "png") {
  return {
    id: "asset-1",
    title: "a.png",
    path: "D:\\refs\\a.png",
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
        // 预览取色走主进程（color.sampleImage）；默认返回一个固定像素。
        color: {
          sampleImage: vi.fn(async () => ({
            hex: "#123456",
            alpha: 255,
            decodedWidth: 100,
            decodedHeight: 50,
          })),
        },
        system: {
          writeClipboard: vi.fn(async () => undefined),
          getPreferences: vi.fn(async () => ({
            previewSettings: PREVIEW_SETTINGS_DEFAULTS,
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

  it("shows the Preview-style zoom menu, fit, rotate and checker controls", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    expect(host.querySelector("[role='combobox'][aria-label='适配窗口']")).toBeNull();
    expect(host.querySelector("[aria-label='适配窗口']")).toBeTruthy();
    expect(host.querySelector("[aria-label='旋转 90°']")).toBeTruthy();
    expect(host.querySelector("[aria-label='棋盘透明背景']")).toBeTruthy();
    expect(host.querySelector("[aria-label='像素取色']")).toBeTruthy();
    expect(host.querySelector(".preview-color-bar")).toBeTruthy();
  });

  it("starts on a dark canvas with checkerboard disabled", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    expect(host.querySelector<HTMLElement>(".image-preview-viewport-stage")?.style.background)
      .toBe("var(--preview-canvas, #0F1119)");
    expect(host.querySelector("[aria-label='棋盘透明背景']")?.getAttribute("aria-pressed"))
      .toBe("false");
  });

  it("uses the neutral application canvas in a managed right-panel session", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} managed />);
    });
    expect(host.querySelector<HTMLElement>(".image-preview-viewport-stage")?.style.background)
      .toBe("var(--surface-1, #1d201f)");
  });

  it("portals managed controls out of the media viewport", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    const controls = document.createElement("div");
    controls.className = "external-controls";
    document.body.append(controls);
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} managed controlsTarget={controls} />);
    });
    expect(host.querySelector(".image-preview-toolbar")).toBeNull();
    expect(controls.querySelector(".image-preview-toolbar")).toBeTruthy();
  });

  it("enables the eyedropper without forcing custom-scheme images through CORS", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='像素取色']")?.click();
    });
    expect(host.querySelector(".image-review-img")?.classList.contains("eyedrop")).toBe(true);
    expect(host.querySelector(".image-review-img")?.getAttribute("crossorigin")).toBeNull();
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

  it("copies an extracted palette color inline without opening a workbench", async () => {
    const color = { rgb: [12, 34, 56] as [number, number, number], hex: "#0c2238", count: 10 };
    const writeClipboard = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        media: { palette: vi.fn(async () => [color]) },
        filesystem: { previewToken: vi.fn() },
        system: {
          writeClipboard,
          getPreferences: vi.fn(async () => ({ previewSettings: PREVIEW_SETTINGS_DEFAULTS })),
        },
      },
    });
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="复制颜色 #0c2238"]')?.click();
    });
    expect(writeClipboard).toHaveBeenCalledWith("#0c2238");
  });

  it("does not let the transformed rect size change the sample point", async () => {
    // 关键回归：<img> 自身带 translate/rotate/scale，getBoundingClientRect()
    // 返回**变换后**的外框，其宽高随缩放变化。旧实现拿它当布局基准，
    // 于是同一个屏幕点在不同缩放下会算出不同的 u/v —— 取色整体漂移。
    //
    // 用「rect 尺寸变化时结果必须不变」来卡这个 bug：
    // 与具体 zoom 数值无关，也不复制实现里的缩放公式。
    installRefCanvas();
    type SampleInput = { assetId: string; u: number; v: number };
    const sampleImage = vi.fn(async (_input: SampleInput) => ({
      hex: "#123456",
      alpha: 255,
      decodedWidth: 100,
      decodedHeight: 50,
    }));
    window.refCanvas.color.sampleImage = sampleImage;
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    const image = host.querySelector<HTMLImageElement>(".image-review-img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 100 },
      naturalHeight: { configurable: true, value: 50 },
      offsetWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 100 },
    });

    // 元素中心固定 (300, 140)；只改 rect 的宽高，模拟不同缩放倍数。
    const rectAt = (scale: number): DOMRect =>
      ({
        left: 300 - (200 * scale) / 2,
        top: 140 - (100 * scale) / 2,
        width: 200 * scale,
        height: 100 * scale,
        right: 300 + (200 * scale) / 2,
        bottom: 140 + (100 * scale) / 2,
        x: 300 - (200 * scale) / 2,
        y: 140 - (100 * scale) / 2,
        toJSON: () => ({}),
      });

    const clickAt = async (scale: number) => {
      const rectSpy = vi.spyOn(image, "getBoundingClientRect");
      rectSpy.mockReturnValue(rectAt(scale));
      await act(async () => {
        host.querySelector<HTMLButtonElement>("[aria-label='像素取色']")?.click();
      });
      await act(async () => {
        image.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 250, clientY: 140 }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      rectSpy.mockRestore();
    };

    await clickAt(1);
    await clickAt(2);
    await clickAt(4);

    expect(sampleImage).toHaveBeenCalledTimes(3);
    const results = sampleImage.mock.calls.map(
      (call) => (call[0] as unknown as { u: number; v: number }).u,
    );
    // 同一屏幕点 = 同一源像素，与缩放无关。
    expect(results[1]).toBeCloseTo(results[0], 9);
    expect(results[2]).toBeCloseTo(results[0], 9);
  });


  it("samples the source pixel through the main process and copies its HEX value", async () => {
    const writeClipboard = vi.fn(async () => undefined);
    installRefCanvas();
    window.refCanvas.system.writeClipboard = writeClipboard;
    // 取色现在由主进程解码源文件单像素（不再读 DOM canvas：源是缩略图、
    // 坐标乘错尺寸、HDR 滤镜都会偏值）。
    const sampleImage = vi.fn(async () => ({
      hex: "#123456",
      alpha: 255,
      decodedWidth: 100,
      decodedHeight: 50,
    }));
    window.refCanvas.color.sampleImage = sampleImage;
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    const image = host.querySelector<HTMLImageElement>(".image-review-img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 100 },
      naturalHeight: { configurable: true, value: 50 },
      // 布局尺寸不受 transform 影响：取色的归一化必须用它，
      // 不能用被缩放/旋转污染过的 getBoundingClientRect。
      offsetWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 100 },
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      right: 210,
      bottom: 120,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='像素取色']")?.click();
    });
    await act(async () => {
      // 盒子 200×100、图片 100×50（同宽高比，无留白），点击落在正中心。
      image.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: 110,
        clientY: 70,
      }));
      await Promise.resolve();
    });
    expect(sampleImage).toHaveBeenCalledTimes(1);
    expect(sampleImage).toHaveBeenCalledWith({
      assetId: asset.id,
      u: 0.5,
      v: 0.5,
    });
    const sample = host.querySelector<HTMLButtonElement>('[aria-label="复制 #123456"]');
    expect(sample).toBeTruthy();
    await act(async () => sample?.click());
    expect(writeClipboard).toHaveBeenCalledWith("#123456");
  });
});