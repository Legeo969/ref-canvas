export type PanelId = "sidebar" | "asset" | "details";

export interface PanelLayout {
  sidebarWidth: number;
  assetWidth: number;
  detailsWidth: number;
  collapsed: PanelId[];
}

export const PANEL_DEFAULTS: PanelLayout = {
  sidebarWidth: 180,
  assetWidth: 280,
  detailsWidth: 1100,
  collapsed: [],
};

export const PANEL_LIMITS: Record<PanelId, { min: number; max: number }> = {
  sidebar: { min: 180, max: 480 },
  asset: { min: 280, max: 720 },
  details: { min: 480, max: 1_200 },
};

/** 白板始终至少保留的宽度。 */
export const BOARD_MIN_WIDTH = 360;

export const PANEL_ID_LIST: readonly PanelId[] = ["sidebar", "asset", "details"];

export const DIRECTORY_PANEL_IDS: readonly PanelId[] = ["sidebar", "details"];
export const BOARD_PANEL_IDS: readonly PanelId[] = ["sidebar"];

export const PANEL_CSS_VARIABLES: Record<PanelId, string> = {
  sidebar: "--panel-sidebar",
  asset: "--panel-asset",
  details: "--panel-details",
};

/** 右侧详情栏的分隔线位于面板左侧，物理拖动方向与宽度增量相反。 */
export function panelResizeDelta(
  panel: PanelId,
  horizontalDelta: number,
): number {
  return panel === "details" ? -horizontalDelta : horizontalDelta;
}

function panelWidth(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampPanelWidth(panel: PanelId, width: number): number {
  const limit = PANEL_LIMITS[panel];
  return Math.round(Math.min(limit.max, Math.max(limit.min, width)));
}

export function panelWidthOf(layout: PanelLayout, panel: PanelId): number {
  return panel === "sidebar"
    ? layout.sidebarWidth
    : panel === "asset"
      ? layout.assetWidth
      : layout.detailsWidth;
}

export function setPanelWidthOf(
  layout: PanelLayout,
  panel: PanelId,
  width: number,
): PanelLayout {
  return panel === "sidebar"
    ? { ...layout, sidebarWidth: width }
    : panel === "asset"
      ? { ...layout, assetWidth: width }
      : { ...layout, detailsWidth: width };
}

export function normalizePanelLayout(value: unknown): PanelLayout {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const collapsed = PANEL_ID_LIST.filter(
    (id) =>
      Array.isArray(source.collapsed) &&
      source.collapsed.includes(id),
  );
  return {
    sidebarWidth: clampPanelWidth(
      "sidebar",
      panelWidth(source.sidebarWidth, PANEL_DEFAULTS.sidebarWidth),
    ),
    assetWidth: clampPanelWidth(
      "asset",
      panelWidth(source.assetWidth, PANEL_DEFAULTS.assetWidth),
    ),
    detailsWidth: clampPanelWidth(
      "details",
      // 286/360px were the old metadata-inspector defaults. Migrate them to
      // the actual preview-workbench width instead of preserving a tiny rail.
      source.detailsWidth === 286 || source.detailsWidth === 360
        ? PANEL_DEFAULTS.detailsWidth
        : panelWidth(source.detailsWidth, PANEL_DEFAULTS.detailsWidth),
    ),
    collapsed,
  };
}

/** 折叠面板的渲染宽度为 0，其余取持久化宽度。 */
export function expandedWidths(layout: PanelLayout): Record<PanelId, number> {
  const collapsed = new Set(layout.collapsed);
  return {
    sidebar: collapsed.has("sidebar") ? 0 : layout.sidebarWidth,
    asset: collapsed.has("asset") ? 0 : layout.assetWidth,
    details: collapsed.has("details") ? 0 : layout.detailsWidth,
  };
}

export function withCollapsed(
  layout: PanelLayout,
  panel: PanelId,
  collapsed: boolean,
): PanelLayout {
  const next = new Set(layout.collapsed);
  if (collapsed) next.add(panel);
  else next.delete(panel);
  return {
    ...layout,
    collapsed: PANEL_ID_LIST.filter((id) => next.has(id)),
  };
}

/**
 * 窗口收缩保护：白板至少保留 BOARD_MIN_WIDTH。窗口过窄时先压缩各面板到
 * 最小宽度，仍不够则依次自动折叠详情栏、侧栏。返回调整后的布局（不修改
 * 调用方的持久化值，折叠由渲染层按需应用）。
 */
export function panelLayoutForWindow(
  layout: PanelLayout,
  windowWidth: number,
  activePanels: readonly PanelId[] = PANEL_ID_LIST,
): PanelLayout {
  const collapsed = new Set(layout.collapsed);
  const visible = activePanels.filter((id) => !collapsed.has(id));
  const base = visible.reduce((sum, id) => sum + panelWidthOf(layout, id), 0);
  if (windowWidth - base >= BOARD_MIN_WIDTH) {
    return { ...layout, collapsed: PANEL_ID_LIST.filter((id) => collapsed.has(id)) };
  }
  const minimums = visible.reduce((sum, id) => sum + PANEL_LIMITS[id].min, 0);
  if (windowWidth - minimums >= BOARD_MIN_WIDTH) {
    const widths: Record<PanelId, number> = {
      sidebar: layout.sidebarWidth,
      asset: layout.assetWidth,
      details: layout.detailsWidth,
    };
    let overflow = Math.max(0, base + BOARD_MIN_WIDTH - windowWidth);
    for (const id of ["details", "asset", "sidebar"] as const) {
      if (!visible.includes(id) || overflow <= 0) continue;
      const shrinkBy = Math.min(
        overflow,
        Math.max(0, widths[id] - PANEL_LIMITS[id].min),
      );
      widths[id] -= shrinkBy;
      overflow -= shrinkBy;
    }
    return setPanelWidths(layout, widths);
  }
  const next = new Set(collapsed);
  for (const id of ["details", "sidebar", "asset"] as const) {
    if (!activePanels.includes(id) || next.has(id)) continue;
    next.add(id);
    const remainingMinimums = activePanels
      .filter((panel) => !next.has(panel))
      .reduce((sum, panel) => sum + PANEL_LIMITS[panel].min, 0);
    if (windowWidth - remainingMinimums >= BOARD_MIN_WIDTH) break;
  }
  return {
    ...layout,
    collapsed: PANEL_ID_LIST.filter((id) => next.has(id)),
  };
}

function setPanelWidths(
  layout: PanelLayout,
  widths: Record<PanelId, number>,
): PanelLayout {
  return {
    ...layout,
    sidebarWidth: widths.sidebar,
    assetWidth: widths.asset,
    detailsWidth: widths.details,
  };
}

/**
 * 拖动/键盘调整面板宽度：面板增大时白板至少保留 BOARD_MIN_WIDTH；从折叠
 * 状态拖出时先恢复；窗口空间不足时面板保持折叠。返回变更后的布局。
 */
export function adjustPanelWidth(
  layout: PanelLayout,
  panel: PanelId,
  delta: number,
  windowWidth: number,
  activePanels: readonly PanelId[] = PANEL_ID_LIST,
): PanelLayout {
  if (layout.collapsed.includes(panel) && delta <= 0) return layout;
  if (layout.collapsed.includes(panel)) {
    // 折叠面板被拖开时，先确认恢复后白板仍能保留最小宽度。
    const others = activePanels.filter(
      (id) => id !== panel && !layout.collapsed.includes(id),
    );
    const otherWidths = others.reduce((sum, id) => sum + expandedWidths(layout)[id], 0);
    if (windowWidth - otherWidths - PANEL_LIMITS[panel].min < BOARD_MIN_WIDTH) {
      return layout;
    }
  }
  const working = layout.collapsed.includes(panel)
    ? withCollapsed(layout, panel, false)
    : layout;
  const widths = expandedWidths(working);
  const occupied = activePanels.reduce((sum, id) => sum + widths[id], 0);
  const board = windowWidth - occupied;
  const room = Math.max(0, board - BOARD_MIN_WIDTH);
  const current = panelWidthOf(working, panel);
  const limit = PANEL_LIMITS[panel];
  if (delta < 0) {
    return setPanelWidthOf(working, panel, Math.round(Math.max(limit.min, current + delta)));
  }
  const maxAllowed = Math.min(limit.max, current + room);
  const target = Math.round(Math.min(maxAllowed, current + delta));
  if (target < limit.min) return layout;
  if (target === current) return working;
  return setPanelWidthOf(working, panel, target);
}
