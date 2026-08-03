import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  AssetKind,
  AssetRecord,
  AssetStorageMode,
  DuplicateGroup,
  FilesystemRenameResult,
  ImportJobSnapshot,
  ImportOptions,
  ImportResult,
  LibraryPreferences,
  LibraryChangedEvent,
  MaterializeOptions,
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
import { managedStorePath } from "./library-manager";
import { MetadataEnricher } from "./metadata-enricher";
import { WatchReconcileService } from "./watch-reconcile-service";
import { specializedKindForExtension } from "../../shared/asset-kind";

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
  collectionSegments: string[];
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

function segmentsForFile(filename: string, root: string): string[] {
  const relativeDirectory = path.relative(root, path.dirname(filename));
  return [
    path.basename(root),
    ...relativeDirectory.split(path.sep).filter((segment) => segment && segment !== "."),
  ];
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

export async function imageVisualSignature(filename: string): Promise<{
  visualHash: string;
  colorSignature: string;
  dominantColor: { r: number; g: number; b: number };
}> {
  const source = sharp(filename, { animated: false, failOn: "none" }).rotate();
  const [gray, color] = await Promise.all([
    source
      .clone()
      .resize(9, 8, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer(),
    source
      .clone()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(4, 4, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      hash <<= 1n;
      if (gray[y * 9 + x] > gray[y * 9 + x + 1]) hash |= 1n;
    }
  }
  const channels = color.info.channels;
  const rgb = Buffer.alloc(48);
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    rgb[pixel * 3] = color.data[pixel * channels];
    rgb[pixel * 3 + 1] = color.data[pixel * channels + Math.min(1, channels - 1)];
    rgb[pixel * 3 + 2] = color.data[pixel * channels + Math.min(2, channels - 1)];
    red += rgb[pixel * 3];
    green += rgb[pixel * 3 + 1];
    blue += rgb[pixel * 3 + 2];
  }
  return {
    visualHash: hash.toString(16).padStart(16, "0"),
    colorSignature: rgb.toString("base64"),
    dominantColor: {
      r: Math.round(red / 16),
      g: Math.round(green / 16),
      b: Math.round(blue / 16),
    },
  };
}

function hammingDistance(left: string, right: string): number {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (value) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
}

export function visualSimilarity(
  left: { visualHash: string; colorSignature: string },
  right: { visualHash: string; colorSignature: string },
): number {
  const structureDifference = hammingDistance(
    left.visualHash,
    right.visualHash,
  ) / 64;
  const leftColor = Buffer.from(left.colorSignature, "base64");
  const rightColor = Buffer.from(right.colorSignature, "base64");
  const length = Math.min(leftColor.length, rightColor.length);
  if (!length) return 0;
  let colorDifference = 0;
  for (let index = 0; index < length; index += 1) {
    colorDifference += Math.abs(leftColor[index] - rightColor[index]);
  }
  colorDifference /= length * 255;
  return Math.max(
    0,
    Math.min(100, (1 - structureDifference * 0.8 - colorDifference * 0.2) * 100),
  );
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
  private readonly managedPaths = new Set<string>();
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
  private defaultStorageMode: AssetStorageMode;
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
      defaultStorageMode?: AssetStorageMode;
      importEnumerator?: ImportEnumerator;
    } = {},
  ) {
    this.libraryRoot = path.resolve(
      options.libraryRoot ??
        path.dirname(database.filename === ":memory:" ? "." : database.filename),
    );
    this.managedStore = managedStorePath(this.libraryRoot);
    this.defaultStorageMode = options.defaultStorageMode ?? "linked";
    this.importEnumerator = options.importEnumerator ?? new LocalImportEnumerator();
    this.importCoordinator = new ImportCoordinator((snapshot) => {
      this.events.emit("import-progress", snapshot);
    });
    this.metadataEnricher = new MetadataEnricher(
      this.database,
      (filename, kind, signal) => this.extractMetadata(filename, kind, signal),
    );
  }

  /** Rebinds the service to a different library context (switching libraries). */
  setLibraryContext(
    libraryRoot: string,
    defaultStorageMode: AssetStorageMode,
  ): void {
    this.libraryRoot = path.resolve(libraryRoot);
    this.defaultStorageMode = defaultStorageMode;
    this.database.setSetting("defaultStorageMode", defaultStorageMode);
  }

  getLibraryDefaultStorageMode(): AssetStorageMode {
    return this.defaultStorageMode;
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
      sidebarWidth: 260,
      assetWidth: 350,
      detailsWidth: 286,
      collapsed: [],
    },
    defaultStorageMode: "linked",
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
      defaultStorageMode:
        stored?.defaultStorageMode ?? this.defaultStorageMode,
    };
    // 0.33 → 0.34 一次性偏好迁移：includeSubfolderAssets 默认改为 true。
    // 该字段在 0.33 从未参与查询（collectionId 始终递归），不存在用户预期损失。
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
    return this.database
      .listVisualSignatures(id)
      .map((candidate) => ({
        id: candidate.id,
        score: visualSimilarity(source!, candidate),
      }))
      .filter((candidate) => candidate.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
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
      storageMode: "linked",
      libraryRelativePath: null,
      originalSourcePath: null,
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
      storageMode: "linked",
      libraryRelativePath: null,
      originalSourcePath: null,
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

  private resolveStorageMode(options?: ImportOptions): AssetStorageMode {
    if (!options?.storageMode || options.storageMode === "library-default") {
      return this.defaultStorageMode;
    }
    return options.storageMode;
  }

  /**
   * Copies a source file into the managed store with full SHA-256 verification
   * and atomic rename. The store is content-addressed (`<hash><ext>`), so
   * re-importing identical content reuses the existing copy and never creates
   * a duplicate record.
   */
  private async managedCopy(
    source: string,
    extension: string,
  ): Promise<{ path: string; hash: string }> {
    const hash = await fullFileHash(source);
    const filename = `${hash}${extension}`;
    const target = path.join(this.managedStore, filename);
    if (await exists(target)) return { path: target, hash };
    await mkdir(this.managedStore, { recursive: true });
    const temporary = `${target}.${randomUUID()}.partial`;
    await copyFile(source, temporary);
    const copiedHash = await fullFileHash(temporary);
    if (copiedHash !== hash) {
      await unlink(temporary).catch(() => undefined);
      throw new Error("FILE_COPY_VERIFICATION_FAILED");
    }
    await rename(temporary, target);
    return { path: target, hash };
  }

  /**
   * Records the persistent file identity of an asset when it lives under one
   * of the watched roots. The identity key is the on-disk path, so later
   * moves and renames can be confirmed by fingerprint. Called after an asset
   * is upserted (the asset id is only known then).
   */
  private updateIdentity(asset: AssetRecord): void {
    if (asset.storageMode === "managed") return;
    const roots = this.database
      .listWatchRoots()
      .map((item) => path.resolve(item.path));
    const root = roots.find(
      (candidate) =>
        asset.path === candidate ||
        asset.path.startsWith(`${candidate}${path.sep}`),
    );
    if (!root) return;
    this.database.upsertFileIdentity({
      pathKey: path.normalize(asset.path).toLocaleLowerCase("en-US"),
      assetId: asset.id,
      fingerprint: asset.fingerprint,
      size: asset.size,
      rootPath: root,
    });
  }

  private async runImport(job: ImportJob): Promise<void> {
    const { snapshot, controller } = job;
    const storageMode = this.resolveStorageMode(job.options);
    const hierarchyMode = job.options.hierarchyMode ?? "collections";
    const targetFolderId = job.options.targetFolderId ?? null;
    const parentFolderId = job.options.parentFolderId ?? null;
    if (parentFolderId && !this.database.getCollection(parentFolderId)) {
      snapshot.state = "failed";
      snapshot.failed.push({
        path: snapshot.sourcePaths.join("; "),
        reason: "COLLECTION_PARENT_NOT_FOUND",
      });
      snapshot.completedAt = new Date().toISOString();
      this.importCoordinator.emit(job);
      return;
    }
    try {
      snapshot.state = "scanning";
      this.importCoordinator.emit(job);
      const watchRoots = this.database.listWatchRoots()
        .map((item) => path.resolve(item.path))
        .sort((left, right) => right.length - left.length);
      const collectionIds = new Map(
        this.database.listCollections().map((collection) => [
          `${collection.parentId ?? ""}\0${collection.title.toLocaleLowerCase("en-US")}`,
          collection.id,
        ]),
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
            const hierarchyRoot = watchRootPath ?? item.sourceRoot;
            return {
              filename: item.filename,
              collectionSegments: hierarchyRoot
                ? segmentsForFile(item.filename, hierarchyRoot)
                : [],
              ...(watchRootPath ? { watchRootPath } : {}),
            };
          });
          for (let transactionOffset = 0; transactionOffset < candidates.length; transactionOffset += 256) {
            controller.signal.throwIfAborted();
            const transactionCandidates = candidates.slice(transactionOffset, transactionOffset + 256);
            const inspected: Array<{
              candidate: ImportCandidate;
              asset: NewAsset;
              copied: boolean;
              verified: boolean;
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
                  if (storageMode === "linked") {
                    return { candidate, asset: linked, copied: false, verified: false };
                  }
                  const copied = await this.managedCopy(
                    candidate.filename,
                    path.extname(candidate.filename).toLowerCase(),
                  );
                  return {
                    candidate,
                    asset: {
                      ...linked,
                      path: copied.path,
                      pathKey: path.normalize(copied.path).toLocaleLowerCase("en-US"),
                      storageMode: "managed" as const,
                      libraryRelativePath: path.relative(this.libraryRoot, copied.path),
                      originalSourcePath: candidate.filename,
                      contentHash: copied.hash,
                    },
                    copied: true,
                    verified: true,
                  };
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
            const collectionRelations: Array<{ assetId: string; collectionId: string }> = [];
            const identities: Array<{
              pathKey: string;
              assetId: string;
              fingerprint: string;
              size: number;
              rootPath: string;
            }> = [];
            for (let index = 0; index < savedAssets.length; index += 1) {
              const saved = savedAssets[index];
              const item = inspected[index];
              if (saved.reused) snapshot.reused += 1;
              else {
                snapshot.imported += 1;
                if (item.copied) snapshot.copied += 1;
              }
              if (item.verified) snapshot.verified += 1;
              if (storageMode === "linked" && item.candidate.watchRootPath) {
                identities.push({
                  pathKey: path.normalize(saved.asset.path).toLocaleLowerCase("en-US"),
                  assetId: saved.asset.id,
                  fingerprint: saved.asset.fingerprint,
                  size: saved.asset.size,
                  rootPath: item.candidate.watchRootPath,
                });
              }
              if (hierarchyMode === "flat") continue;
              if (targetFolderId) {
                collectionRelations.push({ assetId: saved.asset.id, collectionId: targetFolderId });
                continue;
              }
              let parentId: string | null = parentFolderId;
              const sourceSegments: string[] = [];
              for (const segment of item.candidate.collectionSegments) {
                sourceSegments.push(segment);
                const key = `${parentId ?? ""}\0${segment.toLocaleLowerCase("en-US")}`;
                let collectionId = collectionIds.get(key);
                if (!collectionId) {
                  collectionId = this.database.findOrCreateCollectionId(segment, parentId);
                  collectionIds.set(key, collectionId);
                }
                if (item.candidate.watchRootPath) {
                  this.database.markCollectionSource(
                    collectionId,
                    item.candidate.watchRootPath,
                    sourceSegments.join(path.sep),
                  );
                }
                parentId = collectionId;
              }
              if (parentId) collectionRelations.push({ assetId: saved.asset.id, collectionId: parentId });
            }
            if (identities.length) this.database.upsertFileIdentities(identities);
            if (collectionRelations.length) this.database.addAssetsToCollections(collectionRelations);
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

  startImport(inputPaths: string[], options: ImportOptions = {}): ImportJobSnapshot {
    const job = this.importCoordinator.create(inputPaths, options);
    this.importCoordinator.enqueueJob(job, (next) => this.runImport(next));
    return structuredClone(job.snapshot);
  }

  getImportJob(id: string): ImportJobSnapshot | null {
    return this.importCoordinator.snapshot(id);
  }

  cancelImport(id: string): boolean {
    return this.importCoordinator.cancel(id);
  }

  retryImport(id: string): ImportJobSnapshot {
    const retry = this.importCoordinator.retryInput(id);
    return this.startImport(retry.paths, retry.options);
  }

  async importPaths(
    inputPaths: string[],
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const snapshot = this.startImport(inputPaths, options);
    return new Promise((resolve) => {
      const unsubscribe = this.onImportProgress((next) => {
        if (next.id !== snapshot.id) return;
        if (!["completed", "cancelled", "failed"].includes(next.state)) return;
        unsubscribe();
        resolve({
          imported: next.imported,
          reused: next.reused,
          unsupported: next.unsupported,
          failed: next.failed,
          copied: next.copied,
          relinked: next.relinked,
          conflicted: next.conflicted,
          verified: next.verified,
        });
      });
    });
  }

  async relinkAsset(id: string, filename: string): Promise<AssetRecord> {
    const current = this.database.getAsset(id);
    if (!current) throw new Error("ASSET_NOT_FOUND");
    const resolved = path.resolve(filename);
    if (current.storageMode === "managed") {
      const linked = await this.readAsset(resolved, current);
      const copied = await this.managedCopy(
        resolved,
        path.extname(resolved).toLowerCase(),
      );
      const next: NewAsset = {
        ...linked,
        path: copied.path,
        pathKey: path.normalize(copied.path).toLocaleLowerCase("en-US"),
        storageMode: "managed",
        libraryRelativePath: path.relative(this.libraryRoot, copied.path),
        originalSourcePath: resolved,
        contentHash: copied.hash,
      };
      return this.database.relinkAsset(id, next);
    }
    const next = await this.readAsset(resolved, current);
    const asset = this.database.relinkAsset(id, next);
    this.updateIdentity(asset);
    return asset;
  }

  /**
   * 按需入库一个未导入文件（Found 式浏览的 materialize）：
   * 同路径复用 assetId；只计算 quick fingerprint，完整 SHA-256 仅用于
   * managed 复制或主动完整性校验；不创建文件夹层级。
   */
  async materializePath(
    filename: string,
    options: MaterializeOptions = {},
  ): Promise<MaterializeResult> {
    const resolved = path.resolve(filename);
    const existing = this.database.getAssetByPath(resolved);
    const next = await this.readAsset(resolved, existing ?? undefined);
    const storageMode = this.resolveStorageMode({
      storageMode: options.storageMode,
    });
    let asset: AssetRecord;
    let copied = false;
    let verified = false;
    if (storageMode === "managed") {
      const managed = await this.managedCopy(
        resolved,
        path.extname(resolved).toLowerCase(),
      );
      asset = this.database.upsertAsset({
        ...next,
        path: managed.path,
        pathKey: path.normalize(managed.path).toLocaleLowerCase("en-US"),
        storageMode: "managed",
        libraryRelativePath: path.relative(this.libraryRoot, managed.path),
        originalSourcePath: resolved,
        contentHash: managed.hash,
      }).asset;
      copied = true;
      verified = true;
    } else {
      const result = this.database.upsertAsset(next);
      asset = result.asset;
      this.updateIdentity(asset);
    }
    if (options.collectionIds?.length) {
      this.database.addAssetsToCollections(
        options.collectionIds.map((collectionId) => ({
          assetId: asset.id,
          collectionId,
        })),
      );
    }
    if (options.tags?.length) {
      this.database.setAssetTags(asset.id, options.tags);
    }
    // 重新读取以反映集合/标签副作用后的最新记录。
    const fresh = this.database.getAsset(asset.id)!;
    return { asset: fresh, created: !existing, copied, verified };
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

  async addWatchRoot(root: string): Promise<ImportResult> {
    const resolved = path.resolve(root);
    if (!(await stat(resolved)).isDirectory()) throw new Error("WATCH_ROOT_NOT_DIRECTORY");
    const watchRoot = this.database.addWatchRoot(resolved);
    if (this.watchReconcile.active) this.watchReconcile.addRoot(watchRoot);
    else await this.startWatching();
    return this.importPaths([resolved]);
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

  private backfillWatchCollectionSources(rootPath: string): void {
    const collections = this.database.listCollections();
    const byId = new Map(collections.map((collection) => [collection.id, collection]));
    for (const identity of this.database.listFileIdentitiesByRoot(rootPath)) {
      const asset = this.database.getAsset(identity.assetId);
      if (!asset) continue;
      const relativeDirectory = path.relative(rootPath, path.dirname(asset.path));
      const segments = relativeDirectory && relativeDirectory !== "."
        ? relativeDirectory.split(path.sep).filter(Boolean)
        : [];
      if (!segments.length) continue;
      for (const collectionId of asset.collectionIds) {
        const chain: Array<{ id: string; title: string }> = [];
        let current = byId.get(collectionId);
        while (current) {
          chain.unshift({ id: current.id, title: current.title });
          current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        if (
          chain.length !== segments.length ||
          chain.some((item, index) =>
            item.title.localeCompare(segments[index], undefined, { sensitivity: "accent" }) !== 0)
        ) {
          continue;
        }
        chain.forEach((item, index) => {
          this.database.markCollectionSource(
            item.id,
            rootPath,
            segments.slice(0, index + 1).join(path.sep),
          );
        });
      }
    }
  }

  async startWatching(): Promise<void> {
    const roots = this.database.listWatchRoots();
    if (!roots.length || this.watchReconcile.active) return;
    for (const root of roots) {
      this.backfillWatchCollectionSources(path.resolve(root.path));
      this.database.pruneEmptyGeneratedCollections(root.path);
    }
    await this.watchReconcile.start(roots, {
      onAdd: (filename) => {
        if (this.managedPaths.has(path.normalize(filename))) return;
        void this.tryRelinkFromRecentUnlink(filename).then((relinked) => {
          if (!relinked) void this.importPaths([filename]);
        });
      },
      onChange: (filename) => {
        if (!this.managedPaths.has(path.normalize(filename))) {
          void this.importPaths([filename]);
        }
      },
      onUnlink: (filename) => {
        if (this.managedPaths.has(path.normalize(filename))) return;
        const asset = this.database.getAssetByPath(filename);
        if (!asset) return;
        this.rememberUnlink(asset);
        this.database.setLinkStateByPath(filename, "missing");
        const watchRoot = this.database.listWatchRoots().find(
          (root) =>
            filename === root.path ||
            filename.startsWith(`${root.path}${path.sep}`),
        );
        if (watchRoot) {
          this.database.pruneEmptyGeneratedCollections(watchRoot.path);
        }
        this.emitLibraryChanged({ reason: "watch", paths: [filename] });
      },
      onNativePath: (filename, resolvedRoot) => {
        if (this.managedPaths.has(path.normalize(filename))) return;
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
            this.database.pruneEmptyGeneratedCollections(resolvedRoot);
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
    for (const asset of this.database.listAllAssetPaths()) {
      try {
        await stat(asset.path);
        this.database.setLinkState(asset.id, "online");
      } catch {
        this.database.setLinkState(asset.id, "missing");
        missing += 1;
      }
    }
    this.emitLibraryChanged({ reason: "reconcile", paths: [] });
    return missing;
  }

  private trashPathFor(asset: AssetRecord): string {
    return path.join(this.trashRoot, asset.id, path.basename(asset.path));
  }

  /**
   * Removes asset records from the library without moving any source file.
   *
   * - `linked` assets: only the record is removed; the external source file is
   *   never modified (this is the "从资料库移除" command).
   * - `managed` assets: the record is removed and the store copy is deleted.
   * - Records still referenced by boards are kept as purged records so canvases
   *   keep loading; their managed store copies are deleted (a purged record
   *   has no live file anyway).
   */
  async removeFromLibrary(scope: SelectionScope): Promise<number> {
    const ids = this.database.resolveSelection(scope);
    let removed = 0;
    for (const id of ids) {
      const asset = this.database.getAsset(id);
      if (!asset || asset.lifecycle !== "active") continue;
      this.database.deleteFileIdentityByAsset(id);
      // Records with board references stay as purged; the managed store copy
      // is removed in either case.
      this.database.purgeRecord(id);
      if (asset.storageMode === "managed") {
        this.managedPaths.add(path.normalize(asset.path));
        try {
          await unlink(asset.path).catch(() => undefined);
        } finally {
          setTimeout(
            () => this.managedPaths.delete(path.normalize(asset.path)),
            1_000,
          );
        }
      }
      removed += 1;
    }
    return removed;
  }

  async trashAssets(scope: SelectionScope): Promise<number> {
    const ids = this.database.resolveSelection(scope);
    let moved = 0;
    for (const id of ids) {
      const asset = this.database.getAsset(id);
      if (!asset || asset.lifecycle !== "active") continue;
      const target = this.trashPathFor(asset);
      const operationId = this.database.recordFileOperation(
        id,
        "trash",
        asset.path,
        target,
      );
      this.managedPaths.add(path.normalize(asset.path));
      try {
        await moveVerified(asset.path, target);
        this.database.markTrashed(id, target);
        this.database.completeFileOperation(operationId);
        moved += 1;
      } finally {
        setTimeout(() => this.managedPaths.delete(path.normalize(asset.path)), 1_000);
      }
    }
    return moved;
  }

  async restoreAssets(ids: string[]): Promise<number> {
    let restored = 0;
    for (const id of ids) {
      const asset = this.database.getAsset(id);
      if (!asset?.trashPath || asset.lifecycle !== "trashed") continue;
      const target = await availableRestorePath(asset.path);
      const operationId = this.database.recordFileOperation(
        id,
        "restore",
        asset.trashPath,
        target,
      );
      await moveVerified(asset.trashPath, target);
      this.database.markRestored(id, target);
      this.database.completeFileOperation(operationId);
      restored += 1;
    }
    return restored;
  }

  async purgeAssets(ids: string[]): Promise<number> {
    let purged = 0;
    for (const id of ids) {
      const asset = this.database.getAsset(id);
      if (!asset || asset.lifecycle !== "trashed") continue;
      const operationId = this.database.recordFileOperation(
        id,
        "purge",
        asset.trashPath ?? "",
        "",
      );
      if (asset.trashPath) await unlink(asset.trashPath).catch(() => undefined);
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

  async mergeDuplicates(keepId: string, removeIds: string[]): Promise<AssetRecord> {
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
        await this.trashAssets({ mode: "ids", ids: [id] });
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
    for (const item of this.database.listAllAssetPaths()) {
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
      this.backfillWatchCollectionSources(rootPath);
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
      this.database.pruneEmptyGeneratedCollections(rootPath);
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
    for (const asset of this.database.listActiveAssets()) {
      const filename = path.basename(asset.path);
      const directory = path.dirname(asset.path);
      const matched = new Set<string>();
      for (const rule of rules) {
        if (
          (rule.filenamePattern &&
            !globMatch(rule.filenamePattern, filename)) ||
          (rule.pathPattern &&
            directory.toLocaleLowerCase("en-US").includes(
              rule.pathPattern.toLocaleLowerCase("en-US"),
            )) ||
          (rule.extension && asset.extension !== rule.extension.toLowerCase())
        ) {
          continue;
        }
        for (const tag of rule.tags) matched.add(tag);
      }
      if (!matched.size) continue;
      const combined = [...new Set([...asset.tags, ...matched])];
      if (combined.length !== asset.tags.length) {
        this.database.setAssetTags(asset.id, combined);
        tagged += 1;
      }
    }
    return tagged;
  }

  async close(): Promise<void> {
    this.similarityController?.abort();
    this.mediaMetadataController?.abort();
    this.pendingMetadataController?.abort();
    this.importCoordinator.cancelAll();
    this.importEnumerator.close();
    await this.stopWatching();
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
