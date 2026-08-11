// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectoryEntry, RefCanvasApi } from "../../../../src/shared/contracts";
import { DirectoryQuickPreview } from "../../../../src/renderer/components/DirectoryQuickPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../../../src/renderer/components/ModelPreview", () => ({
  ModelPreview: ({ asset }: { asset: { extension: string; previewUrl: string } }) => (
    <div
      className="model-preview-test"
      data-extension={asset.extension}
      data-source={asset.previewUrl}
    />
  ),
}));

vi.mock("../../../../src/renderer/components/VideoPreview", () => ({
  VideoPreview: ({ asset }: { asset: { path: string; previewUrl: string } }) => (
    <div
      className="video-preview-test"
      data-path={asset.path}
      data-source={asset.previewUrl}
    />
  ),
}));

vi.mock("../../../../src/renderer/components/AudioPreview", () => ({
  AudioPreview: ({ asset }: { asset: { previewUrl: string } }) => (
    <div className="audio-preview-test">
      <audio src={asset.previewUrl} controls />
    </div>
  ),
}));

vi.mock("../../../../src/renderer/components/HdrPreview", () => ({
  HdrPreview: ({ source, extension }: { source: string; extension: string }) => (
    <div
      className="hdr-preview-test"
      data-extension={extension}
      data-source={source}
    />
  ),
}));

describe("DirectoryQuickPreview", () => {
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function renderPreview(extension: string): Promise<HTMLElement> {
    const entry: DirectoryEntry = {
      path: `D:\\private\\sample.${extension}`,
      name: `sample.${extension}`,
      isDirectory: false,
      extension,
      size: 1024,
    };
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          previewToken: vi.fn(async () => "12345678-1234-1234-1234-123456789abc"),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <DirectoryQuickPreview
          entry={entry}
          files={[entry]}
          query=""
          onNavigate={vi.fn()}
          onOpen={vi.fn()}
          onReveal={vi.fn()}
          onCopyPath={vi.fn()}
          onTag={vi.fn()}
          onTrash={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    return host;
  }

  it("uses raw streams for browser images, professional video, audio and PDF", async () => {
    let host = await renderPreview("png");
    expect(host.querySelector(".directory-preview-stage img")?.getAttribute("src"))
      .toBe("refbrowse://preview/12345678-1234-1234-1234-123456789abc");

    await act(async () => root?.unmount());
    root = null;
    host = await renderPreview("mp4");
    expect(
      host.querySelector<HTMLElement>(".video-preview-test")?.dataset.source,
    ).toBe(
      "refbrowse://preview/12345678-1234-1234-1234-123456789abc",
    );

    await act(async () => root?.unmount());
    root = null;
    host = await renderPreview("wav");
    expect(host.querySelector("audio")?.getAttribute("src")).toContain(
      "refbrowse://preview/",
    );

    await act(async () => root?.unmount());
    root = null;
    host = await renderPreview("pdf");
    const pdfSource = host.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(pdfSource).toContain(
      "refbrowse://preview/",
    );
    expect(pdfSource).not.toContain("D:\\private");
  });

  it.each(["exr", "hdr"])("uses WebGL tone mapping for %s", async (extension) => {
    const host = await renderPreview(extension);
    const preview = host.querySelector<HTMLElement>(".hdr-preview-test");
    expect(preview?.dataset.extension).toBe(extension);
    expect(preview?.dataset.source).toContain("refbrowse://thumbnail/");
    expect(preview?.dataset.source).not.toContain("refbrowse://preview/");
  });

  it("uses proxy thumbnails for converted images and DCC files", async () => {
    let host = await renderPreview("exr");
    expect(host.querySelector(".hdr-preview-test")).toBeTruthy();

    await act(async () => root?.unmount());
    root = null;
    host = await renderPreview("psd");
    expect(host.querySelector(".directory-preview-stage img")?.getAttribute("src"))
      .toContain("refbrowse://thumbnail/");
  });

  it.each(["glb", "gltf", "fbx", "obj", "stl"])(
    "reuses ModelPreview for %s",
    async (extension) => {
      const host = await renderPreview(extension);
      const model = host.querySelector<HTMLElement>(".model-preview-test");
      expect(model?.dataset.extension).toBe(extension);
      expect(model?.dataset.source).toBe(
        `refbrowse://preview/12345678-1234-1234-1234-123456789abc/sample.${extension}`,
      );
    },
  );

  it("shows an explicit extension placeholder when Shell has no thumbnail", async () => {
    const host = await renderPreview("abc");
    const image = host.querySelector<HTMLImageElement>(
      ".directory-preview-stage img",
    );
    await act(async () => {
      image?.dispatchEvent(new window.Event("error", { bubbles: true }));
    });
    expect(host.querySelector(".asset-placeholder")?.textContent).toContain(
      "ABC",
    );
  });

  it("keeps Space preview read-only with details, navigation and close only", async () => {
    const host = await renderPreview("png");
    expect(host.querySelector(".directory-preview-actions")).toBeNull();
    expect(host.textContent).toContain("D:\\private\\sample.png");
    expect(host.querySelector(".preview-close")).toBeTruthy();
    expect(host.querySelector('[aria-label*="复制"]')).toBeNull();
    expect(host.querySelector('[aria-label*="删除"]')).toBeNull();
  });

  it("applies the shared focused class so focus changes the quick-preview layout", async () => {
    const host = await renderPreview("png");
    const preview = host.querySelector(".directory-preview");
    expect(preview?.classList.contains("preview-session-focused")).toBe(false);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    expect(preview?.classList.contains("preview-session-focused")).toBe(true);
    expect(preview?.getAttribute("data-preview-focused")).toBe("true");
    expect(host.querySelector('[aria-label="退出聚焦预览"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});
