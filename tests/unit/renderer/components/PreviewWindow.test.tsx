// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  encodePreviewWindowPath,
  parsePreviewWindowParams,
} from "../../../../src/renderer/app/preview-window";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { PreviewWindow } from "../../../../src/renderer/components/PreviewWindow";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

describe("preview window (FND-004)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("round-trips a Windows path through encode/decode", () => {
    const path = "D:\\refs\\shot_001.exr";
    const encoded = encodePreviewWindowPath(path);
    expect(encoded).not.toContain("\\");
    expect(encoded).not.toContain("=");
    const params = parsePreviewWindowParams(
      `?preview=${encodeURIComponent(encoded)}&mode=window`,
    );
    expect(params?.previewPath).toBe(path);
  });

  it("returns null for non-window or malformed params", () => {
    expect(parsePreviewWindowParams("?mode=window&preview=!invalid!")).toBeNull();
    expect(parsePreviewWindowParams("?board=x&mode=window")).toBeNull();
    expect(parsePreviewWindowParams("")).toBeNull();
  });

  it("renders the asset preview for an indexed path", async () => {
    const asset = {
      id: "asset-1",
      path: "D:\\refs\\a.png",
      title: "a.png",
      kind: "image",
      extension: "png",
      previewUrl: "refbrowse://preview/t-1",
      thumbnailUrl: "refbrowse://thumbnail/t-1",
      size: 100,
      linkState: "online",
    };
    Object.assign(window, {
      refCanvas: {
        library: {
          getByPath: vi.fn(async () => asset),
        },
        filesystem: { reveal: vi.fn(async () => undefined) },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewWindow path="D:\\refs\\a.png" onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("a.png");
  });

  it("shows an error card for an unindexed path", async () => {
    Object.assign(window, {
      refCanvas: {
        library: {
          getByPath: vi.fn(async () => null),
        },
        filesystem: { reveal: vi.fn(async () => undefined) },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewWindow path="D:\\missing.png" onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("无法加载预览");
  });
});
