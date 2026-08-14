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
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeNull();
    expect(host.querySelector('[aria-label="全屏预览"]')).toBeTruthy();
    expect(host.querySelector(".preview-session-shell.preview-window")).toBeTruthy();
    expect(host.querySelector('[data-preview-renderer="image"]')).toBeTruthy();
  });

  it("keeps floating preview isolated with fullscreen then close Escape order", async () => {
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
    const onClose = vi.fn();
    const presentationListeners = new Set<(enabled: boolean) => void>();
    Object.assign(window, {
      refCanvas: {
        library: { getByPath: vi.fn(async () => asset) },
        filesystem: { reveal: vi.fn(async () => undefined) },
        system: {
          setPresentationMode: vi.fn(async (enabled: boolean) => {
            presentationListeners.forEach((listener) => listener(enabled));
            return true;
          }),
          onPresentationModeChanged: vi.fn((listener: (enabled: boolean) => void) => {
            presentationListeners.add(listener);
            return () => presentationListeners.delete(listener);
          }),
        },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<PreviewWindow path={asset.path} onClose={onClose} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-window")?.classList.contains("preview-session-focused")).toBe(false);
    expect(host.querySelector(".preview-window")?.classList.contains("preview-session-window-fullscreen")).toBe(true);
    expect(host.querySelector('[aria-label="退出全屏预览"]')).toBeTruthy();
    expect(host.querySelector('[aria-label*="聚焦"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="全屏预览"]')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
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
