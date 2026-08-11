import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { AssetRecord } from "../../../shared/contracts";

export interface BoardEventBindings {
  assets: AssetRecord[];
  onSelectAsset(asset: AssetRecord | null): void;
  onLocateAsset?(asset: AssetRecord): void;
  onSaveDocument(document: import("../../../shared/contracts").BoardDocumentV3): Promise<void>;
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
