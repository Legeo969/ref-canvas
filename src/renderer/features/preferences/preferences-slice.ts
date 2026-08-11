import type { LibraryPreferences } from "../../../shared/contracts";

export interface PreferencesSliceState {
  currentLibraryRoot: string | null;
  currentLibraryName: string | null;
  preferences: LibraryPreferences;
}

export function createPreferencesSliceState(): PreferencesSliceState {
  return {
    currentLibraryRoot: null,
    currentLibraryName: null,
    preferences: {
      layoutMode: "grid",
      cardSize: "medium",
      thumbnailBackground: "checker",
      includeSubfolderAssets: true,
      panelLayout: {
        sidebarWidth: 180,
        assetWidth: 280,
        detailsWidth: 1100,
        collapsed: [],
      },
    },
  };
}
