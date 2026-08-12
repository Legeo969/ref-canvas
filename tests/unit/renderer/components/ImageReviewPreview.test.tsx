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

  it("shows the Found-style zoom menu, fit, rotate and checker controls", async () => {
    installRefCanvas();
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    expect(host.querySelector("[role='combobox'][aria-label='适配窗口']")).toBeTruthy();
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
      .toBe("var(--found-canvas, #0F1119)");
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

  it("copies an extracted palette color inline without opening a workbench", async () => {
    const color = { rgb: [12, 34, 56] as [number, number, number], hex: "#0c2238", count: 10 };
    const writeClipboard = vi.fn(async () => undefined);
    Object.assign(window, {
      refCanvas: {
        media: { palette: vi.fn(async () => [color]) },
        filesystem: { previewToken: vi.fn() },
        system: {
          writeClipboard,
          getPreferences: vi.fn(async () => ({ foundSettings: FOUND_SETTINGS_DEFAULTS })),
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

  it("samples the visible pixel inline and copies its HEX value", async () => {
    const writeClipboard = vi.fn(async () => undefined);
    installRefCanvas();
    window.refCanvas.system.writeClipboard = writeClipboard;
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([18, 52, 86, 255]) }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    const { host, root, asset } = render();
    await act(async () => {
      root.render(<ImageReviewPreview asset={asset} />);
    });
    const image = host.querySelector<HTMLImageElement>(".image-review-img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 100 },
      naturalHeight: { configurable: true, value: 50 },
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
      image.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: 110,
        clientY: 70,
      }));
      await Promise.resolve();
    });
    expect(getImageData).toHaveBeenLastCalledWith(50, 25, 1, 1);
    const sample = host.querySelector<HTMLButtonElement>('[aria-label="复制 #123456"]');
    expect(sample).toBeTruthy();
    await act(async () => sample?.click());
    expect(writeClipboard).toHaveBeenCalledWith("#123456");
  });
});
