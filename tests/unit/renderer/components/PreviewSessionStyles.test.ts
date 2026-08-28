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

  it("contains the focused layout for the active Preview shell", async () => {
    const found = await readFile(
      path.resolve("src/renderer/styles/preview-panel.css"),
      "utf8",
    );
    expect(found).toMatch(
      /\.preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.preview-tab-bar,[^{]*{\s*display:\s*none;/s,
    );
  });

  it("centers the preview filename independently of right-side metadata", async () => {
    const css = await readFile(
      path.resolve("src/renderer/styles/preview-panel.css"),
      "utf8",
    );
    expect(css).toMatch(/\.preview-file-row\s*{[^}]*position:\s*relative;/s);
    expect(css).toMatch(
      /\.preview-filename\s*{[^}]*position:\s*absolute;[^}]*inset-inline:\s*72px;[^}]*text-align:\s*center;/s,
    );
  });

  it("makes focus and fullscreen previews media-first with legible frosted overlay controls", async () => {
    const found = await readFile(path.resolve("src/renderer/styles/preview-panel.css"), "utf8");
    const shell = await readFile(path.resolve("src/renderer/styles/shell.css"), "utf8");
    const directory = await readFile(path.resolve("src/renderer/styles/directory.css"), "utf8");
    expect(found).toMatch(/\.preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.preview-tab-bar,[^{]*\.workbench-external-action\s*{[^}]*display:\s*none/s);
    expect(found).toMatch(/\.preview-viewport[^}]*min-height:\s*0/s);
    expect(shell).toMatch(/\.preview-session-focused,\s*\.preview-session-window-fullscreen\s*{[^}]*inset:\s*0[^}]*height:\s*100vh/s);
    expect(found).toMatch(/\.preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.preview-workspace\s*{[^}]*position:\s*absolute;[^}]*background:\s*transparent;[^}]*backdrop-filter:\s*none;/s);
    // 沉浸模式覆盖控件必须是可读的半透明毛玻璃，而不是全透明（回归：
    // GIF/视频裁剪范围、进度条全透明时下层 UI 透出看不清）。
    expect(found).toMatch(/\.preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) :is\([^}]*\.preview-toolbar-tail,[^}]*\.preview-color-context-toolbar,[^}]*\.preview-session-footer[^}]*\)\s*{[^}]*background:\s*rgba\(15, 18, 17, 0\.72\);[^}]*backdrop-filter:\s*blur\(14px\);/s);
    // 资产备注是内容编辑工具：沉浸下保持接近不透明（可读性优先），且
    // 不做 fixed 浮动（避免破坏聚焦模式的托盘布局）。
    expect(found).toMatch(/\.preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.asset-notes-panel\s*{[^}]*background:\s*rgba\(17, 19, 18, 0\.96\);[^}]*backdrop-filter:\s*none;/s);
    expect(found).not.toMatch(/preview-context-tray-notes\s*{[^}]*position:\s*fixed/s);
    expect(found).toMatch(/\.preview-panel\.preview-session-window-fullscreen :is\([^}]*\.preview-workspace,[^}]*\.preview-session-footer,[^}]*\)\s*{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transition:\s*none;/s);
    expect(found).toMatch(/\.preview-panel\.preview-session-window-fullscreen\.fullscreen-controls-visible :is\([^}]*\.preview-workspace,[^}]*\.preview-session-footer,[^}]*\)\s*{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*transition-property:\s*opacity, transform;/s);
    expect(found).toMatch(/\.preview-toolbar-tail\s*{[^}]*background:\s*var\(--preview-toolbar\);[^}]*}/s);
    expect(found).not.toMatch(/\.preview-toolbar-tail\s*{[^}]*box-shadow:/s);
    expect(found).toMatch(/\.preview-context-tray\s*{[^}]*max-height:\s*min\(38vh, 320px\);[^}]*overflow:\s*auto/s);
    expect(found).not.toMatch(/\.preview-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.preview-tab-bar\s*{[^}]*position:\s*absolute/s);
    expect(directory).toMatch(/\.directory-workbench-panel:is\(\.preview-session-focused, \.preview-session-window-fullscreen\) \.workbench-header\s*{[^}]*position:\s*static/s);
  });

  it("gives fitted images a stable viewport box instead of relying on intrinsic size", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/image-review.css"), "utf8");
    expect(css).toMatch(/\.image-review-img\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s);
  });

  it("uses one borderless button treatment for every preview panel renderer", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/preview-panel.css"), "utf8");
    expect(css).toMatch(/\.preview-tool-btn,\s*\.preview-tool-label\s*{[^}]*border:\s*0;[^}]*border-radius:\s*3px;/s);
    expect(css).toMatch(/\.preview-toolbar-renderer-controls \.image-preview-toolbar-start > button,[^{]*\.preview-toolbar-renderer-controls \.model-preview-actions > button\s*{[^}]*min-width:\s*40px;[^}]*height:\s*40px;[^}]*border:\s*0;/s);
    expect(css).toMatch(/\.preview-toolbar :is\(\.preview-tool-btn, \.preview-tool-label\)\.active,[^{]*\.preview-toolbar-renderer-controls \.model-preview-toolbar > button\.active\s*{[^}]*background:\s*rgba\(53, 198, 160, 0\.12\);/s);
  });

  it("keeps MP4 preset names readable instead of shrinking them to one character", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/dialogs.css"), "utf8");
    expect(css).toMatch(/\.mp4-preset-row > input\[type="text"\]\s*{[^}]*min-width:\s*120px;[^}]*flex:\s*1 1 140px;/s);
  });
});
