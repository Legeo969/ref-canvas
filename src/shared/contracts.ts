export const assetKinds = [
  "image",
  "video",
  "audio",
  "pdf",
  "model3d",
  "dcc",
  "font",
  "generic",
] as const;

export const assetColorLabels = [
  "none",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;

export const assetSortKeys = [
  "createdAt",
  "updatedAt",
  "mtimeMs",
  "title",
  "size",
  "rating",
  "random",
] as const;

export const assetOrientations = ["landscape", "portrait", "square"] as const;

export type AssetKind = (typeof assetKinds)[number];
export type AssetColorLabel = (typeof assetColorLabels)[number];
export type AssetSortKey = (typeof assetSortKeys)[number];
export type AssetOrientation = (typeof assetOrientations)[number];
export type SortDirection = "asc" | "desc";
export type AssetLifecycle = "active" | "trashed" | "purged";
export type LinkState = "online" | "missing" | "searching" | "ambiguous" | "offline";
export type AssetMetadataStatus = "pending" | "ready" | "failed";

export interface AssetRecord {
  id: string;
  title: string;
  kind: AssetKind;
  path: string;
  extension: string;
  size: number;
  mtimeMs: number;
  fingerprint: string;
  contentHash: string | null;
  lifecycle: AssetLifecycle;
  deletedAt: string | null;
  trashPath: string | null;
  favorite: boolean;
  rating: number;
  colorLabel: AssetColorLabel;
  linkState: LinkState;
  notes: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  metadataStatus: AssetMetadataStatus;
  metadataError: string | null;
  metadataUpdatedAt: string | null;
  /** Beats per minute, extracted locally for audio. */
  bpm: number | null;
  /** Local-only key/value metadata (extensible custom fields). */
  customFields: Record<string, string>;
  /** Optional user-chosen image overriding the generated thumbnail. */
  customThumbnailPath: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
  thumbnailUrl: string;
}

export interface MediaPaletteColor {
  rgb: [number, number, number];
  hex: string;
  count: number;
}

export interface AssetAnnotation {
  id: string;
  assetId: string;
  x: number;
  y: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetSearchInput {
  query?: string;
  kind?: AssetKind | "all";
  linkState?: LinkState | "all";
  lifecycle?: AssetLifecycle;
  pageSize?: number;
  cursor?: string;
  tag?: string;
  favorite?: boolean;
  ratingMin?: number;
  colorLabel?: AssetColorLabel;
  dominantColor?: string;
  colorTolerance?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minSize?: number;
  maxSize?: number;
  minDuration?: number;
  maxDuration?: number;
  minBpm?: number;
  maxBpm?: number;
  extension?: string;
  orientation?: AssetOrientation;
  /** All listed tags must be present (boolean AND). */
  includeTags?: string[];
  /** Any of the listed tags present (boolean OR, combined with includeTags). */
  anyTags?: string[];
  /** None of the listed tags may be present (exclusion). */
  excludeTags?: string[];
  /** Substring match against the absolute file path. */
  pathContains?: string;
  /** Substring match against the file name only. */
  filenameContains?: string;
  /** Substring match against notes/annotations text. */
  notesContains?: string;
  /** Exact aspect ratio, e.g. "16:9". */
  exactAspectRatio?: string;
  /** Custom-field conditions, all must match (key: value substring). */
  customFields?: Array<{ key: string; value: string }>;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  sort?: AssetSortKey;
  direction?: SortDirection;
  /** @deprecated Kept for migration tests and older renderer builds. */
  limit?: number;
  /** @deprecated Cursor pagination replaces offsets. */
  offset?: number;
}

export interface AssetPage {
  items: AssetRecord[];
  total: number;
  nextCursor: string | null;
}

export interface AssetSearchWindowInput {
  query: AssetSearchInput;
  offset: number;
  pageSize: number;
  includeTotal: boolean;
}

export interface AssetSearchWindow {
  items: AssetRecord[];
  total: number | null;
}

export type SelectionScope =
  | { mode: "ids"; ids: string[] }
  | {
      mode: "query";
      query: AssetSearchInput;
      excludedIds: string[];
    };

export interface BatchAssetPatch {
  addTags?: string[];
  removeTags?: string[];
  replaceTags?: string[];
  favorite?: boolean;
  rating?: number;
  colorLabel?: AssetColorLabel;
  notes?: string;
}

export type ImportJobState =
  | "queued"
  | "scanning"
  | "processing"
  | "enriching"
  | "completed"
  | "cancelled"
  | "failed";

export interface ImportJobSnapshot {
  id: string;
  state: ImportJobState;
  discovered: number;
  /** Number of base asset records persisted. */
  processed: number;
  enriched: number;
  metadataFailed: number;
  sourcePaths: string[];
  imported: number;
  reused: number;
  unsupported: number;
  failed: Array<{ path: string; reason: string }>;
  /** Records repaired to a new location after identity confirmation. */
  relinked: number;
  /** Moves parked in the reconcile queue because identity was ambiguous. */
  conflicted: number;
  createdAt: string;
  completedAt: string | null;
}

export interface LibraryChangedEvent {
  reason: "watch" | "reconcile" | "thumbnail";
  paths: string[];
}

export type SaveRenderedImageResult =
  | { mode: "export"; path: string }
  | { mode: "thumbnail"; asset: AssetRecord };

export interface WatchRoot {
  id: string;
  path: string;
  createdAt: string;
}

/** 挂载根：本地盘符、移动盘或 NAS mount root（计划 §7.2）。 */
export interface MountRoot {
  id: string;
  path: string;
  displayName: string;
  volumeId: string | null;
  state: "online" | "offline" | "permission-denied";
  lastSeenAt: string | null;
}

export interface MountChangedEvent {
  type: "added" | "removed" | "state";
  mountId: string;
  state?: MountRoot["state"];
}

/** 文件身份：磁盘上真实文件的路径 + fingerprint（计划 §7.2）。 */
export interface FileIdentity {
  id: string;
  mountId: string;
  relativePath: string;
  fileId: string | null;
  size: number;
  mtimeMs: number;
  quickHash: string | null;
  contentHash: string | null;
  linkState: "online" | "missing" | "offline" | "ambiguous";
}

export interface AutoTagRule {
  id: string;
  name: string;
  /** Glob-style pattern matched against the file name (e.g. "*concept*"). */
  filenamePattern: string | null;
  /** Substring matched against the directory path. */
  pathPattern: string | null;
  /** Exact extension without dot (e.g. "png"), or null for any. */
  extension: string | null;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryPreferences {
  layoutMode: "grid" | "waterfall" | "detail" | "random";
  cardSize: "small" | "medium" | "large";
  thumbnailBackground: "checker" | "black" | "white" | "auto";
  /** 查询文件夹时是否默认包含子文件夹素材。 */
  includeSubfolderAssets: boolean;
  /** 每个资料库独立保存的工作区面板宽度与折叠状态。 */
  panelLayout: {
    sidebarWidth: number;
    assetWidth: number;
    detailsWidth: number;
    collapsed: Array<"sidebar" | "asset" | "details">;
  };
}

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  databaseSchemaVersion: number;
  /** 当前打开的资料库目录。 */
  libraryPath: string | null;
  libraryName: string | null;
  /** 安装渠道：signed 使用签名的 NSIS/Squirrel 安装包，否则为 unsigned。 */
  installChannel: "signed" | "unsigned";
  platform: string;
  userDataPath: string;
  /** Squirrel 安装版可从应用内启动系统卸载流程。 */
  uninstallAvailable: boolean;
}

/**
 * 启动期数据库迁移失败的恢复信息（FND-001）。
 * 迁移失败时应用停留在恢复页，不进入主工作区；UI 据此展示可恢复的
 * 数据库文件与迁移备份目录，并列出失败步骤。
 */
export interface MigrationRecoveryInfo {
  failed: boolean;
  databasePath: string | null;
  backupDirectory: string | null;
  entries: Array<{
    stepId: string;
    fromVersion: number;
    toVersion: number;
    error: string | null;
  }>;
}

export interface BoardSettings {
  /** PureRef 2.1 相近的直接操作预设。 */
  interactionPreset: "pureref" | "standard";
  /** 拖动时显示临时吸附参考线。 */
  snapEnabled: boolean;
  /** 选中图片对象时自动置顶。 */
  bringToFrontOnSelect: boolean;
  sampling: "nearest" | "bilinear";
  /** 撤销历史最大条数。 */
  undoLimit: number;
}

/** 应用级偏好（非资料库级），存主进程 settings 表。 */
export type AppLanguage = "zh-CN" | "en";

/** 主窗口侧栏 SplitPanes 各板块高度（px）。 */
export interface SidebarLayoutPreference {
  quickAccessHeight: number;
  directoryHeight: number;
  boardHeight: number;
}

export const SIDEBAR_LAYOUT_DEFAULTS: SidebarLayoutPreference = {
  quickAccessHeight: 270,
  directoryHeight: 290,
  boardHeight: 180,
};

export interface AppPreferences {
  globalShortcuts: boolean;
  /** 后台驻留：关闭窗口后保留主进程与托盘。 */
  backgroundResidency: boolean;
  boardSettings: BoardSettings;
  /** 界面语言（双语：zh-CN / en；en 为回退基准）。 */
  language: AppLanguage;
  /** 预览高级功能设置（阶段 5），默认值见 PREVIEW_SETTINGS_DEFAULTS。 */
  previewSettings: PreviewSettings;
  /** 侧栏板块高度（拖动分隔条后持久化）。 */
  sidebarLayout: SidebarLayoutPreference;
}

/** 序列检测自定义规则（阶段 5 §10.1 Sequence rules）。 */
export interface SequenceRule {
  id: string;
  name: string;
  /** 文件名正则（不含目录），如 ^frame\\.\\d+\\.exr$。 */
  pattern: string;
  /** 少于该帧数不构成序列。 */
  minFrames: number;
}

/** MP4 导出预设（阶段 5 §10.1 MP4 presets）。 */
export interface Mp4Preset {
  id: string;
  label: string;
  enabled: boolean;
  codec: "h264" | "h265";
  quality: "medium" | "high" | "best";
  resolution: "original" | "half" | "quarter";
}

export const previewFormatGroupIds = [
  "model3d",
  "image",
  "video",
  "audio",
  "pdf",
] as const;

export type PreviewFormatGroupId = (typeof previewFormatGroupIds)[number];

export interface PreviewFormatGroup {
  id: PreviewFormatGroupId;
  label: string;
  extensions: string[];
}

export const PREVIEW_FORMAT_GROUP_DEFAULTS: PreviewFormatGroup[] = [
  {
    id: "model3d",
    label: "3D",
    extensions: ["obj", "abc", "fbx", "gltf", "glb", "stl"],
  },
  {
    id: "image",
    label: "IMG",
    extensions: [
      "jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp", "gif", "exr", "hdr",
      "raw", "dng", "arw", "nef", "heic", "heif", "avif", "jxl", "jp2", "svg",
      "psd", "psb", "tga", "dds",
    ],
  },
  {
    id: "video",
    label: "VIDS",
    extensions: ["mp4", "mpeg", "mpg", "mov", "webm", "wmv", "mkv", "m4v", "flv", "avi", "gif", "mxf", "ts", "vcc", "h266", "evc", "apv", "rmvb", "rv60"],
  },
  {
    id: "audio",
    label: "MP3",
    extensions: ["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus", "wma", "aiff", "ape"],
  },
  {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
  },
];

/** 预览高级功能设置（全部进持久化 + cache invalidation + 任务参数）。 */
export interface PreviewSettings {
  // §10.1 高级浏览
  showHiddenFiles: boolean;
  folderClickMode: "single" | "double";
  /** 文件夹 flattening 默认深度：0 = 关闭，1/2 = 层级，>2 自定义。 */
  defaultFlattenDepth: number;
  /** 每个文件夹独立记忆的 flattening 深度（path → depth）。 */
  flattenPerFolder: Record<string, number>;
  /** 预览式可编辑格式分组；扩展名不含点、统一小写。 */
  formatGroups: PreviewFormatGroup[];
  /** 纳入 OTHER 筛选的非视觉扩展名；默认不隐藏磁盘上的未知文件。 */
  formatWhitelist: string[];
  // §10.2 高级预览
  autoplayVideo: boolean;
  autoplaySequence: boolean;
  /** 目录网格是否把连续图片帧折叠成一个序列卡片。 */
  collapseImageSequences: boolean;
  autoplayModel3d: boolean;
  defaultSequenceFps: number;
  sequenceFpsPresets: number[];
  /** 少于该帧数的同类文件不判定为序列。 */
  sequenceMinFrames: number;
  sequenceRules: SequenceRule[];
  alphaBackground: "black" | "white" | "checker" | "custom";
  alphaCustomColor: string;
  /** UI 缩放（0.8–1.5）。 */
  uiScale: number;
  /** 预览队列并发（PreviewQueue maximumConcurrent）。 */
  previewConcurrency: number;
  /** 缩略图 worker（libvips）并发线程。 */
  thumbnailWorkerThreads: number;
  // §10.4 输出工作流
  downscaleMode: "suffix" | "subdirectory" | "backup";
  /** suffix 模式：文件名追加后缀，如 image_2k.png。 */
  downscaleSuffix: string;
  /** subdirectory 模式：输出到分辨率子目录。 */
  downscaleSubdirectory: string;
  defaultMp4PresetId: string;
  mp4Presets: Mp4Preset[];
  // §10.3 色彩管理
  /** 显式注册的 OCIO config 路径（$OCIO 自动检测优先）。 */
  ocioConfigPath: string | null;
  lutDirectories: string[];
  /** 当前生效的 LUT 文件路径（进 thumbnail cache key）。 */
  activeLut: string | null;
  // §10.5 本地设置
  debugLogging: boolean;
  closeBehavior: "quit" | "tray";
}

export const PREVIEW_SETTINGS_DEFAULTS: PreviewSettings = {
  showHiddenFiles: false,
  folderClickMode: "double",
  defaultFlattenDepth: 0,
  flattenPerFolder: {},
  formatGroups: PREVIEW_FORMAT_GROUP_DEFAULTS,
  formatWhitelist: [
    "txt", "md", "json", "xml", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "zip", "rar", "7z", "tar", "gz", "svg", "ai", "eps", "hip", "nk", "max", "ma", "mb",
  ],
  autoplayVideo: true,
  autoplaySequence: true,
  collapseImageSequences: true,
  autoplayModel3d: false,
  defaultSequenceFps: 25,
  sequenceFpsPresets: [15, 24, 25, 30, 60, 90, 120],
  sequenceMinFrames: 2,
  sequenceRules: [],
  alphaBackground: "checker",
  alphaCustomColor: "#404040",
  uiScale: 1,
  previewConcurrency: 4,
  thumbnailWorkerThreads: 1,
  downscaleMode: "suffix",
  downscaleSuffix: "2k",
  downscaleSubdirectory: "downscaled",
  defaultMp4PresetId: "convert-default",
  mp4Presets: [
    {
      id: "convert-default",
      label: "默认转换",
      enabled: true,
      codec: "h264",
      quality: "high",
      resolution: "original",
    },
    {
      id: "convert-2",
      label: "转换 2",
      enabled: false,
      codec: "h265",
      quality: "medium",
      resolution: "half",
    },
    {
      id: "convert-3",
      label: "转换 3",
      enabled: false,
      codec: "h265",
      quality: "best",
      resolution: "quarter",
    },
  ],
  ocioConfigPath: null,
  lutDirectories: [],
  activeLut: null,
  debugLogging: false,
  closeBehavior: "quit",
};

/** 应用级偏好补丁：boardSettings 可只传要改的字段。 */
export interface AppPreferencesPatch {
  globalShortcuts?: boolean;
  backgroundResidency?: boolean;
  boardSettings?: Partial<BoardSettings>;
  language?: AppLanguage;
  previewSettings?: Partial<PreviewSettings>;
  sidebarLayout?: Partial<SidebarLayoutPreference>;
}

export interface PanelLayoutPreference {
  sidebarWidth: number;
  assetWidth: number;
  detailsWidth: number;
  collapsed: Array<"sidebar" | "asset" | "details">;
}

export type NavigationSource = "library" | "directory";

/** 本地目录浏览（预览式）的单个条目，不依赖素材数据库。 */
export interface DirectoryEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  /** 小写扩展名（不含点）；目录为空字符串。 */
  extension: string;
  /** 包含子目录的层级；0 = 仅当前目录。 */
  depth?: number;
  /** 按需分批补齐的元数据，排序依赖字段时先完成补齐再稳定排序。 */
  size?: number;
  mtimeMs?: number;
  width?: number;
  height?: number;
  duration?: number;
  /** 同目录文件序列的轻量识别结果；仅用于浏览和预览。 */
  sequence?: import("./file-sequence").FileSequenceInfo;
  /** Full detected group supplied by the renderer for inline sequence preview. */
  sequenceGroup?: SequenceGroupInfo;
  /** 本地索引中的用户标签；磁盘模式下按需回填。 */
  tags?: string[];
  /** 已按需建立索引时的收藏状态；未索引时未定义。 */
  favorite?: boolean;
  /** 已按需建立索引时的 0–5 评分；未索引时未定义。 */
  rating?: number;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  total: number;
  nextCursor: string | null;
  /** Opaque scan revision used to reject stale destructive operations. */
  revision?: string;
  offset?: number;
  totalFiles?: number;
  scanState?: "scanning" | "complete";
  order?: "discovery" | "name";
}

export interface DirectoryProgressSnapshot {
  path: string;
  revision: string;
  state: "discovered" | "metadata" | "reset" | "invalidated";
  discovered?: number;
  totalFiles?: number;
  entries?: DirectoryEntry[];
}

export type DirectorySelectionScope =
  | { mode: "explicit"; paths: string[] }
  | {
      mode: "all";
      directoryPath: string;
      revision: string;
      excludedPaths: string[];
      extensions?: string[];
      /** 只选择已收藏素材（目录浏览「只看收藏」模式下的全选/批量操作）。 */
      favoritesOnly?: boolean;
    }
  | {
      mode: "search";
      searchId: string;
      revision: string;
      excludedPaths: string[];
    };

export type DirectoryBatchAction =
  | { type: "materialize" }
  | { type: "tag"; tags: string[] }
  | { type: "trash" }
  | { type: "exportPaths"; destination: string };

export interface DirectoryBatchSnapshot {
  id: string;
  state: "running" | "completed" | "cancelled" | "failed";
  action: DirectoryBatchAction;
  total: number;
  processed: number;
  failed: Array<{ path: string; reason: string }>;
  createdAt: string;
  updatedAt: string;
}

/** 文件名冲突时的处理策略（计划 §8.2）。 */
export type FileConflictAction = "skip" | "rename" | "replace";

/** 单次文件操作的冲突处理偏好（apply to all 语义由调用方展开）。 */
export interface FileOperationOptions {
  conflictAction?: FileConflictAction;
  /** 目标已存在时的重命名模板，例如 "name (2).png"；仅 conflictAction=rename。 */
  renameTemplate?: string;
  /** 破坏性操作前需匹配的目录扫描 revision（计划 §8.2）。 */
  revision?: string;
  /** revision 对应的目录路径。 */
  directoryPath?: string;
}

export interface FileOperationResult {
  copied: number;
  moved: number;
  skipped: number;
  replaced: number;
  failed: Array<{ source: string; target: string; reason: string }>;
}

export type FileOperationKind = "copy" | "move";

export interface FileOperationReport extends FileOperationResult {
  kind: FileOperationKind;
  targets: string[];
}

export type DirectorySearchState =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface DirectorySearchSnapshot {
  id: string;
  state: DirectorySearchState;
  rootPath: string;
  query: string;
  /** 当前层结果立即显示，子目录结果流式追加。 */
  entries: DirectoryEntry[];
  /** Results remain paged; entries contains only the first compatibility page. */
  totalFiles?: number;
  revision?: string;
  order?: "discovery" | "name";
  processedDirectories: number;
  totalDirectories: number | null;
  /** 无权限目录加入报告，不中断其他目录。 */
  failedDirectories: Array<{ path: string; reason: string }>;
  createdAt: string;
  completedAt: string | null;
}

export interface QuickAccessEntry {
  id: string;
  path: string;
  name: string;
  sortOrder: number;
  expanded: boolean;
  createdAt: string;
}

export interface MaterializeResult {
  /** 复用同路径索引记录的 assetId。 */
  asset: AssetRecord;
  /** 是否新建记录（false 表示同路径已有索引，直接复用）。 */
  created: boolean;
}

export interface FilesystemRenameResult {
  path: string;
  /** 该路径是否已索引（若已索引则同步 path/identity/白板引用/缩略图缓存，assetId 不变）。 */
  syncedAsset: AssetRecord | null;
}

export interface TagRecord {
  id: string;
  name: string;
  groupId: string | null;
  assetCount: number;
  /** Optional alternate name matched by search. */
  alias: string | null;
  /** Optional keyboard shortcut label (local convenience only). */
  shortcutKey: string | null;
}

export interface TagGroupRecord {
  id: string;
  title: string;
  sortOrder: number;
  tagCount: number;
}

export interface SavedView {
  id: string;
  title: string;
  search: AssetSearchInput;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateGroup {
  contentHash: string;
  size: number;
  assets: AssetRecord[];
}

export interface SimilarAsset {
  asset: AssetRecord;
  score: number;
}

export interface SimilarityIndexSnapshot {
  state: "idle" | "running" | "completed" | "cancelled";
  total: number;
  processed: number;
  indexed: number;
  failed: number;
}

export interface MediaMetadataSnapshot {
  state: "idle" | "running" | "completed" | "cancelled";
  total: number;
  processed: number;
  updated: number;
  failed: number;
}

export interface LibraryStats {
  total: number;
  missing: number;
  trashed: number;
  favorites: number;
  duplicates: number;
  trashBytes: number;
  byKind: Record<AssetKind, number>;
}

export interface RelinkResult {
  status: "relinked" | "not-found" | "ambiguous";
  asset: AssetRecord;
  candidates: number;
}

export interface AssetReference {
  boardId: string;
  boardTitle: string;
}

// --- Media preview & local actions (phase 3) ---

export type AssetNotePositionKind = "general" | "time" | "frame";

/** Persistent note attached to any asset, optionally linked to time or frame. */
export interface MediaNote {
  id: string;
  assetId: string;
  /** Time in milliseconds from the start of the media. */
  timeMs: number;
  positionKind: AssetNotePositionKind;
  /** Milliseconds for `time`, frame index for `frame`, zero for `general`. */
  position: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** Persistent playback state for GIF/video/audio previews. */
export interface PlaybackState {
  /** Last playback rate (e.g. 1, 1.5, 2). */
  playbackRate: number;
  /** Muted at last interaction. */
  muted: boolean;
  /** Last volume 0..1. */
  volume: number;
  /** Last seek position in milliseconds. */
  positionMs: number;
}

export type AssetActionType =
  | "convert"
  | "merge-images"
  | "webp"
  | "compress"
  | "video-to-gif"
  | "change-extension"
  | "export-csv"
  | "export-folder";

export type AssetActionState =
  | "queued"
  | "preparing"
  | "running"
  | "reviewing"
  | "completed"
  | "cancelled"
  | "failed";

export interface AssetActionItem {
  sourcePath: string;
  status: "pending" | "done" | "conflict" | "failed";
  /** Final output path once produced. */
  outputPath: string | null;
  error: string | null;
}

export interface AssetActionSnapshot {
  id: string;
  type: AssetActionType;
  state: AssetActionState;
  total: number;
  processed: number;
  created: number;
  failed: number;
  /** Paths that already exist and need user confirmation before overwrite. */
  conflicts: string[];
  items: AssetActionItem[];
  createdAt: string;
  completedAt: string | null;
  outputDirectory: string | null;
  error: string | null;
}

export interface AssetActionRequest {
  type: AssetActionType;
  targets: SelectionScope;
  /** Action-specific options (see each action implementation). */
  options: Record<string, unknown>;
  /** Output directory; defaults to a per-type folder under the Pictures dir. */
  outputDirectory?: string | null;
  /**
   * Naming template supporting {name}, {index}, {count}, {ext}, {date}.
   * Defaults to "{name}".
   */
  namingTemplate?: string | null;
  /** Recreate the source folder hierarchy under the output directory. */
  keepHierarchy?: boolean;
  /** Write a `.json` sidecar with metadata next to each output. */
  writeSidecar?: boolean;
}

// --- Action option payloads (validated in the main process) ---

export interface ConvertOptions {
  format: "png" | "jpeg" | "webp" | "avif" | "tiff";
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface MergeImagesOptions {
  direction: "horizontal" | "vertical" | "grid";
  columns?: number;
  gap?: number;
}

export interface CompressOptions {
  /** JPEG quality target for lossy formats (no-op for lossless). */
  quality?: number;
}

export interface VideoToGifOptions {
  fps?: number;
  scale?: number;
  /** Millisecond range to extract; null = whole file. */
  startMs?: number | null;
  endMs?: number | null;
}

export interface ChangeExtensionOptions {
  extension: string;
}

export interface ExportCsvOptions {
  fields: Array<
    "title" | "path" | "extension" | "size" | "width" | "height" | "duration" | "bpm" | "rating" | "tags" | "notes" | "createdAt" | "updatedAt"
  >;
}

export interface ResolveConflictInput {
  overwrite: boolean;
}

export interface BackupRecord {
  filename: string;
  path: string;
  size: number;
  createdAt: string;
  automatic: boolean;
}

export interface PathMigrationReport {
  updated: number;
  missing: number;
  conflicts: number;
  skipped: number;
}

export interface CaptureSource {
  dataUrl: string;
  width: number;
  height: number;
}

export interface BoardSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Monotonic document version used to reject stale writes from another window. */
  revision: number;
}

export interface BoardDocumentV1 {
  schemaVersion: 1;
  canvas: Record<string, unknown>;
}

export interface BoardAppearance {
  backgroundColor: string;
  gridVisible: boolean;
  gridSize: number;
}

export interface BoardDocumentV2 {
  schemaVersion: 2;
  canvas: Record<string, unknown>;
  viewport: {
    transform: [number, number, number, number, number, number];
    zoom: number;
  };
  guides: { x: number[]; y: number[] };
  appearance: BoardAppearance;
}

export type BoardGridStyle = "line" | "dot" | "none";
export type BoardWindowMode =
  | "normal"
  | "always-on-bottom"
  | "transparent-overlay"
  | "locked";
export type BoardSampling = "nearest" | "bilinear";
export type BoardExportFormat = "png" | "jpeg" | "webp";

export interface BoardCanvasMode {
  /** Whole-canvas lock: selection and manipulation disabled. */
  locked: boolean;
  /** Whole-canvas grayscale rendering. */
  grayscale: boolean;
  gridStyle: BoardGridStyle;
}

export interface BoardExportSettings {
  format: BoardExportFormat;
  /** When true, a .refcanvas package embeds managed copies of assets. */
  embedAssets: boolean;
}

/** Rich-text note payload stored on fabric objects as `data.note`. */
export interface BoardNote {
  text: string;
  /** Rich-text segments for bold/italic/underline (stored as markdown-ish spans). */
  richText: string;
  checklist: Array<{ text: string; checked: boolean }>;
  link: string | null;
  /** Auto-sizing vs fixed-width wrapping. */
  autoWidth: boolean;
}

/**
 * PureRef-grade board document: extends V2 with window/canvas modes, export
 * settings and sampling; notes/lists/links travel inside the canvas object
 * `data` so existing tooling keeps working.
 */
export interface BoardDocumentV3 {
  schemaVersion: 3;
  canvas: Record<string, unknown>;
  viewport: {
    transform: [number, number, number, number, number, number];
    zoom: number;
  };
  guides: { x: number[]; y: number[] };
  appearance: BoardAppearance;
  windowMode: BoardWindowMode;
  canvasMode: BoardCanvasMode;
  sampling: BoardSampling;
  exportSettings: BoardExportSettings;
}

export type BoardDocument = BoardDocumentV1 | BoardDocumentV2 | BoardDocumentV3;

export interface ReconcileCandidate {
  assetId: string;
  title: string;
  /** On-disk filename the candidate resolved to, for user-confirmed relinks. */
  path: string;
}

export type ReconcileEventType = "unlink" | "add" | "change";

export interface ReconcileEntry {
  id: string;
  rootPath: string;
  eventType: ReconcileEventType;
  filename: string;
  assetId: string | null;
  state: "pending" | "resolved" | "dropped";
  candidates: ReconcileCandidate[];
  createdAt: string;
}

export interface ReconcileReport {
  rootId: string | null;
  scanned: number;
  relinked: number;
  imported: number;
  missing: number;
  ambiguous: number;
  unchanged: number;
}

export interface ReconcileSnapshot {
  report: ReconcileReport | null;
  pending: ReconcileEntry[];
}

// --- §13.4 新增 API 类型（mounts / metadata / media / providers）---

/** 用户自定义 metadata 补丁：tags、rating、notes（计划 §7.2）。 */
export interface UserMetadataPatch {
  tags?: string[];
  rating?: number;
  notes?: string;
}

/** media.probe 结果（计划 §9）。 */
export interface MediaProbeResult {
  width: number | null;
  height: number | null;
  duration: number | null;
  /** 格式专属附加数据。 */
  extra: Record<string, unknown>;
}

export interface MediaThumbnailOptions {
  width?: number;
  height?: number;
  /** EXR/HDR 标准通道（R/G/B/A）；缺省为合成预览。 */
  channel?: string;
}

export interface MediaThumbnailResult {
  /** 缩略图文件路径（缓存目录内）。 */
  path: string;
  width: number;
  height: number;
}

export interface MediaPreviewResult {
  /** refbrowse:// 预览源 URL。 */
  source: string;
  mimeType: string;
}

export interface MediaConvertResult {
  path: string;
  format: string;
}

/** media.frame 精确取帧结果（阶段 3 §9.3）。 */
export interface MediaFrameResult {
  /** refbrowse:// 帧图 URL。 */
  source: string;
  /** 缓存内帧图路径。 */
  path: string;
  timeMs: number;
  jobId?: string;
}

/**
 * media.gifFrames 整包拆帧结果：Chromium 的 GIF 解码器对大型 GIF 只报
 * 第一帧，无法在渲染端播放动画；改为主进程用 ffmpeg 拆出全部 PNG 帧，
 * 渲染端以 refbrowse:// URL 逐帧加载成位图播放。
 */
export interface MediaGifFramesResult {
  /** 拆出的帧数（如 165）。 */
  count: number;
  /** 每一帧的可加载 URL（refbrowse://preview/<token>），顺序即播放顺序。 */
  urls: string[];
  jobId?: string;
}

/** media.waveform 波形结果（阶段 4：音频）。 */
export interface MediaWaveformResult {
  /** 归一化 0..1 峰值包络（等时间间隔）。 */
  peaks: number[];
  /** 每点对应的时间跨度（秒）。 */
  secondsPerPoint: number;
  /** 音频时长（秒；解码失败时为 null）。 */
  durationSeconds: number | null;
}

/** media.readText 文本预览结果（阶段 4：文档）。 */
export interface TextPreviewResult {
  text: string;
  encoding: string;
  truncated: boolean;
  byteLength: number;
  lineCount: number;
}

/** 序列导出 MP4 请求（阶段 5）。 */
export interface ExportMp4Request {
  /** 帧文件绝对路径（按帧号升序）。 */
  files: string[];
  /** 输出 fps。 */
  fps: number;
  /** Mp4Preset.id（默认 "original"）。 */
  presetId: string;
  /** 输出目录（用户选择）。 */
  outputDirectory: string;
  /** 输出文件名（不含扩展名）。 */
  baseName: string;
  jobId?: string;
}

export interface ExportMp4Result {
  outputPath: string;
  durationSeconds: number;
  frameCount: number;
  width: number;
  height: number;
  jobId?: string;
}

/** 单视频 → MP4 导出请求（右键菜单「导出 MP4」）。 */
export interface ExportVideoMp4Request {
  inputPath: string;
  outputDirectory: string;
  baseName: string;
  /** Mp4Preset.id（默认 "original"）。 */
  presetId: string;
  jobId?: string;
}

export interface ExportVideoMp4Result {
  outputPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  jobId?: string;
}

export interface ExportGifRequest {
  files: string[];
  fps: number;
  outputDirectory: string;
  baseName: string;
  maxWidth?: number;
  /** Palette size. Lower values trade fidelity for a smaller file. */
  colors?: number;
  dither?: "none" | "bayer" | "floyd_steinberg" | "sierra2_4a";
  jobId?: string;
}

export interface ExportVideoGifRequest {
  /** Backward-compatible single input. Prefer clips for the GIF studio. */
  inputPath?: string;
  /** Ordered video ranges concatenated into one GIF. */
  clips?: Array<{
    inputPath: string;
    startMs?: number;
    endMs?: number;
  }>;
  outputDirectory: string;
  baseName: string;
  fps?: number;
  maxWidth?: number;
  /** Palette size. Lower values trade fidelity for a smaller file. */
  colors?: number;
  dither?: "none" | "bayer" | "floyd_steinberg" | "sierra2_4a";
  jobId?: string;
}

export interface ExportGifResult {
  outputPath: string;
  durationSeconds: number;
  frameCount: number | null;
  width: number;
  height: number;
  sizeBytes?: number;
  jobId?: string;
}

export interface ExportVideoFramesRequest {
  inputPath: string;
  outputDirectory: string;
  baseName: string;
  format: "png" | "jpeg";
  /** Omit/null to preserve the source frame cadence. */
  fps?: number | null;
  startMs?: number;
  endMs?: number;
  /** JPEG quality from 1 to 100. Ignored for PNG. */
  quality?: number;
  jobId?: string;
}

export interface ExportVideoFramesResult {
  outputDirectory: string;
  frameCount: number;
  format: "png" | "jpeg";
  jobId?: string;
}

export interface ExportDisplayChannelRequest {
  inputPath: string;
  outputDirectory: string;
  baseName: string;
  channel?: string;
  jobId?: string;
}

export interface ExportDisplayChannelResult {
  outputPath: string;
  width: number;
  height: number;
  channel: string | null;
  jobId?: string;
}

/** Downscale 请求（阶段 5 §10.4）。 */
export interface DownscaleRequest {
  paths: string[];
  maxDimension: number;
  mode: "suffix" | "subdirectory" | "backup";
  jobId?: string;
}

export interface DownscaleItemResult {
  sourcePath: string;
  outputPath: string;
  width: number;
  height: number;
}

export interface DownscaleResult {
  results: DownscaleItemResult[];
  /** backup 模式覆盖了原路径（UI 需先确认）。 */
  modifiesSources: boolean;
  jobId?: string;
}

/** 色彩管理状态（阶段 5 §10.3）。 */
export interface ColorStatus {
  /** 自动检测的 $OCIO 环境变量。 */
  detectedOcio: string | null;
  ocioConfigPath: string | null;
  activeLut: string | null;
  /** activeLut 是否真实存在（丢失时 UI 提示）。 */
  activeLutExists: boolean;
  lutDirectories: string[];
}

/** 已注册脚本（阶段 5 §10.5；sha256 信任锚点）。 */
export interface RegisteredScript {
  id: string;
  name: string;
  path: string;
  hash: string;
  kind: "py" | "ps1" | "other";
  timeoutMs: number;
  createdAt: string;
}

export interface ScriptRunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  failureReason: "TIMEOUT" | "OUTPUT_LIMIT_EXCEEDED" | null;
  durationMs: number;
}

/** 图片序列分组（阶段 3 §9.4）。 */
export interface SequenceGroupInfo {
  id: string;
  directory: string;
  baseName: string;
  extension: string;
  pattern: "standard" | "compatible" | "custom";
  /** 组内文件绝对路径（按帧号升序）。 */
  files: string[];
  frames: number[];
  start: number;
  end: number;
  missingFrames: number[];
  width: number;
  fps: number;
}

/** provider manifest 摘要（renderer 可读，不含实现）。 */
export interface ProviderManifestInfo {
  id: string;
  version: string;
  kinds: AssetKind[];
  extensions: string[];
  capabilities: Array<
    | "probe"
    | "metadata"
    | "thumbnail"
    | "waveform"
    | "preview"
    | "convert"
  >;
  priority: number;
  runtime: "node" | "native-sidecar" | "external-cli";
}

export interface ProviderHealthInfo {
  ok: boolean;
  detail: string;
}

/** Board 引用解析结果（计划 §11 BoardAssetReferenceV4 解析态）。 */
export interface BoardReferenceResolution {
  assetId: string;
  /** 解析后的磁盘路径；缺失时为 null。 */
  path: string | null;
  state: "online" | "missing" | "offline" | "ambiguous";
  /** fingerprint 搜索候选（ambiguous 时供 relink UI 选择）。 */
  candidates?: Array<{ path: string; assetId: string | null }>;
  /** 本次是否自动重连（fingerprint 匹配 → path 已更新）。 */
  relinked?: boolean;
}

// --- 引用集合（schema 17，§6.1/§6.3） ---

export type CollectionItemState = "resolved" | "offline" | "missing" | "ambiguous";

export interface ReferenceCollection {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceCollectionItem {
  id: string;
  collectionId: string;
  identityId: string | null;
  mountId: string | null;
  relativePath: string | null;
  lastResolvedPath: string;
  pathKey: string;
  fingerprint: string | null;
  state: CollectionItemState;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 批量添加路径的结果：成功条目 + 被跳过的非文件/缺失路径。 */
export interface CollectionAddResult {
  added: ReferenceCollectionItem[];
  skipped: { directories: string[]; missing: string[] };
}

/** 集合导出任务快照（§6.3）。 */
export interface CollectionExportSnapshot {
  id: string;
  collectionId: string;
  targetDirectory: string;
  state: "running" | "completed" | "cancelled" | "failed";
  copied: number;
  skipped: number;
  failed: number;
  manifestPath: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

// --- 统一任务中心（FND-007 §8.3） ---

export type TaskKind =
  | "import"
  | "batch"
  | "convert"
  | "export"
  | "archive"
  | "ai";

export type TaskState = "queued" | "running" | "completed" | "failed" | "cancelled";

/** 统一任务中心快照：聚合导入/批处理/转换/导出/归档/AI 任务。 */
export interface TaskSnapshot {
  id: string;
  kind: TaskKind;
  state: TaskState;
  /** 当前阶段描述（human readable）。 */
  stage: string;
  /** 0..1；未知时为 null。 */
  progress: number | null;
  /** 输出路径（文件/目录）。 */
  output: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ZIP 归档任务快照（FND-007 §8.2）。 */
export interface ArchiveSnapshot {
  id: string;
  state: "running" | "completed" | "cancelled" | "failed";
  archivePath: string | null;
  entries: number;
  skipped: Array<{ path: string; reason: string }>;
  failed: Array<{ path: string; reason: string }>;
  bytesWritten: number;
  errorCode: string | null;
  errorMessage: string | null;
}

// --- AI Design Supervisor（§9） ---

export type AiProviderKind = "remote-rest" | "comfyui" | "mock";

export type AiJobState =
  | "queued"
  | "uploading"
  | "generating"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface AiDesignRequest {
  sourcePath: string;
  referencePaths: string[]; // 0..6
  prompt: string;
  majorChange: boolean;
  outputCount: number; // 1..4，默认 2
  outputDirectory: string;
}

export interface AiJobSnapshot {
  id: string;
  provider: AiProviderKind;
  state: AiJobState;
  stage: string;
  progress: number | null; // 0..1；未知时为 null
  outputs: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderSummary {
  kind: AiProviderKind;
  label: string;
  available: boolean;
  detail: string | null;
}

export interface AiProviderHealth {
  kind: AiProviderKind;
  ok: boolean;
  detail: string;
  latencyMs: number | null;
}

export interface AiSettings {
  comfyuiAddress: string;
  comfyuiWorkflowPath: string | null;
  comfyuiBinding: unknown | null;
  remoteBaseUrl: string | null;
  remoteConfigured: boolean;
  defaultProvider: AiProviderKind;
  enabledProviders: AiProviderKind[];
}

export interface RefCanvasApi {
  library: {
    search(input?: AssetSearchInput): Promise<AssetPage>;
    searchWindow(input: AssetSearchWindowInput): Promise<AssetSearchWindow>;
    get(id: string): Promise<AssetRecord | null>;
    getByPath(path: string): Promise<AssetRecord | null>;
    pickAndImport(mode: "files" | "folder"): Promise<ImportJobSnapshot | null>;
    importPaths(paths: string[]): Promise<ImportJobSnapshot>;
    startImport(paths: string[]): Promise<ImportJobSnapshot>;
    getImportJob(id: string): Promise<ImportJobSnapshot | null>;
    cancelImport(id: string): Promise<boolean>;
    retryImport(id: string): Promise<ImportJobSnapshot>;
    onImportProgress(
      callback: (snapshot: ImportJobSnapshot) => void,
    ): () => void;
    onLibraryChanged(callback: (event: LibraryChangedEvent) => void): () => void;
    pathsForFiles(files: File[]): string[];
    update(
      id: string,
      patch: {
        title?: string;
        notes?: string;
        favorite?: boolean;
        rating?: number;
        colorLabel?: AssetColorLabel;
      },
    ): Promise<AssetRecord>;
    listAnnotations(assetId: string): Promise<AssetAnnotation[]>;
    createAnnotation(
      assetId: string,
      input: { x: number; y: number; text: string },
    ): Promise<AssetAnnotation>;
    updateAnnotation(
      id: string,
      patch: { x?: number; y?: number; text?: string },
    ): Promise<AssetAnnotation>;
    deleteAnnotation(id: string): Promise<void>;
    batchUpdate(scope: SelectionScope, patch: BatchAssetPatch): Promise<number>;
    batchRename(scope: SelectionScope, pattern: string): Promise<number>;
    trash(scope: SelectionScope): Promise<number>;
    /**
     * Removes records from the library without touching `linked` source files;
     * managed copies are deleted with their records. Board-referenced assets
     * are kept as purged records so existing canvases keep loading.
     */
    removeFromLibrary(scope: SelectionScope): Promise<number>;
    restore(ids: string[]): Promise<number>;
    purge(ids: string[]): Promise<number>;
    /** 清除回收站记录但保留实际文件。 */
    forgetTrash(ids: string[]): Promise<number>;
    listTrash(input?: AssetSearchInput): Promise<AssetPage>;
    refreshLinks(): Promise<number>;
    pickAndRelink(id: string): Promise<AssetRecord | null>;
    searchAndRelink(id: string): Promise<RelinkResult | null>;
    addWatchFolder(): Promise<WatchRoot | null>;
    listWatchRoots(): Promise<WatchRoot[]>;
    removeWatchRoot(id: string): Promise<WatchRoot>;
    setTags(assetId: string, tags: string[]): Promise<AssetRecord>;
    listTags(): Promise<TagRecord[]>;
    listTagGroups(): Promise<TagGroupRecord[]>;
    createTagGroup(title: string): Promise<TagGroupRecord>;
    renameTagGroup(id: string, title: string): Promise<TagGroupRecord>;
    deleteTagGroup(id: string): Promise<void>;
    moveTagToGroup(id: string, groupId: string | null): Promise<TagRecord>;
    renameTag(id: string, name: string): Promise<TagRecord>;
    updateTagMeta(
      id: string,
      patch: { name?: string; alias?: string | null; shortcutKey?: string | null },
    ): Promise<TagRecord>;
    deleteTag(id: string): Promise<void>;
    listAutoTagRules(): Promise<AutoTagRule[]>;
    createAutoTagRule(rule: Omit<AutoTagRule, "id" | "createdAt" | "updatedAt">): Promise<AutoTagRule>;
    updateAutoTagRule(id: string, patch: Partial<Omit<AutoTagRule, "id" | "createdAt" | "updatedAt">>): Promise<AutoTagRule>;
    deleteAutoTagRule(id: string): Promise<void>;
    /** Applies all enabled rules to every active asset; returns tagged count. */
    applyAutoTagRules(): Promise<number>;
    setCustomThumbnail(id: string, path: string | null): Promise<AssetRecord>;
    getPreferences(): Promise<LibraryPreferences>;
    setPreferences(prefs: Partial<LibraryPreferences>): Promise<LibraryPreferences>;
    listSavedViews(): Promise<SavedView[]>;
    saveView(title: string, search: AssetSearchInput): Promise<SavedView>;
    updateSavedView(
      id: string,
      patch: { title?: string; search?: AssetSearchInput },
    ): Promise<SavedView>;
    duplicateSavedView(id: string): Promise<SavedView>;
    deleteSavedView(id: string): Promise<void>;
    listDuplicates(): Promise<DuplicateGroup[]>;
    mergeDuplicates(keepId: string, removeIds: string[]): Promise<AssetRecord>;
    findSimilar(
      id: string,
      options?: { limit?: number; minScore?: number },
    ): Promise<SimilarAsset[]>;
    startSimilarityIndex(): Promise<SimilarityIndexSnapshot>;
    getSimilarityIndex(): Promise<SimilarityIndexSnapshot>;
    cancelSimilarityIndex(): Promise<boolean>;
    onSimilarityProgress(
      callback: (snapshot: SimilarityIndexSnapshot) => void,
    ): () => void;
    startMediaMetadataRebuild(): Promise<MediaMetadataSnapshot>;
    getMediaMetadataRebuild(): Promise<MediaMetadataSnapshot>;
    cancelMediaMetadataRebuild(): Promise<boolean>;
    onMediaMetadataProgress(
      callback: (snapshot: MediaMetadataSnapshot) => void,
    ): () => void;
    references(id: string): Promise<AssetReference[]>;
    collectProject(boardId: string): Promise<string | null>;
    migratePaths(fromRoot: string, toRoot: string): Promise<PathMigrationReport>;
    /**
     * SPEC-2：导出整个库为 `.refcanvas-bundle`（db 快照 + 缩略图 + bundle.json）。
     * 打开目录选择器；取消返回 null。
     */
    exportBundle(): Promise<{
      path: string;
      size: number;
      manifest: {
        format: "refcanvas-bundle";
        version: number;
        schemaVersion: number;
        exportedAt: string;
        pathRoots: string[];
        includesManaged: boolean;
        includesThumbnails: boolean;
      };
    } | null>;
    /**
     * SPEC-2：导入 `.refcanvas-bundle`。解包到 userData 后需重启应用以应用
     * 新库与路径重映射；返回 `requiresRestart: true`。
     * `rootRules` 为路径根映射（导出根 → 导入根），空数组表示用默认建议。
     */
    importBundle(options: {
      bundlePath: string;
      rootRules: Array<{ from: string; to: string }>;
    }): Promise<{
      pendingRemapFile: string;
      rules: Array<{ from: string; to: string }>;
      requiresRestart: boolean;
    }>;
    stats(): Promise<LibraryStats>;
  };
  libraries: {
    /** Managed preflight（§13.3）：统计 managed records 与 store 文件。 */
    managedPreflight(): Promise<{
      managedAssets: number;
      managedFiles: number;
      storeBytes: number;
      canMigrateDirectly: boolean;
    }>;
    /** 把 managed store 迁移到磁盘目录并退役 managed storage（§13.3）。 */
    managedMigrate(targetDirectory: string): Promise<{
      migrated: number;
      failed: Array<{ path: string; reason: string }>;
    }>;
    /** 浏览器扩展捕获落盘目录（<userData>/browser-captures）。 */
    capturesDirectory(): Promise<string>;
    /**
     * 认领捕获：复制进目标目录 → size/SHA-256 校验 → 重链资产与集合
     * 引用 → 删除 browser-captures 原件。
     */
    adoptCaptures(paths: string[], targetDirectory: string): Promise<{
      adopted: Array<{ assetId: string; from: string; to: string }>;
      failed: Array<{ path: string; reason: string }>;
    }>;
  };
  mounts: {
    list(): Promise<MountRoot[]>;
    /** 注册挂载根并启动监视；已存在时返回现有记录。 */
    add(path: string): Promise<MountRoot>;
    /** 移除挂载根与对应监视；不会删除磁盘文件。 */
    remove(id: string): Promise<void>;
    /** 刷新挂载状态；离线恢复后触发增量 reconcile。 */
    reconnect(id: string): Promise<MountRoot>;
    /** 运行时挂载状态变化（磁盘/NAS 断连或恢复）。 */
    onChanged(
      callback: (change: MountChangedEvent) => void,
    ): () => void;
  };
  /** 引用集合（schema 17，§6）。 */
  collections: {
    list(): Promise<ReferenceCollection[]>;
    create(input: {
      parentId?: string | null;
      name: string;
    }): Promise<ReferenceCollection>;
    update(
      id: string,
      patch: {
        name?: string;
        parentId?: string | null;
        sortOrder?: number;
      },
    ): Promise<ReferenceCollection>;
    delete(id: string, options: { recursive: boolean }): Promise<void>;
    listItems(collectionId: string): Promise<ReferenceCollectionItem[]>;
    addPaths(
      collectionId: string,
      paths: string[],
    ): Promise<CollectionAddResult>;
    removeItems(collectionId: string, itemIds: string[]): Promise<void>;
    resolve(collectionId: string): Promise<
      Array<{ item: ReferenceCollectionItem; relinked: boolean }>
    >;
    relink(
      itemId: string,
      path: string,
      confirmFingerprintChange: boolean,
    ): Promise<ReferenceCollectionItem>;
    export(
      collectionId: string,
      targetDirectory: string,
      options?: { jobId?: string; conflictAction?: FileConflictAction },
    ): Promise<CollectionExportSnapshot>;
    /** 取消进行中的导出（jobId 为 export 返回的 id）；已复制文件保留。 */
    cancelExport(jobId: string): Promise<boolean>;
    onChanged(callback: () => void): () => void;
  };
  metadata: {
    /** 确保路径已建立索引（等价 materialize，§13.4 metadata.ensure）。 */
    ensure(path: string): Promise<MaterializeResult>;
    /** 更新用户 metadata（tags/rating/notes；不可重建数据，参与备份）。 */
    patch(assetId: string, patch: UserMetadataPatch): Promise<AssetRecord>;
  };
  media: {
    /** 探测媒体基本信息（provider probe，§6.2）。 */
    probe(path: string): Promise<MediaProbeResult>;
    /** 生成缩略图（缓存目录内）。 */
    thumbnail(path: string, options?: MediaThumbnailOptions): Promise<MediaThumbnailResult>;
    /** 生成 refbrowse 预览源 URL。 */
    preview(path: string): Promise<MediaPreviewResult>;
    /** 校验自定义 OCIO 配置可用性（解析 + 最小转换；LUT 缺失在此暴露）。 */
    validateOcioConfig(path: string): Promise<{ ok: boolean; detail: string | null }>;
    /** 按时间戳精确取帧（视频逐帧；不依赖 HTML video seek）。 */
    frame(
      path: string,
      options?: { timeMs?: number; width?: number; height?: number },
    ): Promise<MediaFrameResult>;
    /** 主进程用 ffmpeg 把 GIF/APNG 整包拆帧，渲染端逐帧位图播放
        （绕开 Chromium GIF 解码器对大型 GIF 只解首帧的问题）。 */
    gifFrames(
      path: string,
      options?: { jobId?: string },
    ): Promise<MediaGifFramesResult>;
    /** 从本地图片或视频时间点提取主色，不依赖 renderer 画布权限。 */
    palette(
      path: string,
      options?: { timeMs?: number; limit?: number },
    ): Promise<MediaPaletteColor[]>;
    /** 格式转换（provider convert；不支持时明确失败）。 */
    convert(
      path: string,
      targetFormat: string,
      jobId?: string,
    ): Promise<MediaConvertResult>;
    /** 视频转循环 GIF。 */
    exportGif(request: ExportVideoGifRequest): Promise<ExportGifResult>;
    /** 视频片段导出 PNG/JPEG 序列帧。 */
    exportFrames(request: ExportVideoFramesRequest): Promise<ExportVideoFramesResult>;
    /** 单视频转码导出 MP4（右键菜单「导出 MP4」，MP4 presets 复用）。 */
    exportMp4(request: ExportVideoMp4Request): Promise<ExportVideoMp4Result>;
    /** 将 EXR/HDR 当前显示层或通道导出为显示转换后的 PNG。 */
    exportDisplayChannel(
      request: ExportDisplayChannelRequest,
    ): Promise<ExportDisplayChannelResult>;
    /** 取消进行中的转换任务。 */
    cancel(jobId: string): Promise<boolean>;
    /**
     * 音频波形峰值（阶段 4；provider waveform 流式解码）。
     * samples：目标峰值数量（0 使用 provider 默认）。
     */
    waveform(
      path: string,
      options?: { samples?: number },
    ): Promise<MediaWaveformResult>;
    /** 文本预览读取（阶段 4；UTF-8 探测，二进制拒绝）。 */
    readText(
      path: string,
      options?: { limit?: number },
    ): Promise<TextPreviewResult>;
    /** Downscale 图片（阶段 5 §10.4 Downscale naming）。 */
    downscale(request: DownscaleRequest): Promise<DownscaleResult>;
  };
  sequences: {
    /** 检测目录内的图片序列分组（阶段 3 §9.4）。 */
    detect(
      directory: string,
      options?: { customPatterns?: string[] },
    ): Promise<SequenceGroupInfo[]>;
    /** 序列导出 MP4（阶段 5 §10.1 MP4 presets）。 */
    exportMp4(request: ExportMp4Request): Promise<ExportMp4Result>;
    /** 图片序列导出循环 GIF。 */
    exportGif(request: ExportGifRequest): Promise<ExportGifResult>;
  };
  providers: {
    list(): Promise<ProviderManifestInfo[]>;
    health(providerId: string): Promise<ProviderHealthInfo>;
  };
  /** 统一任务中心（FND-007 §8.3）：聚合导入/批处理/转换/导出/归档/AI。 */
  tasks: {
    list(limit?: number): Promise<TaskSnapshot[]>;
    get(id: string): Promise<TaskSnapshot | null>;
    cancel(id: string): Promise<TaskSnapshot | null>;
    onChanged(callback: (snapshot: TaskSnapshot) => void): () => void;
  };
  /** AI Design Supervisor（FND-008 §9；Mock 仅开发/测试构建可见）。 */
  ai: {
    listProviders(): Promise<AiProviderSummary[]>;
    listJobs(limit?: number): Promise<AiJobSnapshot[]>;
    getJob(id: string): Promise<AiJobSnapshot | null>;
    start(
      provider: AiProviderKind,
      request: AiDesignRequest,
    ): Promise<AiJobSnapshot>;
    cancel(id: string): Promise<AiJobSnapshot>;
    retry(id: string): Promise<AiJobSnapshot>;
    getSettings(): Promise<AiSettings>;
    setSettings(patch: Partial<AiSettings>): Promise<AiSettings>;
    health(kind: AiProviderKind): Promise<AiProviderHealth>;
    /** Bearer token 状态（Renderer 只读 configured）。 */
    secretStatus(): Promise<{
      configured: boolean;
      source: "safe-storage" | "test";
    }>;
    /** 保存 Bearer token（safeStorage 加密）。 */
    saveSecret(token: string): Promise<{
      configured: boolean;
      source: "safe-storage" | "test";
    }>;
    /** 清除 Bearer token。 */
    clearSecret(): Promise<{
      configured: boolean;
      source: "safe-storage" | "test";
    }>;
    /** 导入 API-format workflow 并返回绑定元数据。 */
    importComfyuiWorkflow(path: string): Promise<{
      valid: boolean;
      errors: string[];
      nodeCount: number;
      outputNodeIds: string[];
      imageInputNodes: Array<{ nodeId: string; type: string }>;
      nodes: Array<{ nodeId: string; type: string; inputNames: string[] }>;
      workflowPath: string;
    }>;
    onChanged(callback: (snapshot: AiJobSnapshot | null) => void): () => void;
  };
  color: {
    /** 色彩管理状态（$OCIO 检测 + LUT）。 */
    getStatus(): Promise<ColorStatus>;
  };
  scripts: {
    list(): Promise<RegisteredScript[]>;
    /** 注册前预检：返回 sha256/类型/将执行的命令行（同意对话框数据）。 */
    inspect(request: { path: string }): Promise<{
      kind: RegisteredScript["kind"];
      sizeBytes: number;
      sha256: string;
      commandPreview: string;
    }>;
    register(request: {
      path: string;
      name?: string;
      timeoutMs?: number;
    }): Promise<RegisteredScript>;
    unregister(id: string): Promise<void>;
    run(request: { id: string; cwd: string }): Promise<ScriptRunResult>;
  };
  watchRoots: {
    /** Full reconciliation of watched roots against the identity index. */
    reconcile(rootId?: string | null): Promise<ReconcileReport>;
    getReport(): Promise<ReconcileSnapshot>;
    /** User confirmation for an ambiguous move; relinks the chosen record. */
    resolveConflict(entryId: string, assetId: string): Promise<AssetRecord>;
  };
  filesystem: {
    /** Windows C:–Z: 根目录；只探测可访问性，不递归扫描。 */
    listRoots(): Promise<DirectoryEntry[]>;
    /** 观察当前可见目录；native watcher 失败时由 main 降级为 mtime polling。 */
    setObservedDirectory(path: string | null): Promise<void>;
    /** 展开目录下一层（游标分页）；flattenDepth/showHidden 见阶段 5。 */
    listDirectory(
      path: string,
      options?: {
        cursor?: string;
        offset?: number;
        pageSize?: number;
        flattenDepth?: number;
        showHidden?: boolean;
        collapseSequences?: boolean;
        extensions?: string[];
        /** 只看收藏素材（按素材库 favorite 标记过滤）。 */
        favoritesOnly?: boolean;
      },
    ): Promise<DirectoryPage>;
    /** 轻量路径类型探测（目录/文件/不存在），供打开目录前的身份判断。 */
    pathType(path: string): Promise<"directory" | "file" | "missing">;
    onDirectoryProgress(
      callback: (snapshot: DirectoryProgressSnapshot) => void,
    ): () => void;
    locateEntry(
      path: string,
      entryPath: string,
      revision: string,
      favoritesOnly?: boolean,
    ): Promise<number | null>;
    /** 目录搜索：当前层即时结果 + 子目录流式追加；更换路径/关键词自动取消旧任务。 */
    startSearch(
      path: string,
      query: string,
      options?: {
        collapseSequences?: boolean;
        extensions?: string[];
        favoritesOnly?: boolean;
      },
    ): Promise<string>;
    cancelSearch(id: string): Promise<void>;
    getSearch(id: string): Promise<DirectorySearchSnapshot | null>;
    getSearchPage(
      id: string,
      options?: { offset?: number; pageSize?: number },
    ): Promise<DirectoryPage>;
    onSearchProgress(callback: (snapshot: DirectorySearchSnapshot) => void): () => void;
    /** 快速访问：本地目录或 NAS 路径，保存显示名、排序与展开状态。 */
    addQuickAccess(path: string, name?: string): Promise<QuickAccessEntry[]>;
    updateQuickAccess(id: string, patch: { name?: string; expanded?: boolean }): Promise<QuickAccessEntry[]>;
    removeQuickAccess(id: string): Promise<QuickAccessEntry[]>;
    listQuickAccess(): Promise<QuickAccessEntry[]>;
    /** 未索引文件按需建立记录：复用同路径 assetId，仅计算 quick fingerprint。 */
    materialize(path: string): Promise<MaterializeResult>;
    /** 真实改名源文件并同步已有索引记录（assetId 不变）。 */
    rename(
      path: string,
      newName: string,
      options?: FileOperationOptions,
    ): Promise<FilesystemRenameResult>;
    /** 在父目录下新建文件夹（同名冲突时自动改名）。 */
    createFolder(
      parentPath: string,
      name: string,
      options?: FileOperationOptions,
    ): Promise<string>;
    /** 复制文件/文件夹到目标目录；冲突按 strategy 处理。 */
    copy(
      sources: string[],
      targetDirectory: string,
      options?: FileOperationOptions,
    ): Promise<FileOperationReport>;
    /** 移动文件/文件夹到目标目录（跨卷走 copy→校验→回收站）。 */
    move(
      sources: string[],
      targetDirectory: string,
      options?: FileOperationOptions,
    ): Promise<FileOperationReport>;
    /** 删除未入库文件到系统回收站；已入库记录同步为 missing。 */
    trash(paths: string[], options?: FileOperationOptions): Promise<void>;
    open(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    /** 为未入库路径生成会话级 refbrowse token 供预览。 */
    previewToken(path: string): Promise<string>;
    previewTokens(paths: string[]): Promise<Array<{ path: string; token: string }>>;
    startBatch(
      selection: DirectorySelectionScope,
      action: DirectoryBatchAction,
    ): Promise<DirectoryBatchSnapshot>;
    exportPaths(
      selection: DirectorySelectionScope,
    ): Promise<DirectoryBatchSnapshot | null>;
    getBatch(id: string): Promise<DirectoryBatchSnapshot | null>;
    cancelBatch(id: string): Promise<boolean>;
    onBatchProgress(
      callback: (snapshot: DirectoryBatchSnapshot) => void,
    ): () => void;
    /** FND-007 §8.2：流式 ZIP 归档（可取消、冲突编号、临时文件原子移动）。 */
    archive(request: {
      sources: string[];
      targetDirectory: string;
      baseName: string;
      jobId: string;
    }): Promise<ArchiveSnapshot>;
    cancelArchive(jobId: string): Promise<boolean>;
    /** 拖出未入库路径到系统。 */
    dragOut(paths: string[]): void;
  };
  backups: {
    list(): Promise<BackupRecord[]>;
    create(): Promise<BackupRecord>;
    restore(path: string): Promise<void>;
  };
  boards: {
    list(): Promise<BoardSummary[]>;
    create(title?: string): Promise<BoardSummary>;
    rename(id: string, title: string): Promise<BoardSummary>;
    delete(id: string): Promise<void>;
    load(id: string): Promise<{
      summary: BoardSummary;
      document: BoardDocumentV3;
    } | null>;
    save(
      id: string,
      document: BoardDocument,
      revision: number,
    ): Promise<BoardSummary>;
    exportJson(id: string): Promise<string | null>;
    exportPng(id: string, dataUrl: string): Promise<string | null>;
    /**
     * Exports a self-contained `.refcanvas` package (board.json + embedded
     * asset copies when embedAssets is true). Returns the written path.
     */
    exportPackage(
      id: string,
      options: { embedAssets: boolean },
    ): Promise<string | null>;
    /** Last-opened boards, most recent first (local workflow). */
    recent(): Promise<BoardSummary[]>;
    /** Tracks that a board was opened (for the recent list). */
    touch(id: string): Promise<void>;
    /** Opens the board in its own window (dedupes: focuses the existing one). */
    openWindow(id: string): Promise<boolean>;
    /** Closes the window this renderer lives in (board windows only). */
    closeWindow(): Promise<boolean>;
    /** Completes any debounced board save before the host window closes. */
    confirmFlush(saved: boolean): void;
    /** Assets referenced by the board (for board-window initial state). */
    getAssets(id: string): Promise<AssetRecord[]>;
    /** 批量解析 board 引用到磁盘路径/状态（计划 §11 V4 引用解析）。 */
    resolveReferences(id: string): Promise<BoardReferenceResolution[]>;
    /** 重新链接一个 board 引用的 asset 到新路径（fingerprint 匹配时自动更新）。 */
    relinkReference(id: string, assetId: string, path: string): Promise<BoardReferenceResolution>;
  };
  actions: {
    start(request: AssetActionRequest): Promise<AssetActionSnapshot>;
    get(id: string): Promise<AssetActionSnapshot | null>;
    cancel(id: string): Promise<boolean>;
    retry(id: string): Promise<AssetActionSnapshot>;
    /** Confirms (or refuses) an overwrite conflict on a reviewing action. */
    resolveConflict(id: string, outputPath: string, overwrite: boolean): Promise<AssetActionSnapshot>;
    onProgress(callback: (snapshot: AssetActionSnapshot) => void): () => void;
  };
  mediaNotes: {
    list(assetId: string): Promise<MediaNote[]>;
    create(assetId: string, input: { timeMs?: number; positionKind?: AssetNotePositionKind; position?: number; text: string }): Promise<MediaNote>;
    update(id: string, patch: { timeMs?: number; positionKind?: AssetNotePositionKind; position?: number; text?: string }): Promise<MediaNote>;
    delete(id: string): Promise<void>;
    /** Persistent playback state for the given asset. */
    getPlaybackState(assetId: string): Promise<PlaybackState | null>;
    setPlaybackState(assetId: string, state: Partial<PlaybackState>): Promise<PlaybackState>;  };
  system: {
    openExternal(path: string): Promise<void>;
    /** 打开系统回收站；Windows 使用 Shell URI。 */
    openRecycleBin(): Promise<void>;
    /** Opens each file with the OS default app (batch). */
    openFilesWithDefaultApp(paths: string[]): Promise<void>;
    revealInFolder(path: string): Promise<void>;
    /** FND-004：打开浮动预览窗口（独立窗口渲染统一预览会话）。 */

    openDataFolder(): Promise<void>;
    /** 请求启动 Windows Squirrel 卸载器；调用前 Renderer 必须二次确认。 */
    requestUninstall(): Promise<boolean>;
    pickDirectory(options: {
      title: string;
      defaultPath?: string;
    }): Promise<string | null>;
    /** 打开文件选择对话框（阶段 6：Board 手动 relink；multiSelections 批量选择）。 */
    pickFile(options: {
      title: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      multiSelections?: boolean;
    }): Promise<string[]>;
    /** 保存 WebGL/Canvas 渲染结果；thumbnail 模式同时关联资产缩略图。 */
    saveRenderedImage(
      dataUrl: string,
      options: {
        mode: "export" | "thumbnail";
        assetId?: string;
        defaultName?: string;
      },
    ): Promise<SaveRenderedImageResult | null>;
    toggleAlwaysOnTop(): Promise<boolean>;
    /** Signals that initial renderer data is painted and background work may start. */
    markRendererInteractive(): Promise<void>;
    /** Sets always-on-bottom window behavior (special window modes). */
    setAlwaysOnBottom(enabled: boolean): Promise<boolean>;
    /** Enables a frameless click-through overlay window mode. */
    setClickThrough(enabled: boolean): Promise<boolean>;
    /** Sets a visible translucent overlay window. */
    setWindowTransparent(enabled: boolean): Promise<boolean>;
    /** Returns the current special window mode state. */
    getWindowModeState(): Promise<{
      alwaysOnTop: boolean;
      alwaysOnBottom: boolean;
      clickThrough: boolean;
    }>;
    setPresentationMode(enabled: boolean): Promise<boolean>;
    onPresentationModeChanged(callback: (enabled: boolean) => void): () => void;
    /** Fired when the main-process emergency shortcut restores normal mode. */
    onWindowModeReset(callback: () => void): () => void;
    /** FND-002：第二实例打开目录 → 主窗口在新标签打开。 */
    onOpenDirectoryTab(callback: (path: string) => void): () => void;
    /** 浏览器扩展发送的图片落入临时文件后通知渲染端导入到活动板。 */
    onBrowserCapture(callback: (data: { path: string; sourceUrl: string }) => void): () => void;
    captureClipboard(): Promise<AssetRecord | null>;
    prepareRegionCapture(): Promise<CaptureSource | null>;
    /** 独立覆盖窗口启动后一次性消费抓屏快照（?capture=1 模式）。 */
    getCaptureSource(): Promise<CaptureSource | null>;
    saveRegionCapture(dataUrl: string): Promise<AssetRecord | null>;
    cancelRegionCapture(): Promise<void>;
    rebuildThumbnailCache(): Promise<void>;
    exportDiagnostics(): Promise<string | null>;
    setGlobalShortcuts(enabled: boolean): Promise<boolean>;
    /** 应用级偏好（非资料库级）。 */
    getPreferences(): Promise<AppPreferences>;
    setPreferences(prefs: AppPreferencesPatch): Promise<AppPreferences>;
    /** 关于页与版本信息，版本必须来自 app.getVersion()。 */
    getAppInfo(): Promise<AppInfo>;
    /**
     * 启动期数据库迁移失败信息（FND-001）。迁移失败时应用停留在恢复页，
     * Renderer 据此展示数据库路径、备份目录与失败步骤。
     */
    getMigrationFailure(): Promise<MigrationRecoveryInfo>;
    /**
     * SPEC-1/SPEC-7 启动健康状态：`ok` 正常；`degraded` 只读降级（主库损坏
     * 仍可浏览，顶部横幅提示，写操作被拒绝）；`safe` 安全模式（库打不开，
     * 提供恢复/重建入口）；`too-new` 库由更新版本创建，拒绝打开。
     */
    getStartupHealth(): Promise<{
      mode: "ok" | "degraded" | "safe" | "too-new";
      databasePath: string | null;
      reason: string | null;
      /** 上次是否异常退出（clean-shutdown 标记缺失）。 */
      previousCrash: boolean;
    }>;
    /** SPEC-1 安全模式：列出最近备份（供"从最近备份恢复"）。 */
    recoverListBackups(): Promise<
      Array<{ filename: string; path: string; createdAt: string }>
    >;
    /** SPEC-1 安全模式：从指定备份恢复主库并重启。 */
    recoverRestoreBackup(filename: string): Promise<void>;
    /** SPEC-1 安全模式：新建空库（删除损坏主库）并重启。 */
    recoverNewDatabase(): Promise<void>;
    /** 写入系统剪贴板文本（用于"复制版本信息"）。 */
    writeClipboard(text: string): Promise<void>;
    getNavigationState(): Promise<string | null>;
    setNavigationState(value: string): Promise<void>;
    getBoardShortcuts(): Promise<Record<string, string> | null>;
    setBoardShortcuts(value: Record<string, string>): Promise<void>;
    startNativeDrag(assetIds: string[]): void;
    onRegionCaptureRequest(callback: () => void): () => void;
  };
}

declare global {
  interface Window {
    refCanvas: RefCanvasApi;
  }
}
