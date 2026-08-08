export interface HierarchyItem {
  id: string;
  parentId?: string;
}

export interface FlattenedHierarchyItem {
  id: string;
  depth: number;
  hasChildren: boolean;
}

export function hierarchyDescendantIds(
  items: HierarchyItem[],
  parentId: string,
): string[] {
  const result: string[] = [];
  const pending = [parentId];
  const visited = new Set<string>(pending);
  while (pending.length) {
    const current = pending.shift()!;
    for (const item of items) {
      if (item.parentId !== current || visited.has(item.id)) continue;
      visited.add(item.id);
      result.push(item.id);
      pending.push(item.id);
    }
  }
  return result;
}

export function canSetHierarchyParent(
  items: HierarchyItem[],
  childId: string,
  parentId: string | undefined,
): boolean {
  if (!parentId) return true;
  if (childId === parentId) return false;
  return !hierarchyDescendantIds(items, childId).includes(parentId);
}

export function flattenHierarchy(
  items: HierarchyItem[],
): FlattenedHierarchyItem[] {
  const ids = new Set(items.map((item) => item.id));
  const children = new Map<string | undefined, HierarchyItem[]>();
  for (const item of items) {
    const parentId =
      item.parentId && ids.has(item.parentId) ? item.parentId : undefined;
    const siblings = children.get(parentId) ?? [];
    siblings.push(item);
    children.set(parentId, siblings);
  }
  const result: FlattenedHierarchyItem[] = [];
  const visited = new Set<string>();
  const append = (item: HierarchyItem, depth: number) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const nested = children.get(item.id) ?? [];
    result.push({ id: item.id, depth, hasChildren: nested.length > 0 });
    for (const child of nested) append(child, depth + 1);
  };
  for (const root of children.get(undefined) ?? []) append(root, 0);
  for (const item of items) append(item, 0);
  return result;
}

export function hierarchyTransformDelta(
  previous: TMat2D,
  current: TMat2D,
): TMat2D {
  return util.multiplyTransformMatrices(
    current,
    util.invertTransform(previous),
  );
}

export function applyHierarchyTransform(
  object: FabricObject,
  delta: TMat2D,
): void {
  const next = util.multiplyTransformMatrices(
    delta,
    object.calcTransformMatrix(),
  );
  util.applyTransformToObject(object, next);
  object.setCoords();
}
import { type FabricObject, type TMat2D, util } from "fabric";
