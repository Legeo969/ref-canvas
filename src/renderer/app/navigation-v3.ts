/**
 * 浏览标签与导航 V3（§5.2）。
 *
 * V3 把单个导航状态升级为多标签模型：每个浏览标签持有独立的目录/集合目标、
 * 历史、查询、类型筛选、展平深度、网格尺寸、选中项与滚动位置；顶层记录
 * 当前工作区（Browser/Board）与活动标签。
 *
 * - 兼容：V2（NavigationStateV2）自动迁移为一个 directory tab；
 *   损坏 JSON 回退默认标签，不阻止启动。
 * - 持久化沿用 Main 侧 durable navigation store（单个 JSON 字符串）；
 *   本模块负责 local 与 durable 两侧的读写与版本迁移。
 */
import type { NavigationStateV2 } from "./navigation-state";
import { translate } from "./i18n";

const STORAGE_KEY_V3 = "refcanvas.navigation.v3";
const DEFAULT_GRID_SIZE = 200;

export type BrowserTabKind = "directory" | "collection";

export interface BrowserTabState {
  id: string;
  kind: BrowserTabKind;
  /** 目录绝对路径或 collection id（由 Main 规范化后的路径）。 */
  targetId: string;
  title: string;
  backStack: string[];
  forwardStack: string[];
  query: string;
  typeFilters: string[];
  flattenDepth: 0 | 1 | 2;
  gridSize: number;
  selectedKeys: string[];
  scrollOffset: number;
}

export interface NavigationStateV3 {
  schemaVersion: 3;
  activeWorkspace: "browser" | "board";
  activeTabId: string | null;
  tabs: BrowserTabState[];
}

export function createBrowserTab(
  kind: BrowserTabKind,
  targetId: string,
  title: string,
): BrowserTabState {
  return {
    id: crypto.randomUUID(),
    kind,
    targetId,
    title: title.slice(0, 256) || translate("directory.untitled"),
    backStack: [],
    forwardStack: [],
    query: "",
    typeFilters: [],
    flattenDepth: 0,
    gridSize: DEFAULT_GRID_SIZE,
    selectedKeys: [],
    scrollOffset: 0,
  };
}

const finiteRange = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
};

const boundedString = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";

const stringList = (value: unknown, maxItems: number): string[] =>
  Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.length > 0 && item.length <= 4096,
        )
        .slice(0, maxItems)
    : [];

const boundedPath = (value: unknown): string =>
  typeof value === "string" && value.length > 0 && value.length <= 32_768
    ? value
    : "";

/** 从任意记录解析单个 tab（未知字段回退默认值）。 */
function parseTab(value: Record<string, unknown>): BrowserTabState | null {
  const kind = value.kind === "collection" ? "collection" : "directory";
  const targetId = boundedPath(value.targetId);
  if (!targetId) return null;
  const title = boundedString(value.title, 256);
  return {
    id: boundedString(value.id, 64) || crypto.randomUUID(),
    kind,
    targetId,
    title: title || targetId.split(/[\\/]/).pop() || translate("directory.untitled"),
    backStack: stringList(value.backStack, 500).filter(
      (item) => item !== targetId,
    ),
    forwardStack: stringList(value.forwardStack, 500).filter(
      (item) => item !== targetId,
    ),
    query: boundedString(value.query, 1_000),
    typeFilters: stringList(value.typeFilters, 64),
    flattenDepth: [0, 1, 2].includes(value.flattenDepth as number)
      ? (value.flattenDepth as 0 | 1 | 2)
      : 0,
    gridSize: finiteRange(value.gridSize, 96, 640, DEFAULT_GRID_SIZE),
    selectedKeys: stringList(value.selectedKeys, 10_000),
    scrollOffset: finiteRange(value.scrollOffset, 0, 100_000_000, 0),
  };
}

/** 从任意记录解析 V3（结构损坏时回退默认标签）。 */
export function parseNavigationStateV3(
  value: Record<string, unknown>,
): NavigationStateV3 | null {
  if (value.schemaVersion !== 3) return null;
  const rawTabs = Array.isArray(value.tabs) ? value.tabs : [];
  const tabs = rawTabs
    .map((tab) =>
      tab && typeof tab === "object"
        ? parseTab(tab as Record<string, unknown>)
        : null,
    )
    .filter((tab): tab is BrowserTabState => tab !== null);
  if (tabs.length === 0) return null;
  const activeTabId = boundedString(value.activeTabId, 64);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  return {
    schemaVersion: 3,
    activeWorkspace: value.activeWorkspace === "board" ? "board" : "browser",
    activeTabId: activeTab.id,
    tabs,
  };
}

/** V2 单导航状态 → V3：迁移为一个 directory tab。 */
export function migrateV2ToV3(v2: NavigationStateV2): NavigationStateV3 {
  const targetId = v2.directoryPath ?? "";
  const directoryTab =
    targetId !== ""
      ? createBrowserTab("directory", targetId, targetId.split(/[\\/]/).pop() ?? targetId)
      : null;
  const fallbackTab = createBrowserTab("directory", "browser://empty", translate("browser.empty"));
  const tabs = directoryTab ? [directoryTab] : [fallbackTab];
  const active = tabs[0];
  if (targetId !== "" && directoryTab) {
    directoryTab.query = v2.query;
    directoryTab.flattenDepth = 0;
    directoryTab.scrollOffset = Math.round(v2.scrollTop ?? 0);
  }
  return {
    schemaVersion: 3,
    activeWorkspace: "browser",
    activeTabId: active.id,
    tabs,
  };
}

function defaultV3(): NavigationStateV3 {
  const tab = createBrowserTab("directory", "browser://empty", translate("browser.empty"));
  return {
    schemaVersion: 3,
    activeWorkspace: "browser",
    activeTabId: tab.id,
    tabs: [tab],
  };
}

export function readNavigationStateV3(
  readV2: () => NavigationStateV2,
): NavigationStateV3 {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_V3);
    if (raw) {
      const parsed = parseNavigationStateV3(JSON.parse(raw) as Record<string, unknown>);
      if (parsed) return parsed;
    }
    // 无 V3：从 V2 自动迁移（V2 读不到时回退默认标签）。
    const v2 = readV2();
    const migrated = migrateV2ToV3(v2);
    window.localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(migrated));
    return migrated;
  } catch {
    return defaultV3();
  }
}

export async function readDurableNavigationStateV3(
  readV2: () => NavigationStateV2,
): Promise<NavigationStateV3> {
  const local = readNavigationStateV3(readV2);
  try {
    const raw = await window.refCanvas?.system?.getNavigationState?.();
    if (!raw) return local;
    const parsed = parseNavigationStateV3(
      JSON.parse(raw) as Record<string, unknown>,
    );
    return parsed ?? local;
  } catch {
    return local;
  }
}

let durableWriteV3 = Promise.resolve();

export function updateNavigationStateV3(
  next: NavigationStateV3,
): void {
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(STORAGE_KEY_V3, serialized);
    if (window.refCanvas?.system?.setNavigationState) {
      durableWriteV3 = durableWriteV3
        .then(() => window.refCanvas.system.setNavigationState(serialized))
        .catch(() => undefined);
    }
  } catch {
    // 持久化失败不得阻塞浏览。
  }
}
