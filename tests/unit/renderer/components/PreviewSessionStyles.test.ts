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
      /\.directory-preview:is\(\.preview-session-focused, :fullscreen\)[^{]*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(dialogs).toMatch(
      /\.directory-preview:is\(\.preview-session-focused, :fullscreen\) \.directory-preview-info,[^{]*\.preview-nav\s*{\s*display:\s*none;/s,
    );
    expect(found).toMatch(
      /\.found-preview-panel:is\(\.preview-session-focused, :fullscreen\) \.found-tab-bar \[role="tab"\],[^{]*{\s*display:\s*none;/s,
    );
    expect(found).toMatch(
      /\.found-preview-panel:is\(\.preview-session-focused, :fullscreen\) \.found-tab-bar\s*{[^}]*position:\s*absolute;[^}]*height:\s*40px;/s,
    );
  });
});
