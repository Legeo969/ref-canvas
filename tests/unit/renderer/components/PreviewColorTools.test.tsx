// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUND_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { PreviewColorTools } from "../../../../src/renderer/components/PreviewColorTools";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("PreviewColorTools", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

  it("imports cube and 3dl LUT files through application preferences", async () => {
    const setPreferences = vi.fn(async (patch) => ({ foundSettings: { ...FOUND_SETTINGS_DEFAULTS, ...patch.foundSettings } }));
    Object.assign(window, { refCanvas: { system: {
      pickFile: vi.fn(async () => ["D:\\luts\\show.cube"]), setPreferences,
    } } });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => root.render(<PreviewColorTools settings={FOUND_SETTINGS_DEFAULTS} />));
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="导入 LUT"]')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(setPreferences).toHaveBeenCalledWith({ foundSettings: { activeLut: "D:\\luts\\show.cube" } });
    expect(host.textContent).toContain("show.cube");
  });
});
