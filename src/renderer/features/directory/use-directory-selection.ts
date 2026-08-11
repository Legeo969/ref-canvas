import { useCallback, useReducer } from "react";
import {
  applyDirectorySelection,
  clearDirectorySelection,
  type DirectorySelectionState,
} from "./directory-selection-model";

type DirectorySelectionAction =
  | { type: "replace"; state: DirectorySelectionState }
  | { type: "clear" }
  | { type: "click"; orderedPaths: readonly string[]; path: string; ctrl: boolean; shift: boolean }
  | { type: "only"; path: string }
  | { type: "all-matching" }
  | { type: "loaded"; paths: readonly string[] };

export function directorySelectionReducer(
  state: DirectorySelectionState,
  action: DirectorySelectionAction,
): DirectorySelectionState {
  if (action.type === "replace") return action.state;
  if (action.type === "clear") return clearDirectorySelection();
  if (action.type === "click") return applyDirectorySelection({ state, ...action });
  if (action.type === "only") {
    return { selectedPaths: new Set([action.path]), allMatchingSelected: false, excludedPaths: new Set(), anchor: action.path };
  }
  if (action.type === "all-matching") {
    return { selectedPaths: new Set(), allMatchingSelected: true, excludedPaths: new Set(), anchor: null };
  }
  return {
    selectedPaths: new Set(action.paths),
    allMatchingSelected: false,
    excludedPaths: new Set(),
    anchor: action.paths[0] ?? null,
  };
}

export function useDirectorySelection() {
  const [state, dispatch] = useReducer(directorySelectionReducer, undefined, clearDirectorySelection);
  return {
    state,
    replace: useCallback((next: DirectorySelectionState) => dispatch({ type: "replace", state: next }), []),
    clear: useCallback(() => dispatch({ type: "clear" }), []),
    click: useCallback((orderedPaths: readonly string[], path: string, ctrl: boolean, shift: boolean) =>
      dispatch({ type: "click", orderedPaths, path, ctrl, shift }), []),
    selectOnly: useCallback((path: string) => dispatch({ type: "only", path }), []),
    selectAllMatching: useCallback(() => dispatch({ type: "all-matching" }), []),
    selectLoaded: useCallback((paths: readonly string[]) => dispatch({ type: "loaded", paths }), []),
  };
}
