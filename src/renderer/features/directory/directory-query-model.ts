import type { DirectorySelectionScope } from "../../../shared/contracts";

export function resolveDirectorySelectionScope(input: {
  allMatchingSelected: boolean;
  searchId: string | null;
  searchComplete: boolean;
  searchRevision: string | null;
  directoryPath: string | null;
  directoryScanComplete: boolean;
  directoryRevision: string | null;
  excludedPaths: ReadonlySet<string>;
  extensions?: string[];
}): DirectorySelectionScope | null {
  if (!input.allMatchingSelected) return null;
  if (input.searchId) {
    return input.searchComplete && input.searchRevision
      ? {
          mode: "search",
          searchId: input.searchId,
          revision: input.searchRevision,
          excludedPaths: [...input.excludedPaths],
        }
      : null;
  }
  return input.directoryScanComplete && input.directoryRevision && input.directoryPath
    ? {
        mode: "all",
        directoryPath: input.directoryPath,
        revision: input.directoryRevision,
        excludedPaths: [...input.excludedPaths],
        extensions: input.extensions,
      }
    : null;
}
