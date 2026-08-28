import type {
  CollectionItemState,
  ReferenceCollectionItem,
} from "../../../shared/contracts";

export type CollectionFilterState = "all" | CollectionItemState;
export type CollectionSearchScope = "current" | "all";
export type CollectionSortMode = "name" | "status" | "added";

export interface CollectionVirtualFolder {
  id: string;
  label: string;
  parentId: string | null;
  segments: string[];
  childIds: string[];
  itemIds: string[];
  fileCount: number;
  attentionCount: number;
}

export interface CollectionVirtualTree {
  rootId: string;
  folders: Map<string, CollectionVirtualFolder>;
  itemFolderIds: Map<string, string>;
}

export interface CollectionBrowserOptions {
  query?: string;
  state?: CollectionFilterState;
  scope?: CollectionSearchScope;
  folderId?: string;
  sort?: CollectionSortMode;
}

const attentionStates = new Set<CollectionItemState>([
  "offline",
  "missing",
  "ambiguous",
]);

function normalizeSegment(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function pathSegments(value: string): string[] {
  return value
    .replaceAll("/", "\\")
    .split("\\")
    .filter(Boolean);
}

function itemName(item: ReferenceCollectionItem): string {
  const value = item.lastResolvedPath || item.pathKey;
  const segments = pathSegments(value);
  return segments.at(-1) ?? value;
}

function parentSegments(item: ReferenceCollectionItem): string[] {
  const value = item.lastResolvedPath || item.pathKey;
  const segments = pathSegments(value);
  return segments.slice(0, -1);
}

function folderIdForSegments(segments: readonly string[]): string {
  return segments.map(normalizeSegment).join("/");
}

/** Build a deterministic virtual folder tree from the last known item paths. */
export function buildCollectionVirtualTree(
  items: readonly ReferenceCollectionItem[],
): CollectionVirtualTree {
  const folders = new Map<string, CollectionVirtualFolder>();
  const itemFolderIds = new Map<string, string>();
  folders.set("", {
    id: "",
    label: "集合",
    parentId: null,
    segments: [],
    childIds: [],
    itemIds: [],
    fileCount: 0,
    attentionCount: 0,
  });

  for (const item of items) {
    const segments = parentSegments(item);
    let parentId = "";
    const built: string[] = [];
    for (const segment of segments) {
      built.push(segment);
      const id = folderIdForSegments(built);
      if (!folders.has(id)) {
        folders.set(id, {
          id,
          label: segment,
          parentId,
          segments: [...built],
          childIds: [],
          itemIds: [],
          fileCount: 0,
          attentionCount: 0,
        });
        folders.get(parentId)!.childIds.push(id);
      }
      parentId = id;
    }
    const folder = folders.get(parentId)!;
    folder.itemIds.push(item.id);
    folder.fileCount += 1;
    if (attentionStates.has(item.state)) folder.attentionCount += 1;
    itemFolderIds.set(item.id, parentId);
  }

  // Roll direct counts up so a drive/source root reports the full subtree.
  const deepestFirst = [...folders.values()].sort(
    (left, right) => right.segments.length - left.segments.length,
  );
  for (const folder of deepestFirst) {
    if (!folder.parentId) continue;
    const parent = folders.get(folder.parentId);
    if (!parent) continue;
    parent.fileCount += folder.fileCount;
    parent.attentionCount += folder.attentionCount;
  }

  for (const folder of folders.values()) {
    folder.childIds.sort((left, right) =>
      folders.get(left)!.label.localeCompare(folders.get(right)!.label, "zh-CN"),
    );
    folder.itemIds.sort();
  }
  return { rootId: "", folders, itemFolderIds };
}

export function filterCollectionItems(
  items: readonly ReferenceCollectionItem[],
  tree: CollectionVirtualTree,
  options: CollectionBrowserOptions = {},
): ReferenceCollectionItem[] {
  const query = options.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
  const state = options.state ?? "all";
  const scope = options.scope ?? "current";
  const folderId = options.folderId ?? "";
  return items.filter((item) => {
    if (state !== "all" && item.state !== state) return false;
    if (scope === "current") {
      // The virtual root is the collection's landing view: keep the legacy
      // flat-materials behavior while still exposing source folders above it.
      if (folderId && (tree.itemFolderIds.get(item.id) ?? "") !== folderId) return false;
    }
    if (!query) return true;
    const haystack = `${itemName(item)} ${item.lastResolvedPath} ${item.pathKey}`.toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  });
}

const stateRank: Record<CollectionItemState, number> = {
  resolved: 0,
  offline: 1,
  missing: 2,
  ambiguous: 3,
};

export function sortCollectionItems(
  items: readonly ReferenceCollectionItem[],
  mode: CollectionSortMode = "name",
): ReferenceCollectionItem[] {
  return items.slice().sort((left, right) => {
    if (mode === "status" && left.state !== right.state) {
      return stateRank[left.state] - stateRank[right.state];
    }
    if (mode === "added" && left.createdAt !== right.createdAt) {
      return right.createdAt.localeCompare(left.createdAt);
    }
    const leftName = itemName(left);
    const rightName = itemName(right);
    const byName = leftName.localeCompare(rightName, "zh-CN");
    return byName || left.id.localeCompare(right.id);
  });
}

export function folderItems(
  tree: CollectionVirtualTree,
  folderId: string,
  itemsById: ReadonlyMap<string, ReferenceCollectionItem>,
): ReferenceCollectionItem[] {
  return (tree.folders.get(folderId)?.itemIds ?? [])
    .map((id) => itemsById.get(id))
    .filter((item): item is ReferenceCollectionItem => Boolean(item));
}

export function itemDisplayName(item: ReferenceCollectionItem): string {
  return itemName(item);
}

export function itemParentLabel(item: ReferenceCollectionItem): string {
  const segments = parentSegments(item);
  return segments.join("\\");
}

export function isAttentionState(state: CollectionItemState): boolean {
  return attentionStates.has(state);
}
