export type ArrangeKey =
  | "name"
  | "added"
  | "layer"
  | "path"
  | "random"
  | "stack";

export interface ArrangeableItem {
  id: string;
  /** Current left/top/width/height in canvas units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fabric object creation index (added order) or layer index. */
  addedIndex: number;
  /** Object title/name for name/path sorting. */
  title: string;
  /** Absolute source path for path sorting (assets only). */
  path: string | null;
}

export interface ArrangeResult {
  id: string;
  x: number;
  y: number;
}

export interface ArrangeOptions {
  key: ArrangeKey;
  reverse?: boolean;
  /** Gap between stacked items. */
  gap?: number;
  /** Alignment within the arrangement for name/added/layer/path. */
  align?: "left" | "center";
  /** Anchor point for stacking (0=first item's top-left). */
  stackAnchor?: "first" | "last";
  /** Random seed for deterministic random order (0 = true random). */
  seed?: number;
}

/** PureRef-style arrange: name / added time / layer order / path / random / stack. */
export function arrangeItems(
  items: ArrangeableItem[],
  options: ArrangeOptions,
): ArrangeResult[] {
  const sorted = [...items];
  switch (options.key) {
    case "name":
      sorted.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true }),
      );
      break;
    case "added":
      sorted.sort((a, b) => a.addedIndex - b.addedIndex);
      break;
    case "layer":
      // Layer order: later objects are "on top"; index 0 is the bottom.
      sorted.sort((a, b) => a.addedIndex - b.addedIndex);
      break;
    case "path":
      sorted.sort((a, b) => {
        const left = a.path ?? "";
        const right = b.path ?? "";
        return left.localeCompare(right, undefined, { numeric: true });
      });
      break;
    case "random": {
      const seed = options.seed ?? 0;
      if (seed === 0) {
        // Fisher–Yates with Math.random.
        for (let index = sorted.length - 1; index > 0; index -= 1) {
          const swap = Math.floor(Math.random() * (index + 1));
          [sorted[index], sorted[swap]] = [sorted[swap], sorted[index]];
        }
      } else {
        // Deterministic LCG shuffle for reproducible arrangements.
        let state = seed >>> 0;
        const next = () => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state / 0x1_0000_0000;
        };
        for (let index = sorted.length - 1; index > 0; index -= 1) {
          const swap = Math.floor(next() * (index + 1));
          [sorted[index], sorted[swap]] = [sorted[swap], sorted[index]];
        }
      }
      break;
    }
    case "stack":
      break;
  }
  if (options.reverse && options.key !== "stack") sorted.reverse();

  const gap = Math.max(0, options.gap ?? 0);
  if (options.key === "stack") {
    // Stack each subsequent item over the anchor, offset by a small step.
    const anchor = options.stackAnchor === "last" ? sorted.length - 1 : 0;
    const anchorItem = sorted[anchor];
    if (!anchorItem) return [];
    const step = 12;
    return sorted.map((item, index) => {
      const offset = (index - anchor) * step;
      return {
        id: item.id,
        x: anchorItem.x + offset,
        y: anchorItem.y + offset,
      };
    });
  }

  // Row arrangement: place items left-to-right with the given gap.
  const align = options.align ?? "left";
  const result: ArrangeResult[] = [];
  let cursorX = 0;
  let rowY = 0;
  let rowMaxHeight = 0;
  let maxRowWidth = 0;
  if (items.length) {
    maxRowWidth = Math.max(...items.map((item) => item.x + item.width)) + 400;
  }
  for (const item of sorted) {
    if (cursorX > 0 && cursorX + item.width > maxRowWidth) {
      cursorX = 0;
      rowY += rowMaxHeight + gap;
      rowMaxHeight = 0;
    }
    result.push({ id: item.id, x: cursorX, y: rowY });
    cursorX += item.width + gap;
    rowMaxHeight = Math.max(rowMaxHeight, item.height);
  }
  if (align === "center") {
    // Center each row horizontally around the widest row.
    const rows = new Map<number, { start: number; width: number }>();
    let currentRow = 0;
    let rowWidth = 0;
    let rowStart = 0;
    for (const placed of result) {
      const item = sorted.find((candidate) => candidate.id === placed.id)!;
      if (placed.x === 0 && placed.y !== (rows.get(currentRow)?.start ?? 0)) {
        currentRow += 1;
        rowWidth = 0;
        rowStart = placed.y;
      }
      rowWidth += item.width + gap;
      rows.set(currentRow, { start: rowStart, width: Math.max(rows.get(currentRow)?.width ?? 0, rowWidth - gap) });
    }
    const maxWidth = Math.max(...[...rows.values()].map((row) => row.width));
    for (const placed of result) {
      const item = sorted.find((candidate) => candidate.id === placed.id)!;
      const row = [...rows.entries()].find(
        ([, value]) => placed.y === value.start,
      );
      if (row) {
        placed.x = (maxWidth - row[1].width) / 2 + placed.x;
      }
      void item;
    }
  }
  return result;
}

/**
 * 统一尺寸：把对象的呈现尺寸（width*scaleX）调整到目标。
 * 只给宽度 → 按原始宽高比等比；只给高度 → 等比；都给出 → 双轴拉伸；
 * 只给 scale → 整体缩放。
 */
export function uniformSize(
  items: ArrangeableItem[],
  target: { width?: number; height?: number; scale?: number },
): Array<{ id: string; scaleX: number; scaleY: number }> {
  return items.map((item) => {
    const baseWidth = item.width || 1;
    const baseHeight = item.height || 1;
    const scale = target.scale ?? 1;
    if (target.width !== undefined && target.height !== undefined) {
      return {
        id: item.id,
        scaleX: (target.width / baseWidth) * scale,
        scaleY: (target.height / baseHeight) * scale,
      };
    }
    if (target.width !== undefined) {
      // 只给宽度 → 等比缩放（两轴同系数，保持纵横比）。
      return {
        id: item.id,
        scaleX: (target.width / baseWidth) * scale,
        scaleY: (target.width / baseWidth) * scale,
      };
    }
    if (target.height !== undefined) {
      return {
        id: item.id,
        scaleX: (target.height / baseHeight) * scale,
        scaleY: (target.height / baseHeight) * scale,
      };
    }
    return { id: item.id, scaleX: scale, scaleY: scale };
  });
}
