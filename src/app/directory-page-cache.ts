import type { DirectoryEntry } from "../shared/contracts";

export function trimDirectoryPageCache<T extends readonly DirectoryEntry[]>(
  pages: Map<number, T>,
  currentOffset: number,
  maximumPages: number,
  pinnedPath?: string | null,
): Map<number, T> {
  if (pages.size <= maximumPages) return pages;
  const removable = [...pages.keys()]
    .filter(
      (offset) =>
        !pinnedPath ||
        !pages.get(offset)?.some((entry) => entry.path === pinnedPath),
    )
    .sort(
      (left, right) =>
        Math.abs(right - currentOffset) - Math.abs(left - currentOffset),
    );
  while (pages.size > maximumPages && removable.length) {
    pages.delete(removable.shift()!);
  }
  return pages;
}
