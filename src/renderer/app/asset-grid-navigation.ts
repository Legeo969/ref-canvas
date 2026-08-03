export type AssetGridNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

export function assetGridNavigationTarget(input: {
  key: AssetGridNavigationKey;
  currentIndex: number;
  itemCount: number;
  columns: number;
  visibleRows: number;
  canLoadMore: boolean;
}): { index: number; requestMore: boolean } | null {
  if (input.itemCount <= 0) return null;
  const current = input.currentIndex >= 0 ? input.currentIndex : 0;
  const columns = Math.max(1, input.columns);
  const pageSize = columns * Math.max(1, input.visibleRows);
  let requested = current;

  switch (input.key) {
    case "ArrowLeft":
      requested = input.currentIndex < 0 ? 0 : current - 1;
      break;
    case "ArrowRight":
      requested = input.currentIndex < 0 ? 0 : current + 1;
      break;
    case "ArrowUp":
      requested = input.currentIndex < 0 ? 0 : current - columns;
      break;
    case "ArrowDown":
      requested = input.currentIndex < 0 ? 0 : current + columns;
      break;
    case "Home":
      requested = 0;
      break;
    case "End":
      requested = input.itemCount - 1;
      break;
    case "PageUp":
      requested = current - pageSize;
      break;
    case "PageDown":
      requested = current + pageSize;
      break;
  }

  return {
    index: Math.max(0, Math.min(input.itemCount - 1, requested)),
    requestMore: requested >= input.itemCount && input.canLoadMore,
  };
}
