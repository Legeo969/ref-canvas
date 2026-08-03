import type {
  DirectoryEntry,
  QuickAccessEntry,
} from "../../../shared/contracts";
import type { NavigationSource } from "../../app/navigation-state";

export interface DirectorySliceState {
  navigationSource: NavigationSource;
  directoryPath: string | null;
  directoryEntries: DirectoryEntry[];
  directoryTotal: number;
  directoryLoading: boolean;
  directoryHistory: string[];
  directoryHistoryIndex: number;
  quickAccess: QuickAccessEntry[];
}

export function createDirectorySliceState(): DirectorySliceState {
  return {
    navigationSource: "library",
    directoryPath: null,
    directoryEntries: [],
    directoryTotal: 0,
    directoryLoading: false,
    directoryHistory: [],
    directoryHistoryIndex: 0,
    quickAccess: [],
  };
}
