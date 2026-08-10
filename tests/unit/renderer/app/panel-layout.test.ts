import { describe, expect, it } from "vitest";
import {
  BOARD_MIN_WIDTH,
  PANEL_DEFAULTS,
  PANEL_LIMITS,
  adjustPanelWidth,
  clampPanelWidth,
  expandedWidths,
  normalizePanelLayout,
  panelLayoutForWindow,
  panelResizeDelta,
  withCollapsed,
} from "../../../../src/renderer/app/panel-layout";

describe("normalizePanelLayout", () => {
  it("falls back to defaults for missing or invalid input", () => {
    expect(normalizePanelLayout(null)).toEqual(PANEL_DEFAULTS);
    expect(normalizePanelLayout(undefined)).toEqual(PANEL_DEFAULTS);
    expect(normalizePanelLayout("garbage")).toEqual(PANEL_DEFAULTS);
  });

  it("clamps out-of-range widths and keeps valid collapsed panels", () => {
    const layout = normalizePanelLayout({
      sidebarWidth: 10_000,
      assetWidth: 100,
      detailsWidth: 300,
      collapsed: ["details", "sidebar"],
    });
    expect(layout.sidebarWidth).toBe(PANEL_LIMITS.sidebar.max);
    expect(layout.assetWidth).toBe(PANEL_LIMITS.asset.min);
    expect(layout.detailsWidth).toBe(PANEL_LIMITS.details.min);
    expect(layout.collapsed).toEqual(["sidebar", "details"]);
  });

  it("rejects unknown collapsed panel ids", () => {
    const layout = normalizePanelLayout({
      collapsed: ["details", "footer"],
    });
    expect(layout.collapsed).toEqual(["details"]);
  });

  it("migrates the legacy 360px inspector to the preview workbench width", () => {
    expect(normalizePanelLayout({ detailsWidth: 360 }).detailsWidth).toBe(
      PANEL_DEFAULTS.detailsWidth,
    );
  });
});

describe("clampPanelWidth", () => {
  it("clamps into the panel range", () => {
    expect(clampPanelWidth("sidebar", 260)).toBe(260);
    expect(clampPanelWidth("sidebar", 10)).toBe(180);
    expect(clampPanelWidth("sidebar", 900)).toBe(480);
    expect(clampPanelWidth("asset", 350)).toBe(350);
    expect(clampPanelWidth("details", 100)).toBe(PANEL_LIMITS.details.min);
  });
});

describe("panelResizeDelta", () => {
  it("keeps left-side panel drag direction and reverses the right-side panel", () => {
    expect(panelResizeDelta("sidebar", 32)).toBe(32);
    expect(panelResizeDelta("asset", -32)).toBe(-32);
    expect(panelResizeDelta("details", -32)).toBe(32);
    expect(panelResizeDelta("details", 32)).toBe(-32);
  });
});

describe("expandedWidths", () => {
  it("returns zero for collapsed panels", () => {
    const layout = normalizePanelLayout({
      sidebarWidth: 260,
      assetWidth: 350,
      detailsWidth: 360,
      collapsed: ["asset"],
    });
    expect(expandedWidths(layout)).toEqual({
      sidebar: 260,
      asset: 0,
      details: PANEL_DEFAULTS.detailsWidth,
    });
  });
});

describe("withCollapsed", () => {
  it("toggles a panel and preserves order", () => {
    let layout = normalizePanelLayout(null);
    layout = withCollapsed(layout, "details", true);
    expect(layout.collapsed).toEqual(["details"]);
    layout = withCollapsed(layout, "sidebar", true);
    expect(layout.collapsed).toEqual(["sidebar", "details"]);
    layout = withCollapsed(layout, "details", false);
    expect(layout.collapsed).toEqual(["sidebar"]);
  });
});

describe("panelLayoutForWindow", () => {
  const wide = 1800;
  const defaultSum =
    PANEL_DEFAULTS.sidebarWidth +
    PANEL_DEFAULTS.assetWidth +
    PANEL_DEFAULTS.detailsWidth;

  it("keeps the layout unchanged when the board has room", () => {
    const layout = normalizePanelLayout(null);
    expect(panelLayoutForWindow(layout, wide)).toEqual(layout);
  });

  it("compresses panels to their minimums before collapsing", () => {
    const layout = normalizePanelLayout(null);
    const squeezed = defaultSum + BOARD_MIN_WIDTH - 100;
    const result = panelLayoutForWindow(layout, squeezed);
    expect(result.collapsed).toEqual([]);
    expect(
      squeezed -
        (PANEL_LIMITS.sidebar.min +
          PANEL_LIMITS.asset.min +
          PANEL_LIMITS.details.min),
    ).toBeGreaterThanOrEqual(BOARD_MIN_WIDTH);
  });

  it("collapses details first, then the sidebar", () => {
    const layout = normalizePanelLayout(null);
    const detailsCollapsed = panelLayoutForWindow(
      layout,
      PANEL_LIMITS.sidebar.min +
        PANEL_LIMITS.asset.min +
        PANEL_LIMITS.details.min +
        BOARD_MIN_WIDTH -
        10,
    );
    expect(detailsCollapsed.collapsed).toContain("details");

    const bothCollapsed = panelLayoutForWindow(
      layout,
      PANEL_LIMITS.sidebar.min +
        PANEL_LIMITS.asset.min +
        BOARD_MIN_WIDTH -
        10,
    );
    expect(bothCollapsed.collapsed).toContain("details");
    expect(bothCollapsed.collapsed).toContain("sidebar");
  });

  it("never auto-collapses a panel the user already collapsed", () => {
    const layout = normalizePanelLayout({
      collapsed: ["asset"],
    });
    const result = panelLayoutForWindow(layout, 640);
    expect(result.collapsed).toContain("asset");
  });
});

describe("adjustPanelWidth", () => {
  it("enlarges a panel without shrinking the board below the minimum", () => {
    const layout = normalizePanelLayout(null);
    const windowWidth =
      PANEL_DEFAULTS.sidebarWidth +
      PANEL_DEFAULTS.assetWidth +
      PANEL_DEFAULTS.detailsWidth +
      BOARD_MIN_WIDTH;
    const result = adjustPanelWidth(layout, "asset", 500, windowWidth);
    expect(result.assetWidth).toBe(PANEL_DEFAULTS.assetWidth + 0);
    expect(result.assetWidth).toBe(PANEL_DEFAULTS.assetWidth);
  });

  it("allows growing into available board room", () => {
    const layout = normalizePanelLayout(null);
    const windowWidth =
      PANEL_DEFAULTS.sidebarWidth +
      PANEL_DEFAULTS.assetWidth +
      PANEL_DEFAULTS.detailsWidth +
      BOARD_MIN_WIDTH +
      200;
    const result = adjustPanelWidth(layout, "sidebar", 300, windowWidth);
    expect(result.sidebarWidth).toBe(PANEL_DEFAULTS.sidebarWidth + 200);
    expect(result.assetWidth).toBe(PANEL_DEFAULTS.assetWidth);
    expect(result.detailsWidth).toBe(PANEL_DEFAULTS.detailsWidth);
  });

  it("clamps shrinking to the panel minimum", () => {
    const layout = normalizePanelLayout(null);
    const result = adjustPanelWidth(layout, "details", -1000, 1600);
    expect(result.detailsWidth).toBe(PANEL_LIMITS.details.min);
  });

  it("restores a collapsed panel when dragged open with enough room", () => {
    const layout = normalizePanelLayout({
      collapsed: ["details"],
    });
    const windowWidth =
      PANEL_DEFAULTS.sidebarWidth +
      PANEL_DEFAULTS.assetWidth +
      PANEL_DEFAULTS.detailsWidth +
      BOARD_MIN_WIDTH +
      60;
    const result = adjustPanelWidth(layout, "details", 60, windowWidth);
    expect(result.collapsed).not.toContain("details");
    expect(result.detailsWidth).toBeGreaterThanOrEqual(PANEL_LIMITS.details.min);
  });

  it("keeps a collapsed panel collapsed when the window is too narrow", () => {
    const layout = normalizePanelLayout({
      collapsed: ["details"],
    });
    const windowWidth =
      PANEL_DEFAULTS.sidebarWidth +
      PANEL_DEFAULTS.assetWidth +
      PANEL_LIMITS.details.min +
      BOARD_MIN_WIDTH -
      1;
    const result = adjustPanelWidth(layout, "details", 300, windowWidth);
    expect(result.collapsed).toContain("details");
  });

  it("ignores negative deltas on a collapsed panel", () => {
    const layout = normalizePanelLayout({
      collapsed: ["sidebar"],
    });
    expect(adjustPanelWidth(layout, "sidebar", -40, 1600)).toBe(layout);
  });

  it("respects the panel maximum", () => {
    const layout = normalizePanelLayout(null);
    const windowWidth = 2400;
    const result = adjustPanelWidth(layout, "asset", 2000, windowWidth);
    expect(result.assetWidth).toBe(PANEL_LIMITS.asset.max);
  });
});
