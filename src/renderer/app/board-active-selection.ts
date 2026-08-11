import {
  ActiveSelection,
  Group,
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

export function createBoardActiveSelection(
  objects: FabricObject[],
  canvas: Canvas,
): BoardActiveSelection {
  return new BoardActiveSelection(objects, { canvas });
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
