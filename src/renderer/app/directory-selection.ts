/**
 * 目录模式选择模型的纯函数：单击/Ctrl 切换/Shift 范围/Ctrl+A。
 * 供目录卡片与批量工具栏共用。
 */

/** Shift 范围选择：anchor → target（按 ordered 顺序），无 anchor 时退回单选。 */
export function rangeSelect(
  ordered: readonly string[],
  anchor: string | null,
  target: string,
): Set<string> {
  const endIndex = ordered.indexOf(target);
  if (endIndex === -1) return new Set([target]);
  const startIndex = anchor ? ordered.indexOf(anchor) : -1;
  if (startIndex === -1) return new Set([target]);
  const [from, to] =
    startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return new Set(ordered.slice(from, to + 1));
}

/** Ctrl 切换：命中则移除，否则加入。 */
export function toggleSelect(current: ReadonlySet<string>, target: string): Set<string> {
  const next = new Set(current);
  if (next.has(target)) next.delete(target);
  else next.add(target);
  return next;
}

/** 应用点击语义（plain = 单选；ctrl = 切换；shift = 范围）。 */
export function applySelectionClick(
  current: ReadonlySet<string>,
  ordered: readonly string[],
  anchor: string | null,
  target: string,
  modifiers: { ctrl: boolean; shift: boolean },
): { selection: Set<string>; anchor: string | null } {
  if (modifiers.ctrl) {
    return { selection: toggleSelect(current, target), anchor: target };
  }
  if (modifiers.shift) {
    return {
      selection: rangeSelect(ordered, anchor ?? target, target),
      anchor: anchor ?? target,
    };
  }
  return { selection: new Set([target]), anchor: target };
}
