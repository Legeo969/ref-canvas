import { applySelectionClick } from "../../app/directory-selection";

export interface DirectorySelectionState {
  selectedPaths: Set<string>;
  allMatchingSelected: boolean;
  excludedPaths: Set<string>;
  anchor: string | null;
}

export function applyDirectorySelection(input: {
  state: DirectorySelectionState;
  orderedPaths: readonly string[];
  path: string;
  ctrl: boolean;
  shift: boolean;
}): DirectorySelectionState {
  const { state, path, ctrl, shift } = input;
  if (state.allMatchingSelected) {
    if (ctrl) {
      const excludedPaths = new Set(state.excludedPaths);
      if (excludedPaths.has(path)) excludedPaths.delete(path);
      else excludedPaths.add(path);
      return { ...state, excludedPaths };
    }
    return {
      selectedPaths: new Set([path]),
      allMatchingSelected: false,
      excludedPaths: new Set(),
      anchor: path,
    };
  }
  const result = applySelectionClick(
    state.selectedPaths,
    [...input.orderedPaths],
    state.anchor,
    path,
    { ctrl, shift },
  );
  return { ...state, selectedPaths: result.selection, anchor: result.anchor };
}

export function clearDirectorySelection(): DirectorySelectionState {
  return {
    selectedPaths: new Set(),
    allMatchingSelected: false,
    excludedPaths: new Set(),
    anchor: null,
  };
}
