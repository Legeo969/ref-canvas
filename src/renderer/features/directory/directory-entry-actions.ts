import type {
  DirectoryEntry,
  PreviewSettings,
  RegisteredScript,
  SequenceGroupInfo,
} from "../../../shared/contracts";
import { runWithDirectoryWriteAccess } from "../../app/directory-write-access";
import { translate } from "../../app/i18n";
import type { AppState } from "../../app/store";
import type { useDialog } from "../../components/DialogProvider";
import {
  isExportableVideoExtension,
  pathNameOf,
  pathStemOf,
} from "./asset-export-formats";

/** 文件所在目录（renderer 不依赖 node:path）。 */
export function dirnameOf(filename: string): string {
  const index = filename.lastIndexOf("\\");
  const alt = filename.lastIndexOf("/");
  const cut = Math.max(index, alt);
  return cut <= 0 ? filename : filename.slice(0, cut);
}

/**
 * 单条目右键动作（自 DirectoryAssetPanel 抽出）：打标签 / Downscale /
 * 导出 MP4 / 运行脚本 / 删除 / 复制移动。均为「取依赖对象」的纯异步函数，
 * 面板每次渲染组装 deps 并包一层薄包装，行为与面板内联实现一致。
 */
export interface DirectoryEntryActionDeps {
  dialog: ReturnType<typeof useDialog>;
  store: AppState;
  previewSettings: PreviewSettings;
  /** 底部快捷提示（面板的 showShortcutNotice）。 */
  showNotice(message: string): void;
  /** 面板页缓存打标签（updateEntryTags）。 */
  updateEntryTags(paths: string[], tags: string[]): void;
  /** 帧路径 → 序列信息（面板 sequenceIndex.byPath）。 */
  sequenceByPath: Map<string, SequenceGroupInfo>;
  closePreview(): void;
  clearSelection(): void;
  closeContextMenu(): void;
  directoryScanComplete: boolean;
  directoryRevision: string;
  /** 冲突处理策略询问（批量操作 hook 提供，单条目复用）。 */
  askConflictStrategy(): Promise<"skip" | "rename" | "replace" | null>;
}

export async function tagEntryAction(
  deps: DirectoryEntryActionDeps,
  entry: DirectoryEntry,
) {
  const indexed = await window.refCanvas.library.getByPath(entry.path);
  const values = await deps.dialog.requestForm({
    title: translate("preview.setTags"),
    description: translate("directory.tagDescription"),
    confirmLabel: translate("collections.save"),
    fields: [
      {
        name: "tags",
        label: translate("directory.tagsLabel"),
        initialValue: indexed?.tags.join(", ") ?? "",
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
  const { asset } = await window.refCanvas.filesystem.materialize(entry.path);
  await deps.store.setTags(asset.id, tags);
  deps.updateEntryTags([entry.path], tags);
}

// 阶段 5 §10.4：Downscale naming（suffix/子目录/备份原文件三种模式）。
export async function downscaleEntryAction(
  deps: DirectoryEntryActionDeps,
  entry: DirectoryEntry,
) {
  if (entry.isDirectory) return;
  const { previewSettings } = deps;
  const values = await deps.dialog.requestForm({
    title: translate("directory.downscale"),
    description: `${translate("directory.downscaleMode")}${previewSettings.downscaleMode === "suffix"
      ? translate("directory.downscaleModeSuffix").replace("{suffix}", previewSettings.downscaleSuffix || "2k")
      : previewSettings.downscaleMode === "subdirectory"
        ? translate("directory.downscaleModeSubdirectory").replace("{directory}", previewSettings.downscaleSubdirectory || "downscaled")
        : translate("directory.downscaleModeBackup")}`,
    confirmLabel: translate("directory.start"),
    fields: [
      {
        name: "maxDimension",
        label: translate("directory.maxDimensionLabel"),
        required: true,
        maxLength: 6,
      },
    ],
    onSubmit: () => undefined,
  });
  if (!values) return;
  const maxDimension = Math.max(
    64,
    Math.min(16_384, Number(values.maxDimension) || 2048),
  );
  if (previewSettings.downscaleMode === "backup") {
    // §10.4：backup 模式修改原路径，执行前展示源/备份/输出。
    const backupPath = `${entry.path.slice(0, -(entry.extension.length + 1))}.bak.${entry.extension}`;
    const confirmed = await deps.dialog.requestConfirm({
      title: translate("directory.backupOverwriteTitle"),
      description: translate("directory.backupOverwriteDescription")
        .replace("{source}", entry.path)
        .replace("{backup}", backupPath)
        .replace("{output}", entry.path),
      confirmLabel: translate("directory.backupAndDownscale"),
      danger: true,
    });
    if (!confirmed) return;
  }
  await window.refCanvas.media.downscale({
    paths: [entry.path],
    maxDimension,
    mode: previewSettings.downscaleMode,
  });
  await deps.store.reloadDirectory();
}

// 右键菜单「导出 MP4」：视频走 media:exportMp4（ffmpeg 转码）；
// 图片仅在属于已检测序列（合并序列帧）时提供，走 sequences:exportMp4。
// 预设复用 PreviewSettings 的 MP4 presets，默认选中 defaultMp4PresetId。
export async function exportMp4EntryAction(
  deps: DirectoryEntryActionDeps,
  entry: DirectoryEntry,
) {
  if (entry.isDirectory) return;
  const { previewSettings } = deps;
  const sequenceGroup = deps.sequenceByPath.get(entry.path);
  const isVideo = isExportableVideoExtension(entry.extension);
  if (!isVideo && !sequenceGroup) return;
  const enabledPresets = previewSettings.mp4Presets.filter((preset) => preset.enabled);
  const presets = enabledPresets.length
    ? enabledPresets
    : previewSettings.mp4Presets.slice(0, 1);
  if (!presets.length) {
    await deps.dialog.requestConfirm({
      title: translate("directory.exportMp4Failed"),
      description: translate("directory.exportMp4NoPresets"),
      confirmLabel: translate("collections.acknowledge"),
    });
    return;
  }
  const defaultPresetId =
    presets.some((preset) => preset.id === previewSettings.defaultMp4PresetId)
      ? previewSettings.defaultMp4PresetId
      : presets[0].id;
  const frameCount = sequenceGroup?.files.length ?? 1;
  const fps = sequenceGroup?.fps ?? previewSettings.defaultSequenceFps;
  const baseName = sequenceGroup?.baseName ?? pathStemOf(entry.path);
  const defaultDirectory = sequenceGroup?.directory ?? dirnameOf(entry.path);
  const description = isVideo
    ? translate("directory.transcodeToMp4").replace("{name}", pathNameOf(entry.path))
    : translate("directory.exportSequenceToMp4")
        .replace("{name}", baseName)
        .replace("{count}", String(frameCount))
        .replace("{fps}", String(fps));
  await deps.dialog.requestForm({
    title: translate("directory.exportMp4"),
    description,
    confirmLabel: translate("directory.export"),
    fields: [
      {
        name: "preset",
        label: translate("directory.convertPreset"),
        type: "select",
        options: presets.map((preset) => ({
          value: preset.id,
          label: preset.label,
        })),
        initialValue: defaultPresetId,
      },
      {
        name: "outputDirectory",
        label: translate("directory.outputDirectory"),
        type: "directory",
        required: true,
        initialValue: defaultDirectory,
      },
    ],
    onSubmit: (values) => {
      // 后台静默导出：点击后立即关闭对话框，导出转后台执行（进度见任务
      // 中心），完成后底部提示，避免长时间占用工作界面。
      const outputDirectory = values.outputDirectory;
      const presetId = values.preset;
      void (async () => {
        try {
          if (isVideo) {
            const result = await window.refCanvas.media.exportMp4({
              inputPath: entry.path,
              outputDirectory,
              baseName,
              presetId,
            });
            deps.showNotice(translate("directory.mp4Exported").replace("{path}", pathNameOf(result.outputPath)));
          } else {
            const result = await window.refCanvas.sequences.exportMp4({
              files: sequenceGroup ? sequenceGroup.files : [entry.path],
              fps,
              presetId,
              outputDirectory,
              baseName,
            });
            deps.showNotice(translate("directory.mp4Exported").replace("{path}", pathNameOf(result.outputPath)));
          }
        } catch (error) {
          deps.showNotice(
            error instanceof Error
              ? error.message
              : translate("directory.exportMp4Failed"),
          );
        }
      })();
    },
  });
}

// 阶段 5 §10.5：运行脚本（cwd = 条目所在目录；hash 变更由主进程拒绝）。
export async function runScriptAction(
  deps: DirectoryEntryActionDeps,
  script: RegisteredScript,
  entry: DirectoryEntry,
) {
  try {
    const result = await window.refCanvas.scripts.run({
      id: script.id,
      cwd: entry.isDirectory ? entry.path : dirnameOf(entry.path),
    });
    const summary = result.timedOut
      ? translate("directory.scriptTimedOut").replace("{name}", script.name)
      : translate("directory.scriptExitCode")
          .replace("{name}", script.name)
          .replace("{code}", String(result.exitCode ?? "?"))
          .replace("{duration}", String(result.durationMs));
    await deps.dialog.requestConfirm({
      title: summary,
      description:
        result.output.trim().slice(0, 4000) || translate("directory.scriptNoOutput"),
      confirmLabel: translate("preview.close"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : translate("directory.scriptRunFailed");
    if (message === "SCRIPT_HASH_CHANGED") {
      await deps.dialog.requestConfirm({
        title: translate("directory.scriptHashChanged"),
        description: translate("directory.scriptHashChangedDescription"),
        confirmLabel: translate("collections.acknowledge"),
      });
    } else {
      await deps.dialog.requestConfirm({
        title: translate("directory.scriptRunFailedTitle"),
        description: message,
        confirmLabel: translate("preview.close"),
      });
    }
  }
}

export async function trashEntryAction(
  deps: DirectoryEntryActionDeps,
  entry: DirectoryEntry,
) {
  const confirmed = await deps.dialog.requestConfirm({
    title: translate("directory.deleteNamed").replace("{name}", entry.name),
    description: translate("directory.trashDescription"),
    confirmLabel: translate("preview.moveToTrash"),
    danger: true,
  });
  if (!confirmed) return;
  const operation = () => window.refCanvas.filesystem.trash(
    [entry.path],
    deps.directoryScanComplete && deps.directoryRevision && deps.store.directoryPath
      ? {
          revision: deps.directoryRevision,
          directoryPath: deps.store.directoryPath,
        }
      : undefined,
  );
  const result = deps.store.directoryPath
    ? await runWithDirectoryWriteAccess(deps.store.directoryPath, operation)
    : { completed: true, value: await operation() };
  if (!result.completed) return;
  await deps.store.reloadDirectory();
  deps.closePreview();
  deps.clearSelection();
}

/** 复制/移动到目标目录（冲突先询问策略，传当前目录 revision）。 */
export async function copyOrMoveEntryAction(
  deps: DirectoryEntryActionDeps,
  entry: DirectoryEntry,
  kind: "copy" | "move",
) {
  deps.closeContextMenu();
  const target = await window.refCanvas.system.pickDirectory({
    title: kind === "copy" ? translate("directory.pickCopyTarget") : translate("directory.pickMoveTarget"),
    defaultPath: deps.store.directoryPath ?? undefined,
  });
  if (!target) return;
  const conflictAction = await deps.askConflictStrategy();
  if (!conflictAction) return;
  const revisionOptions = {
    conflictAction,
    revision: deps.directoryRevision || undefined,
    directoryPath: deps.store.directoryPath ?? undefined,
  };
  const report = await (kind === "copy"
    ? window.refCanvas.filesystem.copy([entry.path], target, revisionOptions)
    : window.refCanvas.filesystem.move([entry.path], target, revisionOptions));
  await deps.store.reloadDirectory();
  const failed = report.failed[0];
  if (failed) {
    window.alert(
      (kind === "copy" ? translate("directory.copyFailed") : translate("directory.moveFailed"))
        .replace("{reason}", failed.reason),
    );
  }
}
