// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, RefCanvasApi } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { TextPreview } from "../../../../src/renderer/components/TextPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

const asset: AssetRecord = {
  id: "asset-1",
  path: "C:\\docs\\notes.md",
  title: "notes",
  kind: "generic",
  extension: "md",
  size: 64,
  mtimeMs: 1,
  fingerprint: "fingerprint",
  contentHash: null,
  lifecycle: "active",
  deletedAt: null,
  trashPath: null,
  favorite: false,
  rating: 0,
  colorLabel: "none",
  linkState: "online",
  notes: "",
  width: null,
  height: null,
  duration: null,
  metadataStatus: "ready",
  metadataError: null,
  metadataUpdatedAt: null,
  bpm: null,
  customFields: {},
  customThumbnailPath: null,
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  thumbnailUrl: "",
  previewUrl: "",
};

function mount(): { host: HTMLElement; root: ReturnType<typeof createRoot> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return { host, root };
}

function mockRefCanvas(media: Partial<RefCanvasApi["media"]>): void {
  Object.assign(window, {
    refCanvas: {
      media,
      mediaNotes: {
        list: vi.fn(async () => []),
        getPlaybackState: vi.fn(async () => null),
      },
    } as unknown as RefCanvasApi,
  });
}

describe("TextPreview（阶段 4：文本预览）", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  const hosts: HTMLElement[] = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    for (const host of hosts.splice(0)) host.remove();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("渲染文本内容与元信息", async () => {
    const readText = vi.fn(async () => ({
      text: "# 标题\n\n正文第一行\n",
      encoding: "utf-8",
      truncated: false,
      byteLength: 32,
      lineCount: 3,
    }));
    mockRefCanvas({ readText });
    const { host, root } = mount();
    roots.push(root);
    await act(async () => {
      root.render(<TextPreview asset={asset} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("标题");
    expect(host.textContent).toContain("正文第一行");
    expect(host.textContent).toContain("3 行");
    expect(readText).toHaveBeenCalledWith("C:\\docs\\notes.md", { limit: 200_000 });
  });

  it("Markdown 标题行带 heading 样式", async () => {
    mockRefCanvas({
      readText: vi.fn(async () => ({
        text: "## 小节",
        encoding: "utf-8",
        truncated: false,
        byteLength: 16,
        lineCount: 1,
      })),
    });
    const { host, root } = mount();
    roots.push(root);
    await act(async () => {
      root.render(<TextPreview asset={asset} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const heading = host.querySelector(".text-heading-2");
    expect(heading).toBeTruthy();
    expect(heading?.textContent).toBe("小节");
  });

  it("读取失败显示降级提示", async () => {
    mockRefCanvas({
      readText: vi.fn(async () => {
        throw new Error("TEXT_READ_FAILED:BINARY");
      }),
    });
    const { host, root } = mount();
    roots.push(root);
    await act(async () => {
      root.render(<TextPreview asset={asset} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("无法作为文本读取");
  });

  it("截断提示", async () => {
    mockRefCanvas({
      readText: vi.fn(async () => ({
        text: "内容",
        encoding: "utf-8",
        truncated: true,
        byteLength: 200_000,
        lineCount: 1,
      })),
    });
    const { host, root } = mount();
    roots.push(root);
    await act(async () => {
      root.render(<TextPreview asset={asset} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("预览截断");
  });
});
