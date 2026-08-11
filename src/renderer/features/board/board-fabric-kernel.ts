import {
  Canvas as FabricCanvas,
  FabricObject,
  Group,
  type TMat2D,
} from "fabric";
import type { BoardDocumentV3 } from "../../../shared/contracts";
import { boardToolInteractionState, type BoardTool } from "./controllers/drawing-controller";
import type { BoardRuntimeController } from "./board-runtime-controller";

export type BoardCanvasObject = FabricObject & {
  data?: {
    type?: string;
    assetId?: string;
    sourceUrl?: string;
    boardProxySize?: import("../../app/board-proxy").BoardProxySize;
    objectId?: string;
    parentId?: string;
    name?: string;
    baseScaleX?: number;
    baseScaleY?: number;
    guideAxis?: "x" | "y";
    modelView?: { position: [number, number, number]; target: [number, number, number] };
    comment?: string;
    commentUpdatedAt?: string;
    note?: {
      text: string;
      richText: string;
      checklist: Array<{ text: string; checked: boolean }>;
      link: string | null;
      autoWidth?: boolean;
    };
    gif?: import("../../app/board-gif").GifState;
  };
};

export function ensureBoardObjectIdentity(
  object: BoardCanvasObject,
  options: { fresh?: boolean; name?: string } = {},
): boolean {
  const previous = object.data ?? {};
  const objectId = options.fresh || !previous.objectId
    ? crypto.randomUUID()
    : previous.objectId;
  const name = options.name ?? previous.name ?? previous.type ?? "对象";
  const baseScaleX = previous.baseScaleX ?? object.scaleX ?? 1;
  const baseScaleY = previous.baseScaleY ?? object.scaleY ?? 1;
  let changed = previous.objectId !== objectId || previous.name !== name ||
    previous.baseScaleX === undefined || previous.baseScaleY === undefined;
  object.data = { ...previous, objectId, name, baseScaleX, baseScaleY };
  if (object instanceof Group) {
    for (const child of object.getObjects() as BoardCanvasObject[]) {
      if (child.data) changed = ensureBoardObjectIdentity(child, { fresh: options.fresh }) || changed;
    }
  }
  return changed;
}

export function serializeBoardDocument(
  canvas: FabricCanvas,
  runtime: BoardRuntimeController,
  canvasSnapshot?: Record<string, unknown>,
): BoardDocumentV3 {
  const guides = { x: [] as number[], y: [] as number[] };
  for (const object of canvas.getObjects() as BoardCanvasObject[]) {
    if (object.data?.guideAxis === "x") guides.x.push(object.left ?? 0);
    if (object.data?.guideAxis === "y") guides.y.push(object.top ?? 0);
  }
  runtime.guides = guides;
  return {
    schemaVersion: 3,
    canvas: canvasSnapshot ?? canvas.toObject(["data"]) as Record<string, unknown>,
    viewport: {
      transform: [...(canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0])] as TMat2D,
      zoom: canvas.getZoom(),
    },
    guides,
    appearance: { ...runtime.appearance },
    windowMode: runtime.document.windowMode ?? "normal",
    canvasMode: runtime.canvasMode,
    sampling: runtime.sampling,
    exportSettings: runtime.exportSettings,
  };
}

export function applyBoardCanvasMode(
  canvas: FabricCanvas,
  mode: { locked: boolean; grayscale: boolean; gridStyle: string },
  tool: BoardTool,
): void {
  const interaction = boardToolInteractionState(tool, mode.locked);
  canvas.selection = interaction.selection;
  canvas.skipTargetFind = interaction.skipTargetFind;
  canvas.isDrawingMode = interaction.drawingMode;
  if (mode.locked) canvas.discardActiveObject();
  for (const object of canvas.getObjects() as BoardCanvasObject[]) {
    if (object.data?.guideAxis) continue;
    object.selectable = !mode.locked;
    object.evented = !mode.locked;
  }
  canvas.requestRenderAll();
}

export function applyBoardSampling(
  canvas: FabricCanvas,
  sampling: "nearest" | "bilinear",
): void {
  const context = canvas.getContext();
  if (!context) return;
  context.imageSmoothingEnabled = sampling === "bilinear";
  context.imageSmoothingQuality = sampling === "bilinear" ? "high" : "low";
}
