import {
  ActiveSelection,
  Canvas as FabricCanvas,
  FabricImage,
  Group,
  Rect,
  type CanvasOptions,
  type CanvasEvents,
  type StaticCanvasOptions,
  type TMat2D,
} from "fabric";
import type { AssetRecord, BoardDocumentV3, BoardSettings } from "../../../shared/contracts";
import { flattenHierarchy } from "../../app/board-hierarchy";
import { inspectorMetrics, inspectorPatch, type InspectorMetrics } from "../../app/board-inspector";
import { translate } from "../../app/i18n";
import type { BoardCanvasObject } from "./board-fabric-kernel";

export interface BoardLayerRowSnapshot {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  visible: boolean;
  locked: boolean;
  guide: boolean;
  hasComment: boolean;
  comment: string | null;
  parentId: string | null;
  assetId: string | null;
}

export interface BoardFocusItemSnapshot {
  id: string;
  assetId: string | null;
  title: string;
}

export interface BoardSelectionCapabilities {
  hasSelection: boolean;
  hasImage: boolean;
  hasNote: boolean;
  hasParent: boolean;
  activeIsImage: boolean;
  activeIsGroup: boolean;
  activeIsMultiSelection: boolean;
  activeHasComment: boolean;
}

export interface BoardCanvasSnapshot {
  selectionCount: number;
  activeObjectId: string | null;
  activeObjectName: string | null;
  activeComment: string | null;
  capabilities: Readonly<BoardSelectionCapabilities>;
  zoom: number;
  saved: boolean;
  inspector: Readonly<{ name: string; metrics: InspectorMetrics }> | null;
}

export interface BoardStructureSnapshot {
  layers: readonly Readonly<BoardLayerRowSnapshot>[];
  focusItems: readonly Readonly<BoardFocusItemSnapshot>[];
  boardObjectCount: number;
}

export interface BoardControllerDiagnostics {
  interactionBuilds: number;
  interactionPublishes: number;
  structureBuilds: number;
  structurePublishes: number;
}

export interface PureRefGestureSnapshot {
  angle: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  left: number;
  top: number;
  cropX?: number;
  cropY?: number;
  width: number;
  height: number;
  viewport?: TMat2D;
}

interface MutableCell<T> { current: T }

export interface BoardGestureRuntimeResources {
  strokeHistory: MutableCell<BoardCanvasObject[]>;
  transformSnapshots: MutableCell<Map<string, TMat2D>>;
  transformDescendants: MutableCell<{ parentId: string; children: BoardCanvasObject[] } | null>;
  focusedObjectId: MutableCell<string | null>;
  preFocusViewport: MutableCell<TMat2D | null>;
  heldKeys: MutableCell<Set<string>>;
  finishContinuousGesture: MutableCell<((key: string) => void) | null>;
  gesture: MutableCell<{
    kind: "rotate" | "scale" | "opacity" | "zoom" | "crop" | "cropPan" | "cropZoom" | "flip" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    target: BoardCanvasObject | null;
    selection: BoardCanvasObject | null;
    baseOpacity: number;
    snapshot?: PureRefGestureSnapshot;
    changed: boolean;
    transform?: {
      center: { x: number; y: number };
      startPoint: { x: number; y: number };
      lastPoint: { x: number; y: number };
      baseAngle: number;
      accumulatedAngle: number;
      baseScaleX: number;
      baseScaleY: number;
    };
    suppressSave: boolean;
  }>;
  cropRect: MutableCell<Rect | null>;
  moveStart: MutableCell<{
    pointer: { x: number; y: number };
    positions: Map<BoardCanvasObject, { left: number; top: number }>;
  } | null>;
}

export type BoardControllerCommand =
  | "select"
  | "toggle-visible"
  | "toggle-locked"
  | "delete"
  | "move-up"
  | "move-down";

export interface BoardDocumentLoadContext {
  generation: number;
  revision: string;
  isCurrent(): boolean;
}

export interface BoardControllerOperations {
  loadDocument?(document: BoardDocumentV3, context: BoardDocumentLoadContext): Promise<void> | void;
  saveDocument?(): Promise<void> | void;
  importAssetIds?(ids: string[], point?: { x: number; y: number }): Promise<void> | void;
  refreshProxies?(): Promise<void> | void;
  handleShortcut?(event: KeyboardEvent): boolean;
}

const EMPTY_CAPABILITIES: Readonly<BoardSelectionCapabilities> = Object.freeze({
  hasSelection: false,
  hasImage: false,
  hasNote: false,
  hasParent: false,
  activeIsImage: false,
  activeIsGroup: false,
  activeIsMultiSelection: false,
  activeHasComment: false,
});

const EMPTY_SNAPSHOT: BoardCanvasSnapshot = Object.freeze({
  selectionCount: 0,
  activeObjectId: null,
  activeObjectName: null,
  activeComment: null,
  capabilities: EMPTY_CAPABILITIES,
  zoom: 100,
  saved: true,
  inspector: null,
});

const EMPTY_STRUCTURE: BoardStructureSnapshot = Object.freeze({
  layers: Object.freeze([]),
  focusItems: Object.freeze([]),
  boardObjectCount: 0,
});

function objectId(object: BoardCanvasObject | undefined): string | null {
  return object?.data?.objectId ?? null;
}

export function boardDocumentRevision(document: BoardDocumentV3): string {
  return JSON.stringify({
    canvas: document.canvas,
    viewport: document.viewport,
    appearance: document.appearance,
    canvasMode: document.canvasMode,
    sampling: document.sampling,
  });
}

function freezeInteraction(snapshot: BoardCanvasSnapshot): BoardCanvasSnapshot {
  Object.freeze(snapshot.capabilities);
  if (snapshot.inspector) {
    Object.freeze(snapshot.inspector.metrics);
    Object.freeze(snapshot.inspector);
  }
  return Object.freeze(snapshot);
}

function freezeStructure(snapshot: BoardStructureSnapshot): BoardStructureSnapshot {
  for (const row of snapshot.layers) Object.freeze(row);
  for (const item of snapshot.focusItems) Object.freeze(item);
  Object.freeze(snapshot.layers);
  Object.freeze(snapshot.focusItems);
  return Object.freeze(snapshot);
}

function interactionKey(snapshot: BoardCanvasSnapshot): string {
  return JSON.stringify(snapshot);
}

function structureKey(snapshot: BoardStructureSnapshot): string {
  return JSON.stringify(snapshot);
}

type EventTargetLike = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Imperative owner of Fabric lifecycle, document revisions, and dirty-channel snapshots. */
export class BoardCanvasController {
  readonly gestureResources: BoardGestureRuntimeResources = {
    strokeHistory: { current: [] },
    transformSnapshots: { current: new Map() },
    transformDescendants: { current: null },
    focusedObjectId: { current: null },
    preFocusViewport: { current: null },
    heldKeys: { current: new Set() },
    finishContinuousGesture: { current: null },
    gesture: {
      current: {
        kind: null,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        target: null,
        selection: null,
        baseOpacity: 1,
        changed: false,
        suppressSave: false,
      },
    },
    cropRect: { current: null },
    moveStart: { current: null },
  };
  private canvas: FabricCanvas | null = null;
  private boardId: string | null = null;
  private document: BoardDocumentV3 | null = null;
  private assets: readonly AssetRecord[] = [];
  private settings: BoardSettings | null = null;
  private operations: BoardControllerOperations = {};
  private snapshot: BoardCanvasSnapshot = EMPTY_SNAPSHOT;
  private structureSnapshot: BoardStructureSnapshot = EMPTY_STRUCTURE;
  private snapshotKey = interactionKey(EMPTY_SNAPSHOT);
  private structureSnapshotKey = structureKey(EMPTY_STRUCTURE);
  private readonly listeners = new Set<() => void>();
  private readonly structureListeners = new Set<() => void>();
  private readonly canvasCleanups: Array<() => void> = [];
  private readonly domListeners: Array<{ target: EventTargetLike; event: string; handler: EventListener; options?: boolean | AddEventListenerOptions }> = [];
  private disposed = false;
  private documentRevision = "";
  private readonly localSaveRevisions = new Map<string, number>();
  private pendingExternal: { document: BoardDocumentV3; revision: string; generation: number } | null = null;
  private loadGeneration = 0;
  private loadLoop: Promise<void> | null = null;
  private gesture: { kind: string; objectId: string | null } | null = null;
  private readonly counts: BoardControllerDiagnostics = {
    interactionBuilds: 0,
    interactionPublishes: 0,
    structureBuilds: 0,
    structurePublishes: 0,
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeStructure = (listener: () => void): (() => void) => {
    this.structureListeners.add(listener);
    return () => this.structureListeners.delete(listener);
  };

  getSnapshot = (): BoardCanvasSnapshot => this.snapshot;
  getStructureSnapshot = (): BoardStructureSnapshot => this.structureSnapshot;
  get diagnostics(): Readonly<BoardControllerDiagnostics> { return { ...this.counts }; }
  get isDisposed(): boolean { return this.disposed; }
  get currentDocument(): BoardDocumentV3 | null { return this.document; }
  get currentSettings(): BoardSettings | null { return this.settings; }
  get activeGesture(): Readonly<{ kind: string; objectId: string | null }> | null { return this.gesture; }

  createCanvas(element: HTMLCanvasElement, options: Partial<TOptions<CanvasOptions & StaticCanvasOptions>>): FabricCanvas {
    const canvas = new FabricCanvas(element, options);
    this.attachCanvas(canvas);
    return canvas;
  }

  syncAssets(assets: readonly AssetRecord[]): void {
    if (this.assets === assets) return;
    this.assets = assets;
    this.refreshStructureSnapshot();
  }

  syncCallbacks(operations: BoardControllerOperations): void { this.operations = operations; }
  syncSettings(settings: BoardSettings): void { this.settings = settings; }

  markLocalSave(document: BoardDocumentV3): string {
    const revision = boardDocumentRevision(document);
    this.localSaveRevisions.set(revision, (this.localSaveRevisions.get(revision) ?? 0) + 1);
    return revision;
  }

  cancelLocalSave(revision: string): void {
    const count = this.localSaveRevisions.get(revision) ?? 0;
    if (count <= 1) this.localSaveRevisions.delete(revision);
    else this.localSaveRevisions.set(revision, count - 1);
  }

  async syncDocument(boardId: string, document: BoardDocumentV3): Promise<void> {
    const revision = boardDocumentRevision(document);
    const sameBoard = this.boardId === boardId;
    const changed = this.documentRevision !== revision;
    if (!sameBoard) {
      this.boardId = boardId;
      this.document = document;
      this.documentRevision = revision;
      this.localSaveRevisions.clear();
      this.pendingExternal = null;
      this.loadGeneration += 1;
      return;
    }
    if (!changed) return;
    this.document = document;
    this.documentRevision = revision;
    const echoCount = this.localSaveRevisions.get(revision) ?? 0;
    if (echoCount > 0) {
      if (echoCount === 1) this.localSaveRevisions.delete(revision);
      else this.localSaveRevisions.set(revision, echoCount - 1);
      return;
    }
    const generation = ++this.loadGeneration;
    this.pendingExternal = { document, revision, generation };
    if (!this.loadLoop) this.loadLoop = this.drainDocumentLoads();
    await this.loadLoop;
  }

  private async drainDocumentLoads(): Promise<void> {
    try {
      while (this.pendingExternal && !this.disposed) {
        const job = this.pendingExternal;
        this.pendingExternal = null;
        await this.operations.loadDocument?.(job.document, {
          generation: job.generation,
          revision: job.revision,
          isCurrent: () => !this.disposed && job.generation === this.loadGeneration,
        });
      }
    } finally {
      this.loadLoop = null;
    }
  }

  attachCanvas(canvas: FabricCanvas): void {
    if (this.canvas === canvas) return;
    this.detachCanvas();
    this.disposed = false;
    this.canvas = canvas;
    for (const event of ["selection:created", "selection:updated", "selection:cleared"] as const) {
      this.onCanvas(canvas, event, () => this.refreshSelectionSnapshot());
    }
    for (const event of ["object:added", "object:removed", "object:modified"] as const) {
      this.onCanvas(canvas, event, () => {
        this.refreshSelectionSnapshot();
        this.refreshStructureSnapshot();
      });
    }
    for (const event of ["object:moving", "object:scaling", "object:rotating"] as const) {
      this.onCanvas(canvas, event, () => this.refreshHotSnapshot());
    }
    this.onCanvas(canvas, "mouse:wheel", () => this.refreshZoomSnapshot());
    this.refreshSelectionSnapshot();
    this.refreshStructureSnapshot();
  }

  onCanvas<K extends keyof CanvasEvents>(canvas: FabricCanvas, event: K, handler: (event: CanvasEvents[K]) => void): () => void {
    canvas.on(event, handler);
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      canvas.off(event, handler);
      const index = this.canvasCleanups.indexOf(cleanup);
      if (index >= 0) this.canvasCleanups.splice(index, 1);
    };
    this.canvasCleanups.push(cleanup);
    return cleanup;
  }

  onDom(
    target: EventTargetLike,
    event: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    target.addEventListener(event, handler, options);
    const record = { target, event, handler, options };
    this.domListeners.push(record);
    return () => {
      target.removeEventListener(event, handler, options);
      const index = this.domListeners.indexOf(record);
      if (index >= 0) this.domListeners.splice(index, 1);
    };
  }

  clearRuntimeListeners(): void {
    for (const cleanup of [...this.canvasCleanups]) cleanup();
    for (const { target, event, handler, options } of this.domListeners.splice(0)) target.removeEventListener(event, handler, options);
  }

  detachCanvas(): void {
    this.clearRuntimeListeners();
    this.canvas = null;
  }

  destroyCanvas(canvas: FabricCanvas): void {
    if (this.canvas === canvas) this.detachCanvas();
    canvas.dispose();
  }

  async loadCanvasJSON(canvas: FabricCanvas, json: Record<string, unknown>): Promise<void> {
    // 竞态守卫：打开白板会触发 async loadFromJSON（内部含 clear()），而
    // StrictMode 双挂 / 切走白板会把实例 dispose。若在此时才 resolve，对已
    // 销毁画布执行 clear → clearContext(ctx) 且 ctx 为 undefined → 崩
    // （Cannot read properties of undefined, reading 'clearRect'）。
    if (this.disposed || this.canvas !== canvas) return;
    try {
      await canvas.loadFromJSON(json);
    } catch (error) {
      // 加载期间画布被销毁/更换：竞态结果作废，不上抛（否则 unhandledrejection）。
      if (this.disposed || this.canvas !== canvas) return;
      throw error;
    }
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.pendingExternal = null;
    this.detachCanvas();
    this.listeners.clear();
    this.structureListeners.clear();
    this.operations = {};
    this.gesture = null;
    this.localSaveRevisions.clear();
    this.disposed = true;
  }

  beginGesture(kind: string, targetId: string | null): void { this.gesture = { kind, objectId: targetId }; }
  endGesture(): void { this.gesture = null; this.refreshHotSnapshot(); }

  async importAssetIds(ids: string[], point?: { x: number; y: number }): Promise<void> {
    await this.operations.importAssetIds?.(ids, point);
  }

  async save(): Promise<void> { this.setSaved(false); await this.operations.saveDocument?.(); this.setSaved(true); }
  refreshProxies(): void { void this.operations.refreshProxies?.(); }
  handleShortcut(event: KeyboardEvent): boolean { return this.operations.handleShortcut?.(event) ?? false; }

  setSaved(saved: boolean): void {
    if (this.snapshot.saved === saved) return;
    this.publishInteraction({ ...this.snapshot, saved });
  }

  setZoom(zoom: number): void {
    const normalized = Math.max(1, Math.round(zoom));
    if (this.snapshot.zoom === normalized) return;
    this.publishInteraction({ ...this.snapshot, zoom: normalized });
  }

  command(command: BoardControllerCommand, id: string): boolean {
    const canvas = this.canvas;
    const object = this.findObject(id);
    if (!canvas || !object) return false;
    if (command === "select") canvas.setActiveObject(object);
    if (command === "toggle-visible") object.set("visible", !object.visible);
    if (command === "toggle-locked") {
      const locked = Boolean(object.lockMovementX && object.lockMovementY);
      object.set({ lockMovementX: !locked, lockMovementY: !locked, lockRotation: !locked, lockScalingX: !locked, lockScalingY: !locked });
    }
    if (command === "delete") canvas.remove(object);
    if (command === "move-up" || command === "move-down") {
      const objects = canvas.getObjects();
      const current = objects.indexOf(object);
      const next = command === "move-up" ? Math.min(objects.length - 1, current + 1) : Math.max(0, current - 1);
      canvas.moveObjectTo(object, next);
    }
    if (command !== "select" && command !== "delete") canvas.fire("object:modified", { target: object });
    canvas.requestRenderAll();
    return true;
  }

  rename(id: string, name: string): boolean {
    const object = this.findObject(id);
    if (!object || !name.trim()) return false;
    object.data = { ...(object.data ?? {}), name: name.trim() };
    this.canvas?.fire("object:modified", { target: object });
    return true;
  }

  updateInspector(key: keyof InspectorMetrics, value: number): boolean {
    const canvas = this.canvas;
    const active = canvas?.getActiveObject() as BoardCanvasObject | undefined;
    if (!canvas || !active || canvas.getActiveObjects().length !== 1) return false;
    const patch = inspectorPatch(active, { [key]: value });
    if (!Object.keys(patch).length) return false;
    active.set(patch);
    active.setCoords();
    canvas.fire("object:modified", { target: active });
    canvas.requestRenderAll();
    return true;
  }

  private findObject(id: string): BoardCanvasObject | undefined {
    return (this.canvas?.getObjects() as BoardCanvasObject[] | undefined)?.find((object) => object.data?.objectId === id);
  }

  refreshSnapshot(): void {
    this.refreshSelectionSnapshot();
    this.refreshStructureSnapshot();
  }

  refreshSelectionSnapshot(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.counts.interactionBuilds += 1;
    const selected = canvas.getActiveObjects() as BoardCanvasObject[];
    const active = canvas.getActiveObject() as BoardCanvasObject | undefined;
    const capabilities: BoardSelectionCapabilities = {
      hasSelection: selected.length > 0,
      hasImage: selected.some((object) => object instanceof FabricImage),
      hasNote: selected.some((object) => Boolean(object.data?.note)),
      hasParent: selected.some((object) => Boolean(object.data?.parentId)),
      activeIsImage: active instanceof FabricImage,
      activeIsGroup: active instanceof Group && !(active instanceof ActiveSelection),
      activeIsMultiSelection: active instanceof ActiveSelection,
      activeHasComment: !(active instanceof ActiveSelection) && Boolean(active?.data?.comment),
    };
    this.publishInteraction({
      selectionCount: selected.length,
      activeObjectId: objectId(active),
      activeObjectName: active?.data?.name ?? active?.data?.type ?? null,
      activeComment: capabilities.activeHasComment ? active?.data?.comment ?? null : null,
      capabilities,
      zoom: Math.round(canvas.getZoom() * 100),
      saved: this.snapshot.saved,
      inspector: selected.length === 1 && active ? { name: active.data?.name ?? active.data?.type ?? translate("board.objectDefaultName"), metrics: inspectorMetrics(active) } : null,
    });
  }

  refreshHotSnapshot(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.counts.interactionBuilds += 1;
    const active = canvas.getActiveObject() as BoardCanvasObject | undefined;
    this.publishInteraction({
      ...this.snapshot,
      activeObjectId: objectId(active),
      activeObjectName: active?.data?.name ?? active?.data?.type ?? null,
      activeComment: this.snapshot.capabilities.activeHasComment ? active?.data?.comment ?? null : null,
      zoom: Math.round(canvas.getZoom() * 100),
      inspector: this.snapshot.selectionCount === 1 && active
        ? { name: active.data?.name ?? active.data?.type ?? translate("board.objectDefaultName"), metrics: inspectorMetrics(active) }
        : null,
    });
  }

  refreshZoomSnapshot(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.counts.interactionBuilds += 1;
    this.setZoom(canvas.getZoom() * 100);
  }

  refreshStructureSnapshot(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.counts.structureBuilds += 1;
    const objects = canvas.getObjects() as BoardCanvasObject[];
    const reversed = [...objects].reverse();
    const byId = new Map(reversed.flatMap((object) => objectId(object) ? [[objectId(object)!, object] as const] : []));
    const hierarchy = flattenHierarchy(reversed.flatMap((object) => objectId(object) ? [{ id: objectId(object)!, parentId: object.data?.parentId }] : []));
    const layers = hierarchy.flatMap(({ id, depth, hasChildren }, index) => {
      const object = byId.get(id);
      if (!object) return [];
      return [{
        id,
        name: object.data?.name ?? object.data?.type ?? translate("board.objectIndexName").replace("{index}", String(objects.length - index)),
        depth,
        hasChildren,
        visible: object.visible,
        locked: Boolean(object.lockMovementX && object.lockMovementY),
        guide: Boolean(object.data?.guideAxis),
        hasComment: Boolean(object.data?.comment),
        comment: object.data?.comment ?? null,
        parentId: object.data?.parentId ?? null,
        assetId: object.data?.assetId ?? null,
      } satisfies BoardLayerRowSnapshot];
    });
    const focusItems = objects.flatMap((object) => {
      const id = objectId(object);
      const image = object as BoardCanvasObject & FabricImage;
      if (!id || !(object instanceof FabricImage) || image.data?.guideAxis) return [];
      const asset = this.assets.find((item) => item.id === image.data?.assetId);
      return [{ id, assetId: image.data?.assetId ?? null, title: image.data?.name ?? asset?.title ?? translate("board.boardAssetDefaultTitle") } satisfies BoardFocusItemSnapshot];
    });
    this.publishStructure({
      layers,
      focusItems,
      boardObjectCount: objects.filter((object) => !object.data?.guideAxis).length,
    });
  }

  private publishInteraction(next: BoardCanvasSnapshot): void {
    const key = interactionKey(next);
    if (key === this.snapshotKey) return;
    this.snapshotKey = key;
    this.snapshot = freezeInteraction(next);
    this.counts.interactionPublishes += 1;
    for (const listener of this.listeners) listener();
  }

  private publishStructure(next: BoardStructureSnapshot): void {
    const key = structureKey(next);
    if (key === this.structureSnapshotKey) return;
    this.structureSnapshotKey = key;
    this.structureSnapshot = freezeStructure(next);
    this.counts.structurePublishes += 1;
    for (const listener of this.structureListeners) listener();
  }
}

type TOptions<T> = { [K in keyof T]?: T[K] };
