import type {
  LibraryPreferences,
  LibrarySummary,
} from "../../../shared/contracts";

export interface PreferencesSliceState {
  libraries: LibrarySummary[];
  currentLibrary: LibrarySummary | null;
  preferences: LibraryPreferences;
}

export function createPreferencesSliceState(): PreferencesSliceState {
  return {
    libraries: [],
    currentLibrary: null,
    preferences: {
      layoutMode: "grid",
      cardSize: "medium",
      thumbnailBackground: "checker",
      includeSubfolderAssets: true,
      panelLayout: {
        sidebarWidth: 260,
        assetWidth: 350,
        detailsWidth: 286,
        collapsed: [],
      },
      defaultStorageMode: "linked",
    },
  };
}
