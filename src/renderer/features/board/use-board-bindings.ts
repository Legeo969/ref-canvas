import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { AssetRecord, BoardDocumentV3, BoardSummary } from "../../../shared/contracts";

export interface BoardEventBindings {
  assets: AssetRecord[];
  onSelectAsset(asset: AssetRecord | null): void;
  onLocateAsset?(asset: AssetRecord): void;
  onSaveDocument(document: BoardDocumentV3, revision: number): Promise<BoardSummary>;
  onReferencesChanged?(): Promise<void>;
}

/** One explicit latest-value bridge for Fabric callbacks registered once. */
export function useBoardEventBindings(
  bindings: BoardEventBindings,
): MutableRefObject<BoardEventBindings> {
  const ref = useRef(bindings);
  useLayoutEffect(() => {
    ref.current = bindings;
  }, [bindings]);
  return ref;
}
