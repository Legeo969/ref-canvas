// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardSideDock,
  type BoardDockPanel,
} from "../../../../src/renderer/components/board/BoardSideDock";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function panel(id: string, overrides: Partial<BoardDockPanel> = {}): BoardDockPanel {
  return {
    id,
    collapsed: false,
    title: id.toUpperCase(),
    children: <p data-body={id}>{id} body</p>,
    ...overrides,
  };
}

async function renderDock(
  panels: readonly BoardDockPanel[],
  handlers: {
    onToggleCollapsed?: (id: string) => void;
    onClose?: (id: string) => void;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <BoardSideDock
        top={64}
        panels={panels}
        onToggleCollapsed={handlers.onToggleCollapsed ?? vi.fn()}
        onClose={handlers.onClose ?? vi.fn()}
      />,
    );
  });
  return host;
}

describe("BoardSideDock", () => {
  it("stacks every open panel in one column so they cannot overlap", async () => {
    // 旧实现让每张卡片各自 absolute + top:64px right:12px，靠父级测量
    // 上一张的高度往下推；漏掉任何一个面板就会重叠。文档流堆叠后
    // 重叠在结构上不可能发生，这个断言把该结构钉住。
    const host = await renderDock([panel("layers"), panel("color"), panel("inspector")]);
    const column = host.querySelector(".board-side-dock");
    expect(column).not.toBeNull();
    const rendered = Array.from(
      column!.querySelectorAll<HTMLElement>(".board-side-dock-panel"),
    );
    expect(rendered.map((node) => node.dataset.panel)).toEqual([
      "layers",
      "color",
      "inspector",
    ]);
    // 面板自身不再自带绝对定位。
    for (const node of rendered) {
      expect(node.style.position).toBe("");
    }
  });

  it("renders nothing when no panel is open", async () => {
    const host = await renderDock([]);
    expect(host.querySelector(".board-side-dock")).toBeNull();
  });

  it("collapses a panel to its header and keeps the others intact", async () => {
    const host = await renderDock([panel("layers"), panel("color", { collapsed: true })]);
    // 折叠只隐藏自己的内容体。
    expect(host.querySelector("[data-body='layers']")).not.toBeNull();
    expect(host.querySelector("[data-body='color']")).toBeNull();
    const colorPanel = host.querySelector<HTMLElement>("[data-panel='color']");
    expect(colorPanel?.classList.contains("collapsed")).toBe(true);
    // 折叠态仍保留标题条，便于重新展开。
    expect(colorPanel?.querySelector(".board-side-dock-header")).not.toBeNull();
  });

  it("reports collapse and close for the exact panel", async () => {
    const onToggleCollapsed = vi.fn();
    const onClose = vi.fn();
    const host = await renderDock([panel("layers"), panel("color")], {
      onToggleCollapsed,
      onClose,
    });
    const toggles = host.querySelectorAll<HTMLButtonElement>(".board-side-dock-toggle");
    await act(async () => toggles[1]?.click());
    expect(onToggleCollapsed).toHaveBeenCalledWith("color");
    const closes = host.querySelectorAll<HTMLButtonElement>(".board-side-dock-close");
    await act(async () => closes[0]?.click());
    expect(onClose).toHaveBeenCalledWith("layers");
  });

  it("exposes expand state on the header toggle", async () => {
    const host = await renderDock([panel("layers"), panel("color", { collapsed: true })]);
    const toggles = host.querySelectorAll<HTMLButtonElement>(".board-side-dock-toggle");
    expect(toggles[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(toggles[1]?.getAttribute("aria-expanded")).toBe("false");
  });
});
