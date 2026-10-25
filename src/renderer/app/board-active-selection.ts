import {
  ActiveSelection,
  Group,
  classRegistry,
  util,
  type Canvas,
  type FabricObject,
} from "fabric";

/**
 * Rendering controls for every selected object is useful for a handful of
 * objects, but becomes substantial visual and CPU noise for bulk selections.
 */
export const BOARD_MEMBER_CONTROL_LIMIT = 64;

/**
 * ActiveSelection normally treats all children as grouped, which prevents the
 * canvas's skipOffscreen optimization from applying to them. This board-specific
 * variant restores that culling while retaining Fabric's temporary grouping and
 * transform semantics.
 */
export class BoardActiveSelection extends ActiveSelection {
  override drawObject(
    ...[context, _forClipping, drawContext]: Parameters<
      ActiveSelection["drawObject"]
    >
  ): void {
    this._renderBackground(context);
    const canvas = this.canvas;

    for (const object of this.getObjects()) {
      if (canvas?.skipOffscreen && !object.isOnScreen()) continue;

      if (canvas?.preserveObjectStacking && object.group !== this) {
        context.save();
        const inverse = util.invertTransform(this.calcTransformMatrix());
        context.transform(
          inverse[0],
          inverse[1],
          inverse[2],
          inverse[3],
          inverse[4],
          inverse[5],
        );
        object.render(context);
        context.restore();
      } else if (object.group === this) {
        object.render(context);
      }
    }

    this._drawClipPath(context, this.clipPath, drawContext);
  }

  override _renderControls(
    ...[context, styleOverride, childrenOverride]: Parameters<
      ActiveSelection["_renderControls"]
    >
  ): void {
    context.save();
    context.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;

    if (this.size() <= BOARD_MEMBER_CONTROL_LIMIT) {
      const options = {
        hasControls: false,
        ...childrenOverride,
        forActiveSelection: true,
      };
      for (const object of this.getObjects()) {
        object._renderControls(context, options);
      }
    }

    Group.prototype._renderControls.call(this, context, styleOverride);
    context.restore();
  }
}

/** Make every Fabric-created selection (marquee and modifier-click) board-safe. */
export function installBoardActiveSelection(): void {
  classRegistry.setClass(BoardActiveSelection, "ActiveSelection");
  classRegistry.setClass(BoardActiveSelection, "activeSelection");
}

export function createBoardActiveSelection(
  objects: FabricObject[],
  canvas: Canvas,
): BoardActiveSelection {
  return new BoardActiveSelection(objects, { canvas });
}

/**
 * Fabric creates its own ActiveSelection for a mouse marquee. Rebuilding that
 * temporary group just to use the board renderer repeats layout work for every
 * selected object, so upgrade the instance in place before the next paint.
 */
export function optimizeBoardActiveSelection(
  selection: ActiveSelection,
): BoardActiveSelection {
  if (!(selection instanceof BoardActiveSelection)) {
    Object.setPrototypeOf(selection, BoardActiveSelection.prototype);
  }
  return selection as BoardActiveSelection;
}

/**
 * Ctrl+点击加选/移出：活动对象为多选且含 target 时移出（剩 1 个收拢为单选、
 * 剩 0 个清除、其余重建多选），不含 target 时加入；无多选（单选/空）保持
 * Fabric 普通点击行为不动。与 selectAllBoardObjects 一样只调度一次重绘。
 */
export function toggleObjectInActiveSelection(
  canvas: Canvas,
  target: FabricObject,
): void {
  const active = canvas.getActiveObject();
  if (!(active instanceof ActiveSelection)) return;
  const members = active.getObjects();
  const rest = members.filter((object) => object !== target);
  if (rest.length === members.length) {
    canvas.setActiveObject(
      createBoardActiveSelection([...members, target], canvas),
    );
  } else if (rest.length === 1) {
    canvas.setActiveObject(rest[0]);
  } else if (rest.length === 0) {
    canvas.discardActiveObject();
  } else {
    canvas.setActiveObject(createBoardActiveSelection(rest, canvas));
  }
  canvas.getActiveObject()?.setCoords();
  canvas.requestRenderAll();
}

/** Selects all selectable board objects and schedules exactly one repaint. */
export function selectAllBoardObjects(canvas: Canvas): void {
  const selectable = canvas
    .getObjects()
    .filter(
      (object) =>
        object.selectable &&
        !(object as FabricObject & { data?: { guideAxis?: "x" | "y" } }).data
          ?.guideAxis,
    );

  if (selectable.length === 1) {
    canvas.setActiveObject(selectable[0]);
  } else if (selectable.length > 1) {
    canvas.setActiveObject(createBoardActiveSelection(selectable, canvas));
  }
  canvas.requestRenderAll();
}
