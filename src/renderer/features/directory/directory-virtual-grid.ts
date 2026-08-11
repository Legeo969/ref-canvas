import type { DirectoryEntry } from "../../../shared/contracts";

export const DIRECTORY_CARD_WIDTH = 148;
export const DIRECTORY_ROW_HEIGHT = 160;
export const DIRECTORY_GRID_GAP = 12;
export const DIRECTORY_PAGE_SIZE = 512;
export const MAXIMUM_CACHED_DIRECTORY_PAGES = 12;

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
}): DirectoryVirtualWindow {
  const columns = Math.max(
    1,
    Math.floor(
      (input.width + DIRECTORY_GRID_GAP) /
        (DIRECTORY_CARD_WIDTH + DIRECTORY_GRID_GAP),
    ),
  );
  const rowCount = Math.ceil(Math.max(0, input.total) / columns);
  const firstVisibleRow = Math.max(
    0,
    Math.floor(input.scrollTop / DIRECTORY_ROW_HEIGHT),
  );
  const lastVisibleRow = Math.min(
    rowCount,
    Math.ceil((input.scrollTop + input.height) / DIRECTORY_ROW_HEIGHT),
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
