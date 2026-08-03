import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styleFiles = ["shell", "directory", "library", "board", "dialogs"];

async function readStyles(): Promise<string> {
  return (await Promise.all(
    styleFiles.map((name) =>
      readFile(path.resolve(`src/renderer/styles/${name}.css`), "utf8"),
    ),
  )).join("\n");
}

describe("UI shell regressions", () => {
  it("allows local preview tokens through the renderer CSP", async () => {
    const html = await readFile(path.resolve("index.html"), "utf8");
    expect(html).toContain("img-src 'self' data: blob: refasset: refbrowse:");
  });

  it("keeps focus and presentation modes in one grid row", async () => {
    const css = await readStyles();
    expect(css).toMatch(
      /\.focus-mode \.details-panel,\s*\.focus-mode \.panel-divider\s*{\s*display: none;/,
    );
    expect(css).toMatch(
      /\.presentation-mode \.details-panel,\s*\.presentation-mode \.panel-divider,/,
    );
  });

  it("keeps the compact canvas toolbar content-sized", async () => {
    const css = await readStyles();
    expect(css).toMatch(
      /\.canvas-toolbar\s*{[^}]*width: max-content;[^}]*translate: -50% 0;/s,
    );
  });

  it("keeps narrow asset panel controls inside the panel", async () => {
    const css = await readStyles();
    expect(css).toMatch(/\.asset-panel\s*{[^}]*overflow: hidden;/s);
    expect(css).toMatch(/\.search-field\s*{[^}]*width: calc\(100% - 24px\);/s);
    expect(css).toMatch(
      /\.asset-filter-row\s*{[^}]*grid-template-columns:[^}]*40px;/s,
    );
    expect(css).toMatch(
      /\.batch-toolbar\s*{[^}]*display: flex;[^}]*height: 44px;[^}]*overflow: hidden;/s,
    );
    expect(css).toMatch(
      /\.batch-actions-popover\s*{[^}]*position: fixed;[^}]*overflow-y: auto;/s,
    );
  });

  it("gives the command palette a shrinkable scrolling results row", async () => {
    const css = await readStyles();
    expect(css).toMatch(
      /\.command-palette\s*{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;/s,
    );
    expect(css).toMatch(
      /\.command-palette-results\s*{[^}]*min-height: 0;[^}]*overflow-y: auto;/s,
    );
  });

  it("keeps the board tools window fixed to its opening coordinates", async () => {
    const css = await readStyles();
    expect(css).toMatch(/\.board-toolbar-more\s*{[^}]*position: fixed;/s);
  });
});
