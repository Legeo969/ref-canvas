// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBoardShortcuts } from "../../../../src/renderer/app/board-shortcuts";
import { BoardShortcutSettings } from "../../../../src/renderer/components/BoardShortcutSettings";
import { setLanguage } from "../../../../src/renderer/app/i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

describe("BoardShortcutSettings", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  it("rejects conflicts and accepts a free shortcut", async () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <BoardShortcutSettings
          bindings={loadBoardShortcuts(null)}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      );
    });

    const capture = host.querySelector(
      '.shortcut-capture[aria-label="修改打开命令面板快捷键"]',
    ) as HTMLButtonElement;
    await act(async () => capture.click());
    await act(async () => {
      capture.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(host.querySelector(".shortcut-settings-error")?.textContent).toContain(
      "撤销",
    );
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      capture.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "j",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ commandPalette: "Ctrl+Alt+J" }),
    );
  });
});
