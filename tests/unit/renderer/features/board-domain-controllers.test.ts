// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardHistoryController } from "../../../../src/renderer/features/board/controllers/history-controller";
import { BoardImportController } from "../../../../src/renderer/features/board/board-import-controller";
import { BoardPersistenceController } from "../../../../src/renderer/features/board/board-persistence-controller";

describe("BoardPersistenceController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 1));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces history capture and debounced saves, then disposes timers", async () => {
    const save = vi.fn(async () => undefined);
    const setSaved = vi.fn();
    const history = new BoardHistoryController();
    history.reset(JSON.stringify({ objects: [] }));
    const controller = new BoardPersistenceController(history, {
      blocked: () => false,
      capture: () => ({ objects: [{ id: "one" }] }),
      save,
      setSaved,
      onSnapshot: vi.fn(),
    });
    controller.schedule();
    controller.schedule();
    await vi.advanceTimersByTimeAsync(1);
    expect(setSaved).toHaveBeenCalledWith(false);
    expect(controller.historyEntry(-1)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
    expect(setSaved).toHaveBeenLastCalledWith(true);
    controller.dispose();
  });

  it("flushes the last debounced snapshot before disposal", async () => {
    const save = vi.fn(async () => undefined);
    const controller = new BoardPersistenceController(new BoardHistoryController(), {
      blocked: () => false,
      capture: () => ({ objects: [{ id: "last-edit" }] }),
      save,
      setSaved: vi.fn(),
      onSnapshot: vi.fn(),
    });

    controller.schedule();
    await vi.advanceTimersByTimeAsync(1);
    await controller.flush();
    controller.dispose();

    expect(save).toHaveBeenCalledExactlyOnceWith({
      objects: [{ id: "last-edit" }],
    });
  });

  it("keeps the failed snapshot available for conflict recovery", async () => {
    const failed = new Error("BOARD_CONFLICT");
    const onSaveError = vi.fn();
    const controller = new BoardPersistenceController(new BoardHistoryController(), {
      blocked: () => false,
      capture: () => ({ objects: [{ id: "local-edit" }] }),
      save: async () => {
        throw failed;
      },
      setSaved: vi.fn(),
      onSnapshot: vi.fn(),
      onSaveError,
    });

    controller.schedule();
    await vi.advanceTimersByTimeAsync(501);

    expect(onSaveError).toHaveBeenCalledWith(failed, {
      objects: [{ id: "local-edit" }],
    });
  });
});

describe("BoardImportController", () => {
  it("owns file import, lookup, placement, and user-facing result coordination", async () => {
    const controller = new BoardImportController();
    const place = vi.fn(async () => 1);
    const changed = vi.fn(async () => undefined);
    const notice = await controller.importFiles(
      [new File(["x"], "one.png")],
      { x: 20, y: 30 },
      {
        pathsForFiles: () => ["D:\\one.png"],
        importPaths: async () => ({ imported: 1, reused: 0 }),
        getByPath: async () => ({ id: "asset-1", title: "one" }) as never,
      },
      place,
      changed,
    );
    expect(place).toHaveBeenCalledWith(["asset-1"], { x: 20, y: 30 });
    expect(changed).toHaveBeenCalledOnce();
    expect(notice).toContain("已加入 1 项");
  });
});
