import type {
  AssetRecord,
  ImportJobSnapshot,
} from "../../../shared/contracts";

export interface LibraryQuerySliceState {
  assets: AssetRecord[];
  selectedAsset: AssetRecord | null;
  loading: boolean;
  importing: boolean;
  importJob: ImportJobSnapshot | null;
}

export function createLibraryQuerySliceState(): LibraryQuerySliceState {
  return {
    assets: [],
    selectedAsset: null,
    loading: true,
    importing: false,
    importJob: null,
  };
}
