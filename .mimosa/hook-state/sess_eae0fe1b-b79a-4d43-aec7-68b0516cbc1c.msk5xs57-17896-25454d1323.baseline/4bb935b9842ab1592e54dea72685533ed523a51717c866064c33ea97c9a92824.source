export interface ToolbarAnchorRect {
  right: number;
  bottom: number;
}

export interface ToolbarPanelPosition {
  x: number;
  y: number;
  maxHeight: number;
}

const panelWidth = 252;
const panelHeaderHeight = 44;
const viewportMargin = 8;
const anchorGap = 8;

/** Positions the tools panel against its trigger in viewport coordinates. */
export function toolbarPanelPosition(
  anchor: ToolbarAnchorRect,
  viewportWidth: number,
  viewportHeight: number,
): ToolbarPanelPosition {
  const x = Math.max(
    viewportMargin,
    Math.min(
      anchor.right - panelWidth,
      viewportWidth - panelWidth - viewportMargin,
    ),
  );
  const y = Math.max(
    viewportMargin,
    Math.min(
      anchor.bottom + anchorGap,
      viewportHeight - panelHeaderHeight - viewportMargin,
    ),
  );
  return {
    x,
    y,
    maxHeight: Math.max(
      panelHeaderHeight,
      viewportHeight - y - viewportMargin,
    ),
  };
}
