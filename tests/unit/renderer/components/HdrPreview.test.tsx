// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { HdrPreview } from "../../../../src/renderer/components/HdrPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN");

describe("HdrPreview flat view rendering", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const renderFlat = async (source: string) => {
    Object.assign(window, {
      refCanvas: {} as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<HdrPreview source={source} extension="exr" />);
    });
    return host;
  };

  it("shows the display-transform <img> as the only media layer", async () => {
    const source = "refbrowse://thumbnail/token?priority=preview&size=1920";
    const host = await renderFlat(source);
    const image = host.querySelector("img.hdr-preview-fallback");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(source);
  });

  it("does not mount a WebGL canvas overlay in flat view", async () => {
    // 打包环境 <img> 无 CORS 许可，WebGL 纹理上传必然抛 SecurityError，
    // 画布只会用黑/白占位覆盖正确的预览图（回归：拖拽布局时黑屏/白闪）。
    const host = await renderFlat(
      "refbrowse://thumbnail/token?priority=preview&size=960",
    );
    expect(host.querySelector(".hdr-preview-canvas")).toBeNull();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("keeps exposure as a CSS brightness variable on the preview root", async () => {
    const host = await renderFlat(
      "refbrowse://thumbnail/token?priority=preview&size=1920",
    );
    const root = host.querySelector(".hdr-preview");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).style.getPropertyValue("--hdr-exposure")).toBe("1");
  });
});
