import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  DirectoryBatchAction,
  DirectoryBatchSnapshot,
  DirectoryEntry,
} from "../../../shared/contracts";
import {
  getDirectoryClipboard,
  setDirectoryClipboard,
} from "../../app/directory-clipboard";
import { runWithDirectoryWriteAccess } from "../../app/directory-write-access";
import { translate } from "../../app/i18n";
import type { AppState } from "../../app/store";
import type { useDialog } from "../../components/DialogProvider";
import { resolveDirectorySelectionScope } from "./directory-query-model";

/**
 * 选中文件集合的批量操作（自 DirectoryAssetPanel 抽出的批量接缝）：
 * 选中路径派生、键盘选中/元数据快捷键、拖出、全结果批处理（startBatch /
 * exportPaths）、批量化打标签 / 上板 / 删除 / 复制移动，以及目录剪贴板。
 * 依赖（选择状态、目录/搜索扫描快照、布局）全部由面板传入；函数每次渲染
 * 重建，闭包语义与面板内联实现一致。
 */
export interface UseDirectoryBatchActionsParams {
  dialog: ReturnType<typeof useDialog>;
  store: AppState;
  /** 当前可视文件条目（已应用格式/收藏/序列折叠过滤）。 */
  files: DirectoryEntry[];
  /** 网格索引空间条目（含文件夹；键盘选中定位用）。 */
  gridEntries: DirectoryEntry[];
  selectedPaths: ReadonlySet<string>;
  allMatchingSelected: boolean;
  excludedPaths: ReadonlySet<string>;
  selectionAnchor: string | null;
  previewPath: string | null;
  searchId: string | null;
  searchComplete: boolean;
  searchRevision: string;
  directoryScanComplete: boolean;
  directoryRevision: string;
  formatFilterExtensions: string[] | undefined;
  favoritesOnly: boolean;
  selectedCount: number;
  setBatchJob: Dispatch<SetStateAction<DirectoryBatchSnapshot | null>>;
  selectOnly(path: string): void;
  clearSelection(): void;
  showNotice(message: string): void;
  updateEntryMetadata(
    path: string,
    metadata: { favorite: boolean; rating: number },
  ): void;
  updateEntryTags(paths: string[], tags: string[]): void;
  closePreview(): void;
  viewportRef: RefObject<HTMLDivElement | null>;
  layout: {
    folderCount: number;
    folderHeaderHeight: number;
    folderColumns: number;
    folderRowHeight: number;
    fileRegionTop: number;
    columns: number;
    effectiveRowHeight: number;
  };
}

export function useDirectoryBatchActions(
  params: UseDirectoryBatchActionsParams,
) {
  const {
    dialog,
    store,
    files,
    gridEntries,
    selectedPaths,
    allMatchingSelected,
    excludedPaths,
    selectionAnchor,
    previewPath,
    searchId,
    searchComplete,
    searchRevision,
    directoryScanComplete,
    directoryRevision,
    formatFilterExtensions,
    favoritesOnly,
    selectedCount,
    setBatchJob,
    selectOnly,
    clearSelection,
    showNotice,
    updateEntryMetadata,
    updateEntryTags,
    closePreview,
    viewportRef,
  } = params;
  const {
    folderCount,
    folderHeaderHeight,
    folderColumns,
    folderRowHeight,
    fileRegionTop,
    columns,
    effectiveRowHeight,
  } = params.layout;

  // ===== 批量操作（选中文件集合） =====
  const selectedFilePaths = () =>
    files
      .map((entry) => entry.path)
      .filter((path) => selectedPaths.has(path));

  const focusedFile = () => {
    const focusedPath = previewPath ?? selectionAnchor ?? store.selectedDirectoryEntry?.path;
    return files.find((entry) => entry.path === focusedPath) ?? files[0] ?? null;
  };

  const selectFileFromKeyboard = (entry: DirectoryEntry) => {
    selectOnly(entry.path);
    store.selectDirectoryEntry(entry);

    // 用网格索引空间定位（分组头偏移感知，两区各自行高/列数），与虚拟
    // 网格渲染位置一致。
    const gridIndex = gridEntries.findIndex(
      (candidate) => candidate.path === entry.path,
    );
    const node = viewportRef.current;
    if (gridIndex < 0 || !node) return;
    const top =
      gridIndex < folderCount
        ? folderHeaderHeight +
          Math.floor(gridIndex / folderColumns) * folderRowHeight
        : fileRegionTop +
          Math.floor((gridIndex - folderCount) / columns) * effectiveRowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + effectiveRowHeight > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.max(0, top + effectiveRowHeight - node.clientHeight);
    }
  };

  const updateFocusedMetadata = async (
    action: "favorite" | "rating",
    rating?: number,
  ) => {
    const entry = focusedFile();
    if (!entry) {
      showNotice(translate("directory.noActionableAssets"));
      return;
    }
    try {
      const { asset } = await window.refCanvas.filesystem.materialize(entry.path);
      const patch =
        action === "favorite"
          ? { favorite: !asset.favorite }
          : { rating: Math.max(0, Math.min(5, rating ?? 0)) };
      const updated = await window.refCanvas.library.update(asset.id, patch);
      updateEntryMetadata(entry.path, {
        favorite: updated.favorite,
        rating: updated.rating,
      });
      showNotice(
        action === "favorite"
          ? updated.favorite
            ? translate("directory.favoritedNamed").replace("{name}", entry.name)
            : translate("directory.unfavoritedNamed").replace("{name}", entry.name)
          : updated.rating
            ? translate("directory.ratedNamed")
                .replace("{name}", entry.name)
                .replace("{rating}", String(updated.rating))
            : translate("directory.ratingClearedNamed").replace("{name}", entry.name),
      );
    } catch (error) {
      showNotice(
        translate("directory.operationFailed").replace(
          "{reason}",
          error instanceof Error ? error.message : translate("directory.failedToUpdateAsset"),
        ),
      );
    }
  };

  const dragOutEntry = (entry: DirectoryEntry) => {
    const paths = allMatchingSelected
      ? files
          .filter((item) => !excludedPaths.has(item.path))
          .map((item) => item.path)
      : selectedPaths.has(entry.path)
        ? selectedFilePaths()
        : [entry.path];
    window.refCanvas.filesystem.dragOut(paths.length ? paths : [entry.path]);
  };

  const startAllBatch = async (action: DirectoryBatchAction): Promise<boolean> => {
    if (
      !allMatchingSelected ||
      !window.refCanvas.filesystem.startBatch
    ) return false;
    const selection = resolveDirectorySelectionScope({
      allMatchingSelected,
      searchId,
      searchComplete,
      searchRevision,
      directoryPath: store.directoryPath,
      directoryScanComplete,
      directoryRevision,
      excludedPaths,
      extensions: formatFilterExtensions,
      favoritesOnly,
    });
    if (!selection) return false;
    const start = () => window.refCanvas.filesystem.startBatch(selection, action);
    const result = action.type === "trash" && store.directoryPath
      ? await runWithDirectoryWriteAccess(store.directoryPath, start)
      : { completed: true, value: await start() };
    if (!result.completed || !result.value) return true;
    const snapshot = result.value;
    setBatchJob(snapshot);
    clearSelection();
    return true;
  };

  const copySelectedPaths = async () => {
    if (allMatchingSelected) {
      const selection = resolveDirectorySelectionScope({
        allMatchingSelected,
        searchId,
        searchComplete,
        searchRevision,
        directoryPath: store.directoryPath,
        directoryScanComplete,
        directoryRevision,
        excludedPaths,
        extensions: formatFilterExtensions,
        favoritesOnly,
      });
      if (!selection) return;
      const snapshot = await window.refCanvas.filesystem.exportPaths(selection);
      if (snapshot) {
        setBatchJob(snapshot);
        clearSelection();
      }
      return;
    }
    void window.refCanvas.system.writeClipboard(
      selectedFilePaths().join("\n"),
    );
  };

  const batchTag = async () => {
    const values = await dialog.requestForm({
      title: translate("preview.setTags"),
      description: translate("directory.batchTagDescription").replace("{count}", String(selectedCount)),
      confirmLabel: translate("collections.save"),
      fields: [
        {
          name: "tags",
          label: translate("directory.tagsLabel"),
          required: true,
          maxLength: 500,
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return;
    const tags = values.tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (await startAllBatch({ type: "tag", tags })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.materializeEntriesWithTags(
      paths,
      tags,
    );
    updateEntryTags(paths, tags);
    clearSelection();
  };

  const addSelectedToBoard = async () => {
    const paths = selectedFilePaths();
    if (!paths.length) return;
    await store.addDirectoryEntriesToBoard(paths);
    clearSelection();
  };

  const batchTrash = async () => {
    const confirmed = await dialog.requestConfirm({
      title: translate("directory.deleteSelectedCount").replace("{count}", String(selectedCount)),
      description: translate("directory.trashBatchDescription"),
      confirmLabel: translate("preview.moveToTrash"),
      danger: true,
    });
    if (!confirmed) return;
    if (await startAllBatch({ type: "trash" })) return;
    const paths = selectedFilePaths();
    if (!paths.length) return;
    if (!(await store.trashEntries(paths))) return;
    closePreview();
    clearSelection();
  };

  /** 询问冲突处理策略（apply-to-all：一次选择应用于全部冲突）。 */
  const askConflictStrategy = async (): Promise<
    "skip" | "rename" | "replace" | null
  > => {
    const values = await dialog.requestForm({
      title: translate("directory.conflictTitle"),
      description: translate("directory.conflictDescription"),
      confirmLabel: translate("directory.continue"),
      fields: [
        {
          name: "strategy",
          label: translate("directory.conflictStrategy"),
          type: "select",
          initialValue: "rename",
          options: [
            { value: "rename", label: translate("directory.conflictRename") },
            { value: "replace", label: translate("directory.conflictReplace") },
            { value: "skip", label: translate("directory.conflictSkip") },
          ],
        },
      ],
      onSubmit: () => undefined,
    });
    if (!values) return null;
    return String(values.strategy) as "skip" | "rename" | "replace";
  };

  /** 批量复制/移动到目标目录（冲突策略先询问，应用到全部）。 */
  const batchCopyMove = async (kind: "copy" | "move") => {
    const paths = selectedFilePaths();
    if (!paths.length) return;
    const target = await window.refCanvas.system.pickDirectory({
      title: kind === "copy" ? translate("directory.pickCopyTarget") : translate("directory.pickMoveTarget"),
      defaultPath: store.directoryPath ?? undefined,
    });
    if (!target) return;
    const conflictAction = await askConflictStrategy();
    if (!conflictAction) return;
    const revisionOptions = {
      conflictAction,
      revision: directoryRevision || undefined,
      directoryPath: store.directoryPath ?? undefined,
    };
    const report = await (kind === "copy"
      ? window.refCanvas.filesystem.copy(paths, target, revisionOptions)
      : window.refCanvas.filesystem.move(paths, target, revisionOptions));
    await store.reloadDirectory();
    clearSelection();
    if (report.failed.length) {
      window.alert(
        (kind === "copy" ? translate("directory.copyFailedCount") : translate("directory.moveFailedCount"))
          .replace("{count}", String(report.failed.length))
          .replace("{reason}", report.failed[0].reason),
      );
    }
  };

  /** 剪切/复制到剪贴板。 */
  const clipboardSelection = (mode: "copy" | "cut") => {
    const paths = selectedFilePaths();
    if (!paths.length) return;
    setDirectoryClipboard({
      paths,
      mode,
      sourceDirectory: store.directoryPath,
    });
  };

  /** 粘贴剪贴板内容到当前目录。 */
  const pasteClipboard = async () => {
    const clipboard = getDirectoryClipboard();
    if (!clipboard || !clipboard.paths.length || !store.directoryPath) return;
    const target = store.directoryPath;
    const conflictAction = await askConflictStrategy();
    if (!conflictAction) return;
    const revisionOptions = {
      conflictAction,
      revision: directoryRevision || undefined,
      directoryPath: store.directoryPath,
    };
    const report = await (clipboard.mode === "copy"
      ? window.refCanvas.filesystem.copy(clipboard.paths, target, revisionOptions)
      : window.refCanvas.filesystem.move(clipboard.paths, target, revisionOptions));
    if (clipboard.mode === "cut") {
      setDirectoryClipboard(null);
      if (store.directoryPath === clipboard.sourceDirectory) {
        await store.reloadDirectory();
      }
    }
    await store.reloadDirectory();
    clearSelection();
    if (report.failed.length) {
      window.alert(
        translate("directory.pasteFailedCount")
          .replace("{count}", String(report.failed.length))
          .replace("{reason}", report.failed[0].reason),
      );
    }
  };

  return {
    selectedFilePaths,
    focusedFile,
    selectFileFromKeyboard,
    updateFocusedMetadata,
    dragOutEntry,
    startAllBatch,
    copySelectedPaths,
    batchTag,
    addSelectedToBoard,
    batchTrash,
    askConflictStrategy,
    batchCopyMove,
    clipboardSelection,
    pasteClipboard,
  };
}
