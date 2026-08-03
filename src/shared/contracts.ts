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

export const assetStorageModes = ["linked", "managed"] as const;

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
export type AssetStorageMode = (typeof assetStorageModes)[number];
export type SortDirection = "asc" | "desc";
export type AssetLifecycle = "active" | "trashed" | "purged";
export type LinkState = "online" | "missing" | "searching" | "ambiguous";
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
  collectionIds: string[];
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
  thumbnailUrl: string;
  /**
   * `linked` keeps the record pointing at the original external file and never
   * modifies it; `managed` owns a copy inside the library directory. The
   * `0.32` baseline and every pre-existing database migrate to `linked` so
   * existing behavior is unchanged; newly created libraries default to
   * `managed`.
   */
  storageMode: AssetStorageMode;
  /** Path of the file relative to the library root, when `managed`. */
  libraryRelativePath: string | null;
  /** Path the asset was imported from (managed mode); equals `path` when linked. */
  originalSourcePath: string | null;
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
  collectionId?: string;
  /**
   * When true (default when omitted), a collectionId search includes assets
   * in descendant subfolders. Set to false to query direct members only.
   */
  includeSubcollections?: boolean;
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
  addCollectionId?: string;
  removeCollectionId?: string;
  favorite?: boolean;
  rating?: number;
  colorLabel?: AssetColorLabel;
  notes?: string;
}

export interface ImportOptions {
  /**
   * `linked` keeps files where they are; `managed` copies them into the
   * library. `library-default` (or omitting the option) uses the active
   * library's configured default.
   */
  storageMode?: AssetStorageMode | "library-default";
  /**
   * `collections` recreates the source directory hierarchy as folders
   * (existing behavior); `flat` skips folder creation.
   */
  hierarchyMode?: "collections" | "flat";
  /** When set, imported assets are added directly to this folder instead of the hierarchy. */
  targetFolderId?: string | null;
  /**
   * When set together with `hierarchyMode: "collections"`, the recreated
   * folder tree is nested under this folder instead of the library root.
   */
  parentFolderId?: string | null;
}

export interface ImportResult {
  imported: number;
  reused: number;
  unsupported: number;
  failed: Array<{ path: string; reason: string }>;
  /** Managed files physically copied into the library store. */
  copied: number;
  /** Records repaired to a new location after identity confirmation. */
  relinked: number;
  /** Moves parked in the reconcile queue because identity was ambiguous. */
  conflicted: number;
  /** Managed copies whose SHA-256 was verified against the source. */
  verified: number;
}

export type ImportJobState =
  | "queued"
  | "scanning"
  | "processing"
  | "enriching"
  | "completed"
  | "cancelled"
  | "failed";

export interface ImportJobSnapshot extends ImportResult {
  id: string;
  state: ImportJobState;
  discovered: number;
  /** Number of base asset records persisted. */
  processed: number;
  enriched: number;
  metadataFailed: number;
  sourcePaths: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface LibraryChangedEvent {
  reason: "watch" | "reconcile";
  paths: string[];
}

export interface WatchRoot {
  id: string;
  path: string;
  createdAt: string;
}

export interface CollectionRecord {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  directAssetCount: number;
  assetCount: number;
  /** Local interface access lock; never claims disk encryption. */
  locked: boolean;
  createdAt: string;
}

/** Batch folder operations (create several at once, rename/move with a pattern). */
export interface BatchCollectionOp {
  create?: string[];
  rename?: Array<{ id: string; title: string }>;
  move?: Array<{ id: string; parentId: string | null }>;
  reorder?: Array<{ id: string; sortOrder: number }>;
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
  /** 当前资料库的默认入库方式（linked 保留原位 / managed 复制进库）。 */
  defaultStorageMode: AssetStorageMode;
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
export interface AppPreferences {
  globalShortcuts: boolean;
  /** 后台驻留：关闭窗口后保留主进程、目录监控与托盘。 */
  backgroundResidency: boolean;
  boardSettings: BoardSettings;
}

/** 应用级偏好补丁：boardSettings 可只传要改的字段。 */
export interface AppPreferencesPatch {
  globalShortcuts?: boolean;
  backgroundResidency?: boolean;
  boardSettings?: Partial<BoardSettings>;
}

export interface PanelLayoutPreference {
  sidebarWidth: number;
  assetWidth: number;
  detailsWidth: number;
  collapsed: Array<"sidebar" | "asset" | "details">;
}

export type NavigationSource = "library" | "directory";

/** 本地目录浏览（Found 式）的单个条目，不依赖素材数据库。 */
export interface DirectoryEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  /** 小写扩展名（不含点）；目录为空字符串。 */
  extension: string;
  /** 按需分批补齐的元数据，排序依赖字段时先完成补齐再稳定排序。 */
  size?: number;
  mtimeMs?: number;
  width?: number;
  height?: number;
  duration?: number;
  /** 同目录文件序列的轻量识别结果；仅用于浏览和预览。 */
  sequence?: import("./file-sequence").FileSequenceInfo;
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
    }
  | {
      mode: "search";
      searchId: string;
      revision: string;
      excludedPaths: string[];
    };

export type DirectoryBatchAction =
  | { type: "materialize" }
  | { type: "addCollection"; collectionId: string }
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

export interface MaterializeOptions {
  collectionIds?: string[];
  tags?: string[];
  targetFolderId?: string | null;
  storageMode?: AssetStorageMode | "library-default";
}

export interface MaterializeResult {
  /** 复用同路径记录的 assetId。 */
  asset: AssetRecord;
  /** 是否新建记录（false 表示同路径已入库，直接复用）。 */
  created: boolean;
  /** linked 未复制源文件；managed 完成完整 SHA-256 校验。 */
  copied: boolean;
  verified: boolean;
}

export interface FilesystemRenameResult {
  path: string;
  /** 该路径是否已入库（入库则同步 path/identity/白板引用/缩略图缓存，assetId 不变）。 */
  syncedAsset: AssetRecord | null;
}

export interface FolderLockStatus {
  collectionId: string;
  locked: boolean;
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

/** Time-point note attached to a video/audio asset. */
export interface MediaNote {
  id: string;
  assetId: string;
  /** Time in milliseconds from the start of the media. */
  timeMs: number;
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

export interface LibrarySummary {
  id: string;
  name: string;
  root: string;
  createdAt: string;
  defaultStorageMode: AssetStorageMode;
  isActive: boolean;
  assetCount: number;
  databaseBytes: number;
  /** True for the pre-existing `0.32` data directory kept in place. */
  legacy: boolean;
}

export interface MergeLibraryReport {
  sourceId: string;
  targetId: string;
  /** Assets created in the target library. */
  mergedAssets: number;
  /** Assets skipped because an identical hash+size already exists in the target. */
  deduplicated: number;
  /** Managed files physically copied into the target store. */
  copiedFiles: number;
  /** Link conflicts (same path already occupied) and unreadable sources. */
  conflicts: Array<{ path: string; reason: string }>;
  skipped: number;
  /** Operation-log file written into the target library, for rollback inspection. */
  logFile: string | null;
}

export interface LibraryVerifyReport {
  id: string;
  integrityOk: boolean;
  assets: number;
  managedFiles: number;
  managedMissing: number;
  orphanFiles: number;
  errors: string[];
}

export interface LibraryExportReport {
  id: string;
  destination: string;
  assets: number;
  files: number;
  databaseBytes: number;
  managedBytes: number;
}

export interface ReconcileCandidate {
  assetId: string;
  title: string;
  /** On-disk filename the candidate was found at, for user-confirmed relinks. */
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

export interface RefCanvasApi {
  library: {
    search(input?: AssetSearchInput): Promise<AssetPage>;
    searchWindow(input: AssetSearchWindowInput): Promise<AssetSearchWindow>;
    get(id: string): Promise<AssetRecord | null>;
    getByPath(path: string): Promise<AssetRecord | null>;
    pickAndImport(mode: "files" | "folder"): Promise<ImportResult | null>;
    importPaths(paths: string[]): Promise<ImportResult>;
    startImport(
      paths: string[],
      options?: ImportOptions,
    ): Promise<ImportJobSnapshot>;
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
    addWatchFolder(): Promise<ImportResult | null>;
    listWatchRoots(): Promise<WatchRoot[]>;
    removeWatchRoot(id: string): Promise<WatchRoot>;
    listCollections(): Promise<CollectionRecord[]>;
    createCollection(
      title: string,
      parentId?: string | null,
    ): Promise<CollectionRecord>;
    updateCollection(
      id: string,
      patch: { title?: string; parentId?: string | null; sortOrder?: number },
    ): Promise<CollectionRecord>;
    deleteCollection(id: string): Promise<void>;
    /** Batch create/rename/move/reorder folders in one call. */
    batchCollections(op: BatchCollectionOp): Promise<CollectionRecord[]>;
    setFolderLock(id: string, password: string | null): Promise<FolderLockStatus>;
    unlockFolder(id: string, password: string): Promise<boolean>;
    isFolderUnlocked(id: string): Promise<boolean>;
    addToCollection(assetId: string, collectionId: string): Promise<AssetRecord>;
    removeFromCollection(
      assetId: string,
      collectionId: string,
    ): Promise<AssetRecord>;
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
    stats(): Promise<LibraryStats>;
  };
  libraries: {
    list(): Promise<LibrarySummary[]>;
    current(): Promise<LibrarySummary | null>;
    create(options: { name: string; directory: string }): Promise<LibrarySummary>;
    /** Opens an existing library directory by manifest. */
    open(path: string): Promise<LibrarySummary>;
    switchTo(id: string): Promise<LibrarySummary>;
    move(id: string, newDirectory: string): Promise<LibrarySummary>;
    merge(sourceId: string, targetId: string): Promise<MergeLibraryReport>;
    verify(id: string): Promise<LibraryVerifyReport>;
    exportLibrary(
      id: string,
      destination: string,
    ): Promise<LibraryExportReport>;
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
    /** 展开目录下一层（游标分页）。 */
    listDirectory(
      path: string,
      options?: { cursor?: string; offset?: number; pageSize?: number },
    ): Promise<DirectoryPage>;
    onDirectoryProgress(
      callback: (snapshot: DirectoryProgressSnapshot) => void,
    ): () => void;
    locateEntry(path: string, entryPath: string, revision: string): Promise<number | null>;
    /** 目录搜索：当前层即时结果 + 子目录流式追加；更换路径/关键词自动取消旧任务。 */
    startSearch(path: string, query: string): Promise<string>;
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
    /** 未入库文件按需入库：复用同路径 assetId，仅计算 quick fingerprint。 */
    materialize(path: string, options?: MaterializeOptions): Promise<MaterializeResult>;
    /** 真实改名源文件并同步已入库记录（assetId 不变）。 */
    rename(path: string, newName: string): Promise<FilesystemRenameResult>;
    /** 删除未入库文件到系统回收站；已入库记录同步为 missing。 */
    trash(paths: string[]): Promise<void>;
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
    save(id: string, document: BoardDocument): Promise<BoardSummary>;
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
    /** Reports the main window's active board (for open-window dedupe). */
    setActive(id: string | null): Promise<boolean>;
    /** Closes the window this renderer lives in (board windows only). */
    closeWindow(): Promise<boolean>;
    /** Assets referenced by the board (for board-window initial state). */
    getAssets(id: string): Promise<AssetRecord[]>;
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
    create(assetId: string, input: { timeMs: number; text: string }): Promise<MediaNote>;
    update(id: string, patch: { timeMs?: number; text?: string }): Promise<MediaNote>;
    delete(id: string): Promise<void>;
    /** Persistent playback state for the given asset. */
    getPlaybackState(assetId: string): Promise<PlaybackState | null>;
    setPlaybackState(assetId: string, state: Partial<PlaybackState>): Promise<PlaybackState>;  };
  system: {
    openExternal(path: string): Promise<void>;
    /** Opens each file with the OS default app (batch). */
    openFilesWithDefaultApp(paths: string[]): Promise<void>;
    revealInFolder(path: string): Promise<void>;
    openDataFolder(): Promise<void>;
    pickDirectory(options: {
      title: string;
      defaultPath?: string;
    }): Promise<string | null>;
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
    captureClipboard(): Promise<AssetRecord | null>;
    prepareRegionCapture(): Promise<CaptureSource | null>;
    saveRegionCapture(dataUrl: string): Promise<ImportResult>;
    cancelRegionCapture(): Promise<void>;
    rebuildThumbnailCache(): Promise<void>;
    exportDiagnostics(): Promise<string | null>;
    setGlobalShortcuts(enabled: boolean): Promise<boolean>;
    /** 应用级偏好（非资料库级）。 */
    getPreferences(): Promise<AppPreferences>;
    setPreferences(prefs: AppPreferencesPatch): Promise<AppPreferences>;
    /** 关于页与版本信息，版本必须来自 app.getVersion()。 */
    getAppInfo(): Promise<AppInfo>;
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
