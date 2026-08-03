export interface TriggerRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MenuBox {
  width: number;
  height: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

const MARGIN = 8;
const GAP = 6;

/**
 * Positions a dropdown menu in fixed (viewport) coordinates so it never clips.
 *
 * The menu opens below the trigger with its left edge aligned to the trigger's
 * left edge; if that would overflow the right viewport edge it shifts left until
 * its right edge rests at the margin. When it does not fit below and there is
 * more room above, it flips above the trigger. `maxHeight` is always clamped to
 * the available space so a tall menu scrolls rather than running off-screen.
 *
 * Coordinates are viewport-relative and meant for `position: fixed`, which is
 * how a portaled menu escapes an ancestor's `overflow` clipping (the sidebar's
 * `overflow-y: auto` also clips horizontally, so an in-flow popover cannot win).
 */
export function placeTriggerMenu(
  trigger: TriggerRect,
  menu: MenuBox,
  viewport: Viewport,
  gap = GAP,
  margin = MARGIN,
): MenuPlacement {
  const left = Math.max(
    margin,
    Math.min(trigger.left, viewport.width - menu.width - margin),
  );
  const spaceBelow = viewport.height - trigger.bottom - gap - margin;
  const spaceAbove = trigger.top - gap - margin;

  if (menu.height <= spaceBelow || spaceBelow >= spaceAbove) {
    return {
      left,
      top: trigger.bottom + gap,
      maxHeight: Math.max(0, spaceBelow),
    };
  }

  const maxHeight = Math.max(0, Math.min(menu.height, spaceAbove));
  return {
    left,
    top: Math.max(margin, trigger.top - gap - maxHeight),
    maxHeight,
  };
}

/**
 * Whether a side-anchored submenu should open to the left of its parent item.
 * Submenus open right by default; they flip only when the right side lacks room.
 */
export function submenuOpensLeft(
  parentRight: number,
  submenuWidth: number,
  viewportWidth: number,
  gap = 4,
  margin = MARGIN,
): boolean {
  return parentRight + gap + submenuWidth + margin > viewportWidth;
}
