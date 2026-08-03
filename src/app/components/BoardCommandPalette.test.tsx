// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardCommandPalette } from "./BoardCommandPalette";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("BoardCommandPalette", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("filters commands and executes the active result", async () => {
    const runExport = vi.fn();
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <BoardCommandPalette
          commands={[
            { id: "fit", label: "适应全部", group: "视图", run: vi.fn() },
            { id: "export", label: "导出 PNG", group: "导出", run: runExport },
          ]}
          commandShortcut="Ctrl+Shift+P"
          onClose={onClose}
          onOpenShortcutSettings={vi.fn()}
        />,
      );
    });

    const input = host.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "导出");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll(".command-palette-row")).toHaveLength(1);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(runExport).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(localStorage.getItem("refcanvas.board-command-recents.v1")).toBe(
      '["export"]',
    );
  });
});
