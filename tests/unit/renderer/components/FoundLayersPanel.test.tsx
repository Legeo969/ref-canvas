// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FoundLayersPanel } from "../../../../src/renderer/components/FoundLayersPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("FoundLayersPanel", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("exposes a collapsible empty SVG layer list", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<FoundLayersPanel />));
    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain("Layers (0)");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button?.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("No layers");
  });
});
