/**
 * 3D 模型预览相机视图的纯函数：默认视图、视图比较与写入安全钳制。
 * ModelPreview 的相机写回与 BoardCanvas 的 modelView 持久化共用。
 */

export type ModelView = {
  position: [number, number, number];
  target: [number, number, number];
};

/** 包围球半径对应的默认相机视图（与 ModelPreview 内部默认一致）。 */
export function defaultModelView(radius: number): ModelView {
  return {
    position: [radius * 1.4, radius * 0.9, radius * 1.8],
    target: [0, 0, 0],
  };
}

/** 两个视图是否等价（用于去重相机写回）。 */
export function viewsEqual(left: ModelView, right: ModelView): boolean {
  return (
    left.position[0] === right.position[0] &&
    left.position[1] === right.position[1] &&
    left.position[2] === right.position[2] &&
    left.target[0] === right.target[0] &&
    left.target[1] === right.target[1] &&
    left.target[2] === right.target[2]
  );
}

/** 写入前钳制：只保留有限数值，非法分量回退 0；整体非法回退默认视图。 */
export function sanitizeModelView(view: ModelView): ModelView {
  const finite = (value: number) => (Number.isFinite(value) ? value : 0);
  const position = [
    finite(view.position[0]),
    finite(view.position[1]),
    finite(view.position[2]),
  ] as [number, number, number];
  const target = [
    finite(view.target[0]),
    finite(view.target[1]),
    finite(view.target[2]),
  ] as [number, number, number];
  if (
    position[0] === 0 &&
    position[1] === 0 &&
    position[2] === 0
  ) {
    return defaultModelView(1);
  }
  return { position, target };
}
