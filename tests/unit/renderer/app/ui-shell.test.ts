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
      /\.presentation-mode \.board-workspace \.details-panel,\s*\.presentation-mode \.board-workspace \.panel-divider,/,
    );
    expect(css).not.toMatch(/\.presentation-mode \.asset-panel/);
  });

  it("reserves a dedicated grid row for startup banners", async () => {
    const css = await readStyles();
    const app = await readFile(path.resolve("src/renderer/app/App.tsx"), "utf8");
    expect(app).toContain('className="startup-banners"');
    expect(css).toMatch(
      /\.app-shell\.has-startup-banner\s*{[^}]*grid-template-rows: auto 48px minmax\(0, 1fr\) 28px;/s,
    );
    expect(css).toMatch(
      /\.app-shell\.presentation-mode\.has-startup-banner\s*{[^}]*grid-template-rows: minmax\(0, 1fr\);/s,
    );
  });

  it("keeps global keyboard focus indicators inside clipped panels", async () => {
    const css = await readFile(path.resolve("src/renderer/styles/shell.css"), "utf8");
    expect(css).toMatch(
      /button:focus-visible,[\s\S]*?outline-offset:\s*-2px;/,
    );
  });

  it("does not show a user-facing banner for a previous unclean exit", async () => {
    const app = await readFile(path.resolve("src/renderer/app/App.tsx"), "utf8");
    expect(app).not.toContain("showPreviousCrashBanner");
    expect(app).not.toContain("previous-crash-banner");
    expect(app).toContain("const hasStartupBanner = startupHealth?.mode === \"degraded\"");
  });

  it("uses mutually exclusive disk, collection, and board workspace grids", async () => {
    const css = await readStyles();
    expect(css).toMatch(
      /\.workspace\.directory-workspace\s*{[^}]*grid-template-columns:[^}]*minmax\(0, 1fr\)[^}]*var\(--panel-details/s,
    );
    expect(css).toMatch(
      /\.workspace\.board-workspace\s*{[^}]*grid-template-columns:[^}]*minmax\(360px, 1fr\);/s,
    );
  });

  it("keeps the compact canvas toolbar content-sized", async () => {
    const css = await readStyles();
    expect(css).toMatch(
      /\.canvas-toolbar\s*{[^}]*width: max-content;[^}]*translate: -50% 0;/s,
    );
  });

  it("renders the two workspace modes without an empty third segment", async () => {
    const css = await readStyles();
    expect(css).toMatch(
      /\.workspace-mode-switch\s*{[^}]*grid-template-columns: repeat\(2,/s,
    );
    expect(css).not.toMatch(/\.dir-current-row\s*{/);
  });

  it("registers a picker-selected folder as a mount before browsing it", async () => {
    const app = await readFile(path.resolve("src/renderer/app/App.tsx"), "utf8");
    expect(app).toMatch(
      /const openPickedDirectory = async[\s\S]*?mounts\.add\(directory\)[\s\S]*?openDirectory\(mount\.path\)/,
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

  it("lifts folder action menus out of the sidebar overflow clip", async () => {
    // The sidebar sets overflow-y: auto, which per the CSS spec also clips
    // horizontally — an in-flow popover anchored to a far-right trigger gets
    // sliced off. The menu must be fixed + portaled so it escapes that clip,
    // matching .batch-actions-popover / .board-toolbar-more above.
    const css = await readStyles();
    expect(css).toMatch(/\.folder-actions-popover\s*{[^}]*position: fixed;/s);
  });

  it("uses page-level UI scaling so portaled submenus share one coordinate system", async () => {
    const app = await readFile(path.resolve("src/renderer/app/App.tsx"), "utf8");
    const preload = await readFile(path.resolve("src/preload/index.ts"), "utf8");
    expect(app).not.toContain("style={{ zoom:");
    expect(preload).toContain("webFrame.setZoomFactor");
  });

  it("lets the hidden state override every board grid style", async () => {
    const css = await readStyles();
    expect(css.indexOf(".board-host.grid-hidden")).toBeGreaterThan(
      css.indexOf(".board-host.grid-style-dot"),
    );
  });
});
