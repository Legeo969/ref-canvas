import { ActiveSelection, type Canvas as FabricCanvas } from "fabric";
import type { AssetRecord } from "../../../../shared/contracts";
import { sceneDeltaToParent, calculateCompactLayout } from "../../../app/board-layout";
import { arrangeItems } from "../../../app/board-arrange";
import type { BoardCanvasObject } from "../board-fabric-kernel";

type CanvasObjectWithData = BoardCanvasObject;

export interface BoardArrangeDeps {
  getCanvas(): FabricCanvas | null;
  /** 排列“按路径”时反查资产路径。 */
  getAssets(): readonly AssetRecord[];
}

/**
 * 选中对象的布局操作（对齐/分布/排列/统一尺寸/复位变换）。
 * 仿 viewport-controller：纯 fabric 操作，无 React 依赖，由 BoardCanvas 注入
 * canvas 与资产池访问。
 */
export class BoardArrangeController {
  private readonly layoutTargets = (
    canvas: FabricCanvas,
  ): CanvasObjectWithData[] => {
    const selected = canvas.getActiveObjects();
    return (selected.length ? selected : canvas.getObjects()).filter(
      (object) =>
        object.visible && !(object as CanvasObjectWithData).data?.guideAxis,
    ) as CanvasObjectWithData[];
  };

  private readonly moveLayoutObjectInScene = (
    object: CanvasObjectWithData,
    deltaX: number,
    deltaY: number,
  ) => {
    const delta = sceneDeltaToParent(
      deltaX,
      deltaY,
      object.group?.calcTransformMatrix(),
    );
    object.set({
      left: (object.left ?? 0) + delta.x,
      top: (object.top ?? 0) + delta.y,
    });
    object.setCoords();
  };

  private readonly commitLayoutObjects = (
    canvas: FabricCanvas,
    objects: CanvasObjectWithData[],
  ) => {
    const active = canvas.getActiveObject();
    if (
      active instanceof ActiveSelection &&
      objects.some((object) => object.group === active)
    ) {
      active.triggerLayout();
      active.setCoords();
    }
    for (const object of objects) {
      object.setCoords();
      canvas.fire("object:modified", { target: object });
    }
    canvas.requestRenderAll();
  };

  constructor(private readonly deps: BoardArrangeDeps) {}

  readonly arrangeCompact = () => {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const objects = this.layoutTargets(canvas);
    if (objects.length < 2) return;
    const boxes = objects.map((object) => object.getBoundingRect());
    const originX = Math.min(...boxes.map((box) => box.left));
    const originY = Math.min(...boxes.map((box) => box.top));
    const viewportWidth = Math.max(
      ...boxes.map((box) => box.width),
      canvas.width / canvas.getZoom() - 96 / canvas.getZoom(),
    );
    const positions = calculateCompactLayout(boxes, viewportWidth, 20);
    objects.forEach((object, index) => {
      const box = boxes[index];
      const position = positions[index];
      this.moveLayoutObjectInScene(
        object,
        originX + position.x - box.left,
        originY + position.y - box.top,
      );
    });
    this.commitLayoutObjects(canvas, objects);
  };

  readonly normalizeSize = (axis: "width" | "height") => {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const objects = this.layoutTargets(canvas);
    if (objects.length < 2) return;
    const boxes = objects.map((object) => object.getBoundingRect());
    const target =
      boxes.reduce((sum, box) => sum + box[axis], 0) / boxes.length;
    objects.forEach((object, index) => {
      const current = boxes[index][axis];
      if (!current) return;
      const ratio = target / current;
      object.set({
        scaleX: (object.scaleX ?? 1) * ratio,
        scaleY: (object.scaleY ?? 1) * ratio,
      });
    });
    this.commitLayoutObjects(canvas, objects);
  };

  /**
   * 排列：按名称/添加时间/图层顺序/路径/随机/堆叠（支持正序/反序与间距）。
   * options 缺省时保持既有默认：正序、间距 20、左对齐。
   */
  readonly arrangeBy = (
    key: "name" | "added" | "layer" | "path" | "random" | "stack",
    options?: {
      reverse?: boolean;
      gap?: number;
      align?: "left" | "center" | "right";
    },
  ) => {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const objects = this.layoutTargets(canvas);
    if (objects.length < 2) return;
    const items = objects.map((object, index) => {
      const box = object.getBoundingRect();
      return {
        id: object.data?.objectId ?? String(index),
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
        addedIndex: index,
        title: object.data?.name ?? object.data?.type ?? "",
        path: object.data?.assetId
          ? (() => {
              const asset = this.deps.getAssets().find(
                (item) => item.id === object.data?.assetId,
              );
              return asset?.path ?? null;
            })()
          : null,
      };
    });
    const results = arrangeItems(items, {
      key,
      reverse: options?.reverse ?? false,
      gap: options?.gap ?? 20,
      align: options?.align ?? "left",
      seed: key === "random" ? Math.floor(Math.random() * 0xffffffff) : 0,
    });
    const byId = new Map(results.map((result) => [result.id, result]));
    objects.forEach((object, index) => {
      const result = byId.get(object.data?.objectId ?? String(index));
      if (!result) return;
      const box = object.getBoundingRect();
      this.moveLayoutObjectInScene(
        object,
        result.x - box.left,
        result.y - box.top,
      );
    });
    this.commitLayoutObjects(canvas, objects);
  };

  /** 统一面积：缩放使所有选中对象的呈现面积（宽×高）相等。 */
  readonly uniformArea = () => {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const objects = this.layoutTargets(canvas);
    if (objects.length < 2) return;
    const boxes = objects.map((object) => object.getBoundingRect());
    const areas = boxes.map((box) => Math.max(1, box.width * box.height));
    const target = Math.sqrt(
      areas.reduce((sum, area) => sum + area, 0) / areas.length,
    );
    objects.forEach((object, index) => {
      const box = boxes[index];
      if (!box.width || !box.height) return;
      const ratio = target / Math.sqrt(box.width * box.height);
      object.set({
        scaleX: (object.scaleX ?? 1) * ratio,
        scaleY: (object.scaleY ?? 1) * ratio,
      });
    });
    this.commitLayoutObjects(canvas, objects);
  };

  /** 统一缩放：所有选中对象缩放到相同尺寸（宽高取中位数）。 */
  readonly uniformScale = () => {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const objects = this.layoutTargets(canvas);
    if (objects.length < 2) return;
    const boxes = objects.map((object) => object.getBoundingRect());
    const widths = boxes.map((box) => box.width).sort((a, b) => a - b);
    const heights = boxes.map((box) => box.height).sort((a, b) => a - b);
    const median = (values: number[]) =>
      values[Math.floor(values.length / 2)] ?? 1;
    const targetWidth = Math.max(1, median(widths));
    const targetHeight = Math.max(1, median(heights));
    objects.forEach((object, index) => {
      const box = boxes[index];
      if (!box.width || !box.height) return;
      object.set({
        scaleX: (object.scaleX ?? 1) * (targetWidth / box.width),
        scaleY: (object.scaleY ?? 1) * (targetHeight / box.height),
      });
    });
    this.commitLayoutObjects(canvas, objects);
  };

  readonly resetSelectionTransform = () => {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const objects = canvas.getActiveObjects() as CanvasObjectWithData[];
    for (const object of objects) {
      object.set({
        angle: 0,
        flipX: false,
        flipY: false,
        scaleX: object.data?.baseScaleX ?? 1,
        scaleY: object.data?.baseScaleY ?? 1,
      });
    }
    this.commitLayoutObjects(canvas, objects);
  };

  readonly alignSelection = (
    mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom",
  ) => {
    const canvas = this.deps.getCanvas();
    const selected = canvas?.getActiveObjects() ?? [];
    if (!canvas || selected.length < 2) return;
    const bounds = selected.map((object) => ({
      object,
      box: object.getBoundingRect(),
    }));
    const left = Math.min(...bounds.map((item) => item.box.left));
    const right = Math.max(...bounds.map((item) => item.box.left + item.box.width));
    const top = Math.min(...bounds.map((item) => item.box.top));
    const bottom = Math.max(...bounds.map((item) => item.box.top + item.box.height));
    for (const { object, box } of bounds) {
      let deltaX = 0;
      let deltaY = 0;
      if (mode === "left") deltaX = left - box.left;
      if (mode === "right") deltaX = right - box.left - box.width;
      if (mode === "centerX") deltaX = (left + right - box.width) / 2 - box.left;
      if (mode === "top") deltaY = top - box.top;
      if (mode === "bottom") deltaY = bottom - box.top - box.height;
      if (mode === "centerY") deltaY = (top + bottom - box.height) / 2 - box.top;
      this.moveLayoutObjectInScene(object, deltaX, deltaY);
    }
    this.commitLayoutObjects(canvas, selected as CanvasObjectWithData[]);
  };

  readonly distributeSelection = (axis: "x" | "y") => {
    const canvas = this.deps.getCanvas();
    const selected = canvas?.getActiveObjects() ?? [];
    if (!canvas || selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => {
      const first = a.getBoundingRect();
      const second = b.getBoundingRect();
      return axis === "x" ? first.left - second.left : first.top - second.top;
    });
    const boxes = sorted.map((object) => object.getBoundingRect());
    const first = boxes[0];
    const last = boxes[boxes.length - 1];
    const occupied = boxes.reduce(
      (sum, box) => sum + (axis === "x" ? box.width : box.height),
      0,
    );
    const span =
      axis === "x"
        ? last.left + last.width - first.left
        : last.top + last.height - first.top;
    const spacing = (span - occupied) / (boxes.length - 1);
    let cursor = axis === "x" ? first.left + first.width : first.top + first.height;
    for (let index = 1; index < sorted.length - 1; index += 1) {
      const object = sorted[index];
      const box = boxes[index];
      const target = cursor + spacing;
      this.moveLayoutObjectInScene(
        object as CanvasObjectWithData,
        axis === "x" ? target - box.left : 0,
        axis === "y" ? target - box.top : 0,
      );
      cursor = target + (axis === "x" ? box.width : box.height);
    }
    this.commitLayoutObjects(canvas, selected as CanvasObjectWithData[]);
  };
}
