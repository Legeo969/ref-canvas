import {
  ActiveSelection,
  Control,
  FabricImage,
  Group,
  controlsUtils,
  type FabricObject,
  type TransformActionHandler,
} from "fabric";

const accent = "#75d2b6";

const renderCorner: Control["render"] = (context, left, top, _style, object) => {
  context.save();
  context.translate(left, top);
  context.rotate(((object.angle ?? 0) * Math.PI) / 180);
  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.strokeRect(-3.5, -3.5, 7, 7);
  context.restore();
};

const rotateWithShiftSnapping: TransformActionHandler = (
  event,
  transform,
  x,
  y,
) => {
  const previousAngle = transform.target.snapAngle;
  const previousThreshold = transform.target.snapThreshold;
  const snapped = Boolean((event as MouseEvent).shiftKey);
  transform.target.snapAngle = snapped ? 45 : 0;
  transform.target.snapThreshold = snapped ? 45 : 0;
  try {
    return controlsUtils.rotationWithSnapping(event, transform, x, y);
  } finally {
    transform.target.snapAngle = previousAngle;
    transform.target.snapThreshold = previousThreshold;
  }
};

function scaleControl(x: -0.5 | 0.5, y: -0.5 | 0.5): Control {
  return new Control({
    x,
    y,
    sizeX: 20,
    sizeY: 20,
    touchSizeX: 28,
    touchSizeY: 28,
    actionHandler: controlsUtils.scalingEqually,
    cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
    render: renderCorner,
  });
}

function rotateControl(x: -0.5 | 0.5, y: -0.5 | 0.5): Control {
  return new Control({
    x,
    y,
    offsetX: x * 36,
    offsetY: y * 36,
    sizeX: 18,
    sizeY: 18,
    touchSizeX: 26,
    touchSizeY: 26,
    actionName: "rotate",
    cursorStyle: "crosshair",
    cursorStyleHandler: controlsUtils.rotationStyleHandler,
    actionHandler: rotateWithShiftSnapping,
    render: () => undefined,
  });
}

export function createBoardControls(): Record<string, Control> {
  return {
    tl: scaleControl(-0.5, -0.5),
    tr: scaleControl(0.5, -0.5),
    bl: scaleControl(-0.5, 0.5),
    br: scaleControl(0.5, 0.5),
    rtl: rotateControl(-0.5, -0.5),
    rtr: rotateControl(0.5, -0.5),
    rbl: rotateControl(-0.5, 0.5),
    rbr: rotateControl(0.5, 0.5),
  };
}

const boardControls = createBoardControls();

export function supportsBoardControls(object: FabricObject): boolean {
  return object instanceof FabricImage || object instanceof Group || object instanceof ActiveSelection;
}

export function applyBoardControls(object: FabricObject): void {
  if (!supportsBoardControls(object)) return;
  object.controls = boardControls;
  object.set({
    borderColor: accent,
    borderScaleFactor: 1,
    cornerColor: "transparent",
    cornerStrokeColor: accent,
    cornerSize: 8,
    touchCornerSize: 28,
    transparentCorners: true,
    padding: 2,
  });
}
