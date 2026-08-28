// @vitest-environment jsdom

import { Canvas as FabricCanvas, FabricImage, Group } from "fabric";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardHistoryController } from "../../../../src/renderer/features/board/controllers/history-controller";
import type {
  AssetRecord,
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
  revision: 1,
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
              bringToFrontOnSelect: true,
              sampling: "bilinear",
              undoLimit: 99,
            },
          })),
          onWindowModeReset: vi.fn(() => () => undefined),
        },
        library: {
          get: vi.fn(async () => null),
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
    const onSave = vi.fn(async () => ({ ...board, revision: board.revision + 1 }));
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

  it("brings an image to the front for created and updated selections", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const loadFromJSON = vi.spyOn(FabricCanvas.prototype, "loadFromJSON");
    vi.spyOn(FabricCanvas.prototype, "requestRenderAll").mockImplementation(() => undefined);
    const onSave = vi.fn(async () => ({ ...board, revision: board.revision + 1 }));

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
    await act(async () => {
      await loadFromJSON.mock.results[0]?.value;
      await Promise.resolve();
    });

    const canvas = loadFromJSON.mock.instances[0] as FabricCanvas;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,",
    );
    const firstSource = document.createElement("canvas");
    const secondSource = document.createElement("canvas");
    firstSource.width = secondSource.width = 20;
    firstSource.height = secondSource.height = 20;
    const firstImage = new FabricImage(firstSource, {
      data: { objectId: "first-image", assetId: "asset-first" },
    });
    const secondImage = new FabricImage(secondSource, {
      data: { objectId: "second-image", assetId: "asset-second" },
    });
    const bringObjectToFront = vi.spyOn(canvas, "bringObjectToFront");
    let activeImage = firstImage;
    const getActiveObject = vi
      .spyOn(canvas, "getActiveObject")
      .mockImplementation(() => activeImage);

    await act(async () => {
      canvas.fire("selection:created", {
        selected: [firstImage],
      });
      await Promise.resolve();
    });

    expect(bringObjectToFront).toHaveBeenCalledWith(firstImage);

    bringObjectToFront.mockClear();
    activeImage = secondImage;
    await act(async () => {
      canvas.fire("selection:updated", {
        selected: [secondImage],
        deselected: [firstImage],
      });
      await Promise.resolve();
    });

    expect(bringObjectToFront).toHaveBeenCalledWith(secondImage);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(onSave).toHaveBeenCalledOnce();
    getActiveObject.mockRestore();
  });

  it("upgrades a mouse marquee selection to the bulk-optimized board selection", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const loadFromJSON = vi.spyOn(FabricCanvas.prototype, "loadFromJSON");
    vi.spyOn(FabricCanvas.prototype, "requestRenderAll").mockImplementation(() => undefined);

    await act(async () => {
      root?.render(
        <DialogProvider>
          <BoardCanvas
            board={board}
            document={boardDocument}
            assets={[]}
            boards={[board]}
            onSelectAsset={vi.fn()}
            onSave={vi.fn(async () => ({ ...board, revision: board.revision + 1 }))}
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

    const canvas = loadFromJSON.mock.instances[0] as FabricCanvas;
    const marqueeCanvas = canvas as FabricCanvas & {
      _groupSelector: {
        x: number;
        y: number;
        deltaX: number;
        deltaY: number;
      } | null;
      handleSelection(event: MouseEvent): boolean;
    };
    await act(async () => {
      marqueeCanvas._groupSelector = {
        x: 0,
        y: 0,
        deltaX: 200,
        deltaY: 100,
      };
      marqueeCanvas.handleSelection(new MouseEvent("mouseup"));
    });

    expect(canvas.getActiveObject()).toBeInstanceOf(BoardActiveSelection);
    expect(canvas.getActiveObjects()).toHaveLength(2);
  });

  it("keeps left-button interaction after a marquee multi-select", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const loadFromJSON = vi.spyOn(FabricCanvas.prototype, "loadFromJSON");
    vi.spyOn(FabricCanvas.prototype, "requestRenderAll").mockImplementation(() => undefined);

    await act(async () => {
      root?.render(
        <DialogProvider>
          <BoardCanvas
            board={board}
            document={boardDocument}
            assets={[]}
            boards={[board]}
            onSelectAsset={vi.fn()}
            onSave={vi.fn(async () => ({ ...board, revision: board.revision + 1 }))}
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

    const canvas = loadFromJSON.mock.instances[0] as FabricCanvas;
    const marqueeCanvas = canvas as FabricCanvas & {
      _groupSelector: {
        x: number;
        y: number;
        deltaX: number;
        deltaY: number;
      } | null;
      handleSelection(event: MouseEvent): boolean;
    };
    await act(async () => {
      marqueeCanvas._groupSelector = { x: 0, y: 0, deltaX: 200, deltaY: 100 };
      marqueeCanvas.handleSelection(new MouseEvent("mouseup"));
    });
    expect(canvas.getActiveObject()).toBeInstanceOf(BoardActiveSelection);

    // 回归：applyBoardControls 替换控件集后必须重算 oCoords，否则
    // findControl 按 oCoords 残留键（如 mtr）取 undefined 抛 TypeError，
    // 下一次左键按下中断整条 mousedown 链（框选后左键失灵）。
    const active = canvas.getActiveObject() as unknown as {
      oCoords?: Record<string, unknown>;
      controls?: Record<string, unknown>;
    };
    const controlKeys = new Set(Object.keys(active.controls ?? {}));
    for (const key of Object.keys(active.oCoords ?? {})) {
      expect(controlKeys.has(key)).toBe(true);
    }

    // 框选后左键按下必须走通（修复前在 findTarget→findControl 抛 TypeError）。
    expect(() =>
      canvas.upperCanvasEl.dispatchEvent(new MouseEvent("mousedown", {
        button: 0,
        clientX: 0,
        clientY: 0,
        bubbles: true,
      })),
    ).not.toThrow();
    expect(canvas.selection).toBe(true);
    expect(canvas.skipTargetFind).toBe(false);
  });

  it("loads non-image assets (video) as a real FabricImage using thumbnailUrl, not a format card", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const loadFromJSON = vi.spyOn(FabricCanvas.prototype, "loadFromJSON");
    vi.spyOn(FabricCanvas.prototype, "requestRenderAll").mockImplementation(() => undefined);
    vi.spyOn(FabricCanvas.prototype, "add").mockImplementation((function add(
      this: FabricCanvas,
      ...objects: unknown[]
    ) {
      const obj = objects[0] as unknown;
      (this as unknown as { _objects: unknown[] })._objects.push(obj);
      return this as unknown as FabricCanvas;
    }) as unknown as FabricCanvas["add"]);
    vi.spyOn(FabricCanvas.prototype, "setActiveObject").mockImplementation((function setActiveObject(
      this: FabricCanvas,
      object: unknown,
    ) {
      (this as unknown as { _activeObject: unknown })._activeObject = object;
      return this as unknown as FabricCanvas;
    }) as unknown as FabricCanvas["setActiveObject"]);

    // mock library.get 返回一个 video 资产。
    const videoAsset: AssetRecord = {
      id: "video-1",
      title: "clip.mp4",
      kind: "video",
      path: "D:\\refs\\clip.mp4",
      extension: "mp4",
      size: 1000,
      mtimeMs: 1,
      fingerprint: "fp",
      contentHash: null,
      lifecycle: "active",
      deletedAt: null,
      trashPath: null,
      favorite: false,
      rating: 0,
      colorLabel: "none",
      linkState: "online",
      notes: "",
      width: 1920,
      height: 1080,
      duration: 10,
      metadataStatus: "ready",
      metadataError: null,
      metadataUpdatedAt: null,
      bpm: null,
      customFields: {},
      customThumbnailPath: null,
      tags: [],
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
      previewUrl: "refasset://preview/video-1",
      thumbnailUrl: "refasset://thumbnail/video-1",
    };
    (window.refCanvas.library.get as ReturnType<typeof vi.fn>).mockResolvedValue(videoAsset);

    // mock FabricImage.fromURL：返回带 width/height 的假 image。
    const fromURL = vi.spyOn(FabricImage, "fromURL").mockResolvedValue(
      Object.assign(Object.create(FabricImage.prototype), {
        width: 1920,
        height: 1080,
        set() { return this; },
        setCoords() {},
      }) as unknown as FabricImage,
    );

    await act(async () => {
      root?.render(
        <DialogProvider>
          <BoardCanvas
            board={board}
            document={boardDocument}
            assets={[]}
            boards={[board]}
            onSelectAsset={vi.fn()}
            onSave={vi.fn(async () => ({ ...board, revision: board.revision + 1 }))}
            onSwitchBoard={async () => undefined}
            onCreateBoard={async () => undefined}
            onRenameBoard={async () => undefined}
            onDeleteBoard={async () => undefined}
            onLibraryChanged={async () => undefined}
            pendingAssetIds={["video-1"]}
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
      await Promise.resolve();
      await Promise.resolve();
    });

    const canvas = loadFromJSON.mock.instances[0] as FabricCanvas & {
      _objects: unknown[];
    };
    // video 资产应加载为 FabricImage（用 thumbnailUrl），而不是格式卡片 Group。
    expect(fromURL).toHaveBeenCalledWith("refasset://thumbnail/video-1");
    expect(canvas._objects.some((object) => object instanceof FabricImage)).toBe(true);
    // 不应出现格式卡片 Group（含 Rect + 扩展名 Text）。
    expect(canvas._objects.some((object) => object instanceof Group)).toBe(false);
  });
});
