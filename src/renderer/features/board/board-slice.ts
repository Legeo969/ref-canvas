import type {
  BoardDocumentV3,
  BoardSummary,
} from "../../../shared/contracts";

export interface BoardSliceState {
  boards: BoardSummary[];
  activeBoard: BoardSummary | null;
  boardDocument: BoardDocumentV3 | null;
  focusMode: boolean;
}

export function createBoardSliceState(): BoardSliceState {
  return {
    boards: [],
    activeBoard: null,
    boardDocument: null,
    focusMode: false,
  };
}
