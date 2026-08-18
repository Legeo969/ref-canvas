import path from "node:path";

/**
 * SPEC-2 库可移植性：纯函数路径重映射。
 *
 * 导入 bundle 时，把导出机器上的绝对路径（`assets.path`、`watch_roots.path`、
 * `mount_roots.path`、`file_identities.path_key/root_path`、`collection_items`
 * 等）按用户指定的根映射改写为新机器的路径。
 */

export interface PathRemapRule {
  /** 导出机上的根（绝对路径，如 `D:/Assets.library/`）。 */
  from: string;
  /** 导入机上的新根（绝对路径，如 `E:/Assets.library/`）。 */
  to: string;
}

/**
 * 应用一组根映射改写单个绝对路径。
 * - 若路径在某个 from 根下，替换为该根对应的 to。
 * - 否则原样返回（不匹配任何根 → 该路径保持导出机的路径，导入后可能不可达）。
 * 规则按 from 长度降序匹配，确保最具体的根优先。
 */
export function remapPath(filename: string, rules: PathRemapRule[]): string {
  const normalized = path.normalize(filename);
  const sorted = [...rules].sort(
    (left, right) => right.from.length - left.from.length,
  );
  for (const rule of sorted) {
    const from = path.normalize(rule.from).replace(/[\\/]+$/, "");
    const candidate = path.normalize(normalized);
    if (
      candidate === from ||
      candidate.startsWith(`${from}${path.sep}`) ||
      candidate.startsWith(`${from}/`)
    ) {
      const relative = candidate.slice(from.length).replace(/^[\\/]+/, "");
      return relative
        ? path.join(path.normalize(rule.to), relative)
        : path.normalize(rule.to);
    }
  }
  return normalized;
}

/** 重算 path_key（与 database.ts 的 pathKeyFor 同规则：normalize + 小写）。 */
export function pathKeyFor(filename: string): string {
  return path.normalize(filename).toLocaleLowerCase("en-US");
}

/**
 * 依据 bundle 的导出根集合，生成默认的根映射建议。
 * 导出根通常来自 bundle.json 的 `pathRoots`（watch_roots + mount_roots）。
 * 每个根生成一条 `from = 该根`、`to = 用户确认/编辑后的新根`（缺省沿用原根）。
 */
export function defaultRemapRules(
  exportedRoots: string[],
  chosenRoots?: Array<{ from: string; to: string }>,
): PathRemapRule[] {
  const chosen = new Map(
    (chosenRoots ?? []).map((rule) => [path.normalize(rule.from), rule.to]),
  );
  return exportedRoots
    .filter((root) => !!root && path.isAbsolute(root))
    .map((root) => ({
      from: root,
      to: chosen.get(path.normalize(root)) ?? root,
    }));
}
