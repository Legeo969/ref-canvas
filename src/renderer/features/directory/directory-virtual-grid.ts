import type { DirectoryEntry } from "../../../shared/contracts";

export const DIRECTORY_CARD_WIDTH = 148;
export const DIRECTORY_ROW_HEIGHT = 160;
export const DIRECTORY_GRID_GAP = 12;
export const DIRECTORY_PAGE_SIZE = 512;
export const MAXIMUM_CACHED_DIRECTORY_PAGES = 12;
/** 目录分区「文件夹 (N) / 文件 (M)」分组头高度（px）。 */
export const DIRECTORY_GROUP_HEADER_HEIGHT = 28;
/** 列表视图行高（px）。 */
export const DIRECTORY_LIST_ROW_HEIGHT = 40;
/** 卡片预览区之外（标题 + 元信息）的固定高度（px），缩放时预览区随之伸缩。 */
export const DIRECTORY_CARD_FOOTER_HEIGHT = 40;
/** 文件夹区紧凑行行高（px，迅雷式多列行；与列表视图行高一致）。 */
export const DIRECTORY_FOLDER_ROW_HEIGHT = 40;
/** 文件夹区紧凑行的最小列宽（px）：列数 = floor((width+gap)/(minWidth+gap))。 */
export const DIRECTORY_FOLDER_ROW_WIDTH = 170;

export interface DirectoryVirtualWindow {
  columns: number;
  rowCount: number;
  startRow: number;
  endRow: number;
  firstVisibleRow: number;
  lastVisibleRow: number;
  startIndex: number;
  endIndex: number;
}

export function calculateDirectoryVirtualWindow(input: {
  width: number;
  height: number;
  scrollTop: number;
  total: number;
  overscanBefore?: number;
  overscanAfter?: number;
  /** 缩放后的卡片宽（缺省 DIRECTORY_CARD_WIDTH）。 */
  cardWidth?: number;
  /** 缩放后的网格间距（缺省 DIRECTORY_GRID_GAP）。 */
  gap?: number;
  /** 行高（缺省 DIRECTORY_ROW_HEIGHT；列表视图用 DIRECTORY_LIST_ROW_HEIGHT）。 */
  rowHeight?: number;
  /**
   * 列数覆盖：列表视图强制单列（渲染与虚拟窗口必须用同一列数，否则滚动时
   * 索引空间按多列推算、行位置错位数倍，视口内容「丢失」）。缺省按宽度自适应。
   */
  columns?: number;
}): DirectoryVirtualWindow {
  const cardW = input.cardWidth ?? DIRECTORY_CARD_WIDTH;
  const gapW = input.gap ?? DIRECTORY_GRID_GAP;
  const rowH = input.rowHeight ?? DIRECTORY_ROW_HEIGHT;
  const columns = Math.max(
    1,
    input.columns ?? Math.floor((input.width + gapW) / (cardW + gapW)),
  );
  const rowCount = Math.ceil(Math.max(0, input.total) / columns);
  const firstVisibleRow = Math.max(
    0,
    Math.floor(input.scrollTop / rowH),
  );
  const lastVisibleRow = Math.min(
    rowCount,
    Math.ceil((input.scrollTop + input.height) / rowH),
  );
  const startRow = Math.max(0, firstVisibleRow - (input.overscanBefore ?? 2));
  const endRow = Math.min(rowCount, lastVisibleRow + (input.overscanAfter ?? 3));
  return {
    columns,
    rowCount,
    startRow,
    endRow,
    firstVisibleRow,
    lastVisibleRow,
    startIndex: startRow * columns,
    endIndex: Math.min(Math.max(0, input.total), endRow * columns),
  };
}

export function indexDirectoryPages(
  pages: ReadonlyMap<number, readonly DirectoryEntry[]>,
): Map<number, DirectoryEntry> {
  const indexed = new Map<number, DirectoryEntry>();
  for (const [offset, page] of pages) {
    page.forEach((entry, index) => indexed.set(offset + index, entry));
  }
  return indexed;
}

export function visibleDirectoryWindow(
  indexed: ReadonlyMap<number, DirectoryEntry>,
  window: Pick<DirectoryVirtualWindow, "startIndex" | "endIndex">,
): Array<{ entry: DirectoryEntry | null; absoluteIndex: number }> {
  const result: Array<{ entry: DirectoryEntry | null; absoluteIndex: number }> = [];
  for (let index = window.startIndex; index < window.endIndex; index += 1) {
    result.push({ entry: indexed.get(index) ?? null, absoluteIndex: index });
  }
  return result;
}
