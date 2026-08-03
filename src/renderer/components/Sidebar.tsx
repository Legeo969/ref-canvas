import {
  Box,
  ChevronDown,
  ChevronRight,
  CopyCheck,
  FileImage,
  FileText,
  Film,
  FolderOpen,
  Headphones,
  Heart,
  Hash,
  Layers3,
  Link2Off,
  Pencil,
  Plus,
  Shapes,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AssetKind, CollectionRecord } from "../../shared/contracts";
import {
  readNavigationState,
  updateNavigationState,
} from "../app/navigation-state";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { FolderActionsMenu } from "./FolderActionsMenu";
import { DIRECTORY_ENTRY_MIME } from "./DirectoryAssetPanel";

const kindItems: Array<{
  kind: AssetKind;
  label: string;
  icon: typeof Layers3;
}> = [
  { kind: "image", label: "图片", icon: FileImage },
  { kind: "video", label: "视频", icon: Film },
  { kind: "audio", label: "音频", icon: Headphones },
  { kind: "pdf", label: "PDF", icon: FileText },
  { kind: "model3d", label: "3D 模型", icon: Box },
  { kind: "dcc", label: "DCC 文件", icon: Shapes },
];

export function Sidebar() {
  const store = useAppStore(
    useShallow(({
      selectedAsset: _selectedAsset,
      selectedIds: _selectedIds,
      allMatchingSelected: _allMatchingSelected,
      excludedIds: _excludedIds,
      selectionAnchorId: _selectionAnchorId,
      ...state
    }) => state),
  );
  const dialog = useDialog();
  const [initialNavigation] = useState(readNavigationState);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(initialNavigation.collapsedFolderIds),
  );
  const [showAllTags, setShowAllTags] = useState(initialNavigation.showAllTags);
  const [assetKindsExpanded, setAssetKindsExpanded] = useState(
    initialNavigation.assetKindsExpanded,
  );
  const [collapsedTagGroups, setCollapsedTagGroups] = useState<Set<string>>(
    () => new Set(initialNavigation.collapsedTagGroupIds),
  );
  useEffect(() => {
    updateNavigationState({
      collapsedFolderIds: [...collapsedFolders],
    });
  }, [collapsedFolders]);
  useEffect(() => {
    updateNavigationState({
      collapsedTagGroupIds: [...collapsedTagGroups],
    });
  }, [collapsedTagGroups]);
  useEffect(() => {
    updateNavigationState({ showAllTags });
  }, [showAllTags]);
  useEffect(() => {
    updateNavigationState({ assetKindsExpanded });
  }, [assetKindsExpanded]);
  const foldersByParent = useMemo(() => {
    const result = new Map<string | null, CollectionRecord[]>();
    for (const collection of store.collections) {
      const siblings = result.get(collection.parentId) ?? [];
      siblings.push(collection);
      result.set(collection.parentId, siblings);
    }
    for (const siblings of result.values()) {
      siblings.sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.title.localeCompare(right.title, "zh-CN"),
      );
    }
    return result;
  }, [store.collections]);
  const countFor = (kind: AssetKind | "all") =>
    kind === "all" ? store.stats.total : store.stats.byKind[kind];
  const requestFolder = (parentId: string | null = null) =>
    dialog.requestForm({
      title: parentId ? "新建子文件夹" : "新建文件夹",
      description: "文件夹用于按项目、主题或用途整理素材。",
      confirmLabel: "创建",
      fields: [
        {
          name: "title",
          label: "文件夹名称",
          required: true,
          maxLength: 120,
        },
      ],
      onSubmit: ({ title }) => store.createCollection(title, parentId),
    });
  const renderFolders = (
    parentId: string | null,
    depth = 0,
  ): ReactNode[] =>
    (foldersByParent.get(parentId) ?? []).map((collection) => {
      const children = foldersByParent.get(collection.id) ?? [];
      const collapsed = collapsedFolders.has(collection.id);
      return (
        <div className="folder-tree-node" key={collection.id}>
          <div
            className={`folder-row ${
              store.collectionFilter === collection.id ? "active" : ""
            }`}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes(
                  "application/x-refcanvas-asset-ids",
                ) ||
                event.dataTransfer.types.includes(
                  "application/x-refcanvas-selection",
                ) ||
                event.dataTransfer.types.includes(
                  "application/x-refcanvas-folder",
                ) ||
                event.dataTransfer.types.includes(DIRECTORY_ENTRY_MIME)
              ) {
                event.preventDefault();
                const isFolderDrag = event.dataTransfer.types.includes(
                  "application/x-refcanvas-folder",
                );
                event.dataTransfer.dropEffect = isFolderDrag
                  ? "move"
                  : event.dataTransfer.types.includes(DIRECTORY_ENTRY_MIME)
                    ? "copy"
                    : event.altKey || !store.collectionFilter
                      ? "copy"
                      : "move";
              }
            }}
            onDrop={(event) => {
              const folderId = event.dataTransfer.getData(
                "application/x-refcanvas-folder",
              );
              if (folderId) {
                event.preventDefault();
                if (folderId !== collection.id) {
                  void store.updateCollection(folderId, {
                    parentId: collection.id,
                  });
                }
                return;
              }
              const directoryEntry = event.dataTransfer.getData(
                DIRECTORY_ENTRY_MIME,
              );
              if (directoryEntry) {
                event.preventDefault();
                if (store.collectionFilter === collection.id) return;
                try {
                  const parsed = JSON.parse(directoryEntry) as {
                    path: string;
                    isDirectory: boolean;
                  };
                  if (parsed.isDirectory) {
                    // 磁盘原生：目录拖放进入目录浏览，不镜像创建合集。
                    void store.openDirectory(parsed.path);
                  } else {
                    // 文件 → 按需入库并加入目标文件夹。
                    void store.materializeEntriesToCollection(
                      [parsed.path],
                      collection.id,
                    );
                  }
                } catch {
                  // Ignore malformed drag payloads from outside RefCanvas.
                }
                return;
              }
              const selection = event.dataTransfer.getData(
                "application/x-refcanvas-selection",
              );
              const serializedIds = event.dataTransfer.getData(
                "application/x-refcanvas-asset-ids",
              );
              if (!selection && !serializedIds) return;
              event.preventDefault();
              if (store.collectionFilter === collection.id) return;
              const removeFromCollectionId =
                !event.altKey && store.collectionFilter
                  ? store.collectionFilter
                  : undefined;
              if (selection) {
                void store.batchUpdate({
                  addCollectionId: collection.id,
                  removeCollectionId: removeFromCollectionId,
                });
                return;
              }
              try {
                const ids = JSON.parse(serializedIds) as string[];
                void store.addAssetsToCollection(
                  ids,
                  collection.id,
                  removeFromCollectionId,
                );
              } catch {
                // Ignore malformed drag payloads from outside RefCanvas.
              }
            }}
            draggable
            onDragStart={(event) => {
              if (
                (event.target as HTMLElement).closest(".folder-actions-menu")
              ) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData(
                "application/x-refcanvas-folder",
                collection.id,
              );
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            <button
              className="folder-main"
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() => store.setCollectionFilter(collection.id)}
            >
              <span
                className="folder-chevron"
                onClick={(event) => {
                  if (!children.length) return;
                  event.stopPropagation();
                  setCollapsedFolders((current) => {
                    const next = new Set(current);
                    if (next.has(collection.id)) next.delete(collection.id);
                    else next.add(collection.id);
                    return next;
                  });
                }}
              >
                {children.length ? (
                  collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />
                ) : null}
              </span>
              <FolderOpen size={15} strokeWidth={1.8} />
              <span className="folder-title" title={collection.title}>
                {collection.title}
              </span>
              <span
                className="nav-count"
                title={
                  collection.directAssetCount === collection.assetCount
                    ? `${collection.assetCount} 个素材`
                    : `直接素材 ${collection.directAssetCount}，含子文件夹共 ${collection.assetCount}`
                }
              >
                {collection.directAssetCount === collection.assetCount
                  ? collection.assetCount
                  : `${collection.directAssetCount}·${collection.assetCount}`}
              </span>
            </button>
            <FolderActionsMenu collection={collection} />
          </div>
          {!collapsed && renderFolders(collection.id, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="section-label row-label" title="当前资料库">
          <span>资料库</span>
          <button
            className="mini-icon-button"
            aria-label="打开资料库"
            onClick={async () => {
              const directory =
                await window.refCanvas.system.pickDirectory({
                  title: "选择资料库目录",
                });
              if (directory) await store.openLibrary(directory);
            }}
          >
            <FolderOpen size={14} />
          </button>
          <button
            className="mini-icon-button"
            aria-label="新建资料库"
            onClick={() => void dialog.requestForm({
              title: "新建资料库",
              description:
                "新资料库默认保留文件原位（linked）；需要复制文件进库时在资料库设置中选择“复制到资料库”。",
              confirmLabel: "创建",
              fields: [
                {
                  name: "name",
                  label: "资料库名称",
                  required: true,
                  maxLength: 120,
                },
              ],
              onSubmit: async ({ name }) => {
                const directory =
                  await window.refCanvas.system.pickDirectory({
                    title: "选择资料库保存位置",
                  });
                if (directory) {
                  await store.createLibrary({
                    name,
                    directory: `${directory}\\${name}`,
                  });
                }
              },
            })}
          >
            <Plus size={14} />
          </button>
        </div>
        {store.libraries.map((entry) => (
          <button
            className={`nav-row ${entry.isActive ? "active" : ""}`}
            key={entry.id}
            onClick={() => {
              if (!entry.isActive) void store.switchLibrary(entry.id);
            }}
          >
            <Layers3 size={16} strokeWidth={1.8} />
            <span className="library-name" title={entry.root}>
              {entry.name}
            </span>
            <span className="nav-count">{entry.assetCount}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="section-label">素材库</div>
        <div
          className={`asset-kind-root ${
            store.lifecycleFilter === "active" &&
            store.favoriteFilter !== true &&
            store.linkStateFilter === "all" &&
            store.collectionFilter === null &&
            store.kindFilter === "all"
              ? "active"
              : ""
          }`}
        >
          <button
            className="asset-kind-toggle"
            aria-label={assetKindsExpanded ? "收起素材类型" : "展开素材类型"}
            aria-expanded={assetKindsExpanded}
            onClick={() => setAssetKindsExpanded((value) => !value)}
          >
            {assetKindsExpanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
          </button>
          <button
            className="asset-kind-main"
            onClick={() => store.setKindFilter("all")}
          >
            <Layers3 size={16} strokeWidth={1.8} />
            <span>全部素材</span>
            <span className="nav-count">{countFor("all")}</span>
          </button>
        </div>
        {assetKindsExpanded && (
          <div className="asset-kind-children">
            {kindItems.map((item) => {
              const Icon = item.icon;
              const active =
                store.lifecycleFilter === "active" &&
                store.favoriteFilter !== true &&
                store.linkStateFilter === "all" &&
                store.collectionFilter === null &&
                store.kindFilter === item.kind;
              return (
                <button
                  className={`nav-row asset-kind-child ${active ? "active" : ""}`}
                  key={item.kind}
                  onClick={() => store.setKindFilter(item.kind)}
                >
                  <Icon size={16} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  <span className="nav-count">{countFor(item.kind)}</span>
                </button>
              );
            })}
            <button
              className={`nav-row asset-kind-child ${
                store.linkStateFilter === "missing" ? "active" : ""
              }`}
              onClick={store.showMissingAssets}
            >
              <Link2Off size={16} strokeWidth={1.8} />
              <span>断链素材</span>
              <span className="nav-count">{store.stats.missing}</span>
            </button>
          </div>
        )}
        <button
          className={`nav-row ${store.favoriteFilter ? "active" : ""}`}
          onClick={store.showFavorites}
        >
          <Heart size={16} strokeWidth={1.8} />
          <span>收藏</span>
          <span className="nav-count">{store.stats.favorites}</span>
        </button>
        <button
          className={`nav-row ${
            store.lifecycleFilter === "trashed" ? "active" : ""
          }`}
          onClick={store.showTrash}
        >
          <Trash2 size={16} strokeWidth={1.8} />
          <span>回收站</span>
          <span className="nav-count">{store.stats.trashed}</span>
        </button>
        <button
          className="nav-row"
          onClick={() => {
            void store.refreshDuplicates();
            window.dispatchEvent(new Event("refcanvas:duplicates"));
          }}
        >
          <CopyCheck size={16} strokeWidth={1.8} />
          <span>重复项</span>
          <span className="nav-count">{store.stats.duplicates}</span>
        </button>
      </div>

      <DirectoryBrowser />

      <div className="sidebar-section">
        <div
          className="section-label row-label"
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes(
                "application/x-refcanvas-folder",
              ) ||
              event.dataTransfer.types.includes(DIRECTORY_ENTRY_MIME)
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
                "application/x-refcanvas-folder",
              )
                ? "move"
                : "copy";
            }
          }}
          onDrop={(event) => {
            const folderId = event.dataTransfer.getData(
              "application/x-refcanvas-folder",
            );
            if (folderId) {
              event.preventDefault();
              void store.updateCollection(folderId, { parentId: null });
              return;
            }
            const directoryEntry = event.dataTransfer.getData(
              DIRECTORY_ENTRY_MIME,
            );
            if (directoryEntry) {
              event.preventDefault();
              try {
                const parsed = JSON.parse(directoryEntry) as {
                  path: string;
                  isDirectory: boolean;
                };
                if (parsed.isDirectory) {
                  // 磁盘原生：目录拖放进入目录浏览。
                  void store.openDirectory(parsed.path);
                } else {
                  // 文件 → 按需入库（不指定文件夹，仅建索引）。
                  void window.refCanvas.filesystem.materialize(parsed.path, {});
                }
              } catch {
                // Ignore malformed drag payloads from outside RefCanvas.
              }
            }
          }}
        >
          <span>文件夹</span>
          <button
            className="mini-icon-button"
            aria-label="新建文件夹"
            onClick={() => void requestFolder()}
          >
            <Plus size={14} />
          </button>
        </div>
        {store.collections.length === 0 && (
          <p className="collections-empty">还没有文件夹，点击右上角＋创建。</p>
        )}
        {renderFolders(null)}
      </div>

      <div className="sidebar-section">
        <div className="section-label row-label">
          <span>标签</span>
          <button
            className="mini-icon-button"
            aria-label="新建标签分组"
            onClick={() =>
              void dialog.requestForm({
                title: "新建标签分组",
                description: "分组只整理标签列表，不会改变标签搜索规则。",
                confirmLabel: "创建",
                fields: [
                  {
                    name: "title",
                    label: "分组名称",
                    required: true,
                    maxLength: 64,
                  },
                ],
                onSubmit: ({ title }) => store.createTagGroup(title),
              })
            }
          >
            <Plus size={14} />
          </button>
        </div>
        {store.tags.length === 0 && store.tagGroups.length === 0 && (
          <p className="collections-empty">
            素材添加标签后会显示在这里，也可以先创建标签分组。
          </p>
        )}
        {[
          { id: null, title: "未分组", tagCount: store.tags.filter((tag) => !tag.groupId).length },
          ...store.tagGroups,
        ].map((group) => {
          const groupKey = group.id ?? "ungrouped";
          const collapsed = collapsedTagGroups.has(groupKey);
          const tags = store.tags
            .slice(0, showAllTags ? undefined : 12)
            .filter((tag) => tag.groupId === group.id);
          if (!group.id && group.tagCount === 0) return null;
          return (
            <div className="tag-group" key={groupKey}>
              <div className="tag-group-header">
                <button
                  className="tag-group-main"
                  onClick={() =>
                    setCollapsedTagGroups((current) => {
                      const next = new Set(current);
                      if (next.has(groupKey)) next.delete(groupKey);
                      else next.add(groupKey);
                      return next;
                    })
                  }
                >
                  {collapsed ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                  <span>{group.title}</span>
                  <span className="nav-count">{group.tagCount}</span>
                </button>
                {group.id && (
                  <div className="tag-nav-actions">
                    <button
                      aria-label={`重命名标签分组 ${group.title}`}
                      onClick={() =>
                        void dialog.requestForm({
                          title: "重命名标签分组",
                          confirmLabel: "保存",
                          fields: [
                            {
                              name: "title",
                              label: "分组名称",
                              initialValue: group.title,
                              required: true,
                              maxLength: 64,
                            },
                          ],
                          onSubmit: ({ title }) =>
                            store.renameTagGroup(group.id!, title),
                        })
                      }
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      aria-label={
                        group.tagCount
                          ? `标签分组 ${group.title} 仍包含标签`
                          : `删除标签分组 ${group.title}`
                      }
                      disabled={group.tagCount > 0}
                      onClick={() => void store.deleteTagGroup(group.id!)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              {!collapsed && tags.map((tag) => (
            <div
              className={`tag-nav-row ${
                store.query === `#${tag.name}` ? "active" : ""
              }`}
              key={tag.id}
            >
              <button
                className="tag-nav-main"
                onClick={() =>
                  store.setTagFilter(
                    store.query === `#${tag.name}` ? null : tag.name,
                  )
                }
              >
                <Hash size={14} />
                <span>{tag.name}</span>
                <span className="nav-count">{tag.assetCount}</span>
              </button>
              <div className="tag-nav-actions">
                <select
                  aria-label={`移动标签 ${tag.name} 到分组`}
                  value={tag.groupId ?? ""}
                  onChange={(event) =>
                    void store.moveTagToGroup(
                      tag.id,
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">未分组</option>
                  {store.tagGroups.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={`重命名标签 ${tag.name}`}
                  onClick={() =>
                    void dialog.requestForm({
                      title: "重命名标签",
                      confirmLabel: "保存",
                      fields: [
                        {
                          name: "name",
                          label: "标签名称",
                          initialValue: tag.name,
                          required: true,
                          maxLength: 64,
                        },
                      ],
                      onSubmit: ({ name }) => store.renameTag(tag.id, name),
                    })
                  }
                >
                  <Pencil size={12} />
                </button>
                <button
                  aria-label={`删除标签 ${tag.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除标签“${tag.name}”？素材文件和其他元数据不受影响。`,
                      )
                    ) {
                      void store.deleteTag(tag.id);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
              ))}
            </div>
          );
        })}
        {store.tags.length > 12 && (
          <button
            className="tags-expand-button"
            onClick={() => setShowAllTags((value) => !value)}
          >
            {showAllTags ? "收起标签" : `显示全部 ${store.tags.length} 个标签`}
          </button>
        )}
      </div>

      {store.savedViews.length > 0 && (
        <div className="sidebar-section">
          <div className="section-label">Smart Folder</div>
          {store.savedViews.map((view) => (
            <div className="saved-view-row" key={view.id}>
              <button className="nav-row" onClick={() => store.applySavedView(view)}>
                <Sparkles size={16} strokeWidth={1.8} />
                <span>{view.title}</span>
              </button>
              <button
                className="mini-icon-button"
                onClick={() =>
                  void dialog.requestForm({
                    title: "重命名 Smart Folder",
                    confirmLabel: "保存",
                    fields: [
                      {
                        name: "title",
                        label: "名称",
                        initialValue: view.title,
                        required: true,
                        maxLength: 120,
                      },
                    ],
                    onSubmit: ({ title }) =>
                      store.updateSavedView(view.id, { title }),
                  })
                }
                aria-label={`重命名 ${view.title}`}
              >
                <Pencil size={12} />
              </button>
              <button
                className="mini-icon-button"
                onClick={() => void store.duplicateSavedView(view.id)}
                aria-label={`复制 ${view.title}`}
              >
                <CopyCheck size={12} />
              </button>
              <button
                className="mini-icon-button"
                onClick={() => void store.deleteSavedView(view.id)}
                aria-label={`删除 ${view.title}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-spacer" />
      <button
        className="watch-folder-button"
        onClick={() => void store.addWatchFolder()}
      >
        <FolderOpen size={16} />
        <span>添加素材文件夹</span>
      </button>
    </aside>
  );
}
