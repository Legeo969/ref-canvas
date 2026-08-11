// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardLayerPanel } from "../../../../src/renderer/components/board/BoardLayerPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("BoardLayerPanel menu dismissal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(
      <BoardLayerPanel
        rows={[{
          id: "layer-1",
          name: "Layer one",
          depth: 0,
          hasChildren: false,
          visible: true,
          locked: false,
          guide: false,
          hasComment: false,
          comment: null,
          parentId: null,
          assetId: null,
        }]}
        onCommand={vi.fn()}
        onReparent={vi.fn()}
        onReorder={vi.fn()}
        onRename={vi.fn()}
        onComment={vi.fn()}
      />,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const openMenu = () => {
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Layer one 更多操作"]');
    act(() => trigger?.click());
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  };

  it.each([
    ["outside pointer", () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))],
    ["Escape", () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
    ["resize", () => window.dispatchEvent(new Event("resize"))],
    ["ancestor scroll", () => window.dispatchEvent(new Event("scroll"))],
  ])("closes on %s", (_name, dismiss) => {
    openMenu();
    act(() => dismiss());
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });
});
