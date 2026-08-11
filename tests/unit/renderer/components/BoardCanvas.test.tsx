// @vitest-environment jsdom

import { Canvas as FabricCanvas } from "fabric";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardHistoryController } from "../../../../src/renderer/features/board/controllers/history-controller";
import type {
  BoardDocumentV3,
  BoardSummary,
  RefCanvasApi,
} from "../../../../src/shared/contracts";
import { BoardActiveSelection } from "../../../../src/renderer/app/board-active-selection";
import { BoardCanvas } from "../../../../src/renderer/components/BoardCanvas";
import { DialogProvider } from "../../../../src/renderer/components/DialogProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const board: BoardSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Reference board",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const boardDocument: BoardDocumentV3 = {
  schemaVersion: 3,
  canvas: {
    objects: [
      {
        type: "rect",
        left: 20,
        top: 20,
        width: 40,
        height: 40,
        fill: "#fff",
        data: { objectId: "object-1", name: "First", baseScaleX: 1, baseScaleY: 1 },
      },
      {
        type: "rect",
        left: 100,
        top: 20,
        width: 40,
        height: 40,
        fill: "#fff",
        data: { objectId: "object-2", name: "Second", baseScaleX: 1, baseScaleY: 1 },
      },
    ],
  },
  viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
  guides: { x: [], y: [] },
  appearance: { backgroundColor: "#202426", gridVisible: true, gridSize: 24 },
  windowMode: "normal",
  canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
  sampling: "bilinear",
  exportSettings: { format: "png", embedAssets: false },
};

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return new Proxy({ canvas } as unknown as CanvasRenderingContext2D, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return () => undefined;
    },
    set: () => true,
  });
}

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("BoardCanvas selection persistence", () => {
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(Date.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", window.clearTimeout);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(
      this: HTMLCanvasElement,
    ) {
      return canvasContext(this);
    });
    Object.assign(window, {
      refCanvas: {
        system: {
          getBoardShortcuts: vi.fn(async () => null),
          getPreferences: vi.fn(async () => ({
            boardSettings: {
              interactionPreset: "pureref",
              snapEnabled: true,
              bringToFrontOnSelect: false,
              sampling: "bilinear",
              undoLimit: 99,
            },
          })),
          onWindowModeReset: vi.fn(() => () => undefined),
        },
      } as unknown as RefCanvasApi,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("does not save or add history when Ctrl+A selects board objects", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onSave = vi.fn(async () => undefined);
    const historyPush = vi.spyOn(BoardHistoryController.prototype, "push");
    const loadFromJSON = vi.spyOn(FabricCanvas.prototype, "loadFromJSON");
    vi.spyOn(FabricCanvas.prototype, "requestRenderAll").mockImplementation(() => undefined);
    const setActiveObject = vi.spyOn(FabricCanvas.prototype, "setActiveObject");

    await act(async () => {
      root?.render(
        <DialogProvider>
          <BoardCanvas
            board={board}
            document={boardDocument}
            assets={[]}
            boards={[board]}
            onSelectAsset={vi.fn()}
            onSave={onSave}
            onSwitchBoard={async () => undefined}
            onCreateBoard={async () => undefined}
            onRenameBoard={async () => undefined}
            onDeleteBoard={async () => undefined}
            onLibraryChanged={async () => undefined}
          />
        </DialogProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const initialLoad = loadFromJSON.mock.results[0]?.value;
    await act(async () => {
      await initialLoad;
      await Promise.resolve();
    });

    const pushesBeforeSelection = historyPush.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyA",
        ctrlKey: true,
        key: "a",
      }));
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(setActiveObject).toHaveBeenCalledWith(expect.any(BoardActiveSelection));
    expect(historyPush).toHaveBeenCalledTimes(pushesBeforeSelection);
    expect(onSave).not.toHaveBeenCalled();
  });
});
