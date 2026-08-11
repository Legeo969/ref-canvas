import type { BoardDocumentV3, BoardSummary } from "../../../shared/contracts";

export function savedBoardState(
  boards: readonly BoardSummary[],
  summary: BoardSummary,
  document: BoardDocumentV3,
): {
  boards: BoardSummary[];
  activeBoard: BoardSummary;
  boardDocument: BoardDocumentV3;
} {
  return {
    boards: boards.map((item) => item.id === summary.id ? summary : item),
    activeBoard: summary,
    boardDocument: document,
  };
}

export function renamedBoardState(
  boards: readonly BoardSummary[],
  activeBoard: BoardSummary | null,
  summary: BoardSummary,
): { boards: BoardSummary[]; activeBoard: BoardSummary | null } {
  return {
    boards: boards.map((board) => board.id === summary.id ? summary : board),
    activeBoard: activeBoard?.id === summary.id ? summary : activeBoard,
  };
}
