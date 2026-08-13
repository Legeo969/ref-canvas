// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../../../src/renderer/app/found-settings", () => ({
  alphaBackgroundStyle: () => "none",
  useFoundSettings: () => ({ ocioConfigPath: null }),
}));

vi.mock("../../../../src/renderer/components/ImagePreviewViewport", () => ({
  ImagePreviewViewport: ({ assetKey }: { assetKey: string }) => <div data-testid="image-viewport" data-asset-key={assetKey} />,
}));

vi.mock("../../../../src/renderer/components/useRetryingPreviewUrl", () => ({
  useRetryingPreviewUrl: (source: string) => ({
    url: source,
    status: "ready",
    markReady: vi.fn(),
    markError: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock("../../../../src/renderer/components/PanoramaPreview", () => ({
  PanoramaPreview: () => <div data-testid="environment-preview" />,
}));

import { HdrPreview } from "../../../../src/renderer/components/HdrPreview";

describe("HDR preview controls", () => {
  const roots: Root[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens exposure as a compact anchored card and updates the visible exposure", async () => {
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
      },
    });
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    document.body.append(host, toolbar);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<HdrPreview source="refasset://hdr" extension="hdr" controlsTarget={toolbar} />);
    });
    const trigger = toolbar.querySelector<HTMLButtonElement>('[aria-label="调整曝光"]');
    expect(trigger).toBeTruthy();
    vi.spyOn(trigger!, "getBoundingClientRect").mockReturnValue({
      x: 40, y: 220, left: 40, top: 220, right: 80, bottom: 260,
      width: 40, height: 40, toJSON: () => ({}),
    });

    await act(async () => trigger?.click());
    const menu = document.body.querySelector<HTMLElement>(".hdr-exposure-anchor-menu");
    expect(menu).toBeTruthy();
    expect(toolbar.querySelector(".hdr-exposure-popover")).toBeNull();
    expect(menu?.getAttribute("data-placement")).toBe("top-center");

    const input = menu?.querySelector<HTMLInputElement>('[aria-label="曝光值"]');
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(menu?.querySelector("output")?.textContent).toBe("+1.0 EV");
    expect(host.querySelector<HTMLElement>(".hdr-preview")?.style.getPropertyValue("--hdr-exposure")).toBe("2");
  });

  it("keeps HDR popovers mutually exclusive and dismisses them on outside click or Escape", async () => {
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
      },
    });
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    document.body.append(host, toolbar);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<HdrPreview source="refasset://hdr" extension="hdr" controlsTarget={toolbar} />));

    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="调整曝光"]')?.click());
    expect(document.body.querySelector(".hdr-exposure-anchor-menu")).toBeTruthy();
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="OCIO 色彩管理"]')?.click());
    expect(document.body.querySelector(".hdr-exposure-anchor-menu")).toBeNull();
    expect(document.body.querySelector(".hdr-ocio-anchor-menu")).toBeTruthy();

    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.body.querySelector(".hdr-ocio-anchor-menu")).toBeNull();
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="调整曝光"]')?.click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector(".hdr-exposure-anchor-menu")).toBeNull();
  });

  it("opens OCIO and multichannel controls as anchored cards outside the toolbar", async () => {
    const multichannelAnchor = document.createElement("button");
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    document.body.append(host, toolbar, multichannelAnchor);
    vi.spyOn(multichannelAnchor, "getBoundingClientRect").mockReturnValue({
      x: 90, y: 220, left: 90, top: 220, right: 130, bottom: 260,
      width: 40, height: 40, toJSON: () => ({}),
    });
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
        filesystem: { previewToken: vi.fn(async () => "token") },
        media: { probe: vi.fn(async () => ({ extra: { defaultLayer: "Beauty", layers: [{ name: "Beauty", components: ["R", "G", "B", "A"] }] } })) },
      },
    });
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<HdrPreview source="refasset://hdr" extension="exr" path="D:\\beauty.exr" controlsTarget={toolbar} multichannelOpen multichannelAnchor={multichannelAnchor} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const ocioTrigger = toolbar.querySelector<HTMLButtonElement>('[aria-label="OCIO 色彩管理"]');
    vi.spyOn(ocioTrigger!, "getBoundingClientRect").mockReturnValue({
      x: 140, y: 220, left: 140, top: 220, right: 180, bottom: 260,
      width: 40, height: 40, toJSON: () => ({}),
    });
    await act(async () => ocioTrigger?.click());

    expect(document.body.querySelector(".hdr-ocio-anchor-menu [aria-label='OCIO 色彩管理菜单']")).toBeTruthy();
    expect(toolbar.querySelector(".hdr-ocio-menu")).toBeNull();
    expect(document.body.querySelector(".hdr-channel-anchor-menu [aria-label='提取多通道']")).toBeTruthy();
    expect(toolbar.querySelector(".hdr-channel-control")).toBeNull();
  });

  it("persists a picked OCIO config and requests a new color-managed preview", async () => {
    const setPreferences = vi.fn(async () => ({
      foundSettings: { ...({} as Record<string, unknown>), ocioConfigPath: "D:\\color\\config.ocio" },
    }));
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
        system: {
          pickFile: vi.fn(async () => ["D:\\color\\config.ocio"]),
          setPreferences,
        },
      },
    });
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    document.body.append(host, toolbar);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<HdrPreview source="refasset://hdr" extension="hdr" controlsTarget={toolbar} />));
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="OCIO 色彩管理"]')?.click());
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>(".hdr-ocio-menu button")]
        .find((button) => button.textContent?.includes("添加新的"))?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setPreferences).toHaveBeenCalledWith({ foundSettings: { ocioConfigPath: "D:\\color\\config.ocio" } });
    expect(host.querySelector('[data-testid="image-viewport"]')?.getAttribute("data-asset-key")).toContain("ocio=");
  });

  it("changes the actual preview request when selecting an OCIO input color space", async () => {
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
      },
    });
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    document.body.append(host, toolbar);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<HdrPreview source="refbrowse://thumbnail/token?size=1920" extension="exr" controlsTarget={toolbar} />));
    const before = host.querySelector('[data-testid="image-viewport"]')?.getAttribute("data-asset-key");

    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="OCIO 色彩管理"]')?.click());
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>(".hdr-ocio-menu button")]
        .find((button) => button.textContent?.includes("ACEScg 1.3"))?.click();
    });

    const after = host.querySelector('[data-testid="image-viewport"]')?.getAttribute("data-asset-key");
    expect(after).not.toBe(before);
    expect(after).toContain("inputColorSpace=ACEScg");
  });

  it("still opens the multichannel card when the EXR has no detected extra layers", async () => {
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    const multichannelAnchor = document.createElement("button");
    document.body.append(host, toolbar, multichannelAnchor);
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
        filesystem: { previewToken: vi.fn(async () => "token") },
        media: { probe: vi.fn(async () => ({ extra: {} })) },
      },
    });
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<HdrPreview source="refasset://hdr" extension="exr" path="D:\flat.exr" controlsTarget={toolbar} multichannelOpen multichannelAnchor={multichannelAnchor} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const card = document.body.querySelector(".hdr-channel-anchor-menu");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("Main RGBA");
  });

  it("retries a transient EXR probe failure without requiring navigation or restart", async () => {
    vi.useFakeTimers();
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("WORKER_JOB_TIMEOUT"))
      .mockResolvedValueOnce({
        extra: {
          defaultLayer: "Beauty",
          layers: [{ name: "Beauty", components: ["R", "G", "B", "A"] }],
        },
      });
    Object.assign(window, {
      refCanvas: {
        color: { getStatus: vi.fn(async () => ({ detectedOcio: null })) },
        filesystem: { previewToken: vi.fn(async () => "token") },
        media: { probe },
      },
    });
    const host = document.createElement("div");
    const toolbar = document.createElement("div");
    const multichannelAnchor = document.createElement("button");
    document.body.append(host, toolbar, multichannelAnchor);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<HdrPreview source="refasset://hdr" extension="exr" path="D:\\beauty.exr" controlsTarget={toolbar} multichannelOpen multichannelAnchor={multichannelAnchor} />);
      await Promise.resolve();
    });
    expect(probe).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(probe).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector<HTMLSelectElement>(".hdr-layer-select select")?.textContent).toContain("Beauty");
  });
});
