import type { SidebarLayoutPreference } from "../../shared/contracts";

/** SplitPanes 最小高度（设计规格 360×850：270 / 290 / 240，min 120 / 140 / 100）。 */
export const MIN_QUICK_ACCESS = 120;
export const MIN_DIRECTORY = 140;
export const MIN_COLLECTIONS = 100;
export const MIN_BOARD = 100;
export const MAX_BOARD = 420;
export const SPLITTER_HEIGHT = 4;
export const SPLITTER_COUNT = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 集合面板在拖动约束里必须预留的最小占位：展开时能收缩到 MIN_COLLECTIONS；
 * 折叠时（flex 0 0 auto + height auto）完全固定，只能按实际高度预留。
 */
export function collectionsFloor(
  sectionHeight: number,
  collapsed: boolean,
): number {
  if (collapsed) return Math.max(1, sectionHeight);
  return MIN_COLLECTIONS;
}

/** 持久化高度读回时钳制到合法区间（board 另有 420 上限）。 */
export function clampSidebarLayout(
  layout: SidebarLayoutPreference,
): SidebarLayoutPreference {
  return {
    quickAccessHeight: clamp(
      Math.round(layout.quickAccessHeight),
      MIN_QUICK_ACCESS,
      8_192,
    ),
    directoryHeight: clamp(
      Math.round(layout.directoryHeight),
      MIN_DIRECTORY,
      8_192,
    ),
    boardHeight: clamp(Math.round(layout.boardHeight), MIN_BOARD, MAX_BOARD),
  };
}

/**
 * 溢出收紧：三个固定面板 + 分隔条 + 集合预留若超出可用高度，按各面板
 * 「可压缩空间」（当前值 − 各自最小值）等比扣减超额部分。这样窗口较矮
 * （或持久化的高度偏大）时参考板不会被 .sidebar-panes 的 overflow:
 * hidden 直接裁掉；收紧后集合（flex-grow）至少保有 floor 的空间。
 */
export function fitSidebarLayout(
  layout: SidebarLayoutPreference,
  available: number,
  collections: number,
): SidebarLayoutPreference {
  const fixed =
    layout.quickAccessHeight +
    layout.directoryHeight +
    layout.boardHeight +
    SPLITTER_HEIGHT * SPLITTER_COUNT +
    collections;
  const overflow = fixed - available;
  if (overflow <= 0) return layout;
  const capacities = [
    { min: MIN_QUICK_ACCESS, value: layout.quickAccessHeight },
    { min: MIN_DIRECTORY, value: layout.directoryHeight },
    { min: MIN_BOARD, value: layout.boardHeight },
  ];
  const totalCapacity = capacities.reduce(
    (sum, item) => sum + Math.max(0, item.value - item.min),
    0,
  );
  if (totalCapacity <= 0) {
    return {
      quickAccessHeight: MIN_QUICK_ACCESS,
      directoryHeight: MIN_DIRECTORY,
      boardHeight: MIN_BOARD,
    };
  }
  const scale = Math.min(1, overflow / totalCapacity);
  // 扣减量向上取整：三项各自取整的累积误差不得让总量仍超出可用高度。
  const [quickAccess, directory, board] = capacities.map((item) =>
    item.value - Math.ceil(Math.max(0, item.value - item.min) * scale),
  );
  return {
    quickAccessHeight: clamp(quickAccess, MIN_QUICK_ACCESS, layout.quickAccessHeight),
    directoryHeight: clamp(directory, MIN_DIRECTORY, layout.directoryHeight),
    boardHeight: clamp(board, MIN_BOARD, Math.min(MAX_BOARD, layout.boardHeight)),
  };
}
