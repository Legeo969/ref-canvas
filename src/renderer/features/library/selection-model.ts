import type { AssetRecord, SelectionScope } from "../../../shared/contracts";

export interface LibrarySelectionState {
  selectedIds: Set<string>;
  allMatchingSelected: boolean;
  excludedIds: Set<string>;
  selectedAsset: AssetRecord | null;
  selectionAnchorId: string | null;
}

export function selectionStateFromScope(
  scope: SelectionScope,
  assets: readonly AssetRecord[],
): LibrarySelectionState {
  if (scope.mode === "query") {
    return {
      selectedIds: new Set(),
      allMatchingSelected: true,
      excludedIds: new Set(scope.excludedIds),
      selectedAsset: null,
      selectionAnchorId: null,
    };
  }
  const selectedIds = new Set(scope.ids);
  return {
    selectedIds,
    allMatchingSelected: false,
    excludedIds: new Set(),
    selectedAsset: assets.find((asset) => selectedIds.has(asset.id)) ?? null,
    selectionAnchorId: scope.ids[0] ?? null,
  };
}

export function selectAssetId(
  state: LibrarySelectionState & { assets: readonly AssetRecord[] },
  id: string,
  mode: "replace" | "toggle" | "range",
): LibrarySelectionState | null {
  if (
    mode === "replace" &&
    !state.allMatchingSelected &&
    state.selectedIds.size === 1 &&
    state.selectedIds.has(id) &&
    state.selectedAsset?.id === id
  ) return null;
  if (state.allMatchingSelected && mode === "toggle") {
    const excludedIds = new Set(state.excludedIds);
    if (excludedIds.has(id)) excludedIds.delete(id);
    else excludedIds.add(id);
    return {
      ...state,
      excludedIds,
      selectedAsset: state.assets.find((asset) => asset.id === id) ?? null,
    };
  }
  const selectedIds = new Set(state.selectedIds);
  if (mode === "replace") {
    selectedIds.clear();
    selectedIds.add(id);
  } else if (mode === "toggle") {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
  } else {
    const anchorIndex = state.assets.findIndex(
      (asset) => asset.id === state.selectionAnchorId,
    );
    const targetIndex = state.assets.findIndex((asset) => asset.id === id);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      selectedIds.clear();
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      for (const asset of state.assets.slice(start, end + 1)) selectedIds.add(asset.id);
    } else selectedIds.add(id);
  }
  return {
    selectedIds,
    allMatchingSelected: false,
    excludedIds: new Set(),
    selectionAnchorId: mode === "range" ? state.selectionAnchorId : id,
    selectedAsset: state.assets.find((asset) => asset.id === id) ?? null,
  };
}
