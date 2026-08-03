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
          onMaterialize={vi.fn()}
          onAddToCollection={vi.fn()}
          onTag={vi.fn()}
          onTrash={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    return host;
  }

  it("uses raw streams for browser images, video, audio and PDF", async () => {
    let host = await renderPreview("png");
    expect(host.querySelector(".directory-preview-stage img")?.getAttribute("src"))
      .toBe("refbrowse://preview/12345678-1234-1234-1234-123456789abc");

    await act(async () => root?.unmount());
    root = null;
    host = await renderPreview("mp4");
    expect(host.querySelector("video")?.getAttribute("src")).toContain(
      "refbrowse://preview/",
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

  it("uses proxy thumbnails for converted images and DCC files", async () => {
    let host = await renderPreview("exr");
    expect(host.querySelector(".directory-preview-stage img")?.getAttribute("src"))
      .toContain("refbrowse://thumbnail/");

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
});
