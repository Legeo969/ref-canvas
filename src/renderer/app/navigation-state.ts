const STORAGE_KEY = "refcanvas.navigation.v2";
const LEGACY_STORAGE_KEY = "refcanvas.navigation.v1";

export type NavigationSource = "library" | "directory";

/**
 * V2 导航状态：V3 多标签（navigation-v3）成为主数据源后，V2 仅承载
 * 目录路径/历史与滚动位置（V2→V3 迁移用）。旧库筛选字段已随筛选 UI 一并移除，
 * 读取时静默忽略存量 JSON 中的未知键。
 */
export interface NavigationStateV2 {
  version: 2;
  updatedAt: number;
  /** 当前数据来源：本地索引或目录浏览。 */
  navigationSource: NavigationSource;
  scrollTop: number;
  /** 本地目录浏览的当前目录路径。 */
  directoryPath: string | null;
  /** 本地目录浏览的历史（含当前目录，最近优先）。 */
  directoryHistory: string[];
  /** 目录历史游标（directoryHistory 中当前项的索引；0.35 新增，旧数据缺省为最右）。 */
  directoryHistoryIndex?: number;
}

type LegacyNavigationStateV1 = Omit<
  NavigationStateV2,
  "version" | "navigationSource" | "directoryPath" | "directoryHistory"
> & { version: 1 };

const defaults: NavigationStateV2 = {
  version: 2,
  updatedAt: 0,
  navigationSource: "directory",
  scrollTop: 0,
  directoryPath: null,
  directoryHistory: [],
  directoryHistoryIndex: 0,
};

const finiteNumber = (
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : undefined;

const pathList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.length > 0 && item.length <= 32_768,
        )
        .slice(0, 500)
    : [];

/** 从任意记录中解析共享字段（V1 与 V2 通用）。 */
function parseSharedFields(
  value: Record<string, unknown>,
): Omit<
  NavigationStateV2,
  "version" | "navigationSource" | "directoryPath" | "directoryHistory"
> {
  return {
    updatedAt: finiteNumber(value.updatedAt, 0, 1_000_000_000_000_000) ?? 0,
    scrollTop: finiteNumber(value.scrollTop, 0, 10_000_000) ?? 0,
  };
}

/** V1 → V2 迁移：保留全部既有字段，补全新字段的默认值。 */
export function migrateNavigationState(
  state: LegacyNavigationStateV1,
): NavigationStateV2 {
  return {
    ...state,
    version: 2,
    navigationSource: "directory",
    directoryPath: null,
    directoryHistory: [],
    directoryHistoryIndex: 0,
  };
}

export function parseNavigationState(raw: string | null): NavigationStateV2 | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const shared = parseSharedFields(value);
    if (value.version === 2) {
      const directoryPath =
        typeof value.directoryPath === "string" &&
        value.directoryPath.length <= 32_768
          ? value.directoryPath
          : null;
      const directoryHistory =
        directoryPath && !pathList(value.directoryHistory).includes(directoryPath)
          ? [directoryPath, ...pathList(value.directoryHistory)]
          : pathList(value.directoryHistory);
      // 旧数据无游标：历史以“最近优先”存储（index 0 = 当前目录），缺省指向 0。
      const fallbackIndex = 0;
      const directoryHistoryIndex = finiteNumber(
        value.directoryHistoryIndex,
        0,
        Math.max(0, directoryHistory.length - 1),
      );
      return {
        ...shared,
        version: 2,
        navigationSource:
          value.navigationSource === "library" ? "library" : "directory",
        directoryPath,
        directoryHistory,
        directoryHistoryIndex:
          directoryHistoryIndex ?? fallbackIndex,
      };
    }
    if (value.version === 1) {
      return migrateNavigationState({
        ...shared,
        version: 1,
      });
    }
    return null;
  } catch {
    return null;
  }
}

export function readNavigationState(): NavigationStateV2 {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    const parsed = parseNavigationState(current);
    if (parsed) return parsed;
    // 0.33 → 0.34 迁移：读取旧的 v1 键并升级为 v2，随后写回新键。
    const legacy = parseNavigationState(
      window.localStorage.getItem(LEGACY_STORAGE_KEY),
    );
    if (legacy) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      return legacy;
    }
    return { ...defaults };
  } catch {
    return { ...defaults };
  }
}

let durableWrite = Promise.resolve();

export async function readDurableNavigationState(): Promise<NavigationStateV2> {
  const local = readNavigationState();
  try {
    const raw = await window.refCanvas?.system?.getNavigationState?.();
    const durable = parseNavigationState(raw ?? null);
    const selected =
      durable && durable.updatedAt > local.updatedAt ? durable : local;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    return selected;
  } catch {
    return local;
  }
}

export function updateNavigationState(
  patch: Partial<NavigationStateV2>,
): void {
  try {
    const current = readNavigationState();
    const next = {
      ...current,
      ...patch,
      version: 2 as const,
      updatedAt: Date.now(),
    };
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(
      STORAGE_KEY,
      serialized,
    );
    if (window.refCanvas?.system?.setNavigationState) {
      durableWrite = durableWrite
        .then(() => window.refCanvas.system.setNavigationState(serialized))
        .catch(() => undefined);
    }
  } catch {
    // Navigation persistence must never block the library.
  }
}
