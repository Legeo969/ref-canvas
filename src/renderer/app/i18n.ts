/**
 * 内部 i18n runtime（FND-011）。
 *
 * - 七语言 catalog（zh-CN / zh-TW / en / ja / ko / es / fr）。
 * - `en` 为完整基 catalog（覆盖全部 MessageKey）；其余语言 spread en 并覆盖
 *   已翻译项——key 集合与英文一致，值可回退但 key 不可缺失（自动测试校验）。
 * - 缺失 key 回退英文，绝不显示 raw key；开发期 console 缺 key 报告。
 * - 语言选择存主进程 settings（AppPreferences.language），切换即时生效。
 */
import type { AppLanguage } from "../../shared/contracts";
import { useEffect, useState } from "react";

/** 应用语言 Hook：初始化时从 preferences 读取，监听切换事件即时生效。 */
export function useAppLanguage(): AppLanguage {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    let cancelled = false;
    try {
      void window.refCanvas.system
        .getPreferences()
        .then((preferences) => {
          if (!cancelled && preferences.language) {
            setLanguage(preferences.language);
            setLanguageState(preferences.language);
            document.documentElement.lang = preferences.language;
          }
        })
        .catch(() => undefined);
    } catch {
      // 测试或受限环境没有完整 preload API：保持默认。
    }
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<AppLanguage>).detail;
      if (next) {
        setLanguage(next);
        setLanguageState(next);
        document.documentElement.lang = next;
      }
    };
    window.addEventListener("refcanvas:language-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("refcanvas:language-changed", onChange);
    };
  }, []);

  return language;
}

export const APP_LANGUAGES: Array<{ code: AppLanguage; label: string }> = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
];

export type MessageKey =
  | "app.name"
  | "workspace.disk"
  | "workspace.board"
  | "titlebar.openFolder"
  | "titlebar.clipboard"
  | "titlebar.region"
  | "titlebar.settings"
  | "titlebar.ai"
  | "titlebar.tasks"
  | "sidebar.quickAccess"
  | "sidebar.drives"
  | "sidebar.collections"
  | "sidebar.boards"
  | "sidebar.recycleBin"
  | "sidebar.openRecycleBin"
  | "boards.new"
  | "boards.createConfirm"
  | "boards.nameLabel"
  | "collections.empty"
  | "collections.create"
  | "collections.addFiles"
  | "collections.newChild"
  | "collections.rename"
  | "collections.delete"
  | "collections.export"
  | "collections.resolve"
  | "collections.exporting"
  | "collections.exported"
  | "collections.openInNewTab"
  | "collections.deleteConfirm"
  | "collections.recursiveDelete"
  | "collections.state.resolved"
  | "collections.state.offline"
  | "collections.state.missing"
  | "collections.state.ambiguous"
  | "collections.itemCount"
  | "collections.emptyHint"
  | "collections.fingerprintChanged"
  | "collections.fingerprintChangedDesc"
  | "collections.exportSummary"
  | "collections.cancelExport"
  | "preview.open"
  | "preview.reveal"
  | "preview.floating"
  | "preview.close"
  | "preview.closeFloating"
  | "preview.previewNamed"
  | "preview.revealShort"
  | "preview.copyPath"
  | "preview.setTags"
  | "preview.moveToTrash"
  | "preview.previousFile"
  | "preview.nextFile"
  | "preview.sequenceMeta"
  | "sequence.pickMp4Dir"
  | "sequence.pickGifDir"
  | "sequence.exportFailed"
  | "sequence.previewNamed"
  | "sequence.framesMeta"
  | "sequence.missingSuffix"
  | "sequence.playbackMeta"
  | "sequence.closeNamed"
  | "sequence.exportingMp4"
  | "sequence.exportedMp4"
  | "sequence.exportingGif"
  | "sequence.exportedGif"
  | "sequence.revealGif"
  | "sequence.frameAlt"
  | "sequence.frameLoadFailed"
  | "sequence.pause"
  | "sequence.play"
  | "sequence.previousFrame"
  | "sequence.nextFrame"
  | "sequence.fps"
  | "sequence.timeline"
  | "sequence.exportPreset"
  | "sequence.resolutionOriginal"
  | "sequence.exportMp4Title"
  | "sequence.exporting"
  | "sequence.exportMp4"
  | "sequence.exportGifTitle"
  | "sequence.exportGif"
  | "sequence.missingFrames"
  | "sequence.missingMore"
  | "sequence.cardLabel"
  | "sequence.framesShort"
  | "video.frameAlt"
  | "video.frameError"
  | "video.exporting"
  | "video.exportedGif"
  | "hdr.generating"
  | "hdr.failed"
  | "hdr.alt"
  | "hdr.channelsGroup"
  | "hdr.layers"
  | "hdr.layersSelect"
  | "hdr.auto"
  | "hdr.composite"
  | "hdr.channels"
  | "hdr.mapping"
  | "hdr.exposure"
  | "panorama.error"
  | "panorama.viewer"
  | "panorama.flat"
  | "audio.loadingWaveform"
  | "audio.sampleCount"
  | "font.loadFailed"
  | "font.loading"
  | "font.variableAxes"
  | "text.readFailed"
  | "text.meta"
  | "text.truncated"
  | "preview.loading"
  | "preview.error"
  | "tasks.title"
  | "tasks.subtitle"
  | "tasks.empty"
  | "tasks.cancel"
  | "tasks.retry"
  | "tasks.cancelTask"
  | "tasks.retryTask"
  | "tasks.kind.import"
  | "tasks.kind.batch"
  | "tasks.kind.convert"
  | "tasks.kind.export"
  | "tasks.kind.archive"
  | "tasks.kind.ai"
  | "tasks.state.queued"
  | "tasks.state.running"
  | "tasks.state.completed"
  | "tasks.state.failed"
  | "tasks.state.cancelled"
  | "ai.title"
  | "ai.subtitle"
  | "ai.source"
  | "ai.references"
  | "ai.prompt"
  | "ai.promptPlaceholder"
  | "ai.majorChange"
  | "ai.outputCount"
  | "ai.outputDirectory"
  | "ai.provider"
  | "ai.generate"
  | "ai.generating"
  | "ai.cancel"
  | "ai.retry"
  | "ai.history"
  | "ai.noJobs"
  | "ai.error.sourceRequired"
  | "ai.error.promptRequired"
  | "ai.error.outputRequired"
  | "ai.referenceCount"
  | "ai.dropHint"
  | "ai.addReference"
  | "ai.removeSource"
  | "ai.displayColor"
  | "ai.outputBrowse"
  | "ai.state.queued"
  | "ai.state.uploading"
  | "ai.state.generating"
  | "ai.state.downloading"
  | "ai.state.completed"
  | "ai.state.failed"
  | "ai.state.cancelled"
  | "ai.input"
  | "ai.pickInput"
  | "ai.pickSource"
  | "ai.pickReference"
  | "ai.pickOutput"
  | "ai.fileFilterImages"
  | "ai.fileFilterAll"
  | "ai.referenceIndex"
  | "ai.dropEmpty"
  | "ai.unavailable"
  | "ai.refresh"
  | "ai.outputCountResult"
  | "ai.removeInput"
  | "aiSettings.title"
  | "aiSettings.comfyuiAddress"
  | "aiSettings.healthCheck"
  | "aiSettings.healthChecking"
  | "aiSettings.healthy"
  | "aiSettings.unhealthy"
  | "aiSettings.workflowFile"
  | "aiSettings.importWorkflow"
  | "aiSettings.imported"
  | "aiSettings.binding"
  | "aiSettings.bindingSource"
  | "aiSettings.bindingPrompt"
  | "aiSettings.bindingBatchSize"
  | "aiSettings.bindingReferences"
  | "aiSettings.bindingOutputs"
  | "aiSettings.bindingInvalid"
  | "aiSettings.workflowErrors"
  | "aiSettings.remoteUrl"
  | "aiSettings.remoteToken"
  | "aiSettings.remoteTokenPlaceholder"
  | "aiSettings.tokenConfigured"
  | "aiSettings.tokenUnconfigured"
  | "aiSettings.saveToken"
  | "aiSettings.clearToken"
  | "aiSettings.urlRejected"
  | "aiSettings.defaultProvider"
  | "aiSettings.enabledProviders"
  | "aiSettings.notConfigured"
  | "aiSettings.noNodes"
  | "settings.title"
  | "settings.subtitle"
  | "settings.language"
  | "settings.languageHint"
  | "settings.general"
  | "settings.restoreLayout"
  | "status.diskReady"
  | "status.boardReady"
  | "status.importing"
  | "directory.searchPlaceholder"
  | "directory.newTab"
  | "directory.empty"
  | "directory.searchEmpty"
  | "directory.searchEmptyHint"
  | "directory.favoriteNamed"
  | "directory.unfavoriteNamed"
  | "directory.favoriteDir"
  | "directory.unfavorite"
  | "directory.collapse"
  | "directory.expand"
  | "directory.collapseDrive"
  | "directory.expandDrive"
  | "directory.favoriteHint"
  | "directory.loadingDrives"
  | "directory.noDrives"
  | "directory.loading"
  | "browser.tab.new"
  | "browser.tab.close"
  | "browser.tabList"
  | "browser.closeTabNamed"
  | "browser.empty"
  | "imageReview.zoomIn"
  | "imageReview.zoomOut"
  | "imageReview.fit"
  | "imageReview.original"
  | "imageReview.rotate"
  | "imageReview.checker"
  | "imageReview.eyedrop"
  | "imageReview.palette"
  | "imageReview.layers"
  | "imageReview.layerNote"
  | "imageReview.paletteLabel"
  | "imageReview.displayColorNote"
  | "imageReview.copy"
  | "imageReview.copied"
  | "imageReview.error"
  | "imageReview.fitShort"
  | "imageReview.noLayers";

type Catalog = Record<MessageKey, string>;

/** 完整英文基 catalog：所有 key 均在此（其余语言 spread 自 en）。 */
const en: Catalog = {
  "app.name": "RefCanvas",
  "workspace.disk": "Disk",
  "workspace.board": "Boards",
  "titlebar.openFolder": "Open Folder",
  "titlebar.clipboard": "Clipboard",
  "titlebar.region": "Region",
  "titlebar.settings": "Settings",
  "titlebar.ai": "AI Design",
  "titlebar.tasks": "Tasks",
  "sidebar.quickAccess": "Quick Access",
  "sidebar.drives": "Drives",
  "sidebar.collections": "Collections",
  "sidebar.boards": "Boards",
  "sidebar.recycleBin": "Recycle Bin",
  "sidebar.openRecycleBin": "Open system recycle bin",
  "boards.new": "New Board",
  "boards.createConfirm": "Create",
  "boards.nameLabel": "Board name",
  "collections.empty": "No collections yet.",
  "collections.create": "New Collection",
  "collections.addFiles": "Add Files…",
  "collections.newChild": "New Child Collection",
  "collections.rename": "Rename",
  "collections.delete": "Delete Collection",
  "collections.export": "Export…",
  "collections.resolve": "Re-resolve",
  "collections.exporting": "Exporting…",
  "collections.exported": "Export Complete",
  "collections.openInNewTab": "Open in New Tab",
  "collections.deleteConfirm": "Delete collection? This cannot be undone.",
  "collections.recursiveDelete": "Delete the collection and all its children and items? Source files on disk are never removed.",
  "collections.state.resolved": "Resolved",
  "collections.state.offline": "Offline",
  "collections.state.missing": "Missing",
  "collections.state.ambiguous": "Ambiguous",
  "collections.itemCount": "{count} items",
  "collections.emptyHint": "Drop files or folders here, or click + beside the collection.",
  "collections.fingerprintChanged": "Fingerprint mismatch",
  "collections.fingerprintChangedDesc": "The selected file's content differs from what the collection recorded. Update the reference anyway?",
  "collections.exportSummary": "{copied} copied · {skipped} skipped · {failed} failed",
  "collections.cancelExport": "Cancel Export",
  "preview.open": "Open",
  "preview.reveal": "Show in File Explorer",
  "preview.floating": "Floating Preview",
  "preview.close": "Close",
  "preview.closeFloating": "Close floating preview",
  "preview.previewNamed": "Preview {name}",
  "preview.revealShort": "Reveal",
  "preview.copyPath": "Copy path",
  "preview.setTags": "Set tags",
  "preview.moveToTrash": "Move to Recycle Bin",
  "preview.previousFile": "Previous file",
  "preview.nextFile": "Next file",
  "preview.sequenceMeta": "Sequence {frame} · {count} frames · ",
  "sequence.pickMp4Dir": "Choose MP4 export directory",
  "sequence.pickGifDir": "Choose GIF export directory",
  "sequence.exportFailed": "Export failed",
  "sequence.previewNamed": "Sequence {name}",
  "sequence.framesMeta": "{start}-{end} · {count} frames",
  "sequence.missingSuffix": " · {count} missing",
  "sequence.playbackMeta": "{ext} · {fps} FPS",
  "sequence.closeNamed": "Close sequence preview Esc",
  "sequence.exportingMp4": "Exporting MP4…",
  "sequence.exportedMp4": "Exported {width}×{height} · {duration}s",
  "sequence.exportingGif": "Exporting GIF…",
  "sequence.exportedGif": "Exported GIF · {width}×{height} · {duration}s",
  "sequence.revealGif": "Reveal GIF file",
  "sequence.frameAlt": "{name} frame {frame}",
  "sequence.frameLoadFailed": "Failed to load sequence frame",
  "sequence.pause": "Pause",
  "sequence.play": "Play",
  "sequence.previousFrame": "Previous frame",
  "sequence.nextFrame": "Next frame",
  "sequence.fps": "Frame rate",
  "sequence.timeline": "Sequence timeline",
  "sequence.exportPreset": "Export preset",
  "sequence.resolutionOriginal": "Original",
  "sequence.exportMp4Title": "Export as MP4",
  "sequence.exporting": "Exporting…",
  "sequence.exportMp4": "Export MP4",
  "sequence.exportGifTitle": "Export as GIF",
  "sequence.exportGif": "Export GIF",
  "sequence.missingFrames": "Missing frames:",
  "sequence.missingMore": "… {count} frames total",
  "sequence.cardLabel": "Sequence",
  "sequence.framesShort": "{count} frames",
  "video.frameAlt": "Exact frame {timecode}",
  "video.frameError": "Could not extract frame",
  "video.exporting": "Exporting",
  "video.exportedGif": "GIF exported",
  "hdr.generating": "Generating HDR preview…",
  "hdr.failed": "Failed to generate HDR preview",
  "hdr.alt": "{ext} preview",
  "hdr.channelsGroup": "EXR layers and channels",
  "hdr.layers": "Layers",
  "hdr.layersSelect": "EXR layers",
  "hdr.auto": "Auto",
  "hdr.composite": "Composite",
  "hdr.channels": "EXR channels",
  "hdr.mapping": "Mapping",
  "hdr.exposure": "Exposure",
  "panorama.error": "360 WebGL preview is not supported in this environment",
  "panorama.viewer": "Panorama view",
  "panorama.flat": "Flat",
  "audio.loadingWaveform": "Loading waveform…",
  "audio.sampleCount": "{count} samples",
  "font.loadFailed": "Failed to load font",
  "font.loading": "Loading font…",
  "font.variableAxes": "Variable axes: {axes}",
  "text.readFailed": "Cannot read as text (binary or read failure)",
  "text.meta": "{lines} lines · {bytes} bytes · {encoding}",
  "text.truncated": "(truncated)",
  "preview.loading": "Loading preview…",
  "preview.error": "Preview unavailable",
  "tasks.title": "Task Center",
  "tasks.subtitle": "Unified progress for imports, batches and AI.",
  "tasks.empty": "No tasks yet.",
  "tasks.cancel": "Cancel",
  "tasks.retry": "Retry",
  "tasks.cancelTask": "Cancel task {id}",
  "tasks.retryTask": "Retry task {id}",
  "tasks.kind.import": "Import",
  "tasks.kind.batch": "Batch",
  "tasks.kind.convert": "Convert",
  "tasks.kind.export": "Export",
  "tasks.kind.archive": "Archive",
  "tasks.kind.ai": "AI",
  "tasks.state.queued": "Queued",
  "tasks.state.running": "Running",
  "tasks.state.completed": "Completed",
  "tasks.state.failed": "Failed",
  "tasks.state.cancelled": "Cancelled",
  "ai.title": "AI Design",
  "ai.subtitle": "Generate variants from a source image, references and a prompt.",
  "ai.source": "Source",
  "ai.references": "References",
  "ai.prompt": "Prompt",
  "ai.promptPlaceholder": "Describe the look you want, e.g. cinematic volumetric lighting…",
  "ai.majorChange": "Major change",
  "ai.outputCount": "Output count",
  "ai.outputDirectory": "Output directory",
  "ai.provider": "Provider",
  "ai.generate": "Generate",
  "ai.generating": "Starting…",
  "ai.cancel": "Cancel",
  "ai.retry": "Retry",
  "ai.history": "History",
  "ai.noJobs": "No jobs yet.",
  "ai.error.sourceRequired": "Choose a source image.",
  "ai.error.promptRequired": "Prompt cannot be empty.",
  "ai.error.outputRequired": "Choose an output directory.",
  "ai.referenceCount": "Up to 6 references",
  "ai.dropHint": "Drop images to replace or append; at most {max} references.",
  "ai.addReference": "Add reference",
  "ai.removeSource": "Remove source",
  "ai.displayColor": "Display color",
  "ai.outputBrowse": "Browse",
  "ai.state.queued": "Queued",
  "ai.state.uploading": "Uploading",
  "ai.state.generating": "Generating",
  "ai.state.downloading": "Downloading",
  "ai.state.completed": "Completed",
  "ai.state.failed": "Failed",
  "ai.state.cancelled": "Cancelled",
  "ai.input": "Input",
  "ai.pickInput": "Choose input image",
  "ai.pickSource": "Choose source image",
  "ai.pickReference": "Choose reference image",
  "ai.pickOutput": "Choose output directory",
  "ai.fileFilterImages": "Images",
  "ai.fileFilterAll": "All files",
  "ai.referenceIndex": "Reference {index}",
  "ai.dropEmpty": "Drop images here or pick from the right",
  "ai.unavailable": "(unavailable)",
  "ai.refresh": "Refresh task list",
  "ai.outputCountResult": "{count} outputs",
  "ai.removeInput": "Remove {label}",
  "aiSettings.title": "AI Providers",
  "aiSettings.comfyuiAddress": "Address",
  "aiSettings.healthCheck": "Check connection",
  "aiSettings.healthChecking": "Checking…",
  "aiSettings.healthy": "Available",
  "aiSettings.unhealthy": "Unavailable",
  "aiSettings.workflowFile": "Workflow file",
  "aiSettings.importWorkflow": "Import API workflow…",
  "aiSettings.imported": "Imported",
  "aiSettings.binding": "Binding",
  "aiSettings.bindingSource": "Source image input",
  "aiSettings.bindingPrompt": "Prompt input",
  "aiSettings.bindingBatchSize": "Batch size input",
  "aiSettings.bindingReferences": "Reference inputs",
  "aiSettings.bindingOutputs": "Output nodes",
  "aiSettings.bindingInvalid": "Binding is incomplete: choose node inputs for source, prompt and batch size, and at least one output node.",
  "aiSettings.workflowErrors": "Structure errors",
  "aiSettings.remoteUrl": "Job API URL",
  "aiSettings.remoteToken": "Bearer Token",
  "aiSettings.remoteTokenPlaceholder": "Enter token (encrypted with safeStorage)",
  "aiSettings.tokenConfigured": "Configured — plaintext is never stored",
  "aiSettings.tokenUnconfigured": "Not configured",
  "aiSettings.saveToken": "Save",
  "aiSettings.clearToken": "Clear",
  "aiSettings.urlRejected": "Must be an HTTPS public URL",
  "aiSettings.defaultProvider": "Default provider",
  "aiSettings.enabledProviders": "Enabled providers",
  "aiSettings.notConfigured": "Not configured",
  "aiSettings.noNodes": "Import a workflow to see bindable nodes.",
  "settings.title": "Settings",
  "settings.subtitle": "General, index and board preferences are stored locally; source files always stay on disk.",
  "settings.language": "Language",
  "settings.languageHint": "Switch instantly; missing strings fall back to English",
  "settings.general": "General",
  "settings.restoreLayout": "Restore Default Layout",
  "status.diskReady": "Disk browsing ready",
  "status.boardReady": "Boards ready",
  "status.importing": "Updating file index…",
  "directory.searchPlaceholder": "Search filenames or #tags (including subfolders)",
  "directory.newTab": "Open in New Tab",
  "directory.empty": "The folder is empty",
  "directory.searchEmpty": "No matching files",
  "directory.searchEmptyHint": "Try different keywords; subfolder results stream in.",
  "directory.favoriteNamed": "Favorite {name}",
  "directory.unfavoriteNamed": "Unfavorite {name}",
  "directory.favoriteDir": "Favorite directory",
  "directory.unfavorite": "Unfavorite",
  "directory.collapse": "Collapse",
  "directory.expand": "Expand",
  "directory.collapseDrive": "Collapse drive",
  "directory.expandDrive": "Expand drive",
  "directory.favoriteHint": "Click the star next to a directory to add it.",
  "directory.loadingDrives": "Reading drives…",
  "directory.noDrives": "No accessible drives detected.",
  "directory.loading": "Loading…",
  "browser.tab.new": "New tab",
  "browser.tab.close": "Close tab",
  "browser.tabList": "Browse tabs",
  "browser.closeTabNamed": "Close tab {title}",
  "browser.empty": "Browse",
  "imageReview.zoomIn": "Zoom in",
  "imageReview.zoomOut": "Zoom out",
  "imageReview.fit": "Fit to window",
  "imageReview.original": "100% original size",
  "imageReview.rotate": "Rotate 90°",
  "imageReview.checker": "Checkerboard transparency",
  "imageReview.eyedrop": "Eyedropper",
  "imageReview.palette": "Extract palette",
  "imageReview.layers": "Layers",
  "imageReview.layerNote": "This format supports layers but no layer parser is available; the composite preview is kept.",
  "imageReview.paletteLabel": "Palette",
  "imageReview.displayColorNote": "Display color",
  "imageReview.copy": "Copy",
  "imageReview.copied": "Copied",
  "imageReview.error": "Failed to decode the image or the format is unsupported.",
  "imageReview.fitShort": "Fit",
  "imageReview.noLayers": "No parseable layers in this format.",
};

const zhCN: Catalog = {
  ...en,
  "workspace.disk": "磁盘",
  "workspace.board": "参考板",
  "titlebar.openFolder": "打开文件夹",
  "titlebar.clipboard": "剪贴板",
  "titlebar.region": "区域",
  "titlebar.settings": "设置",
  "titlebar.ai": "AI 设计",
  "titlebar.tasks": "任务",
  "sidebar.quickAccess": "快速访问",
  "sidebar.drives": "磁盘",
  "sidebar.collections": "引用集合",
  "sidebar.boards": "参考板",
  "sidebar.recycleBin": "回收站",
  "sidebar.openRecycleBin": "打开系统回收站",
  "boards.new": "新建白板",
  "boards.createConfirm": "创建",
  "boards.nameLabel": "白板名称",
  "collections.empty": "还没有集合。",
  "collections.create": "新建集合",
  "collections.addFiles": "添加文件…",
  "collections.newChild": "新建子集合",
  "collections.rename": "重命名",
  "collections.delete": "删除集合",
  "collections.export": "导出…",
  "collections.resolve": "重新解析",
  "collections.exporting": "导出中…",
  "collections.exported": "导出完成",
  "collections.openInNewTab": "在新标签打开",
  "collections.deleteConfirm": "删除集合？此操作不可撤销。",
  "collections.recursiveDelete": "删除集合及其全部子集合与条目？磁盘上的源文件不会被删除。",
  "collections.state.resolved": "可解析",
  "collections.state.offline": "离线",
  "collections.state.missing": "缺失",
  "collections.state.ambiguous": "歧义",
  "collections.itemCount": "{count} 项",
  "collections.emptyHint": "拖入文件或文件夹，或点击集合旁的 +。",
  "collections.fingerprintChanged": "指纹不一致",
  "collections.fingerprintChangedDesc": "所选文件内容与集合中记录的不一致。仍要更新引用吗？",
  "collections.exportSummary": "已复制 {copied} · 已跳过 {skipped} · 失败 {failed}",
  "collections.cancelExport": "取消导出",
  "preview.open": "打开",
  "preview.reveal": "在资源管理器中显示",
  "preview.floating": "浮动预览",
  "preview.close": "关闭",
  "preview.closeFloating": "关闭浮动预览",
  "preview.previewNamed": "预览 {name}",
  "preview.revealShort": "定位",
  "preview.copyPath": "复制路径",
  "preview.setTags": "设置标签",
  "preview.moveToTrash": "移入回收站",
  "preview.previousFile": "上一个文件",
  "preview.nextFile": "下一个文件",
  "preview.sequenceMeta": "序列 {frame} · {count} 帧 · ",
  "sequence.pickMp4Dir": "选择 MP4 导出目录",
  "sequence.pickGifDir": "选择 GIF 导出目录",
  "sequence.exportFailed": "导出失败",
  "sequence.previewNamed": "序列 {name}",
  "sequence.framesMeta": "{start}-{end} · {count} 帧",
  "sequence.missingSuffix": " · 缺 {count}",
  "sequence.playbackMeta": "{ext} · 播放 {fps} FPS",
  "sequence.closeNamed": "关闭序列预览 Esc",
  "sequence.exportingMp4": "正在导出 MP4…",
  "sequence.exportedMp4": "已导出 {width}×{height} · {duration}s",
  "sequence.exportingGif": "正在导出 GIF…",
  "sequence.exportedGif": "已导出 GIF · {width}×{height} · {duration}s",
  "sequence.revealGif": "定位 GIF 文件",
  "sequence.frameAlt": "{name} 第 {frame} 帧",
  "sequence.frameLoadFailed": "无法加载序列帧",
  "sequence.pause": "暂停",
  "sequence.play": "播放",
  "sequence.previousFrame": "上一帧",
  "sequence.nextFrame": "下一帧",
  "sequence.fps": "帧率",
  "sequence.timeline": "序列时间轴",
  "sequence.exportPreset": "导出预设",
  "sequence.resolutionOriginal": "原始",
  "sequence.exportMp4Title": "导出为 MP4",
  "sequence.exporting": "正在导出…",
  "sequence.exportMp4": "导出 MP4",
  "sequence.exportGifTitle": "导出为 GIF",
  "sequence.exportGif": "导出 GIF",
  "sequence.missingFrames": "缺帧：",
  "sequence.missingMore": "… 共 {count} 帧",
  "sequence.cardLabel": "序列",
  "sequence.framesShort": "{count} 帧",
  "video.frameAlt": "精确帧 {timecode}",
  "video.frameError": "无法提取该帧",
  "video.exporting": "导出中",
  "video.exportedGif": "已导出 GIF",
  "hdr.generating": "正在生成 HDR 预览...",
  "hdr.failed": "无法生成 HDR 预览",
  "hdr.alt": "{ext} 预览",
  "hdr.channelsGroup": "EXR 图层与通道",
  "hdr.layers": "图层",
  "hdr.layersSelect": "EXR 图层",
  "hdr.auto": "自动",
  "hdr.composite": "合成",
  "hdr.channels": "EXR 通道",
  "hdr.mapping": "映射",
  "hdr.exposure": "曝光",
  "panorama.error": "当前环境不支持 360 WebGL 预览",
  "panorama.viewer": "全景查看",
  "panorama.flat": "平面",
  "audio.loadingWaveform": "波形加载中…",
  "audio.sampleCount": "{count} 采样点",
  "font.loadFailed": "无法加载该字体",
  "font.loading": "字体加载中…",
  "font.variableAxes": "可变轴: {axes}",
  "text.readFailed": "无法作为文本读取（二进制或读取失败）",
  "text.meta": "{lines} 行 · {bytes} 字节 · {encoding}",
  "text.truncated": "（预览截断）",
  "preview.loading": "正在加载预览…",
  "preview.error": "无法加载预览",
  "tasks.title": "任务中心",
  "tasks.subtitle": "导入、批处理与 AI 任务统一进度。",
  "tasks.empty": "暂无任务。",
  "tasks.cancel": "取消",
  "tasks.retry": "重试",
  "tasks.cancelTask": "取消任务 {id}",
  "tasks.retryTask": "重试任务 {id}",
  "tasks.kind.import": "导入",
  "tasks.kind.batch": "批处理",
  "tasks.kind.convert": "转换",
  "tasks.kind.export": "导出",
  "tasks.kind.archive": "归档",
  "tasks.kind.ai": "AI",
  "tasks.state.queued": "排队中",
  "tasks.state.running": "进行中",
  "tasks.state.completed": "已完成",
  "tasks.state.failed": "失败",
  "tasks.state.cancelled": "已取消",
  "ai.title": "AI 设计",
  "ai.subtitle": "由源图、参考图与提示词生成方案。",
  "ai.source": "源图",
  "ai.references": "参考图",
  "ai.prompt": "提示词",
  "ai.promptPlaceholder": "描述希望生成的方案，例如：cinematic volumetric lighting…",
  "ai.majorChange": "重大改动",
  "ai.outputCount": "输出数量",
  "ai.outputDirectory": "输出目录",
  "ai.provider": "Provider",
  "ai.generate": "生成方案",
  "ai.generating": "启动中…",
  "ai.cancel": "取消",
  "ai.retry": "重试",
  "ai.history": "任务历史",
  "ai.noJobs": "还没有任务。",
  "ai.error.sourceRequired": "请选择源图",
  "ai.error.promptRequired": "提示词不能为空",
  "ai.error.outputRequired": "请选择输出目录",
  "ai.referenceCount": "最多 6 张参考图",
  "ai.dropHint": "拖放图片可替换/追加；参考图最多 {max} 张",
  "ai.addReference": "添加参考图",
  "ai.removeSource": "移除源图",
  "ai.displayColor": "显示色值",
  "ai.outputBrowse": "浏览",
  "ai.state.queued": "排队中",
  "ai.state.uploading": "上传中",
  "ai.state.generating": "生成中",
  "ai.state.downloading": "下载中",
  "ai.state.completed": "已完成",
  "ai.state.failed": "失败",
  "ai.state.cancelled": "已取消",
  "ai.input": "输入",
  "ai.pickInput": "选择输入图片",
  "ai.pickSource": "选择源图",
  "ai.pickReference": "选择参考图",
  "ai.pickOutput": "选择输出目录",
  "ai.fileFilterImages": "图像",
  "ai.fileFilterAll": "所有文件",
  "ai.referenceIndex": "参考 {index}",
  "ai.dropEmpty": "拖放图片到此处，或点击右侧选择",
  "ai.unavailable": "（不可用）",
  "ai.refresh": "刷新任务列表",
  "ai.outputCountResult": "{count} 个输出",
  "ai.removeInput": "移除 {label}",
  "aiSettings.title": "AI Provider",
  "aiSettings.comfyuiAddress": "地址",
  "aiSettings.healthCheck": "检查连接",
  "aiSettings.healthChecking": "检查中…",
  "aiSettings.healthy": "可用",
  "aiSettings.unhealthy": "不可用",
  "aiSettings.workflowFile": "工作流文件",
  "aiSettings.importWorkflow": "导入 API workflow…",
  "aiSettings.imported": "已导入",
  "aiSettings.binding": "绑定",
  "aiSettings.bindingSource": "源图输入",
  "aiSettings.bindingPrompt": "提示词输入",
  "aiSettings.bindingBatchSize": "批量数输入",
  "aiSettings.bindingReferences": "参考图输入",
  "aiSettings.bindingOutputs": "输出节点",
  "aiSettings.bindingInvalid": "绑定不完整：请为源图、提示词、批量数选择节点输入，并至少选择一个输出节点。",
  "aiSettings.workflowErrors": "结构错误",
  "aiSettings.remoteUrl": "Job API 地址",
  "aiSettings.remoteToken": "Bearer Token",
  "aiSettings.remoteTokenPlaceholder": "输入 token（safeStorage 加密保存）",
  "aiSettings.tokenConfigured": "已配置——明文不会存储在本地",
  "aiSettings.tokenUnconfigured": "未配置",
  "aiSettings.saveToken": "保存",
  "aiSettings.clearToken": "清除",
  "aiSettings.urlRejected": "必须为 HTTPS 公网地址",
  "aiSettings.defaultProvider": "默认 Provider",
  "aiSettings.enabledProviders": "启用的 Provider",
  "aiSettings.notConfigured": "未配置",
  "aiSettings.noNodes": "导入 workflow 后可选择可绑定节点。",
  "settings.title": "设置",
  "settings.subtitle": "通用、索引与白板偏好保存在本机设置中，源文件始终留在磁盘。",
  "settings.language": "界面语言",
  "settings.languageHint": "七种语言即时切换，缺失文案回退英文",
  "settings.general": "通用",
  "settings.restoreLayout": "恢复默认布局",
  "status.diskReady": "磁盘浏览已就绪",
  "status.boardReady": "参考板已就绪",
  "status.importing": "正在更新文件索引…",
  "directory.searchPlaceholder": "搜索文件名或 #标签（含子目录）",
  "directory.newTab": "在新标签打开",
  "directory.empty": "目录为空",
  "directory.searchEmpty": "没有匹配的文件",
  "directory.searchEmptyHint": "尝试更换关键词；子目录结果会流式追加。",
  "directory.favoriteNamed": "收藏 {name}",
  "directory.unfavoriteNamed": "取消收藏 {name}",
  "directory.favoriteDir": "收藏目录",
  "directory.unfavorite": "取消收藏",
  "directory.collapse": "折叠",
  "directory.expand": "展开",
  "directory.collapseDrive": "折叠磁盘",
  "directory.expandDrive": "展开磁盘",
  "directory.favoriteHint": "点击目录旁的星标添加收藏。",
  "directory.loadingDrives": "正在读取磁盘…",
  "directory.noDrives": "没有检测到可访问的磁盘。",
  "directory.loading": "加载中…",
  "browser.tab.new": "新建标签",
  "browser.tab.close": "关闭标签",
  "browser.tabList": "浏览标签",
  "browser.closeTabNamed": "关闭标签 {title}",
  "browser.empty": "浏览",
  "imageReview.zoomIn": "放大",
  "imageReview.zoomOut": "缩小",
  "imageReview.fit": "适配窗口",
  "imageReview.original": "100% 原始大小",
  "imageReview.rotate": "旋转 90°",
  "imageReview.checker": "棋盘透明背景",
  "imageReview.eyedrop": "像素取色",
  "imageReview.palette": "提取主色板",
  "imageReview.layers": "图层",
  "imageReview.layerNote": "该格式支持分层，但当前无图层解析 Provider，保留合成图预览。",
  "imageReview.paletteLabel": "主色",
  "imageReview.displayColorNote": "显示色值",
  "imageReview.copy": "复制",
  "imageReview.copied": "已复制",
  "imageReview.error": "图片解码失败或格式不受支持。",
  "imageReview.fitShort": "适配",
  "imageReview.noLayers": "当前格式无可解析图层。",
};

const zhTW: Catalog = {
  ...en,
  "workspace.disk": "磁碟",
  "workspace.board": "參考板",
  "titlebar.openFolder": "開啟資料夾",
  "titlebar.clipboard": "剪貼簿",
  "titlebar.region": "區域",
  "titlebar.settings": "設定",
  "titlebar.ai": "AI 設計",
  "titlebar.tasks": "任務",
  "sidebar.quickAccess": "快速存取",
  "sidebar.drives": "磁碟",
  "sidebar.collections": "引用集合",
  "sidebar.boards": "參考板",
  "sidebar.recycleBin": "資源回收筒",
  "collections.create": "新建集合",
  "collections.addFiles": "新增檔案…",
  "collections.newChild": "新增子集合",
  "collections.rename": "重新命名",
  "collections.delete": "刪除集合",
  "collections.export": "匯出…",
  "collections.resolve": "重新解析",
  "collections.exporting": "匯出中…",
  "collections.exported": "匯出完成",
  "collections.openInNewTab": "在新分頁開啟",
  "collections.state.resolved": "可解析",
  "collections.state.offline": "離線",
  "collections.state.missing": "遺失",
  "collections.state.ambiguous": "歧義",
  "preview.open": "開啟",
  "preview.reveal": "在檔案總管中顯示",
  "preview.floating": "浮動預覽",
  "preview.close": "關閉",
  "tasks.title": "任務中心",
  "tasks.subtitle": "匯入、批次處理與 AI 任務的統一進度。",
  "tasks.empty": "目前沒有任務。",
  "tasks.cancel": "取消",
  "tasks.retry": "重試",
  "tasks.cancelTask": "取消任務 {id}",
  "tasks.retryTask": "重試任務 {id}",
  "tasks.kind.import": "匯入",
  "tasks.kind.batch": "批次處理",
  "tasks.kind.convert": "轉換",
  "tasks.kind.export": "匯出",
  "tasks.kind.archive": "封存",
  "tasks.kind.ai": "AI",
  "tasks.state.queued": "排隊中",
  "tasks.state.running": "進行中",
  "tasks.state.completed": "已完成",
  "tasks.state.failed": "失敗",
  "tasks.state.cancelled": "已取消",
  "ai.title": "AI 設計",
  "ai.subtitle": "從來源圖、參考圖與提示詞產生方案。",
  "ai.source": "來源圖",
  "ai.references": "參考圖",
  "ai.prompt": "提示詞",
  "ai.promptPlaceholder": "描述想要的方案，例如：cinematic volumetric lighting…",
  "ai.majorChange": "重大變更",
  "ai.outputCount": "輸出數量",
  "ai.outputDirectory": "輸出目錄",
  "ai.provider": "Provider",
  "ai.generate": "產生方案",
  "ai.generating": "啟動中…",
  "ai.cancel": "取消",
  "ai.retry": "重試",
  "ai.history": "任務記錄",
  "ai.noJobs": "尚無任務。",
  "ai.error.sourceRequired": "請選擇來源圖",
  "ai.error.promptRequired": "提示詞不能為空",
  "ai.error.outputRequired": "請選擇輸出目錄",
  "ai.referenceCount": "最多 6 張參考圖",
  "ai.dropHint": "拖放圖片可替換/追加；參考圖最多 {max} 張",
  "ai.addReference": "新增參考圖",
  "ai.removeSource": "移除來源圖",
  "ai.displayColor": "顯示色值",
  "ai.outputBrowse": "瀏覽",
  "ai.state.queued": "排隊中",
  "ai.state.uploading": "上傳中",
  "ai.state.generating": "產生中",
  "ai.state.downloading": "下載中",
  "ai.state.completed": "已完成",
  "ai.state.failed": "失敗",
  "ai.state.cancelled": "已取消",
  "ai.input": "輸入",
  "ai.pickInput": "選擇輸入圖片",
  "ai.pickSource": "選擇來源圖",
  "ai.pickReference": "選擇參考圖",
  "ai.pickOutput": "選擇輸出目錄",
  "ai.fileFilterImages": "圖像",
  "ai.fileFilterAll": "所有檔案",
  "ai.referenceIndex": "參考 {index}",
  "ai.dropEmpty": "拖放圖片到此處，或點擊右側選擇",
  "ai.unavailable": "（不可用）",
  "ai.refresh": "重新整理任務清單",
  "ai.outputCountResult": "{count} 個輸出",
  "ai.removeInput": "移除 {label}",
  "settings.title": "設定",
  "settings.subtitle": "通用、索引與白板偏好儲存在本機設定中，來源檔案始終留在磁碟。",
  "settings.language": "介面語言",
  "settings.languageHint": "七種語言即時切換，缺失文案回退英文",
  "settings.general": "通用",
  "settings.restoreLayout": "恢復預設版面",
  "status.diskReady": "磁碟瀏覽已就緒",
  "status.boardReady": "參考板已就緒",
  "status.importing": "正在更新檔案索引…",
  "directory.searchPlaceholder": "搜尋檔名或 #標籤（含子資料夾）",
  "directory.newTab": "在新分頁開啟",
  "directory.empty": "資料夾為空",
  "directory.searchEmpty": "沒有相符的檔案",
  "directory.searchEmptyHint": "嘗試其他關鍵字；子資料夾結果會串流新增。",
  "browser.tab.new": "新增分頁",
  "browser.tab.close": "關閉分頁",
  "browser.empty": "瀏覽",
  "imageReview.zoomIn": "放大",
  "imageReview.zoomOut": "縮小",
  "imageReview.fit": "適配視窗",
  "imageReview.original": "100% 原始大小",
  "imageReview.rotate": "旋轉 90°",
  "imageReview.checker": "棋盤透明背景",
  "imageReview.eyedrop": "像素取色",
  "imageReview.palette": "提取主色板",
  "imageReview.layers": "圖層",
  "imageReview.layerNote": "該格式支援分層，但目前沒有圖層解析 Provider，保留合成圖預覽。",
  "imageReview.paletteLabel": "主色",
  "imageReview.displayColorNote": "顯示色值",
  "imageReview.copy": "複製",
  "imageReview.copied": "已複製",
  "imageReview.error": "圖片解碼失敗或格式不受支援。",
  "imageReview.fitShort": "適配",
  "imageReview.noLayers": "目前格式無可解析圖層。",
};

const ja: Catalog = {
  ...en,
  "workspace.disk": "ディスク",
  "workspace.board": "ボード",
  "titlebar.openFolder": "フォルダーを開く",
  "titlebar.clipboard": "クリップボード",
  "titlebar.region": "領域",
  "titlebar.settings": "設定",
  "titlebar.ai": "AI デザイン",
  "titlebar.tasks": "タスク",
  "sidebar.quickAccess": "クイックアクセス",
  "sidebar.drives": "ドライブ",
  "sidebar.collections": "コレクション",
  "sidebar.boards": "ボード",
  "sidebar.recycleBin": "ゴミ箱",
  "collections.create": "新規コレクション",
  "collections.addFiles": "ファイルを追加…",
  "collections.newChild": "子コレクションを作成",
  "collections.rename": "名前を変更",
  "collections.delete": "コレクションを削除",
  "collections.export": "書き出し…",
  "collections.resolve": "再解決",
  "collections.exporting": "書き出し中…",
  "collections.exported": "書き出し完了",
  "collections.openInNewTab": "新しいタブで開く",
  "collections.state.resolved": "解決済み",
  "collections.state.offline": "オフライン",
  "collections.state.missing": "欠落",
  "collections.state.ambiguous": "あいまい",
  "preview.open": "開く",
  "preview.reveal": "エクスプローラーで表示",
  "preview.floating": "フローティングプレビュー",
  "preview.close": "閉じる",
  "tasks.title": "タスクセンター",
  "tasks.subtitle": "インポート・バッチ・AI タスクの統合進捗。",
  "tasks.empty": "タスクはまだありません。",
  "tasks.cancel": "キャンセル",
  "tasks.retry": "再試行",
  "tasks.cancelTask": "タスク {id} をキャンセル",
  "tasks.retryTask": "タスク {id} を再試行",
  "tasks.kind.import": "インポート",
  "tasks.kind.batch": "バッチ",
  "tasks.kind.convert": "変換",
  "tasks.kind.export": "書き出し",
  "tasks.kind.archive": "アーカイブ",
  "tasks.kind.ai": "AI",
  "tasks.state.queued": "待機中",
  "tasks.state.running": "実行中",
  "tasks.state.completed": "完了",
  "tasks.state.failed": "失敗",
  "tasks.state.cancelled": "キャンセル済み",
  "ai.title": "AI デザイン",
  "ai.subtitle": "ソース画像・参照画像・プロンプトから案を生成します。",
  "ai.source": "ソース画像",
  "ai.references": "参照画像",
  "ai.prompt": "プロンプト",
  "ai.promptPlaceholder": "希望する見た目を記述、例：cinematic volumetric lighting…",
  "ai.majorChange": "大幅な変更",
  "ai.outputCount": "出力数",
  "ai.outputDirectory": "出力先フォルダ",
  "ai.provider": "プロバイダー",
  "ai.generate": "生成",
  "ai.generating": "起動中…",
  "ai.cancel": "キャンセル",
  "ai.retry": "再試行",
  "ai.history": "履歴",
  "ai.noJobs": "ジョブはまだありません。",
  "ai.error.sourceRequired": "ソース画像を選択してください",
  "ai.error.promptRequired": "プロンプトは空にできません",
  "ai.error.outputRequired": "出力先フォルダを選択してください",
  "ai.referenceCount": "参照画像は最大 6 枚",
  "ai.dropHint": "画像をドロップすると置換/追加されます。参照は最大 {max} 枚",
  "ai.addReference": "参照を追加",
  "ai.removeSource": "ソースを削除",
  "ai.displayColor": "表示色",
  "ai.outputBrowse": "参照",
  "ai.state.queued": "待機中",
  "ai.state.uploading": "アップロード中",
  "ai.state.generating": "生成中",
  "ai.state.downloading": "ダウンロード中",
  "ai.state.completed": "完了",
  "ai.state.failed": "失敗",
  "ai.state.cancelled": "キャンセル済み",
  "ai.input": "入力",
  "ai.pickInput": "入力画像を選択",
  "ai.pickSource": "ソース画像を選択",
  "ai.pickReference": "参照画像を選択",
  "ai.pickOutput": "出力先フォルダーを選択",
  "ai.fileFilterImages": "画像",
  "ai.fileFilterAll": "すべてのファイル",
  "ai.referenceIndex": "参照 {index}",
  "ai.dropEmpty": "ここに画像をドロップ、または右側から選択",
  "ai.unavailable": "（利用不可）",
  "ai.refresh": "タスク一覧を更新",
  "ai.outputCountResult": "{count} 件の出力",
  "ai.removeInput": "{label} を削除",
  "settings.title": "設定",
  "settings.subtitle": "一般・インデックス・ボード設定はローカルに保存され、ソースファイルは常にディスクに残ります。",
  "settings.language": "言語",
  "settings.languageHint": "即時切替、欠落文言は英語にフォールバック",
  "settings.general": "一般",
  "settings.restoreLayout": "既定レイアウトに戻す",
  "status.diskReady": "ディスク閲覧準備完了",
  "status.boardReady": "ボード準備完了",
  "status.importing": "ファイルインデックスを更新中…",
  "directory.searchPlaceholder": "ファイル名または #タグを検索（サブフォルダー含む）",
  "directory.newTab": "新しいタブで開く",
  "directory.empty": "フォルダーは空です",
  "directory.searchEmpty": "一致するファイルがありません",
  "directory.searchEmptyHint": "別のキーワードをお試しください。サブフォルダーの結果がストリームで追加されます。",
  "browser.tab.new": "新しいタブ",
  "browser.tab.close": "タブを閉じる",
  "browser.empty": "閲覧",
  "imageReview.zoomIn": "拡大",
  "imageReview.zoomOut": "縮小",
  "imageReview.fit": "ウィンドウに合わせる",
  "imageReview.original": "100% 元のサイズ",
  "imageReview.rotate": "90° 回転",
  "imageReview.checker": "透明チェッカー背景",
  "imageReview.eyedrop": "スポイト",
  "imageReview.palette": "パレット抽出",
  "imageReview.layers": "レイヤー",
  "imageReview.layerNote": "この形式はレイヤーに対応していますがパーサーがなく、合成プレビューを維持します。",
  "imageReview.paletteLabel": "パレット",
  "imageReview.displayColorNote": "表示色",
  "imageReview.copy": "コピー",
  "imageReview.copied": "コピー済み",
  "imageReview.error": "画像のデコードに失敗したか、フォーマットがサポートされていません。",
  "imageReview.fitShort": "フィット",
  "imageReview.noLayers": "この形式には解析可能なレイヤーがありません。",
};

const ko: Catalog = {
  ...en,
  "workspace.disk": "디스크",
  "workspace.board": "보드",
  "titlebar.openFolder": "폴더 열기",
  "titlebar.clipboard": "클립보드",
  "titlebar.region": "영역",
  "titlebar.settings": "설정",
  "titlebar.ai": "AI 디자인",
  "titlebar.tasks": "작업",
  "sidebar.quickAccess": "빠른 액세스",
  "sidebar.drives": "드라이브",
  "sidebar.collections": "컬렉션",
  "sidebar.boards": "보드",
  "sidebar.recycleBin": "휴지통",
  "collections.create": "새 컬렉션",
  "collections.addFiles": "파일 추가…",
  "collections.newChild": "하위 컬렉션 만들기",
  "collections.rename": "이름 바꾸기",
  "collections.delete": "컬렉션 삭제",
  "collections.export": "내보내기…",
  "collections.resolve": "다시 해석",
  "collections.exporting": "내보내는 중…",
  "collections.exported": "내보내기 완료",
  "collections.openInNewTab": "새 탭에서 열기",
  "collections.state.resolved": "해결됨",
  "collections.state.offline": "오프라인",
  "collections.state.missing": "누락",
  "collections.state.ambiguous": "모호함",
  "preview.open": "열기",
  "preview.reveal": "파일 탐색기에 표시",
  "preview.floating": "플로팅 미리보기",
  "preview.close": "닫기",
  "tasks.title": "작업 센터",
  "tasks.subtitle": "가져오기·배치·AI 작업의 통합 진행률.",
  "tasks.empty": "아직 작업이 없습니다.",
  "tasks.cancel": "취소",
  "tasks.retry": "재시도",
  "tasks.cancelTask": "작업 {id} 취소",
  "tasks.retryTask": "작업 {id} 재시도",
  "tasks.kind.import": "가져오기",
  "tasks.kind.batch": "배치",
  "tasks.kind.convert": "변환",
  "tasks.kind.export": "내보내기",
  "tasks.kind.archive": "보관",
  "tasks.kind.ai": "AI",
  "tasks.state.queued": "대기 중",
  "tasks.state.running": "진행 중",
  "tasks.state.completed": "완료",
  "tasks.state.failed": "실패",
  "tasks.state.cancelled": "취소됨",
  "ai.title": "AI 디자인",
  "ai.subtitle": "소스 이미지·참조 이미지·프롬프트로 안을 생성합니다.",
  "ai.source": "소스 이미지",
  "ai.references": "참조 이미지",
  "ai.prompt": "프롬프트",
  "ai.promptPlaceholder": "원하는 구성을 설명하세요, 예: cinematic volumetric lighting…",
  "ai.majorChange": "대폭 변경",
  "ai.outputCount": "출력 수",
  "ai.outputDirectory": "출력 폴더",
  "ai.provider": "공급자",
  "ai.generate": "생성",
  "ai.generating": "시작 중…",
  "ai.cancel": "취소",
  "ai.retry": "재시도",
  "ai.history": "기록",
  "ai.noJobs": "아직 작업이 없습니다.",
  "ai.error.sourceRequired": "소스 이미지를 선택하세요",
  "ai.error.promptRequired": "프롬프트는 비울 수 없습니다",
  "ai.error.outputRequired": "출력 폴더를 선택하세요",
  "ai.referenceCount": "참조 이미지는 최대 6장",
  "ai.dropHint": "이미지를 끌어 놓아 교체/추가. 참조는 최대 {max}장",
  "ai.addReference": "참조 추가",
  "ai.removeSource": "소스 제거",
  "ai.displayColor": "표시 색상",
  "ai.outputBrowse": "찾아보기",
  "ai.state.queued": "대기 중",
  "ai.state.uploading": "업로드 중",
  "ai.state.generating": "생성 중",
  "ai.state.downloading": "다운로드 중",
  "ai.state.completed": "완료",
  "ai.state.failed": "실패",
  "ai.state.cancelled": "취소됨",
  "ai.input": "입력",
  "ai.pickInput": "입력 이미지 선택",
  "ai.pickSource": "소스 이미지 선택",
  "ai.pickReference": "참조 이미지 선택",
  "ai.pickOutput": "출력 폴더 선택",
  "ai.fileFilterImages": "이미지",
  "ai.fileFilterAll": "모든 파일",
  "ai.referenceIndex": "참조 {index}",
  "ai.dropEmpty": "여기에 이미지를 끌어 놓거나 오른쪽에서 선택",
  "ai.unavailable": "(사용 불가)",
  "ai.refresh": "작업 목록 새로고침",
  "ai.outputCountResult": "출력 {count}개",
  "ai.removeInput": "{label} 제거",
  "settings.title": "설정",
  "settings.subtitle": "일반·인덱스·보드 설정은 로컬에 저장되며 원본 파일은 항상 디스크에 남습니다.",
  "settings.language": "언어",
  "settings.languageHint": "즉시 전환, 누락된 문구는 영어로 폴백",
  "settings.general": "일반",
  "settings.restoreLayout": "기본 레이아웃 복원",
  "status.diskReady": "디스크 탐색 준비 완료",
  "status.boardReady": "보드 준비 완료",
  "status.importing": "파일 색인 업데이트 중…",
  "directory.searchPlaceholder": "파일명 또는 #태그 검색(하위 폴더 포함)",
  "directory.newTab": "새 탭에서 열기",
  "directory.empty": "폴더가 비어 있습니다",
  "directory.searchEmpty": "일치하는 파일이 없습니다",
  "directory.searchEmptyHint": "다른 키워드를 시도하세요. 하위 폴더 결과가 스트리밍됩니다.",
  "browser.tab.new": "새 탭",
  "browser.tab.close": "탭 닫기",
  "browser.empty": "탐색",
  "imageReview.zoomIn": "확대",
  "imageReview.zoomOut": "축소",
  "imageReview.fit": "창에 맞춤",
  "imageReview.original": "100% 원본 크기",
  "imageReview.rotate": "90° 회전",
  "imageReview.checker": "투명 체커 배경",
  "imageReview.eyedrop": "스포이드",
  "imageReview.palette": "팔레트 추출",
  "imageReview.layers": "레이어",
  "imageReview.layerNote": "이 형식은 레이어를 지원하지만 파서가 없어 합성 미리보기를 유지합니다.",
  "imageReview.paletteLabel": "팔레트",
  "imageReview.displayColorNote": "표시 색상",
  "imageReview.copy": "복사",
  "imageReview.copied": "복사됨",
  "imageReview.error": "이미지 디코딩에 실패했거나 형식이 지원되지 않습니다.",
  "imageReview.fitShort": "맞춤",
  "imageReview.noLayers": "이 형식에는 분석 가능한 레이어가 없습니다.",
};

const es: Catalog = {
  ...en,
  "workspace.disk": "Disco",
  "workspace.board": "Paneles",
  "titlebar.openFolder": "Abrir carpeta",
  "titlebar.clipboard": "Portapapeles",
  "titlebar.region": "Región",
  "titlebar.settings": "Ajustes",
  "titlebar.ai": "Diseño IA",
  "titlebar.tasks": "Tareas",
  "sidebar.quickAccess": "Acceso rápido",
  "sidebar.drives": "Unidades",
  "sidebar.collections": "Colecciones",
  "sidebar.boards": "Paneles",
  "sidebar.recycleBin": "Papelera",
  "collections.create": "Nueva colección",
  "collections.addFiles": "Añadir archivos…",
  "collections.newChild": "Nueva subcolección",
  "collections.rename": "Renombrar",
  "collections.delete": "Eliminar colección",
  "collections.export": "Exportar…",
  "collections.resolve": "Resolver de nuevo",
  "collections.exporting": "Exportando…",
  "collections.exported": "Exportación completa",
  "collections.openInNewTab": "Abrir en pestaña nueva",
  "collections.state.resolved": "Resuelto",
  "collections.state.offline": "Sin conexión",
  "collections.state.missing": "Faltante",
  "collections.state.ambiguous": "Ambiguo",
  "preview.open": "Abrir",
  "preview.reveal": "Mostrar en el explorador",
  "preview.floating": "Vista flotante",
  "preview.close": "Cerrar",
  "tasks.title": "Centro de tareas",
  "tasks.subtitle": "Progreso unificado de importaciones, lotes e IA.",
  "tasks.empty": "Aún no hay tareas.",
  "tasks.cancel": "Cancelar",
  "tasks.retry": "Reintentar",
  "tasks.cancelTask": "Cancelar tarea {id}",
  "tasks.retryTask": "Reintentar tarea {id}",
  "tasks.kind.import": "Importar",
  "tasks.kind.batch": "Lote",
  "tasks.kind.convert": "Convertir",
  "tasks.kind.export": "Exportar",
  "tasks.kind.archive": "Archivo",
  "tasks.kind.ai": "IA",
  "tasks.state.queued": "En cola",
  "tasks.state.running": "En curso",
  "tasks.state.completed": "Completado",
  "tasks.state.failed": "Fallido",
  "tasks.state.cancelled": "Cancelado",
  "ai.title": "Diseño IA",
  "ai.subtitle": "Genera variantes desde una imagen de origen, referencias y una indicación.",
  "ai.source": "Imagen de origen",
  "ai.references": "Imágenes de referencia",
  "ai.prompt": "Indicación",
  "ai.promptPlaceholder": "Describe el aspecto deseado, p. ej. cinematic volumetric lighting…",
  "ai.majorChange": "Cambio importante",
  "ai.outputCount": "Número de salidas",
  "ai.outputDirectory": "Carpeta de salida",
  "ai.provider": "Proveedor",
  "ai.generate": "Generar",
  "ai.generating": "Iniciando…",
  "ai.cancel": "Cancelar",
  "ai.retry": "Reintentar",
  "ai.history": "Historial",
  "ai.noJobs": "Aún no hay trabajos.",
  "ai.error.sourceRequired": "Elige una imagen de origen.",
  "ai.error.promptRequired": "La indicación no puede estar vacía.",
  "ai.error.outputRequired": "Elige una carpeta de salida.",
  "ai.referenceCount": "Hasta 6 referencias",
  "ai.dropHint": "Arrastra imágenes para reemplazar o añadir; máx. {max} referencias.",
  "ai.addReference": "Añadir referencia",
  "ai.removeSource": "Quitar origen",
  "ai.displayColor": "Color mostrado",
  "ai.outputBrowse": "Examinar",
  "ai.state.queued": "En cola",
  "ai.state.uploading": "Subiendo",
  "ai.state.generating": "Generando",
  "ai.state.downloading": "Descargando",
  "ai.state.completed": "Completado",
  "ai.state.failed": "Fallido",
  "ai.state.cancelled": "Cancelado",
  "ai.input": "Entrada",
  "ai.pickInput": "Elegir imagen de entrada",
  "ai.pickSource": "Elegir imagen de origen",
  "ai.pickReference": "Elegir imagen de referencia",
  "ai.pickOutput": "Elegir carpeta de salida",
  "ai.fileFilterImages": "Imágenes",
  "ai.fileFilterAll": "Todos los archivos",
  "ai.referenceIndex": "Referencia {index}",
  "ai.dropEmpty": "Arrastra imágenes aquí o elige a la derecha",
  "ai.unavailable": "(no disponible)",
  "ai.refresh": "Actualizar lista de tareas",
  "ai.outputCountResult": "{count} salidas",
  "ai.removeInput": "Quitar {label}",
  "settings.title": "Ajustes",
  "settings.subtitle": "Las preferencias generales, de índice y de paneles se guardan localmente; los archivos fuente permanecen en disco.",
  "settings.language": "Idioma",
  "settings.languageHint": "Cambio instantáneo; los textos ausentes vuelven al inglés",
  "settings.general": "General",
  "settings.restoreLayout": "Restaurar diseño predeterminado",
  "status.diskReady": "Exploración de disco lista",
  "status.boardReady": "Paneles listos",
  "status.importing": "Actualizando el índice…",
  "directory.searchPlaceholder": "Buscar nombres o #etiquetas (incluye subcarpetas)",
  "directory.newTab": "Abrir en pestaña nueva",
  "directory.empty": "La carpeta está vacía",
  "directory.searchEmpty": "Sin archivos coincidentes",
  "directory.searchEmptyHint": "Prueba otras palabras clave; los resultados de subcarpetas llegan en streaming.",
  "browser.tab.new": "Pestaña nueva",
  "browser.tab.close": "Cerrar pestaña",
  "browser.empty": "Explorar",
  "imageReview.zoomIn": "Acercar",
  "imageReview.zoomOut": "Alejar",
  "imageReview.fit": "Ajustar a la ventana",
  "imageReview.original": "100% tamaño original",
  "imageReview.rotate": "Rotar 90°",
  "imageReview.checker": "Fondo ajedrez transparente",
  "imageReview.eyedrop": "Cuentagotas",
  "imageReview.palette": "Extraer paleta",
  "imageReview.layers": "Capas",
  "imageReview.layerNote": "Este formato admite capas pero no hay analizador; se mantiene la vista compuesta.",
  "imageReview.paletteLabel": "Paleta",
  "imageReview.displayColorNote": "Color mostrado",
  "imageReview.copy": "Copiar",
  "imageReview.copied": "Copiado",
  "imageReview.error": "No se pudo decodificar la imagen o el formato no es compatible.",
  "imageReview.fitShort": "Ajustar",
  "imageReview.noLayers": "No hay capas analizables en este formato.",
};

const fr: Catalog = {
  ...en,
  "workspace.disk": "Disque",
  "workspace.board": "Tableaux",
  "titlebar.openFolder": "Ouvrir un dossier",
  "titlebar.clipboard": "Presse-papiers",
  "titlebar.region": "Région",
  "titlebar.settings": "Paramètres",
  "titlebar.ai": "Conception IA",
  "titlebar.tasks": "Tâches",
  "sidebar.quickAccess": "Accès rapide",
  "sidebar.drives": "Lecteurs",
  "sidebar.collections": "Collections",
  "sidebar.boards": "Tableaux",
  "sidebar.recycleBin": "Corbeille",
  "collections.create": "Nouvelle collection",
  "collections.addFiles": "Ajouter des fichiers…",
  "collections.newChild": "Nouvelle sous-collection",
  "collections.rename": "Renommer",
  "collections.delete": "Supprimer la collection",
  "collections.export": "Exporter…",
  "collections.resolve": "Re-résoudre",
  "collections.exporting": "Exportation…",
  "collections.exported": "Exportation terminée",
  "collections.openInNewTab": "Ouvrir dans un nouvel onglet",
  "collections.state.resolved": "Résolu",
  "collections.state.offline": "Hors ligne",
  "collections.state.missing": "Manquant",
  "collections.state.ambiguous": "Ambigu",
  "preview.open": "Ouvrir",
  "preview.reveal": "Afficher dans l'explorateur",
  "preview.floating": "Aperçu flottant",
  "preview.close": "Fermer",
  "tasks.title": "Centre de tâches",
  "tasks.subtitle": "Progression unifiée des imports, lots et IA.",
  "tasks.empty": "Aucune tâche pour le moment.",
  "tasks.cancel": "Annuler",
  "tasks.retry": "Réessayer",
  "tasks.cancelTask": "Annuler la tâche {id}",
  "tasks.retryTask": "Réessayer la tâche {id}",
  "tasks.kind.import": "Import",
  "tasks.kind.batch": "Lot",
  "tasks.kind.convert": "Conversion",
  "tasks.kind.export": "Export",
  "tasks.kind.archive": "Archive",
  "tasks.kind.ai": "IA",
  "tasks.state.queued": "En attente",
  "tasks.state.running": "En cours",
  "tasks.state.completed": "Terminé",
  "tasks.state.failed": "Échec",
  "tasks.state.cancelled": "Annulé",
  "ai.title": "Conception IA",
  "ai.subtitle": "Génère des variantes à partir d'une source, de références et d'une invite.",
  "ai.source": "Image source",
  "ai.references": "Images de référence",
  "ai.prompt": "Invite",
  "ai.promptPlaceholder": "Décrivez le rendu souhaité, p. ex. cinematic volumetric lighting…",
  "ai.majorChange": "Changement majeur",
  "ai.outputCount": "Nombre de sorties",
  "ai.outputDirectory": "Dossier de sortie",
  "ai.provider": "Fournisseur",
  "ai.generate": "Générer",
  "ai.generating": "Démarrage…",
  "ai.cancel": "Annuler",
  "ai.retry": "Réessayer",
  "ai.history": "Historique",
  "ai.noJobs": "Aucun travail pour le moment.",
  "ai.error.sourceRequired": "Choisissez une image source.",
  "ai.error.promptRequired": "L'invite ne peut pas être vide.",
  "ai.error.outputRequired": "Choisissez un dossier de sortie.",
  "ai.referenceCount": "Jusqu'à 6 références",
  "ai.dropHint": "Déposez des images pour remplacer ou ajouter ; {max} références max.",
  "ai.addReference": "Ajouter une référence",
  "ai.removeSource": "Retirer la source",
  "ai.displayColor": "Couleur affichée",
  "ai.outputBrowse": "Parcourir",
  "ai.state.queued": "En attente",
  "ai.state.uploading": "Téléversement",
  "ai.state.generating": "Génération",
  "ai.state.downloading": "Téléchargement",
  "ai.state.completed": "Terminé",
  "ai.state.failed": "Échec",
  "ai.state.cancelled": "Annulé",
  "ai.input": "Entrée",
  "ai.pickInput": "Choisir l'image d'entrée",
  "ai.pickSource": "Choisir l'image source",
  "ai.pickReference": "Choisir une image de référence",
  "ai.pickOutput": "Choisir le dossier de sortie",
  "ai.fileFilterImages": "Images",
  "ai.fileFilterAll": "Tous les fichiers",
  "ai.referenceIndex": "Référence {index}",
  "ai.dropEmpty": "Déposez des images ici ou choisissez à droite",
  "ai.unavailable": "(indisponible)",
  "ai.refresh": "Actualiser la liste des tâches",
  "ai.outputCountResult": "{count} sorties",
  "ai.removeInput": "Retirer {label}",
  "settings.title": "Paramètres",
  "settings.subtitle": "Les préférences générales, d'index et de tableaux sont locales ; les fichiers sources restent sur le disque.",
  "settings.language": "Langue",
  "settings.languageHint": "Changement instantané ; textes manquants en anglais",
  "settings.general": "Général",
  "settings.restoreLayout": "Restaurer la disposition par défaut",
  "status.diskReady": "Parcours du disque prêt",
  "status.boardReady": "Tableaux prêts",
  "status.importing": "Mise à jour de l'index…",
  "directory.searchPlaceholder": "Rechercher des noms ou #étiquettes (sous-dossiers inclus)",
  "directory.newTab": "Ouvrir dans un nouvel onglet",
  "directory.empty": "Le dossier est vide",
  "directory.searchEmpty": "Aucun fichier correspondant",
  "directory.searchEmptyHint": "Essayez d'autres mots-clés ; les résultats des sous-dossiers arrivent en flux.",
  "browser.tab.new": "Nouvel onglet",
  "browser.tab.close": "Fermer l'onglet",
  "browser.empty": "Parcourir",
  "imageReview.zoomIn": "Zoom avant",
  "imageReview.zoomOut": "Zoom arrière",
  "imageReview.fit": "Ajuster à la fenêtre",
  "imageReview.original": "100 % taille d'origine",
  "imageReview.rotate": "Pivoter 90°",
  "imageReview.checker": "Fond damier transparent",
  "imageReview.eyedrop": "Pipette",
  "imageReview.palette": "Extraire la palette",
  "imageReview.layers": "Calques",
  "imageReview.layerNote": "Ce format prend en charge les calques mais aucun analyseur n'est disponible ; l'aperçu composé est conservé.",
  "imageReview.paletteLabel": "Palette",
  "imageReview.displayColorNote": "Couleur affichée",
  "imageReview.copy": "Copier",
  "imageReview.copied": "Copié",
  "imageReview.error": "Impossible de décoder l'image ou format non pris en charge.",
  "imageReview.fitShort": "Ajuster",
  "imageReview.noLayers": "Aucun calque analysable dans ce format.",
};

const CATALOGS: Record<AppLanguage, Catalog> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
  es,
  fr,
};

let currentLanguage: AppLanguage = "en";

export function setLanguage(language: AppLanguage): void {
  currentLanguage = language;
}

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export function translate(key: MessageKey): string {
  const catalog = CATALOGS[currentLanguage];
  const value = catalog?.[key];
  if (value !== undefined && value !== "") return value;
  // 缺失 key：回退英文；开发期报告缺 key。
  if (import.meta.env?.DEV) {
    console.warn(`[i18n] missing key "${key}" in "${currentLanguage}"`);
  }
  return CATALOGS.en[key] ?? key;
}

/** 所有语言的 key 集合（供自动 catalog 校验测试使用）。 */
export function catalogKeySets(): Record<AppLanguage, string[]> {
  return {
    "zh-CN": Object.keys(zhCN),
    "zh-TW": Object.keys(zhTW),
    en: Object.keys(en),
    ja: Object.keys(ja),
    ko: Object.keys(ko),
    es: Object.keys(es),
    fr: Object.keys(fr),
  };
}
