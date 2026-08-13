import { Rect } from "fabric";
import { describe, expect, it, vi } from "vitest";
import { BoardCanvasController } from "../../../../src/renderer/features/board/board-canvas-controller";
import type { BoardDocumentV3 } from "../../../../src/shared/contracts";

const document = (left: number): BoardDocumentV3 => ({
  schemaVersion: 3,
  canvas: { objects: [{ type: "rect", left }] },
  viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
  guides: { x: [], y: [] },
  appearance: { backgroundColor: "#202426", gridVisible: true, gridSize: 24 },
  windowMode: "normal",
  canvasMode: { locked: false, grayscale: false, gridStyle: "line" },
  sampling: "bilinear",
  exportSettings: { format: "png", embedAssets: false },
});

function fakeCanvas(provided?: Array<Rect & { data?: { objectId?: string; name?: string } }>) {
  const object = new Rect({ width: 10, height: 10 }) as Rect & {
    data?: { objectId?: string; name?: string };
  };
  object.data = { objectId: "object-1", name: "Layer one" };
  const objects = provided ?? [object];
  const handlers = new Map<string, Set<(event?: unknown) => void>>();
  const canvas = {
    on: vi.fn((event: string, handler: (event?: unknown) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
    }),
    off: vi.fn((event: string, handler: (event?: unknown) => void) => handlers.get(event)?.delete(handler)),
    getObjects: vi.fn(() => objects),
    getActiveObjects: vi.fn(() => [objects[0]]),
    getActiveObject: vi.fn(() => objects[0]),
    getZoom: vi.fn(() => 1.25),
    setActiveObject: vi.fn(),
    remove: vi.fn(),
    moveObjectTo: vi.fn(),
    fire: vi.fn((event: string, payload?: unknown) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    }),
    requestRenderAll: vi.fn(),
  };
  return { canvas, object, handlers };
}

describe("BoardCanvasController", () => {
  it("does not rebuild the layer structure for selection-only events", () => {
    const controller = new BoardCanvasController();
    const { canvas } = fakeCanvas(Array.from({ length: 2_000 }, (_, index) => {
      const object = new Rect({ width: 10, height: 10 }) as Rect & { data?: { objectId?: string; name?: string } };
      object.data = { objectId: `object-${index}`, name: `Layer ${index}` };
      return object;
    }));
    controller.attachCanvas(canvas as never);
    const before = controller.diagnostics.structureBuilds;

    canvas.fire("selection:created");

    expect(controller.diagnostics.structureBuilds).toBe(before);
  });
  it("publishes deeply serializable snapshots without Fabric instances", () => {
    const controller = new BoardCanvasController();
    const { canvas } = fakeCanvas();
    controller.attachCanvas(canvas as never);
    const snapshot = controller.getSnapshot();
    const structure = controller.getStructureSnapshot();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot).toMatchObject({ selectionCount: 1, activeObjectId: "object-1" });
    expect(structure.layers[0]).toMatchObject({ id: "object-1", name: "Layer one" });
    expect(Object.isFrozen(structure.layers[0])).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("cacheKey");
  });

  it("synchronizes changed documents on the same board", async () => {
    const controller = new BoardCanvasController();
    const loadDocument = vi.fn();
    controller.syncCallbacks({ loadDocument });
    await controller.syncDocument("board-1", document(10));
    expect(loadDocument).not.toHaveBeenCalled();
    await controller.syncDocument("board-1", document(20));
    expect(loadDocument).toHaveBeenCalledOnce();
    expect(loadDocument).toHaveBeenCalledWith(document(20), expect.objectContaining({ generation: expect.any(Number) }));
  });

  it("ignores its own save echo without disturbing the live selection", async () => {
    const controller = new BoardCanvasController();
    const loadDocument = vi.fn();
    const { canvas } = fakeCanvas();
    controller.attachCanvas(canvas as never);
    controller.syncCallbacks({ loadDocument });
    await controller.syncDocument("board-1", document(10));
    const saved = document(20);
    controller.markLocalSave(saved);
    await controller.syncDocument("board-1", saved);
    expect(loadDocument).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ selectionCount: 1, activeObjectId: "object-1" });
  });

  it("can roll back a failed local-save token so a matching external revision loads", async () => {
    const controller = new BoardCanvasController();
    const loadDocument = vi.fn();
    controller.syncCallbacks({ loadDocument });
    await controller.syncDocument("board-1", document(10));
    const failed = document(20);
    const revision = controller.markLocalSave(failed);
    controller.cancelLocalSave(revision);
    await controller.syncDocument("board-1", failed);
    expect(loadDocument).toHaveBeenCalledOnce();
  });

  it("serializes racing external revisions so the newest document wins", async () => {
    const controller = new BoardCanvasController();
    const resolvers: Array<() => void> = [];
    const applied: number[] = [];
    const contexts: Array<{ isCurrent(): boolean }> = [];
    controller.syncCallbacks({
      loadDocument: async (next, context) => {
        applied.push((next.canvas.objects as Array<{ left: number }>)[0].left);
        contexts.push(context);
        await new Promise<void>((resolve) => resolvers.push(resolve));
      },
    });
    await controller.syncDocument("board-1", document(10));
    const first = controller.syncDocument("board-1", document(20));
    await Promise.resolve();
    const second = controller.syncDocument("board-1", document(30));
    expect(applied).toEqual([20]);
    expect(contexts[0].isCurrent()).toBe(false);
    resolvers.shift()?.();
    await vi.waitFor(() => expect(applied).toEqual([20, 30]));
    expect(contexts[1].isCurrent()).toBe(true);
    resolvers.shift()?.();
    await Promise.all([first, second]);
    expect(applied.at(-1)).toBe(30);
  });

  it("keeps structural projection work off pointer hot paths", () => {
    const objects = Array.from({ length: 1_000 }, (_, index) => {
      const item = new Rect({ width: 2, height: 2 }) as Rect & { data?: { objectId?: string; name?: string } };
      item.data = { objectId: `object-${index}`, name: `Layer ${index}` };
      return item;
    });
    const controller = new BoardCanvasController();
    const { canvas, handlers } = fakeCanvas(objects);
    canvas.getActiveObjects.mockImplementation(() => objects);
    controller.attachCanvas(canvas as never);
    const before = controller.diagnostics;
    canvas.getActiveObjects.mockClear();
    for (let index = 0; index < 100; index += 1) {
      for (const handler of handlers.get("object:moving") ?? []) handler();
    }
    const after = controller.diagnostics;
    expect(after.structureBuilds).toBe(before.structureBuilds);
    expect(after.structurePublishes).toBe(before.structurePublishes);
    expect(after.interactionBuilds - before.interactionBuilds).toBe(100);
    expect(after.interactionPublishes - before.interactionPublishes).toBe(0);
    expect(canvas.getActiveObjects).not.toHaveBeenCalled();
  });

  it("disposes every Fabric listener it registered", () => {
    const controller = new BoardCanvasController();
    const { canvas, handlers } = fakeCanvas();
    controller.attachCanvas(canvas as never);
    expect(canvas.on).toHaveBeenCalledTimes(10);
    controller.dispose();
    expect(canvas.off).toHaveBeenCalledTimes(10);
    expect([...handlers.values()].every((set) => set.size === 0)).toBe(true);
    expect(controller.isDisposed).toBe(true);
  });

  it("disposes registered DOM listeners and subscriptions", () => {
    const controller = new BoardCanvasController();
    const target = new EventTarget();
    const handler = vi.fn();
    const unsubscribe = controller.subscribe(handler);
    const remove = vi.spyOn(target, "removeEventListener");
    controller.onDom(target, "resize", handler);
    controller.dispose();
    expect(remove).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("executes object mutations by stable ID", () => {
    const controller = new BoardCanvasController();
    const { canvas, object } = fakeCanvas();
    controller.attachCanvas(canvas as never);
    expect(controller.command("toggle-visible", "object-1")).toBe(true);
    expect(object.visible).toBe(false);
    expect(controller.command("select", "missing")).toBe(false);
    expect(controller.command("delete", "object-1")).toBe(true);
    expect(canvas.remove).toHaveBeenCalledWith(object);
  });
});
