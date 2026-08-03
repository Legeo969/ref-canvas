import type { CollectionRecord } from "../../shared/contracts";

/**
 * 层级文件夹/目录导航的纯函数：面包屑路径计算。
 * 渲染层直接消费，避免在组件内重复递归。
 */

/** 从根到目标文件夹（含自身）的祖先链；未知 id 返回空数组。 */
export function ancestorChain(
  collections: readonly CollectionRecord[],
  folderId: string | null,
): CollectionRecord[] {
  if (!folderId) return [];
  const byId = new Map(collections.map((item) => [item.id, item]));
  const chain: CollectionRecord[] = [];
  let current: CollectionRecord | undefined = byId.get(folderId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** 文件夹完整路径标签（根到自身，`父 / 子` 形式）。 */
export function folderLabel(
  collections: readonly CollectionRecord[],
  folderId: string,
): string {
  const byId = new Map(collections.map((item) => [item.id, item]));
  const labelFor = (id: string): string => {
    const collection = byId.get(id);
    if (!collection) return "";
    return collection.parentId
      ? `${labelFor(collection.parentId)} / ${collection.title}`
      : collection.title;
  };
  return labelFor(folderId);
}

/** 目录面包屑：每段可点击跳转的 {label, path} 列表。 */
export interface DirectoryCrumb {
  label: string;
  /** 点击跳转目标路径。 */
  path: string;
}

export function directoryBreadcrumb(
  directoryPath: string | null,
): DirectoryCrumb[] {
  if (!directoryPath) return [];
  const normalized = directoryPath.replace(/\//g, "\\");
  const segments = normalized.split("\\").filter(Boolean);
  if (!segments.length) return [];
  const crumbs: DirectoryCrumb[] = [];
  let accumulated = "";
  // UNC 共享根（\\server\share）整体作为首个不可再分的段。
  if (normalized.startsWith("\\\\") && segments.length >= 2) {
    const root = `\\\\${segments[0]}\\${segments[1]}`;
    crumbs.push({ label: `${segments[0]}\\${segments[1]}`, path: root });
    accumulated = root;
    segments.splice(0, 2);
  }
  for (const segment of segments) {
    const isDrive = /^[a-z]:$/i.test(segment);
    accumulated = accumulated
      ? `${accumulated.replace(/\\$/, "")}\\${segment}`
      : isDrive
        ? `${segment}\\`
        : segment;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}
