// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { AssetNotesPanel } from "../../../../src/renderer/components/AssetNotesPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

describe("AssetNotesPanel", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("adds general notes and seeks frame-linked notes", async () => {
    const seekFrame = vi.fn();
    const create = vi.fn(async (_assetId, input) => ({
      id: "note-new", assetId: "asset-1", timeMs: 0,
      positionKind: input.positionKind, position: input.position,
      text: input.text, createdAt: "now", updatedAt: "now",
    }));
    Object.assign(window, { refCanvas: { mediaNotes: {
      list: vi.fn(async () => [{
        id: "frame-note", assetId: "asset-1", timeMs: 0,
        positionKind: "frame", position: 12, text: "Frame detail",
        createdAt: "now", updatedAt: "now",
      }]),
      create, update: vi.fn(), delete: vi.fn(),
    } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AssetNotesPanel assetId="asset-1" position={{ kind: "frame", value: 24 }} onSeekFrame={seekFrame} />);
      await Promise.resolve();
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="跳到第 12 帧"]')?.click());
    expect(seekFrame).toHaveBeenCalledWith(12);
    const input = host.querySelector<HTMLInputElement>('[aria-label="备注内容"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "General note");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加资产备注"]')?.click());
    expect(create).toHaveBeenCalledWith("asset-1", {
      positionKind: "general", position: 0, text: "General note",
    });
  });
});
