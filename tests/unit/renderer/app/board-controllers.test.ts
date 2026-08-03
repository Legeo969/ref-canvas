import { describe, expect, it } from "vitest";
import { BoardHistoryController } from "../../../../src/renderer/features/board/controllers/history-controller";
import {
  clientToScenePoint,
  fitViewport,
} from "../../../../src/renderer/features/board/controllers/viewport-controller";
import { resolveBoardSelection } from "../../../../src/renderer/features/board/controllers/selection-controller";

describe("board controllers", () => {
  it("keeps history branches bounded and commits navigation explicitly", () => {
    const history = new BoardHistoryController();
    history.setLimit(2);
    history.reset("a");
    history.push("b");
    history.push("c");
    const undo = history.entry(-1);

    expect(undo).toEqual({ index: 1, snapshot: "b" });
    expect(history.index).toBe(2);
    history.commit(undo!.index);
    history.push("d");
    expect(history.canRedo).toBe(false);
    expect(history.entry(-1)?.snapshot).toBe("b");
  });

  it("converts client coordinates and fits object bounds", () => {
    expect(
      clientToScenePoint(150, 90, { left: 10, top: 20 }, [2, 0, 0, 2, 40, 10]),
    ).toEqual({ x: 50, y: 30 });
    const fitted = fitViewport(
      [{ left: 0, top: 0, width: 100, height: 50 }],
      500,
      300,
    );

    expect(fitted?.zoom).toBe(4);
    expect(fitted?.transform).toEqual([4, 0, 0, 4, 50, 50]);
  });

  it("resolves resident and missing selection assets", () => {
    const asset = { id: "asset-1" } as never;
    expect(resolveBoardSelection([asset], { data: { assetId: "asset-1" } })).toEqual({
      asset,
      missingAssetId: null,
    });
    expect(resolveBoardSelection([], { data: { assetId: "asset-2" } })).toEqual({
      asset: null,
      missingAssetId: "asset-2",
    });
  });
});
