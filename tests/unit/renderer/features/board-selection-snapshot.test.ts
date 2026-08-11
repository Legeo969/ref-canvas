import { describe, expect, it, vi } from "vitest";
import { BoardSelectionSnapshotController } from "../../../../src/renderer/features/board/board-selection-snapshot";

describe("BoardSelectionSnapshotController", () => {
  it("publishes stable lightweight snapshots and deduplicates updates", () => {
    const controller = new BoardSelectionSnapshotController();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.update(1, "object-1");
    const snapshot = controller.getSnapshot();
    expect(snapshot).toEqual({ count: 1, activeObjectId: "object-1" });
    expect(Object.isFrozen(snapshot)).toBe(true);
    controller.update(1, "object-1");
    expect(listener).toHaveBeenCalledOnce();
    controller.clear();
    expect(controller.getSnapshot()).toEqual({ count: 0, activeObjectId: null });
  });
});
