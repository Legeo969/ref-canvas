import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  AutoTagRule,
  AutoTagRulePreview,
  AssetKind,
  AssetRecord,
  DuplicateGroup,
  FilesystemRenameResult,
  ImportJobSnapshot,
  LibraryPreferences,
  LibraryChangedEvent,
  MaterializeResult,
  MediaMetadataSnapshot,
  PathMigrationReport,
  ReconcileReport,
  ReconcileSnapshot,
  RelinkResult,
  SelectionScope,
  SimilarAsset,
  SimilarityIndexSnapshot,
  WatchRoot,
} from "../../shared/contracts";
import type { NewAsset, RefCanvasDatabase } from "../persistence/database";
import { readMediaMetadata } from "./media-metadata";
import {
  LocalImportEnumerator,
  type EnumeratedImportPath,
  type ImportEnumerator,
} from "./import-enumerator";
import {
  ImportCoordinator,
  type ImportJob,
} from "./import-coordinator";
import { managedStorePath, browserCapturesPath } from "./library-manager";
import { MetadataEnricher } from "./metadata-enricher";
import { WatchReconcileService } from "./watch-reconcile-service";
import { specializedKindForExtension } from "../../shared/asset-kind";
import {
  imageVisualSignature,
  visualSimilarity,
} from "./visual-signature-service";
export { imageVisualSignature, visualSimilarity } from "./visual-signature-service";

/**
 * Files whose extension is not a specialized kind are imported as `generic`
 * when they are readable, so any local file can live in the library. Returns
 * undefined only for unreadable/unknown input (the caller keeps it as
 * unsupported).
 */
function kindForExtension(extension: string): AssetKind | undefined {
  return specializedKindForExtension(extension);
}

interface ImportCandidate {
  filename: string;
  watchRootPath?: string;
}

async function walk(root: string, signal?: AbortSignal): Promise<string[]> {
  const result: string[] = [];
  const directories = [root];
  let offset = 0;
  while (offset < directories.length) {
    if (signal?.aborted) break;
    const batch = directories.slice(offset, offset + 16);
    offset += batch.length;
    const listings = await Promise.all(
      batch.map(async (directory) => ({
        directory,
        entries: await readdir(directory, { withFileTypes: true }),
      })),
    );
    for (const listing of listings) {
      for (const entry of listing.entries) {
        const fullPath = path.join(listing.directory, entry.name);
        if (entry.isDirectory()) directories.push(fullPath);
        else if (entry.isFile()) result.push(fullPath);
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return result;
}

/**
 * Minimal glob matcher supporting `*` (any run of characters) and `?` (single
 * character), case-insensitive. Used by offline auto-tag rules against file
 * names. Characters are translated one by one so `*`/`?` are never escaped.
 */
export function globMatch(pattern: string, value: string): boolean {
  const source = value.toLocaleLowerCase("en-US");
  let regex = "^";
  for (const character of pattern.toLocaleLowerCase("en-US")) {
    if (character === "*") regex += ".*";
    else if (character === "?") regex += ".";
    else regex += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  regex += "$";
  return new RegExp(regex).test(source);
}

export function autoTagRuleMatches(
  rule: Pick<AutoTagRule, "filenamePattern" | "pathPattern" | "extension">,
  filename: string,
  directory: string,
  extension: string,
): boolean {
  return !(
    (rule.filenamePattern && !globMatch(rule.filenamePattern, filename)) ||
    (rule.pathPattern && !directory.toLocaleLowerCase("en-US").includes(
      rule.pathPattern.toLocaleLowerCase("en-US"),
    )) ||
    (rule.extension && extension !== rule.extension.toLowerCase())
  );
}

export async function quickFingerprint(
  filename: string,
  size: number,
): Promise<string> {
  const handle = await open(filename, "r");
  try {
    const chunkSize = Math.min(size, 64 * 1024);
    const first = Buffer.alloc(chunkSize);
    if (chunkSize) await handle.read(first, 0, chunkSize, 0);
    const hash = createHash("sha256");
    hash.update(String(size));
    hash.update(first);
    if (size > chunkSize) {
      const last = Buffer.alloc(chunkSize);
      await handle.read(last, 0, chunkSize, Math.max(0, size - chunkSize));
      hash.update(last);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export async function fullFileHash(filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function exists(filename: string): Promise<boolean> {
  try {
    await stat(filename);
    return true;
  } catch {
    return false;
  }
}

async function moveVerified(source: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await rename(source, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  const temporary = `${target}.${randomUUID()}.partial`;
  await copyFile(source, temporary);
  const [sourceHash, copiedHash] = await Promise.all([
    fullFileHash(source),
    fullFileHash(temporary),
  ]);
  if (sourceHash !== copiedHash) {
    await unlink(temporary).catch(() => undefined);
    throw new Error("FILE_COPY_VERIFICATION_FAILED");
  }
  await rename(temporary, target);
  await unlink(source);
}

async function availableRestorePath(original: string): Promise<string> {
  if (!(await exists(original))) return original;
  const extension = path.extname(original);
  const stem = extension ? original.slice(0, -extension.length) : original;
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (restored ${index})${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("RESTORE_NAME_EXHAUSTED");
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("IMPORT_CANCELLED"));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export class LibraryService {
  private readonly watchReconcile = new WatchReconcileService();
  private readonly events = new EventEmitter();
  /**
   * Paths the app is currently moving itself (e.g. into trash); the watcher
   * ignores events for them so it never reacts to our own file operations.
   */
  private readonly selfMovedPaths = new Set<string>();
  private similarityController: AbortController | null = null;
  private similaritySnapshot: SimilarityIndexSnapshot = {
    state: "idle",
    total: 0,
    processed: 0,
    indexed: 0,
    failed: 0,
  };
  private mediaMetadataController: AbortController | null = null;
  private mediaMetadataSnapshot: MediaMetadataSnapshot = {
    state: "idle",
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
  };
  private libraryRoot: string;
  private readonly managedStore: string;
  private readonly importEnumerator: ImportEnumerator;
  private readonly importCoordinator: ImportCoordinator;
  private readonly metadataEnricher: MetadataEnricher;
  private pendingMetadataController: AbortController | null = null;
  private lastReconcileReport: ReconcileReport | null = null;

  constructor(
    private readonly database: RefCanvasDatabase,
    private readonly trashRoot = path.join(
      path.dirname(database.filename === ":memory:" ? "." : database.filename),
      "trash",
      "files",
    ),
    options: {
      libraryRoot?: string;
      importEnumerator?: ImportEnumerator;
    } = {},
  ) {
    this.libraryRoot = path.resolve(
      options.libraryRoot ??
        path.dirname(database.filename === ":memory:" ? "." : database.filename),
    );
    this.managedStore = managedStorePath(this.libraryRoot);
    this.importEnumerator = options.importEnumerator ?? new LocalImportEnumerator();
    this.importCoordinator = new ImportCoordinator((snapshot) => {
      this.events.emit("import-progress", snapshot);
    });
    this.metadataEnricher = new MetadataEnricher(
      this.database,
      (filename, kind, signal) => this.extractMetadata(filename, kind, signal),
    );
  }

  getLibraryRoot(): string {
    return this.libraryRoot;
  }

  private static readonly defaultPreferences: LibraryPreferences = {
    layoutMode: "grid",
    cardSize: "medium",
    thumbnailBackground: "checker",
    includeSubfolderAssets: true,
    panelLayout: {
      sidebarWidth: 180,
      assetWidth: 280,
      detailsWidth: 1100,
      collapsed: [],
    },
  };

  getPreferences(): LibraryPreferences {
    const stored = this.database.getSetting<
      | (Partial<LibraryPreferences> & {
          __preferencesVersion?: number;
        })
      | null
    >("libraryPreferences", null);
    const preferences = {
      layoutMode: stored?.layoutMode ?? "grid",
      cardSize: stored?.cardSize ?? "medium",
      thumbnailBackground: stored?.thumbnailBackground ?? "checker",
      includeSubfolderAssets: stored?.includeSubfolderAssets ?? true,
      panelLayout: stored?.panelLayout ?? {
        ...LibraryService.defaultPreferences.panelLayout,
      },
    };
    // 0.33 → 0.34 一次性偏好迁移：includeSubfolderAssets 默认改为 true。
    // 该字段在 0.33 从未参与查询，不存在用户预期损失。
    if (
      stored &&
      stored.__preferencesVersion !== 2 &&
      stored.includeSubfolderAssets === false
    ) {
      preferences.includeSubfolderAssets = true;
      this.database.setSetting("libraryPreferences", {
        ...stored,
        ...preferences,
        __preferencesVersion: 2,
      });
    }
    return preferences;
  }

  setPreferences(prefs: Partial<LibraryPreferences>): LibraryPreferences {
    const current = this.getPreferences();
    const next = { ...current, ...prefs };
    this.database.setSetting("libraryPreferences", {
      ...next,
      __preferencesVersion: 2,
    });
    return next;
  }

  onImportProgress(
    listener: (snapshot: ImportJobSnapshot) => void,
  ): () => void {
    this.events.on("import-progress", listener);
    return () => this.events.off("import-progress", listener);
  }

  onLibraryChanged(listener: (event: LibraryChangedEvent) => void): () => void {
    this.events.on("library-changed", listener);
    return () => this.events.off("library-changed", listener);
  }

  private emitLibraryChanged(event: LibraryChangedEvent): void {
    this.events.emit("library-changed", structuredClone(event));
  }

  setCustomThumbnail(id: string, thumbnailPath: string | null): AssetRecord {
    const asset = this.database.setCustomThumbnail(id, thumbnailPath);
    this.emitLibraryChanged({ reason: "thumbnail", paths: [asset.path] });
    return asset;
  }

  onSimilarityProgress(
    listener: (snapshot: SimilarityIndexSnapshot) => void,
  ): () => void {
    this.events.on("similarity-progress", listener);
    return () => this.events.off("similarity-progress", listener);
  }

  private emitSimilarity(): void {
    this.events.emit(
      "similarity-progress",
      structuredClone(this.similaritySnapshot),
    );
  }

  getSimilarityIndex(): SimilarityIndexSnapshot {
    return structuredClone(this.similaritySnapshot);
  }

  startSimilarityIndex(): SimilarityIndexSnapshot {
    if (this.similaritySnapshot.state === "running") {
      return this.getSimilarityIndex();
    }
    const candidates = this.database.listImagesMissingVisualIndex();
    this.similarityController = new AbortController();
    this.similaritySnapshot = {
      state: candidates.length ? "running" : "completed",
      total: candidates.length,
      processed: 0,
      indexed: 0,
      failed: 0,
    };
    this.emitSimilarity();
    if (candidates.length) {
      void this.runSimilarityIndex(candidates, this.similarityController);
    }
    return this.getSimilarityIndex();
  }

  private async runSimilarityIndex(
    candidates: Array<{ id: string; path: string }>,
    controller: AbortController,
  ): Promise<void> {
    for (let index = 0; index < candidates.length; index += 4) {
      if (controller.signal.aborted) break;
      const batch = candidates.slice(index, index + 4);
      const results = await Promise.all(
        batch.map(async (candidate) => {
          try {
            return {
              candidate,
              signature: await imageVisualSignature(candidate.path),
            };
          } catch {
            return null;
          }
        }),
      );
      for (const result of results) {
        if (result) {
          this.database.setVisualSignature(
            result.candidate.id,
            result.signature.visualHash,
            result.signature.colorSignature,
            result.signature.dominantColor,
          );
          this.similaritySnapshot.indexed += 1;
        } else {
          this.similaritySnapshot.failed += 1;
        }
      }
      this.similaritySnapshot.processed += batch.length;
      this.emitSimilarity();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.similaritySnapshot.state = controller.signal.aborted
      ? "cancelled"
      : "completed";
    this.similarityController = null;
    this.emitSimilarity();
  }

  cancelSimilarityIndex(): boolean {
    if (!this.similarityController) return false;
    this.similarityController.abort();
    return true;
  }

  onMediaMetadataProgress(
    listener: (snapshot: MediaMetadataSnapshot) => void,
  ): () => void {
    this.events.on("media-metadata-progress", listener);
    return () => this.events.off("media-metadata-progress", listener);
  }

  private emitMediaMetadata(): void {
    this.events.emit(
      "media-metadata-progress",
      structuredClone(this.mediaMetadataSnapshot),
    );
  }

  getMediaMetadataRebuild(): MediaMetadataSnapshot {
    return structuredClone(this.mediaMetadataSnapshot);
  }

  startMediaMetadataRebuild(): MediaMetadataSnapshot {
    if (this.mediaMetadataSnapshot.state === "running") {
      return this.getMediaMetadataRebuild();
    }
    const candidates: AssetRecord[] = [];
    for (const kind of ["video", "audio"] as const) {
      let cursor: string | undefined;
      do {
        const page = this.database.searchAssets({
          kind,
          lifecycle: "active",
          pageSize: 500,
          cursor,
        });
        candidates.push(
          ...page.items.filter((asset) => asset.linkState === "online"),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    this.mediaMetadataController = new AbortController();
    this.mediaMetadataSnapshot = {
      state: candidates.length ? "running" : "completed",
      total: candidates.length,
      processed: 0,
      updated: 0,
      failed: 0,
    };
    this.emitMediaMetadata();
    if (candidates.length) {
      void this.runMediaMetadataRebuild(
        candidates,
        this.mediaMetadataController,
      );
    }
    return this.getMediaMetadataRebuild();
  }

  private async runMediaMetadataRebuild(
    candidates: AssetRecord[],
    controller: AbortController,
  ): Promise<void> {
    for (let index = 0; index < candidates.length; index += 2) {
      if (controller.signal.aborted) break;
      const batch = candidates.slice(index, index + 2);
      const results = await Promise.all(
        batch.map(async (asset) => {
          try {
            const next = await this.readAsset(asset.path, asset, {
              forceMediaMetadata: true,
              signal: controller.signal,
            });
            this.database.upsertAsset(next);
            return "updated" as const;
          } catch {
            return controller.signal.aborted
              ? ("cancelled" as const)
              : ("failed" as const);
          }
        }),
      );
      this.mediaMetadataSnapshot.processed += results.filter(
        (result) => result !== "cancelled",
      ).length;
      this.mediaMetadataSnapshot.updated += results.filter(
        (result) => result === "updated",
      ).length;
      this.mediaMetadataSnapshot.failed += results.filter(
        (result) => result === "failed",
      ).length;
      this.emitMediaMetadata();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.mediaMetadataSnapshot.state = controller.signal.aborted
      ? "cancelled"
      : "completed";
    this.mediaMetadataController = null;
    this.emitMediaMetadata();
  }

  cancelMediaMetadataRebuild(): boolean {
    if (!this.mediaMetadataController) return false;
    this.mediaMetadataController.abort();
    return true;
  }

  async findSimilar(
    id: string,
    options: { limit?: number; minScore?: number } = {},
  ): Promise<SimilarAsset[]> {
    const asset = this.database.getAsset(id);
    if (!asset || asset.kind !== "image") throw new Error("IMAGE_ASSET_REQUIRED");
    let source = this.database.getVisualSignature(id);
    if (!source) {
      const signature = await imageVisualSignature(asset.path);
      this.database.setVisualSignature(
        id,
        signature.visualHash,
        signature.colorSignature,
        signature.dominantColor,
      );
      source = signature;
    }
    if (this.similaritySnapshot.state !== "running") {
      this.startSimilarityIndex();
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const minScore = Math.min(Math.max(options.minScore ?? 70, 0), 100);
    // SPEC-4：分批消费签名并维护有界 top-N 堆，避免全库签名一次 materialize。
    const best: Array<{ id: string; score: number }> = [];
    const pushCandidate = (candidate: { id: string; score: number }): void => {
      if (candidate.score < minScore) return;
      best.push(candidate);
      best.sort((left, right) => right.score - left.score);
      if (best.length > limit) best.length = limit;
    };
    await this.database.forEachVisualSignature(256, (batch) => {
      for (const candidate of batch) {
        if (candidate.id === id) continue; // 排除源资产自身
        pushCandidate({
          id: candidate.id,
          score: visualSimilarity(source!, candidate),
        });
      }
    });
    return best
      .flatMap((candidate) => {
        const similar = this.database.getAsset(candidate.id);
        return similar ? [{ asset: similar, score: candidate.score }] : [];
      });
  }

  private async readAsset(
    filename: string,
    existing?: AssetRecord,
    options: {
      forceMediaMetadata?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<NewAsset> {
    const extension = path.extname(filename).toLowerCase();
    const kind = kindForExtension(extension) ?? "generic";
    if (existing && existing.kind !== kind && existing.kind !== "generic") {
      throw new Error("ASSET_KIND_MISMATCH");
    }
    const fileStat = await stat(filename);
    const unchanged =
      existing?.size === fileStat.size &&
      existing.mtimeMs === fileStat.mtimeMs;
    const fingerprint = unchanged
      ? Promise.resolve(existing.fingerprint)
      : quickFingerprint(filename, fileStat.size);
    let width: number | null = null;
    let height: number | null = null;
    let duration: number | null = null;
    let bpm: number | null = null;
    if (kind === "image") {
      if (unchanged && existing.width !== null && existing.height !== null) {
        width = existing.width;
        height = existing.height;
      } else {
        try {
          const metadata = await sharp(filename, {
            animated: false,
            failOn: "none",
          }).metadata();
          width = metadata.width ?? null;
          height = metadata.height ?? null;
        } catch {
          // Keep specialized formats indexable when Chromium cannot decode them.
        }
      }
      // GIF/APNG 是图片分类但属于动画：补一个真实时长，供预览进度条/时间码使用。
      if (extension === ".gif" || extension === ".apng") {
        if (unchanged && existing.duration != null) {
          duration = existing.duration;
        } else {
          try {
            const metadata = await readMediaMetadata(
              filename,
              undefined,
              options.signal,
            );
            duration = metadata.duration;
          } catch {
            // 保留 null；预览端仍会尝试 ffprobe/字节解析兜底。
          }
        }
      }
    } else if (kind === "video" || kind === "audio") {
      const reusable =
        !options.forceMediaMetadata &&
        unchanged &&
        existing.duration !== null &&
        (kind === "audio" ||
          (existing.width !== null && existing.height !== null));
      if (reusable) {
        width = existing.width;
        height = existing.height;
        duration = existing.duration;
        bpm = existing.bpm;
      } else {
        try {
          const metadata = await readMediaMetadata(
            filename,
            undefined,
            options.signal,
          );
          width = metadata.width;
          height = metadata.height;
          duration = metadata.duration;
          bpm = metadata.bpm;
        } catch {
          if (unchanged) {
            width = existing?.width ?? null;
            height = existing?.height ?? null;
            duration = existing?.duration ?? null;
            bpm = existing?.bpm ?? null;
          }
        }
      }
    }
    return {
      title: existing?.title ?? path.basename(filename, extension),
      kind,
      path: filename,
      pathKey: path.normalize(filename).toLocaleLowerCase("en-US"),
      extension: extension.slice(1),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      fingerprint: await fingerprint,
      linkState: "online",
      notes: existing?.notes ?? "",
      width,
      height,
      duration,
      metadataStatus: "ready",
      metadataError: null,
      metadataUpdatedAt: new Date().toISOString(),
      bpm,
      customFields: existing?.customFields ?? {},
    };
  }

  private async readAssetBase(
    filename: string,
    existing: AssetRecord | undefined,
    metadataJobId: string,
  ): Promise<NewAsset> {
    const extension = path.extname(filename).toLowerCase();
    const kind = kindForExtension(extension) ?? "generic";
    if (existing && existing.kind !== kind && existing.kind !== "generic") {
      throw new Error("ASSET_KIND_MISMATCH");
    }
    const fileStat = await stat(filename);
    const unchanged =
      existing?.size === fileStat.size && existing.mtimeMs === fileStat.mtimeMs;
    const reusableMetadata = unchanged && existing?.metadataStatus === "ready";
    const needsMetadata = kind === "image" || kind === "video" || kind === "audio";
    return {
      title: existing?.title ?? path.basename(filename, extension),
      kind,
      path: filename,
      pathKey: path.normalize(filename).toLocaleLowerCase("en-US"),
      extension: extension.slice(1),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      fingerprint: unchanged
        ? existing.fingerprint
        : await quickFingerprint(filename, fileStat.size),
      linkState: "online",
      notes: existing?.notes ?? "",
      width: reusableMetadata ? existing.width : null,
      height: reusableMetadata ? existing.height : null,
      duration: reusableMetadata ? existing.duration : null,
      bpm: reusableMetadata ? existing.bpm : null,
      customFields: existing?.customFields ?? {},
      metadataStatus: needsMetadata && !reusableMetadata ? "pending" : "ready",
      metadataError: null,
      metadataUpdatedAt: reusableMetadata ? existing.metadataUpdatedAt : null,
      metadataJobId: needsMetadata && !reusableMetadata ? metadataJobId : null,
    };
  }

  private async extractMetadata(
    filename: string,
    kind: AssetKind,
    signal?: AbortSignal,
  ): Promise<{
    width: number | null;
    height: number | null;
    duration: number | null;
    bpm: number | null;
  }> {
    if (kind === "image") {
      const metadata = await sharp(filename, {
        animated: false,
        failOn: "none",
      }).metadata();
      return {
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        duration: null,
        bpm: null,
      };
    }
    if (kind === "video" || kind === "audio") {
      return readMediaMetadata(filename, undefined, signal);
    }
    return { width: null, height: null, duration: null, bpm: null };
  }

  /**
   * Records the persistent file identity of an asset when it lives under one
   * of the watched roots or a registered mount root. The identity key is the
   * on-disk path, so later moves and renames can be confirmed by fingerprint.
   * Called after an asset is upserted (the asset id is only known then).
   */
  private updateIdentity(asset: AssetRecord): void {
    // watch roots 与 mount roots 都是合法身份根（§7.2）。
    const roots = [
      ...this.database.listWatchRoots(),
      ...this.database.listMountRoots(),
    ];
    const match = roots.find(
      (item) =>
        asset.path === item.path ||
        asset.path.startsWith(`${item.path}${path.sep}`),
    );
    if (!match) return;
    this.database.upsertFileIdentity({
      pathKey: path.normalize(asset.path).toLocaleLowerCase("en-US"),
      assetId: asset.id,
      fingerprint: asset.fingerprint,
      size: asset.size,
      rootPath: path.resolve(match.path),
      mountId: match.id,
    });
  }

  private async runImport(job: ImportJob): Promise<void> {
    const { snapshot, controller } = job;
    // 磁盘唯一真相：导入恒为 linked（磁盘原生，计划 §13.2 退役 managed）。
    try {
      snapshot.state = "scanning";
      this.importCoordinator.emit(job);
      const watchRootEntries = this.database.listWatchRoots();
      const watchRoots = watchRootEntries
        .map((item) => path.resolve(item.path))
        .sort((left, right) => right.length - left.length);
      const mountIdByRoot = new Map(
        watchRootEntries.map((item) => [path.resolve(item.path), item.id]),
      );
      await this.importEnumerator.enumerate(
        snapshot.sourcePaths,
        controller.signal,
        async (items: EnumeratedImportPath[]) => {
          if (controller.signal.aborted) return;
          snapshot.discovered += items.length;
          if (snapshot.state !== "processing") {
            snapshot.state = "processing";
            this.importCoordinator.emit(job);
          }
          const candidates: ImportCandidate[] = items.map((item) => {
            const watchRootPath = watchRoots.find(
              (root) =>
                item.filename === root || item.filename.startsWith(`${root}${path.sep}`),
            );
            return {
              filename: item.filename,
              ...(watchRootPath ? { watchRootPath } : {}),
            };
          });
          for (let transactionOffset = 0; transactionOffset < candidates.length; transactionOffset += 256) {
            controller.signal.throwIfAborted();
            const transactionCandidates = candidates.slice(transactionOffset, transactionOffset + 256);
            const inspected: Array<{
              candidate: ImportCandidate;
              asset: NewAsset;
            }> = [];
            for (let readOffset = 0; readOffset < transactionCandidates.length; readOffset += 12) {
              const readBatch = transactionCandidates.slice(readOffset, readOffset + 12);
              const results = await Promise.all(readBatch.map(async (candidate) => {
                try {
                   const existing = this.database.getAssetBaseByPath(candidate.filename) ?? undefined;
                   const linked = await abortable(
                     this.readAssetBase(candidate.filename, existing, snapshot.id),
                     controller.signal,
                   );
                  // 恒为 linked：不复制源文件（计划 §13.2）。
                  return { candidate, asset: linked };
                } catch (error) {
                  snapshot.failed.push({
                    path: candidate.filename,
                    reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
                  });
                  return null;
                }
              }));
              inspected.push(...results.filter((item): item is NonNullable<typeof item> => item !== null));
            }
            const savedAssets = this.database.upsertAssets(inspected.map((item) => item.asset));
            const identities: Array<{
              pathKey: string;
              assetId: string;
              fingerprint: string;
              size: number;
              rootPath: string;
              mountId?: string | null;
            }> = [];
            for (let index = 0; index < savedAssets.length; index += 1) {
              const saved = savedAssets[index];
              const item = inspected[index];
              if (saved.reused) snapshot.reused += 1;
              else {
                snapshot.imported += 1;
                this.applyAutoTagsToAsset(saved.asset);
              }
              if (item.candidate.watchRootPath) {
                identities.push({
                  pathKey: path.normalize(saved.asset.path).toLocaleLowerCase("en-US"),
                  assetId: saved.asset.id,
                  fingerprint: saved.asset.fingerprint,
                  size: saved.asset.size,
                  rootPath: item.candidate.watchRootPath,
                  mountId: mountIdByRoot.get(item.candidate.watchRootPath) ?? null,
                });
              }
            }
            if (identities.length) this.database.upsertFileIdentities(identities);
            snapshot.processed += savedAssets.length;
            this.importCoordinator.emit(job, false);
          }
        },
      );
      if (controller.signal.aborted) {
        snapshot.state = "cancelled";
      } else {
        snapshot.state = "enriching";
        this.importCoordinator.emit(job);
        await this.metadataEnricher.run(
          snapshot.id,
          controller.signal,
          ({ enriched, failed }) => {
            snapshot.enriched += enriched;
            snapshot.metadataFailed += failed;
            this.importCoordinator.emit(job, false);
          },
        );
        snapshot.state = controller.signal.aborted ? "cancelled" : "completed";
      }
    } catch (error) {
      if (controller.signal.aborted) snapshot.state = "cancelled";
      else {
        snapshot.state = "failed";
        snapshot.failed.push({
          path: snapshot.sourcePaths.join("; "),
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
      }
    } finally {
      snapshot.completedAt = new Date().toISOString();
      this.importCoordinator.emit(job, true);
    }
  }

  resumePendingMetadata(): void {
    this.pendingMetadataController?.abort();
    this.database.resetFailedAssetMetadata();
    const controller = new AbortController();
    this.pendingMetadataController = controller;
    this.importCoordinator.enqueue(() =>
      this.metadataEnricher.run(undefined, controller.signal));
  }

  startImport(inputPaths: string[]): ImportJobSnapshot {
    const job = this.importCoordinator.create(inputPaths);
    this.importCoordinator.enqueueJob(job, (next) => this.runImport(next));
    return structuredClone(job.snapshot);
  }

  getImportJob(id: string): ImportJobSnapshot | null {
    return this.importCoordinator.snapshot(id);
  }

  listImportJobs(): ImportJobSnapshot[] {
    return this.importCoordinator.list();
  }

  cancelImport(id: string): boolean {
    return this.importCoordinator.cancel(id);
  }

  retryImport(id: string): ImportJobSnapshot {
    const retry = this.importCoordinator.retryInput(id);
    return this.startImport(retry);
  }

  async importPaths(inputPaths: string[]): Promise<ImportJobSnapshot> {
    const snapshot = this.startImport(inputPaths);
    return new Promise((resolve) => {
      const unsubscribe = this.onImportProgress((next) => {
        if (next.id !== snapshot.id) return;
        if (!["completed", "cancelled", "failed"].includes(next.state)) return;
        unsubscribe();
        resolve(next);
      });
    });
  }

  async relinkAsset(id: string, filename: string): Promise<AssetRecord> {
    const current = this.database.getAsset(id);
    if (!current) throw new Error("ASSET_NOT_FOUND");
    const resolved = path.resolve(filename);
    const next = await this.readAsset(resolved, current);
    const asset = this.database.relinkAsset(id, next);
    this.updateIdentity(asset);
    return asset;
  }

  /**
   * 按需入库一个未导入文件（预览式浏览的 materialize）：
   * 磁盘唯一真相——同路径复用 assetId；只计算 quick fingerprint，完整
   * SHA-256 仅用于主动完整性校验；不创建文件夹层级，绝不复制源文件
   * （materialize 恒为 linked 引用索引，§13.4 已移除 options）。
   */
  async materializePath(filename: string): Promise<MaterializeResult> {
    const resolved = path.resolve(filename);
    const existing = this.database.getAssetByPath(resolved);
    const next = await this.readAsset(resolved, existing ?? undefined);
    const result = this.database.upsertAsset(next);
    const asset = result.asset;
    this.updateIdentity(asset);
    if (!existing) this.applyAutoTagsToAsset(asset);
    // 重新读取以反映索引后的最新记录。
    const fresh = this.database.getAsset(asset.id)!;
    return { asset: fresh, created: !existing };
  }

  /**
   * 真实改名源文件并同步已入库记录：assetId、白板引用（id-keyed）不变，
   * path/path_key/file identity 同步更新；返回改名后的路径与（若有）被
   * 同步的素材记录。
   */
  async renameSourceFile(
    filename: string,
    newName: string,
  ): Promise<FilesystemRenameResult> {
    const resolved = path.resolve(filename);
    const directory = path.dirname(resolved);
    const extension = path.extname(resolved);
    const name = newName.trim();
    if (!name || /[\\/:*?"<>|]/.test(name)) {
      throw new Error("INVALID_FILENAME");
    }
    const target = path.join(
      directory,
      name.toLowerCase().endsWith(extension.toLowerCase())
        ? name
        : `${name}${extension}`,
    );
    if (target === resolved) return { path: resolved, syncedAsset: null };
    if (await exists(target)) throw new Error("TARGET_EXISTS");
    await rename(resolved, target);
    const existing = this.database.getAssetByPath(resolved);
    if (!existing) return { path: target, syncedAsset: null };
    const synced = await this.relinkAsset(existing.id, target);
    return { path: target, syncedAsset: synced };
  }

  async searchAndRelink(id: string, root: string): Promise<RelinkResult> {    const asset = this.database.getAsset(id);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    this.database.setLinkState(id, "searching");
    const files = await walk(path.resolve(root));
    const originalName = path.basename(asset.path).toLocaleLowerCase("en-US");
    const nameMatches = files.filter(
      (filename) => path.basename(filename).toLocaleLowerCase("en-US") === originalName,
    );
    const fingerprintMatches: string[] = [];
    const scan = nameMatches.length ? nameMatches : files;
    for (const filename of scan) {
      const candidateKind = kindForExtension(path.extname(filename).toLowerCase());
      if (asset.kind === "generic") {
        if (candidateKind !== undefined && candidateKind !== "generic") continue;
      } else if (candidateKind !== asset.kind) {
        continue;
      }
      try {
        const fileStat = await stat(filename);
        if (
          fileStat.size === asset.size &&
          (await quickFingerprint(filename, fileStat.size)) === asset.fingerprint
        ) {
          fingerprintMatches.push(filename);
          if (fingerprintMatches.length > 1) break;
        }
      } catch {
        // Ignore candidates that disappear while scanning.
      }
    }
    const candidates = fingerprintMatches.length ? fingerprintMatches : nameMatches;
    if (candidates.length === 1) {
      return {
        status: "relinked",
        asset: await this.relinkAsset(id, candidates[0]),
        candidates: 1,
      };
    }
    const status = candidates.length > 1 ? "ambiguous" : "not-found";
    this.database.setLinkState(id, status === "ambiguous" ? status : "missing");
    return {
      status,
      asset: this.database.getAsset(id)!,
      candidates: candidates.length,
    };
  }

  async addWatchRoot(root: string): Promise<WatchRoot> {
    const resolved = path.resolve(root);
    if (!(await stat(resolved)).isDirectory()) throw new Error("WATCH_ROOT_NOT_DIRECTORY");
    const watchRoot = this.database.addWatchRoot(resolved);
    // 同一目录作为 mount root 注册（计划 §7.2）：watch root 即挂载根。
    this.database.upsertMountRoot({
      id: watchRoot.id,
      path: resolved,
      displayName: path.basename(resolved) || resolved,
      state: "online",
    });
    if (this.watchReconcile.active) this.watchReconcile.addRoot(watchRoot);
    else await this.startWatching();
    void this.importPaths([resolved]);
    return watchRoot;
  }

  async removeWatchRoot(id: string): Promise<WatchRoot> {
    const root = this.database.removeWatchRoot(id);
    await this.watchReconcile.removeRoot(root.path);
    // Drop stale identity rows so a removed root never resurrects records.
    this.database
      .listFileIdentitiesByRoot(path.resolve(root.path))
      .forEach((identity) =>
        this.database.deleteFileIdentity(identity.pathKey),
      );
    return root;
  }

  /**
   * Fingerprint-keyed cache of the most recent unlinks, used to recognize a
   * move live (unlink + add within the window) and relink instead of creating
   * a duplicate record. Cap of 10,000 entries guards memory on huge trees.
   */
  private readonly recentUnlinks = new Map<
    string,
    { assetId: string; at: number }
  >();

  private rememberUnlink(asset: AssetRecord): void {
    const key = `${asset.fingerprint}:${asset.size}`;
    const now = Date.now();
    this.recentUnlinks.set(key, { assetId: asset.id, at: now });
    if (this.recentUnlinks.size > 10_000) {
      const oldest = [...this.recentUnlinks.entries()].sort(
        (left, right) => left[1].at - right[1].at,
      )[0];
      if (oldest) this.recentUnlinks.delete(oldest[0]);
    }
  }

  private async tryRelinkFromRecentUnlink(filename: string): Promise<boolean> {
    try {
      const fileStat = await stat(filename);
      const fingerprint = await quickFingerprint(filename, fileStat.size);
      const match = this.recentUnlinks.get(`${fingerprint}:${fileStat.size}`);
      if (!match) return false;
      if (Date.now() - match.at > 60_000) {
        this.recentUnlinks.delete(`${fingerprint}:${fileStat.size}`);
        return false;
      }
      const asset = this.database.getAsset(match.assetId);
      if (!asset || asset.lifecycle !== "active") return false;
      await this.relinkAsset(asset.id, filename);
      this.recentUnlinks.delete(`${fingerprint}:${fileStat.size}`);
      return true;
    } catch {
      return false;
    }
  }

  async startWatching(): Promise<void> {
    const roots = this.database.listWatchRoots();
    if (!roots.length || this.watchReconcile.active) return;
    await this.watchReconcile.start(roots, {
      onAdd: (filename) => {
        if (this.selfMovedPaths.has(path.normalize(filename))) return;
        void this.tryRelinkFromRecentUnlink(filename).then((relinked) => {
          if (!relinked) void this.importPaths([filename]);
        });
      },
      onChange: (filename) => {
        if (!this.selfMovedPaths.has(path.normalize(filename))) {
          void this.importPaths([filename]);
        }
      },
      onUnlink: (filename) => {
        if (this.selfMovedPaths.has(path.normalize(filename))) return;
        const asset = this.database.getAssetByPath(filename);
        if (!asset) return;
        this.rememberUnlink(asset);
        this.database.setLinkStateByPath(filename, "missing");
        this.emitLibraryChanged({ reason: "watch", paths: [filename] });
      },
      onDirectoryChange: (filename) => {
        this.emitLibraryChanged({ reason: "watch", paths: [filename] });
      },
      onNativePath: (filename, _resolvedRoot) => {
        if (this.selfMovedPaths.has(path.normalize(filename))) return;
        void stat(filename)
          .then(async (fileStat) => {
            if (fileStat.isDirectory()) {
              await this.importPaths([filename]);
              return;
            }
            if (!fileStat.isFile()) return;
            const relinked = await this.tryRelinkFromRecentUnlink(filename);
            if (!relinked) await this.importPaths([filename]);
          })
          .catch(() => {
            const asset = this.database.getAssetByPath(filename);
            if (!asset) return;
            this.rememberUnlink(asset);
            this.database.setLinkStateByPath(filename, "missing");
            this.emitLibraryChanged({ reason: "watch", paths: [filename] });
          });
      },
      onError: (rootId) => {
        void this.reconcileRoots(rootId);
      },
    });
  }
  async refreshLinkStates(): Promise<number> {
    let missing = 0;
    // SPEC-4：分批消费，避免几十万资产路径一次全量加载。
    await this.database.forEachActiveAssetPath(256, async (assets) => {
      for (const asset of assets) {
        try {
          await stat(asset.path);
          this.database.setLinkState(asset.id, "online");
        } catch {
          this.database.setLinkState(asset.id, "missing");
          missing += 1;
        }
      }
    });
    this.emitLibraryChanged({ reason: "reconcile", paths: [] });
    return missing;
  }

  private trashPathFor(asset: AssetRecord): string {
    return path.join(this.trashRoot, asset.id, path.basename(asset.path));
  }

  /**
   * Removes asset records from the library without moving any source file.
   *
   * Only the record is removed; the external source file is never modified
   * (this is the "从资料库移除" command). Records still referenced by boards are
   * kept as purged records so canvases keep loading.
   */
  async removeFromLibrary(scope: SelectionScope): Promise<number> {
    let removed = 0;
    // SPEC-4：分批消费 selection，避免几十万资产一次 materialize。
    await this.database.forEachSelectionId(scope, 256, async (ids) => {
      for (const id of ids) {
        const asset = this.database.getAsset(id);
        if (!asset || asset.lifecycle !== "active") continue;
        this.database.deleteFileIdentityByAsset(id);
        this.database.purgeRecord(id);
        removed += 1;
      }
    });
    return removed;
  }

  async trashAssets(scope: SelectionScope): Promise<number> {
    // SPEC-4：分批消费 selection，逐批回收，避免几十万资产一次 materialize。
    let moved = 0;
    await this.database.forEachSelectionId(scope, 256, async (ids) => {
      const entries = ids.map((id) => ({
        id,
        sourcePath: this.database.getAsset(id)?.path ?? "",
      }));
      moved += await this.trashAssetsByAuthorizedPaths(entries);
    });
    return moved;
  }

  async trashAssetsByAuthorizedPaths(
    entries: Array<{ id: string; sourcePath: string }>,
    finalGuard?: (filename: string) => Promise<string>,
  ): Promise<number> {
    let moved = 0;
    for (const { id, sourcePath: authorizedSource } of entries) {
      const asset = this.database.getAsset(id);
      if (!asset || asset.lifecycle !== "active" || !authorizedSource) continue;
      const sourcePath = finalGuard ? await finalGuard(authorizedSource) : authorizedSource;
      const target = this.trashPathFor(asset);
      const operationId = this.database.recordFileOperation(
        id,
        "trash",
        sourcePath,
        target,
      );
      this.selfMovedPaths.add(path.normalize(sourcePath));
      try {
        await moveVerified(sourcePath, target);
        this.database.markTrashed(id, target);
        this.database.completeFileOperation(operationId);
        moved += 1;
      } finally {
        setTimeout(() => this.selfMovedPaths.delete(path.normalize(sourcePath)), 1_000);
      }
    }
    return moved;
  }

  async restoreAssets(ids: string[]): Promise<number> {
    return this.restoreAssetsFromPlan(await this.planRestoreAssets(ids));
  }

  async planRestoreAssets(ids: string[]): Promise<Array<{
    id: string;
    sourcePath: string;
    targetPath: string;
  }>> {
    const result = [];
    for (const id of ids) {
      const asset = this.database.getAsset(id);
      if (!asset?.trashPath || asset.lifecycle !== "trashed") continue;
      result.push({ id, sourcePath: asset.trashPath, targetPath: await availableRestorePath(asset.path) });
    }
    return result;
  }

  async restoreAssetsFromPlan(plans: Array<{
    id: string;
    sourcePath: string;
    targetPath: string;
  }>, finalGuard?: (sourcePath: string, targetPath: string) => Promise<{
    sourcePath: string;
    targetPath: string;
  }>): Promise<number> {
    let restored = 0;
    for (const plan of plans) {
      const { id } = plan;
      const asset = this.database.getAsset(id);
      if (!asset?.trashPath || asset.lifecycle !== "trashed") continue;
      const guarded = finalGuard
        ? await finalGuard(plan.sourcePath, plan.targetPath)
        : plan;
      const { sourcePath, targetPath } = guarded;
      const operationId = this.database.recordFileOperation(
        id,
        "restore",
        sourcePath,
        targetPath,
      );
      await moveVerified(sourcePath, targetPath);
      this.database.markRestored(id, targetPath);
      this.database.completeFileOperation(operationId);
      restored += 1;
    }
    return restored;
  }

  async purgeAssets(ids: string[]): Promise<number> {
    return this.purgeAssetsByAuthorizedPaths(ids.map((id) => ({
      id,
      trashPath: this.database.getAsset(id)?.trashPath ?? "",
    })));
  }

  async purgeAssetsByAuthorizedPaths(
    entries: Array<{ id: string; trashPath: string }>,
  ): Promise<number> {
    let purged = 0;
    for (const { id, trashPath } of entries) {
      const asset = this.database.getAsset(id);
      if (!asset || asset.lifecycle !== "trashed") continue;
      const operationId = this.database.recordFileOperation(
        id,
        "purge",
        trashPath,
        "",
      );
      if (trashPath) await unlink(trashPath).catch(() => undefined);
      this.database.markPurged(id);
      this.database.completeFileOperation(operationId);
      purged += 1;
    }
    return purged;
  }

  /** Clears trashed records while leaving their files untouched on disk. */
  async forgetTrashedAssets(ids: string[]): Promise<number> {
    let forgotten = 0;
    for (const id of ids) {
      const asset = this.database.getAsset(id);
      if (!asset || asset.lifecycle !== "trashed") continue;
      this.database.purgeRecord(id);
      forgotten += 1;
    }
    return forgotten;
  }

  async recoverPendingOperations(): Promise<void> {
    for (const operation of this.database.listPendingFileOperations()) {
      const sourceExists = operation.sourcePath
        ? await exists(operation.sourcePath)
        : false;
      const targetExists = operation.targetPath
        ? await exists(operation.targetPath)
        : false;
      if (operation.operation === "trash" && targetExists && !sourceExists) {
        this.database.markTrashed(operation.assetId, operation.targetPath);
      } else if (operation.operation === "restore" && targetExists && !sourceExists) {
        this.database.markRestored(operation.assetId, operation.targetPath);
      } else if (operation.operation === "purge" && !sourceExists) {
        this.database.markPurged(operation.assetId);
      }
      this.database.completeFileOperation(operation.id);
    }
  }

  async findDuplicates(): Promise<DuplicateGroup[]> {
    for (const group of this.database.listDuplicateCandidates()) {
      for (const id of group.ids) {
        const asset = this.database.getAsset(id);
        if (!asset || asset.contentHash) continue;
        const filename = this.database.getAssetPath(id);
        if (filename) this.database.setContentHash(id, await fullFileHash(filename));
      }
    }
    return this.database.listDuplicateGroups();
  }

  async mergeDuplicates(
    keepId: string,
    removeIds: string[],
    authorizedPaths?: Map<string, string>,
    finalGuard?: (filename: string) => Promise<string>,
  ): Promise<AssetRecord> {
    const keep = this.database.getAsset(keepId);
    if (!keep) throw new Error("ASSET_NOT_FOUND");
    const keepPath = this.database.getAssetPath(keepId);
    if (!keepPath) throw new Error("ASSET_FILE_NOT_FOUND");
    const keepHash = keep.contentHash ?? await fullFileHash(keepPath);
    this.database.setContentHash(keepId, keepHash);
    const removed: string[] = [];
    try {
      for (const id of removeIds) {
        const asset = this.database.getAsset(id);
        const filename = this.database.getAssetPath(id);
        if (!asset || !filename) throw new Error("ASSET_FILE_NOT_FOUND");
        const hash = asset.contentHash ?? await fullFileHash(filename);
        if (hash !== keepHash || asset.size !== keep.size) {
          throw new Error("DUPLICATE_HASH_MISMATCH");
        }
        this.database.setContentHash(id, hash);
        await this.trashAssetsByAuthorizedPaths([{
          id,
          sourcePath: authorizedPaths?.get(id) ?? filename,
        }], finalGuard);
        removed.push(id);
      }
      return this.database.mergeAssetRecords(keepId, removeIds);
    } catch (error) {
      await this.restoreAssets(removed);
      throw error;
    }
  }

  async migratePaths(fromRoot: string, toRoot: string): Promise<PathMigrationReport> {
    const report: PathMigrationReport = {
      updated: 0,
      missing: 0,
      conflicts: 0,
      skipped: 0,
    };
    const normalizedFrom = path.resolve(fromRoot);
    const normalizedTo = path.resolve(toRoot);
    // SPEC-4：分批消费，避免几十万资产路径一次全量加载。
    await this.database.forEachActiveAssetPath(256, async (assets) => {
      for (const item of assets) {
        const relative = path.relative(normalizedFrom, item.path);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          report.skipped += 1;
          continue;
        }
        const target = path.join(normalizedTo, relative);
        if (!(await exists(target))) {
          report.missing += 1;
          continue;
        }
        const conflicting = this.database.getAssetByPath(target);
        if (conflicting && conflicting.id !== item.id) {
          report.conflicts += 1;
          continue;
        }
        await this.relinkAsset(item.id, target);
        report.updated += 1;
      }
    });
    return report;
  }

  /**
   * Full reconciliation of the persistent identity index against the current
   * contents of the watched roots.
   *
   * Handles the cases live watcher events cannot cover: events interrupted
   * while the app was closed, moves that happened while the app was offline,
   * and moves that raced with each other. Identity is confirmed with a full
   * quick fingerprint (head+tail SHA-256); ambiguous cases are parked in the
   * deferred reconcile queue for the user instead of auto-creating duplicate
   * records.
   */
  async reconcileRoots(rootId?: string | null): Promise<ReconcileReport> {
    const roots = rootId
      ? this.database.listWatchRoots().filter((item) => item.id === rootId)
      : this.database.listWatchRoots();
    const report: ReconcileReport = {
      rootId: rootId ?? null,
      scanned: 0,
      relinked: 0,
      imported: 0,
      missing: 0,
      ambiguous: 0,
      unchanged: 0,
    };
    for (const root of roots) {
      const rootPath = path.resolve(root.path);
      const files = await walk(rootPath);
      report.scanned += files.length;
      const byFingerprint = new Map<string, string[]>();
      for (const filename of files) {
        try {
          const fileStat = await stat(filename);
          const fingerprint = await quickFingerprint(filename, fileStat.size);
          const key = `${fingerprint}:${fileStat.size}`;
          const bucket = byFingerprint.get(key) ?? [];
          bucket.push(filename);
          byFingerprint.set(key, bucket);
        } catch {
          // Files that vanish mid-scan are simply absent from the index.
        }
      }
      const claimed = new Map<string, string>();
      const claimedAssets = new Set<string>();
      for (const identity of this.database.listFileIdentitiesByRoot(rootPath)) {
        const asset = this.database.getAsset(identity.assetId);
        if (!asset) {
          this.database.deleteFileIdentity(identity.pathKey);
          continue;
        }
        if (await exists(asset.path)) {
          report.unchanged += 1;
          claimed.set(path.normalize(asset.path), asset.id);
          claimedAssets.add(asset.id);
          // 挂载恢复：原路径仍在的 asset 重新置为 online（§7.5）。
          if (asset.linkState !== "online") {
            this.database.setLinkState(asset.id, "online");
          }
          continue;
        }
        const candidates = byFingerprint.get(
          `${identity.fingerprint}:${identity.size}`,
        ) ?? [];
        const unclaimed = candidates.filter(
          (filename) => !claimed.has(path.normalize(filename)),
        );
        if (unclaimed.length === 0) {
          report.missing += 1;
          this.database.setLinkState(identity.assetId, "missing");
        } else if (unclaimed.length === 1) {
          await this.relinkAsset(asset.id, unclaimed[0]);
          claimed.set(path.normalize(unclaimed[0]), asset.id);
          claimedAssets.add(asset.id);
          this.database.deleteFileIdentity(identity.pathKey);
          this.updateIdentity(this.database.getAsset(asset.id)!);
          report.relinked += 1;
        } else {
          report.ambiguous += 1;
          for (const filename of unclaimed) {
            this.database.enqueueReconcileEntry({
              rootPath,
              eventType: "unlink",
              filename,
              assetId: asset.id,
              candidates: [],
            });
          }
        }
      }
      for (const [key, filenames] of byFingerprint) {
        const [fingerprint, sizeText] = key.split(":");
        for (const filename of filenames) {
          if (claimed.has(path.normalize(filename))) continue;
          const matches = this.database
            .findIdentityByFingerprint(fingerprint, Number(sizeText))
            .filter((item) => this.database.getAsset(item.assetId))
            .filter((item) => !claimedAssets.has(item.assetId));
          if (matches.length === 0) {
            // Genuinely new file: import it (watch-root import keeps linking).
            await this.importPaths([filename]);
            report.imported += 1;
          } else if (matches.length === 1) {
            await this.relinkAsset(matches[0].assetId, filename);
            claimed.set(path.normalize(filename), matches[0].assetId);
            claimedAssets.add(matches[0].assetId);
            report.relinked += 1;
          } else {
            report.ambiguous += 1;
            const assets = matches.map((item) => this.database.getAsset(item.assetId)!);
            this.database.enqueueReconcileEntry({
              rootPath,
              eventType: "add",
              filename,
              assetId: null,
              candidates: assets.map((asset) => ({
                assetId: asset.id,
                title: asset.title,
                path: filename,
              })),
            });
          }
        }
      }
    }
    this.database.deleteResolvedReconcileEntries();
    this.lastReconcileReport = report;
    if (report.relinked || report.imported || report.missing) {
      this.emitLibraryChanged({ reason: "reconcile", paths: [] });
    }
    return report;
  }

  getReconcileSnapshot(): ReconcileSnapshot {
    return {
      report: this.lastReconcileReport,
      pending: this.database.listReconcileEntries("pending"),
    };
  }

  /**
   * User confirmation for an ambiguous move parked in the reconcile queue.
   *
   * - `unlink` entries: the known asset is relinked to the entry's candidate
   *   file; sibling entries for the same asset are dropped.
   * - `add` entries: the chosen candidate asset claims the new file; sibling
   *   entries for the same file are dropped.
   */
  async resolveReconcileConflict(
    entryId: string,
    assetId: string,
  ): Promise<AssetRecord> {
    const entry = this.database
      .listReconcileEntries("pending")
      .find((item) => item.id === entryId);
    if (!entry) throw new Error("RECONCILE_ENTRY_NOT_FOUND");
    let resolved: AssetRecord;
    if (entry.eventType === "unlink") {
      const targetAsset = this.database.getAsset(entry.assetId ?? assetId);
      if (!targetAsset) throw new Error("ASSET_NOT_FOUND");
      resolved = await this.relinkAsset(targetAsset.id, entry.filename);
      const siblings = this.database
        .listReconcileEntries("pending")
        .filter((item) => item.assetId === targetAsset.id);
      for (const sibling of siblings) {
        this.database.dropReconcileEntry(sibling.id);
      }
    } else {
      resolved = await this.relinkAsset(assetId, entry.filename);
      const siblings = this.database
        .listReconcileEntries("pending")
        .filter((item) => item.filename === entry.filename);
      for (const sibling of siblings) {
        this.database.dropReconcileEntry(sibling.id);
      }
    }
    this.database.markReconcileEntryResolved(entry.id, resolved.id);
    return resolved;
  }

  /**
   * Applies every enabled auto-tag rule to all active assets. Rules match on
   * file name (glob), directory path (substring) and extension; hits merge
   * tags onto the asset. Returns the number of assets that gained tags.
   */
  async applyAutoTagRules(): Promise<number> {
    const rules = this.database
      .listAutoTagRules()
      .filter((rule) => rule.enabled && rule.tags.length > 0);
    if (!rules.length) return 0;
    let tagged = 0;
    // SPEC-4：分批消费 active assets，避免几十万资产一次全量 materialize。
    await this.database.forEachActiveAsset(256, (assets) => {
      for (const asset of assets) {
        const filename = path.basename(asset.path);
        const directory = path.dirname(asset.path);
        const matched = new Set<string>();
        for (const rule of rules) {
          if (!autoTagRuleMatches(rule, filename, directory, asset.extension)) continue;
          for (const tag of rule.tags) matched.add(tag);
        }
        if (!matched.size) continue;
        const combined = [...new Set([...asset.tags, ...matched])];
        if (combined.length !== asset.tags.length) {
          this.database.setAssetTags(asset.id, combined);
          tagged += 1;
        }
      }
    });
    return tagged;
  }

  private applyAutoTagsToAsset(asset: AssetRecord): boolean {
    const filename = path.basename(asset.path);
    const directory = path.dirname(asset.path);
    const matched = new Set<string>();
    for (const rule of this.database.listAutoTagRules()) {
      if (!rule.enabled || rule.tags.length === 0) continue;
      if (!autoTagRuleMatches(rule, filename, directory, asset.extension)) continue;
      for (const tag of rule.tags) matched.add(tag);
    }
    if (matched.size === 0) return false;
    const combined = [...new Set([...asset.tags, ...matched])];
    if (combined.length === asset.tags.length) return false;
    this.database.setAssetTags(asset.id, combined);
    return true;
  }

  previewAutoTagRule(
    rule: Omit<AutoTagRule, "id" | "createdAt" | "updatedAt">,
    sampleLimit = 12,
  ): AutoTagRulePreview {
    let total = 0;
    const samples: AutoTagRulePreview["samples"] = [];
    this.database.forEachActiveAsset(256, (assets) => {
      for (const asset of assets) {
        if (!autoTagRuleMatches(
          rule,
          path.basename(asset.path),
          path.dirname(asset.path),
          asset.extension,
        )) continue;
        total += 1;
        if (samples.length < sampleLimit) {
          samples.push({
            id: asset.id,
            title: asset.title,
            path: asset.path,
            extension: asset.extension,
          });
        }
      }
    });
    return { total, samples };
  }

  async close(): Promise<void> {
    this.similarityController?.abort();
    this.mediaMetadataController?.abort();
    this.pendingMetadataController?.abort();
    this.importCoordinator.cancelAll();
    this.importEnumerator.close();
    await this.stopWatching();
  }

  /**
   * Managed preflight（计划 §13.3）：统计 managed records 与实际 store 文件。
   * 返回迁移前的检查报告；managed 记录与 store 文件都为零时允许直接退役。
   */
  async prepareManagedMigration(): Promise<{
    managedAssets: number;
    managedFiles: number;
    storeBytes: number;
    canMigrateDirectly: boolean;
  }> {
    const managed = this.database.listManagedAssets();
    // 实际文件统计独立于记录数：孤儿文件也算作待迁移数据。
    const files = await this.managedStoreFiles();
    let storeBytes = 0;
    for (const filename of files) {
      const info = await stat(filename).catch(() => null);
      if (info?.isFile()) storeBytes += info.size;
    }
    return {
      managedAssets: managed.length,
      managedFiles: files.length,
      storeBytes,
      canMigrateDirectly: managed.length === 0 && files.length === 0,
    };
  }

  managedStorePathForAuthorization(): string {
    return this.managedStore;
  }

  /**
   * 把 managed store 迁移到用户选择的磁盘目录（计划 §13.3）：
   * 先注册目标目录为 mount root，再复制 → 逐文件验证 size + SHA-256 →
   * 更新 asset 的 path/fingerprint/identity；所有 managed 记录与孤儿文件
   * 都处理成功后才移除 managed store。
   */
  async migrateManagedToDisk(targetDirectory: string): Promise<{
    migrated: number;
    failed: Array<{ path: string; reason: string }>;
  }> {
    const managed = this.database.listManagedAssets();
    const targetRoot = path.resolve(targetDirectory);
    const failed: Array<{ path: string; reason: string }> = [];
    let migrated = 0;
    await mkdir(targetRoot, { recursive: true });
    // 先注册 mount root，使 relink 后的 updateIdentity 能建立 mount-scoped
    // identity（§13.3 第 6 条）。
    const mountId =
      this.database
        .listMountRoots()
        .find((mount) => mount.path === targetRoot)?.id ?? randomUUID();
    this.database.upsertMountRoot({
      id: mountId,
      path: targetRoot,
      displayName: path.basename(targetRoot) || targetRoot,
      state: "online",
    });
    // 记录每个 managed 文件对应的磁盘目标路径（冲突时逐文件隔离）。
    const usedTargets = new Set<string>();
    for (const asset of managed) {
      const existing = this.database.getAsset(asset.id);
      if (!existing) {
        // 记录缺失也是失败：不得静默移除 store。
        failed.push({ path: asset.path, reason: "MANAGED_ASSET_RECORD_MISSING" });
        continue;
      }
      const parsed = path.parse(asset.path);
      let targetPath = path.join(targetRoot, parsed.base);
      let suffix = 2;
      while (
        usedTargets.has(path.normalize(targetPath).toLocaleLowerCase("en-US")) ||
        (await stat(targetPath).catch(() => null))
      ) {
        targetPath = path.join(
          targetRoot,
          `${parsed.name} ${suffix}${parsed.ext}`,
        );
        suffix += 1;
      }
      usedTargets.add(path.normalize(targetPath).toLocaleLowerCase("en-US"));
      try {
        // 复制并校验 size + 完整 SHA-256（contentHash 缺失时同样计算并建立）。
        await copyFile(asset.path, targetPath);
        const [sourceInfo, targetInfo] = await Promise.all([
          stat(asset.path),
          stat(targetPath),
        ]);
        if (sourceInfo.size !== targetInfo.size) {
          throw new Error("MIGRATE_SIZE_MISMATCH");
        }
        const copiedHash = await fullFileHash(targetPath);
        if (existing.contentHash && copiedHash !== existing.contentHash) {
          throw new Error("MIGRATE_HASH_MISMATCH");
        }
        // 更新 asset 为 linked 模式并指向磁盘目标；contentHash 缺失时以
        // 实际复制的 SHA-256 建立验证摘要。
        const next = await this.readAsset(targetPath, existing);
        const updated = this.database.relinkAsset(asset.id, {
          ...next,
          contentHash: existing.contentHash ?? copiedHash,
          storageMode: "linked",
          libraryRelativePath: null,
          originalSourcePath: null,
        });
        this.updateIdentity(updated);
        // A completed item is no longer managed storage. Remove only after
        // copy, hash verification, and database relink all succeed so retries
        // do not misclassify completed files as orphaned store files.
        await rm(asset.path, { force: true });
        migrated += 1;
      } catch (error) {
        failed.push({
          path: asset.path,
          reason: error instanceof Error ? error.message : "MIGRATE_FAILED",
        });
      }
    }
    // 孤儿文件：无对应记录但仍在 store，也计入失败，避免被静默删除。
    const storeFiles = await this.managedStoreFiles();
    const managedPaths = new Set(managed.map((item) => path.normalize(item.path)));
    for (const filename of storeFiles) {
      if (managedPaths.has(path.normalize(filename))) continue;
      failed.push({ path: filename, reason: "ORPHAN_STORE_FILE" });
    }
    if (failed.length === 0 && managed.length > 0) {
      // 全部记录与文件都成功后才移除 managed store。
      await rm(this.managedStore, { recursive: true, force: true });
    }
    return { migrated, failed };
  }

  /**
   * 认领浏览器捕获（路线一）：把 browser-captures 里的捕获复制进用户选择
   * 的目录，校验后把 linked 资产重链到新路径，引用旧路径的集合条目一并
   * 重定向，最后删除原件（已持验证副本，且白板对象按 assetId 引用不受
   * 影响）。所有权转移由用户显式完成，存储模型保持"恒为 linked"。
   * 只接受捕获目录内的文件；目标重名自动加序号，不覆盖。
   */
  async adoptBrowserCaptures(
    paths: string[],
    targetDirectory: string,
  ): Promise<{
    adopted: Array<{ assetId: string; from: string; to: string }>;
    failed: Array<{ path: string; reason: string }>;
  }> {
    const targetRoot = path.resolve(targetDirectory);
    const captureRoot = browserCapturesPath(this.libraryRoot);
    const targetInfo = await stat(targetRoot).catch(() => null);
    if (!targetInfo?.isDirectory()) throw new Error("ADOPT_TARGET_NOT_DIRECTORY");
    const adopted: Array<{ assetId: string; from: string; to: string }> = [];
    const failed: Array<{ path: string; reason: string }> = [];
    const usedTargets = new Set<string>();
    for (const inputPath of paths) {
      const sourcePath = path.resolve(inputPath);
      try {
        // 只允许认领捕获目录内的文件：这是捕获认领的语义边界，也防止把
        // 任意库资产误当成可移动的临时文件。
        if (
          sourcePath !== captureRoot &&
          !sourcePath.startsWith(`${captureRoot}${path.sep}`)
        ) {
          throw new Error("NOT_A_BROWSER_CAPTURE");
        }
        const [sourceInfo, existing] = await Promise.all([
          stat(sourcePath).catch(() => null),
          Promise.resolve(this.database.getAssetByPath(sourcePath)),
        ]);
        if (!sourceInfo?.isFile()) throw new Error("CAPTURE_FILE_MISSING");
        if (!existing) throw new Error("CAPTURE_NOT_IMPORTED");

        let targetPath = path.join(targetRoot, path.basename(sourcePath));
        let suffix = 2;
        while (
          usedTargets.has(path.normalize(targetPath).toLocaleLowerCase("en-US")) ||
          (await stat(targetPath).catch(() => null))
        ) {
          const parsed = path.parse(sourcePath);
          targetPath = path.join(targetRoot, `${parsed.name} ${suffix}${parsed.ext}`);
          suffix += 1;
        }
        usedTargets.add(path.normalize(targetPath).toLocaleLowerCase("en-US"));

        await copyFile(sourcePath, targetPath);
        const copiedInfo = await stat(targetPath);
        if (copiedInfo.size !== sourceInfo.size) {
          throw new Error("ADOPT_SIZE_MISMATCH");
        }
        // 有验证摘要时以 SHA-256 复核副本；缺失则借此建立摘要。
        const copiedHash =
          existing.contentHash != null ? await fullFileHash(targetPath) : null;
        if (existing.contentHash != null && copiedHash !== existing.contentHash) {
          throw new Error("ADOPT_HASH_MISMATCH");
        }

        const next = await this.readAsset(targetPath, existing);
        const updated = this.database.relinkAsset(existing.id, {
          ...next,
          contentHash: existing.contentHash ?? copiedHash,
          storageMode: "linked",
          libraryRelativePath: null,
          originalSourcePath: null,
        });
        this.updateIdentity(updated);

        // 引用旧路径的集合条目重定向为路径引用（挂载元数据由下次解析重建）。
        for (const item of this.database.collections().listItemsReferencingPath(sourcePath)) {
          this.database.collections().updateItem(item.id, {
            identityId: null,
            mountId: null,
            relativePath: null,
            lastResolvedPath: targetPath,
            pathKey: path
              .normalize(targetPath)
              .toLocaleLowerCase("en-US"),
            state: "resolved",
          });
        }

        await unlink(sourcePath);
        adopted.push({ assetId: existing.id, from: sourcePath, to: targetPath });
      } catch (error) {
        failed.push({
          path: sourcePath,
          reason: error instanceof Error ? error.message : "ADOPT_FAILED",
        });
      }
    }
    return { adopted, failed };
  }

  /** 浏览器扩展捕获落盘目录（供渲染端过滤可认领条目）。 */
  browserCapturesDirectory(): string {
    return browserCapturesPath(this.libraryRoot);
  }

  /** 返回 managed store 下实际普通文件的绝对路径（过滤子目录）。 */
  private async managedStoreFiles(): Promise<string[]> {
    const result: string[] = [];
    let entries;
    try {
      entries = await readdir(this.managedStore, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (entry.isFile()) result.push(path.join(this.managedStore, entry.name));
    }
    return result;
  }

  /** 暂停目录监控（托盘驻留模式保留主进程但不监控）。 */
  async pauseWatching(): Promise<void> {
    await this.stopWatching();
  }

  /** 恢复目录监控（托盘重新打开窗口后）。 */
  async resumeWatching(): Promise<void> {
    if (this.watchReconcile.active) return;
    await this.startWatching();
  }

  private async stopWatching(): Promise<void> {
    await this.watchReconcile.stop();
  }
}
