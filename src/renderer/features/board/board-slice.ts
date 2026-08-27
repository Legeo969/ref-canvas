import type {
  BoardDocumentV3,
  BoardSummary,
} from "../../../shared/contracts";

export interface BoardSliceState {
  boards: BoardSummary[];
  recentBoards: BoardSummary[];
  activeBoard: BoardSummary | null;
  boardDocument: BoardDocumentV3 | null;
  pendingBoardAssetIds: string[];
  focusMode: boolean;
}

export function createBoardSliceState(): BoardSliceState {
  return {
    boards: [],
    recentBoards: [],
    activeBoard: null,
    boardDocument: null,
    pendingBoardAssetIds: [],
    focusMode: false,
  };
}
