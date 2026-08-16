// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DirectoryEntry,
  MediaProbeResult,
  RefCanvasApi,
} from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { DirectoryQuickPreview } from "../../../../src/renderer/components/DirectoryQuickPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

function createEntry(extension: string): DirectoryEntry {
  return {
    path: `D:\\private\\sample.${extension}`,
    name: `sample.${extension}`,
    isDirectory: false,
    extension,
    size: 1024,
  };
}

function stubRefCanvas(probe: () => Promise<MediaProbeResult | null>): void {
  Object.assign(window, {
    refCanvas: {
      media: { probe: vi.fn(probe) },
    } as unknown as RefCanvasApi,
  });
}

describe("DirectoryQuickPreview", () => {
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function renderPreview(
    entry: DirectoryEntry,
    handlers: {
      files?: DirectoryEntry[];
      onNavigate?: () => void;
      onClose?: () => void;
    } = {},
  ): Promise<HTMLElement> {
    stubRefCanvas(async () => null);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <DirectoryQuickPreview
          entry={entry}
          files={handlers.files ?? [entry]}
          query=""
          onNavigate={handlers.onNavigate ?? vi.fn()}
          onOpen={vi.fn()}
          onReveal={vi.fn()}
          onCopyPath={vi.fn()}
          onTag={vi.fn()}
          onTrash={vi.fn()}
          onClose={handlers.onClose ?? vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    return host;
  }

  it("shows only asset details and media info, without any media player", async () => {
    const host = await renderPreview(createEntry("mp4"));
    // 无播放舞台：视频/音频/PDF/图片预览全部移除。
    expect(host.querySelector(".directory-preview-stage")).toBeNull();
    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector("audio")).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".model-preview")).toBeNull();
    // 素材详细信息。
    const info = host.querySelector<HTMLElement>(".directory-preview-info");
    expect(info?.querySelector("h3")?.textContent).toContain("sample.mp4");
    expect(info?.querySelector(".directory-preview-path")?.textContent).toContain(
      "D:\\private\\sample.mp4",
    );
    expect(info?.querySelector(".directory-preview-meta")?.textContent).toContain(
      "1 / 1",
    );
  });

  it("renders media info from the probe when available", async () => {
    const entry = createEntry("mp4");
    stubRefCanvas(async () => ({
      width: 1920,
      height: 1080,
      duration: 12.5,
      extra: { codec: "h264", frameRate: 25 },
    }));
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
    await act(async () => {
      await Promise.resolve();
    });
    const section = host.querySelector<HTMLElement>(".media-info-section");
    expect(section).toBeTruthy();
    expect(section?.textContent).toContain("媒体信息");
    expect(section?.textContent).toContain("h264");
    expect(section?.textContent).toContain("1920 × 1080");
  });

  it("hides media info silently when the probe fails", async () => {
    const host = await renderPreview(createEntry("wav"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".media-info-section")).toBeNull();
  });

  it("navigates with the previous/next buttons", async () => {
    const entry = createEntry("png");
    const other = createEntry("jpg");
    const onNavigate = vi.fn();
    await renderPreview(entry, {
      files: [other, entry],
      onNavigate,
    });
    const next = document.querySelector<HTMLButtonElement>(
      ".preview-nav.preview-next",
    );
    const prev = document.querySelector<HTMLButtonElement>(
      ".preview-nav.preview-prev",
    );
    expect(prev).toBeTruthy();
    expect(next).toBeTruthy();
    await act(async () => {
      next?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith(1);
    await act(async () => {
      prev?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it("closes via the close button and overlay pointer-down", async () => {
    const onClose = vi.fn();
    const host = await renderPreview(createEntry("png"), { onClose });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".preview-close")?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      host.querySelector<HTMLElement>(".directory-preview-overlay")?.dispatchEvent(
        new window.MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the info dialog read-only with details, navigation and close only", async () => {
    const host = await renderPreview(createEntry("png"));
    expect(host.textContent).toContain("D:\\private\\sample.png");
    expect(host.querySelector(".preview-close")).toBeTruthy();
    expect(host.querySelector('[aria-label*="复制"]')).toBeNull();
    expect(host.querySelector('[aria-label*="删除"]')).toBeNull();
    // 没有聚焦/全屏会话按钮（信息浮层无沉浸模式）。
    expect(host.querySelector(".preview-session-mode-actions")).toBeNull();
  });
});
