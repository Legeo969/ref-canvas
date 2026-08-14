import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("preview session controls", () => {
  it("keeps mode hit areas at least 40px and reserves green for pressed state", async () => {
    const css = await readFile(
      path.resolve("src/renderer/styles/shell.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.preview-session-mode-actions button\s*{[^}]*width:\s*40px;[^}]*height:\s*40px;/s,
    );
    expect(css).toMatch(
      /\.preview-session-mode-actions button:hover\s*{[^}]*background:\s*rgba\(255, 255, 255,/s,
    );
    expect(css).toMatch(
      /\.preview-session-shell \.preview-session-mode-actions button\[aria-pressed="true"\]\s*{[^}]*rgba\(53, 198, 160,/s,
    );
  });

  it("contains focused layouts for directory quick preview and the active Found shell", async () => {
    const dialogs = await readFile(
      path.resolve("src/renderer/styles/dialogs.css"),
      "utf8",
    );
    const found = await readFile(
      path.resolve("src/renderer/styles/found-preview.css"),
      "utf8",
    );
    expect(dialogs).toMatch(
      /\.directory-preview:is\(\.preview-session-focused, \.preview-session-window-fullscreen\)[^{]*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(dialogs).toMatch(
      /\.directory-preview:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.directory-preview-info,[^{]*\.preview-nav\s*{\s*display:\s*none;/s,
    );
    expect(found).toMatch(
      /\.found-preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.found-tab-bar,[^{]*{\s*display:\s*none;/s,
    );
  });

  it("makes focus and fullscreen previews media-first with transparent overlay controls", async () => {
    const found = await readFile(path.resolve("src/renderer/styles/found-preview.css"), "utf8");
    const shell = await readFile(path.resolve("src/renderer/styles/shell.css"), "utf8");
    const dialogs = await readFile(path.resolve("src/renderer/styles/dialogs.css"), "utf8");
    const directory = await readFile(path.resolve("src/renderer/styles/directory.css"), "utf8");
    expect(found).toMatch(/\.found-preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.found-tab-bar,[^{]*\.workbench-external-action\s*{[^}]*display:\s*none/s);
    expect(found).toMatch(/\.found-preview-viewport[^}]*min-height:\s*0/s);
    expect(shell).toMatch(/\.preview-session-focused,\s*\.preview-session-window-fullscreen\s*{[^}]*inset:\s*0[^}]*height:\s*100vh/s);
    expect(found).toMatch(/\.found-preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.found-preview-workspace\s*{[^}]*position:\s*absolute;[^}]*background:\s*transparent;[^}]*backdrop-filter:\s*none;/s);
    expect(found).toMatch(/\.found-preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) :is\([^}]*\.found-toolbar-tail,[^}]*\.found-color-context-toolbar,[^}]*\.found-preview-session-footer,[^}]*\)\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*backdrop-filter:\s*none;/s);
    expect(found).toMatch(/\.found-preview-panel\.preview-session-window-fullscreen :is\([^}]*\.found-preview-workspace,[^}]*\.found-preview-session-footer,[^}]*\)\s*{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transition:\s*none;/s);
    expect(found).toMatch(/\.found-preview-panel\.preview-session-window-fullscreen\.fullscreen-controls-visible :is\([^}]*\.found-preview-workspace,[^}]*\.found-preview-session-footer,[^}]*\)\s*{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*transition-property:\s*opacity, transform;/s);
    expect(found).toMatch(/\.found-toolbar-tail\s*{[^}]*background:\s*var\(--found-toolbar\);[^}]*}/s);
    expect(found).not.toMatch(/\.found-toolbar-tail\s*{[^}]*box-shadow:/s);
    expect(found).toMatch(/\.found-context-tray\s*{[^}]*max-height:\s*min\(38vh, 320px\);[^}]*overflow:\s*auto/s);
    expect(found).not.toMatch(/\.found-preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.found-tab-bar\s*{[^}]*position:\s*absolute/s);
    expect(shell).toMatch(/\.preview-window:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.preview-window-header\s*{[^}]*position:\s*static/s);
    expect(dialogs).toMatch(/\.directory-preview:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.directory-preview-session-actions\s*{[^}]*position:\s*static/s);
    expect(directory).toMatch(/\.directory-workbench-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.workbench-header\s*{[^}]*position:\s*static/s);
  });

  it("gives fitted images a stable viewport box instead of relying on intrinsic size", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/image-review.css"), "utf8");
    expect(css).toMatch(/\.image-review-img\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s);
  });

  it("uses one borderless button treatment for every Found preview renderer", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/found-preview.css"), "utf8");
    expect(css).toMatch(/\.found-tool-btn,\s*\.found-tool-label\s*{[^}]*border:\s*0;[^}]*border-radius:\s*3px;/s);
    expect(css).toMatch(/\.found-toolbar-renderer-controls \.image-preview-toolbar-start > button,[^{]*\.found-toolbar-renderer-controls \.model-preview-actions > button\s*{[^}]*min-width:\s*40px;[^}]*height:\s*40px;[^}]*border:\s*0;/s);
    expect(css).toMatch(/\.found-toolbar :is\(\.found-tool-btn, \.found-tool-label\)\.active,[^{]*\.found-toolbar-renderer-controls \.model-preview-toolbar > button\.active\s*{[^}]*background:\s*rgba\(53, 198, 160, 0\.12\);/s);
  });

  it("keeps MP4 preset names readable instead of shrinking them to one character", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/dialogs.css"), "utf8");
    expect(css).toMatch(/\.mp4-preset-row > input\[type="text"\]\s*{[^}]*min-width:\s*120px;[^}]*flex:\s*1 1 140px;/s);
  });
});
