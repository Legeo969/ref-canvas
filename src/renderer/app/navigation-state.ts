import {
  assetColorLabels,
  assetKinds,
  assetSortKeys,
  type AssetColorLabel,
  type AssetKind,
  type AssetSortKey,
  type LinkState,
  type SortDirection,
} from "../../shared/contracts";

const STORAGE_KEY = "refcanvas.navigation.v2";
const LEGACY_STORAGE_KEY = "refcanvas.navigation.v1";

export type NavigationSource = "library" | "directory";

export interface NavigationStateV2 {
  version: 2;
  updatedAt: number;
  /** 当前浏览来源：资料库素材还是本地目录浏览。 */
  navigationSource: NavigationSource;
  query: string;
  kindFilter: AssetKind | "all";
  collectionFilter: string | null;
  linkStateFilter: LinkState | "all";
  lifecycleFilter: "active" | "trashed";
  favoriteFilter?: boolean;
  ratingFilter: number;
  colorFilter: AssetColorLabel;
  visualColor: string | null;
  visualColorTolerance: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minSize?: number;
  maxSize?: number;
  minDuration?: number;
  maxDuration?: number;
  extension?: string;
  orientation?: "landscape" | "portrait" | "square";
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  sort: AssetSortKey;
  direction: SortDirection;
  collapsedFolderIds: string[];
  collapsedTagGroupIds: string[];
  assetKindsExpanded: boolean;
  showAllTags: boolean;
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
  | "version"
  | "navigationSource"
  | "directoryPath"
  | "directoryHistory"
  | "assetKindsExpanded"
> & { version: 1 };

const defaults: NavigationStateV2 = {
  version: 2,
  updatedAt: 0,
  navigationSource: "library",
  query: "",
  kindFilter: "all",
  collectionFilter: null,
  linkStateFilter: "all",
  lifecycleFilter: "active",
  favoriteFilter: undefined,
  ratingFilter: 0,
  colorFilter: "none",
  visualColor: null,
  visualColorTolerance: 25,
  minWidth: undefined,
  maxWidth: undefined,
  minHeight: undefined,
  maxHeight: undefined,
  minSize: undefined,
  maxSize: undefined,
  minDuration: undefined,
  maxDuration: undefined,
  extension: undefined,
  orientation: undefined,
  createdAfter: undefined,
  createdBefore: undefined,
  modifiedAfter: undefined,
  modifiedBefore: undefined,
  sort: "createdAt",
  direction: "desc",
  collapsedFolderIds: [],
  collapsedTagGroupIds: [],
  assetKindsExpanded: false,
  showAllTags: false,
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

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.length > 0 && item.length <= 128,
        )
        .slice(0, 10_000)
    : [];

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
  const kindFilter = [...assetKinds, "all"].includes(
    value.kindFilter as AssetKind | "all",
  )
    ? (value.kindFilter as AssetKind | "all")
    : defaults.kindFilter;
  const linkStateFilter = [
    "all",
    "online",
    "missing",
    "searching",
    "ambiguous",
  ].includes(String(value.linkStateFilter))
    ? (value.linkStateFilter as LinkState | "all")
    : defaults.linkStateFilter;
  const lifecycleFilter =
    value.lifecycleFilter === "trashed" ? "trashed" : "active";
  const colorFilter = assetColorLabels.includes(
    value.colorFilter as AssetColorLabel,
  )
    ? (value.colorFilter as AssetColorLabel)
    : defaults.colorFilter;
  const sort = assetSortKeys.includes(value.sort as AssetSortKey)
    ? (value.sort as AssetSortKey)
    : defaults.sort;
  const direction: SortDirection =
    value.direction === "asc" ? "asc" : "desc";
  const visualColor =
    typeof value.visualColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.visualColor)
      ? value.visualColor
      : null;
  return {
    updatedAt: finiteNumber(value.updatedAt, 0, 1_000_000_000_000_000) ?? 0,
    query:
      typeof value.query === "string" ? value.query.slice(0, 1_000) : "",
    kindFilter,
    collectionFilter:
      typeof value.collectionFilter === "string" &&
      value.collectionFilter.length <= 128
        ? value.collectionFilter
        : null,
    linkStateFilter,
    lifecycleFilter,
    favoriteFilter: value.favoriteFilter === true ? true : undefined,
    ratingFilter: finiteNumber(value.ratingFilter, 0, 5) ?? 0,
    colorFilter,
    visualColor,
    visualColorTolerance:
      finiteNumber(value.visualColorTolerance, 1, 100) ?? 25,
    minWidth: finiteNumber(value.minWidth, 0, 1_000_000),
    maxWidth: finiteNumber(value.maxWidth, 0, 1_000_000),
    minHeight: finiteNumber(value.minHeight, 0, 1_000_000),
    maxHeight: finiteNumber(value.maxHeight, 0, 1_000_000),
    minSize: finiteNumber(value.minSize, 0, 1_000_000_000_000_000),
    maxSize: finiteNumber(value.maxSize, 0, 1_000_000_000_000_000),
    minDuration: finiteNumber(value.minDuration, 0, 315_360_000),
    maxDuration: finiteNumber(value.maxDuration, 0, 315_360_000),
    extension:
      typeof value.extension === "string" &&
      /^[a-z0-9]{1,16}$/i.test(value.extension)
        ? value.extension.toLowerCase()
        : undefined,
    orientation: ["landscape", "portrait", "square"].includes(
      String(value.orientation),
    )
      ? (value.orientation as "landscape" | "portrait" | "square")
      : undefined,
    createdAfter:
      typeof value.createdAfter === "string"
        ? value.createdAfter.slice(0, 64)
        : undefined,
    createdBefore:
      typeof value.createdBefore === "string"
        ? value.createdBefore.slice(0, 64)
        : undefined,
    modifiedAfter:
      typeof value.modifiedAfter === "string"
        ? value.modifiedAfter.slice(0, 64)
        : undefined,
    modifiedBefore:
      typeof value.modifiedBefore === "string"
        ? value.modifiedBefore.slice(0, 64)
        : undefined,
    sort,
    direction,
    collapsedFolderIds: stringList(value.collapsedFolderIds),
    collapsedTagGroupIds: stringList(value.collapsedTagGroupIds),
    assetKindsExpanded: value.assetKindsExpanded === true,
    showAllTags: value.showAllTags === true,
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
    navigationSource: "library",
    directoryPath: null,
    directoryHistory: [],
    directoryHistoryIndex: 0,
    assetKindsExpanded: false,
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
          value.navigationSource === "directory" ? "directory" : "library",
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

export function navigationStateForCollections(
  state: NavigationStateV2,
  collectionIds: ReadonlySet<string>,
): NavigationStateV2 {
  return {
    ...state,
    collectionFilter:
      state.collectionFilter && collectionIds.has(state.collectionFilter)
        ? state.collectionFilter
        : null,
    collapsedFolderIds: state.collapsedFolderIds.filter((id) =>
      collectionIds.has(id),
    ),
  };
}
