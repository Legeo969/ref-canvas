import { util, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import { ensureBoardObjectIdentity } from "./board-fabric-kernel";
import { createBoardActiveSelection } from "../../app/board-active-selection";
import type { BoardCanvasObject } from "./board-fabric-kernel";

type CanvasObjectWithData = BoardCanvasObject;

let boardClipboard: Record<string, unknown>[] = [];

export function hasBoardClipboard(): boolean {
  return boardClipboard.length > 0;
}

/** 复制当前选中对象（序列化快照，含 data）。 */
export function copyBoardSelection(canvas: FabricCanvas): void {
  boardClipboard = canvas
    .getActiveObjects()
    .map((object) => object.toObject(["data"]) as Record<string, unknown>);
}

/** 粘贴板内对象：重建 id、修复层级父引用并偏移 24px 后选中。 */
export async function pasteBoardSelection(canvas: FabricCanvas): Promise<void> {
  if (!boardClipboard.length) return;
  const objects = await util.enlivenObjects<FabricObject>(boardClipboard);
  const objectIds = new Map<string, string>();
  for (const object of objects as CanvasObjectWithData[]) {
    const oldId = object.data?.objectId;
    ensureBoardObjectIdentity(object, { fresh: true });
    if (oldId && object.data?.objectId) {
      objectIds.set(oldId, object.data.objectId);
    }
  }
  for (const object of objects) {
    object.set({
      left: (object.left ?? 0) + 24,
      top: (object.top ?? 0) + 24,
    });
    const payload = object as CanvasObjectWithData;
    payload.data = {
      ...(payload.data ?? {}),
      parentId: payload.data?.parentId
        ? objectIds.get(payload.data.parentId)
        : undefined,
    };
    canvas.add(object);
  }
  canvas.setActiveObject(createBoardActiveSelection(objects, canvas));
  canvas.requestRenderAll();
}
