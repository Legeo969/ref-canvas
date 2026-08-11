import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type {
  AssetActionRequest,
  AssetActionSnapshot,
  AssetActionType,
  ChangeExtensionOptions,
  CompressOptions,
  ConvertOptions,
  ExportCsvOptions,
  MergeImagesOptions,
  SelectionScope,
  VideoToGifOptions,
} from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";

const execFileAsync = promisify(execFile);

const actionDirectoryNames: Record<AssetActionType, string> = {
  convert: "转换",
  "merge-images": "图片合并",
  webp: "WebP",
  compress: "无损压缩",
  "video-to-gif": "视频转GIF",
  "change-extension": "扩展名修改",
  "export-csv": "CSV导出",
  "export-folder": "文件夹导出",
};

function defaultDirectoryName(type: AssetActionType): string {
  return actionDirectoryNames[type] ?? type;
}

interface ActionJob {
  snapshot: AssetActionSnapshot;
  controller: AbortController;
  request: AssetActionRequest;
  targets: Array<{ id: string; path: string; title: string }>;
}

function safeSegment(value: string): string {
  // Control chars are stripped deliberately: they are illegal in filenames.
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120);
}

function namingTemplate(
  template: string | null | undefined,
  values: { name: string; index: number; count: number; ext: string },
): string {
  const count = values.count || 1;
  const source = template ?? "{name}";
  const date = new Date().toISOString().slice(0, 10);
  return source
    .replaceAll("{name}", safeSegment(values.name))
    .replaceAll("{index}", String(values.index + 1).padStart(2, "0"))
    .replaceAll("{count}", String(count).padStart(2, "0"))
    .replaceAll("{date}", date)
    .replaceAll("{ext}", values.ext)
    .trim();
}

async function exists(filename: string): Promise<boolean> {
  try {
    await stat(filename);
    return true;
  } catch {
    return false;
  }
}

function ffmpegExecutable(): string {
  return process.env.REFCANVAS_FFMPEG || "ffmpeg";
}

/**
 * Local background action jobs.
 *
 * Every action defaults to writing new files and never modifies the original
 * asset. Actions that could overwrite an existing output pause in the
 * `reviewing` state so the user confirms per-item; cancel, retry and a final
 * report are supported on every job.
 */
export class ActionService {
  private readonly jobs = new Map<string, ActionJob>();
  private readonly events = new EventEmitter();

  constructor(
    private readonly database: RefCanvasDatabase,
    private readonly defaultBaseDirectory: string,
  ) {}

  onProgress(listener: (snapshot: AssetActionSnapshot) => void): () => void {
    this.events.on("progress", listener);
    return () => this.events.off("progress", listener);
  }

  private emit(job: ActionJob): void {
    this.events.emit("progress", structuredClone(job.snapshot));
  }

  start(request: AssetActionRequest): AssetActionSnapshot {
    const ids = this.database.resolveSelection(request.targets);
    const targets = ids
      .map((id) => {
        const asset = this.database.getAsset(id);
        const filename = this.database.getAssetPath(id);
        return asset && filename
          ? { id, path: filename, title: asset.title }
          : null;
      })
      .filter((item): item is { id: string; path: string; title: string } =>
        item !== null,
      );
    const snapshot: AssetActionSnapshot = {
      id: randomUUID(),
      type: request.type,
      state: "queued",
      total: targets.length,
      processed: 0,
      created: 0,
      failed: 0,
      conflicts: [],
      items: targets.map((target) => ({
        sourcePath: target.path,
        status: "pending",
        outputPath: null,
        error: null,
      })),
      createdAt: new Date().toISOString(),
      completedAt: null,
      outputDirectory: null,
      error: null,
    };
    const job: ActionJob = {
      snapshot,
      controller: new AbortController(),
      request,
      targets,
    };
    this.jobs.set(snapshot.id, job);
    void this.run(job);
    return structuredClone(snapshot);
  }

  get(id: string): AssetActionSnapshot | null {
    const job = this.jobs.get(id);
    return job ? structuredClone(job.snapshot) : null;
  }

  authorizationDirectoryFor(request: AssetActionRequest): string {
    return path.resolve(
      request.outputDirectory
        ?? path.join(this.defaultBaseDirectory, defaultDirectoryName(request.type)),
    );
  }

  authorizationDirectoryForRetry(id: string): string {
    const job = this.jobs.get(id);
    if (!job) throw new Error("ACTION_JOB_NOT_FOUND");
    return this.authorizationDirectoryFor(job.request);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || ["completed", "cancelled", "failed"].includes(job.snapshot.state)) {
      return false;
    }
    job.controller.abort();
    return true;
  }

  retry(id: string, outputDirectory?: string): AssetActionSnapshot {
    const job = this.jobs.get(id);
    if (!job) throw new Error("ACTION_JOB_NOT_FOUND");
    const failedIds = job.snapshot.items
      .filter((item) => item.status === "failed")
      .map((item) => this.assetIdForPath(item.sourcePath))
      .filter((item): item is string => item !== null);
    const targets: SelectionScope =
      failedIds.length > 0
        ? { mode: "ids", ids: failedIds }
        : job.request.targets;
    return this.start({ ...job.request, targets, outputDirectory: outputDirectory ?? job.request.outputDirectory });
  }

  private assetIdForPath(filename: string): string | null {
    const asset = this.database.getAssetByPath(filename);
    return asset?.id ?? null;
  }

  /**
   * Resolves a single overwrite conflict. `overwrite: true` deletes the
   * existing output and re-runs that item; `overwrite: false` skips it.
   */
  async resolveConflict(
    id: string,
    outputPath: string,
    overwrite: boolean,
  ): Promise<AssetActionSnapshot> {
    const job = this.jobs.get(id);
    if (!job) throw new Error("ACTION_JOB_NOT_FOUND");
    if (job.snapshot.state !== "reviewing") return structuredClone(job.snapshot);
    const item = job.snapshot.items.find(
      (candidate) => candidate.outputPath === outputPath,
    );
    if (!item) throw new Error("ACTION_CONFLICT_NOT_FOUND");
    job.snapshot.conflicts = job.snapshot.conflicts.filter(
      (filename) => filename !== outputPath,
    );
    if (overwrite) {
      await unlink(outputPath).catch(() => undefined);
      item.status = "pending";
      item.error = null;
      item.outputPath = outputPath;
      try {
        const output = await this.runItem(job, item);
        item.outputPath = output;
        item.status = "done";
        job.snapshot.created += 1;
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        job.snapshot.failed += 1;
      }
    } else {
      item.status = "done";
      item.outputPath = null;
      item.error = "SKIPPED_CONFLICT";
    }
    job.snapshot.processed += 1;
    if (job.snapshot.conflicts.length === 0) {
      job.snapshot.state = "completed";
      job.snapshot.completedAt = new Date().toISOString();
    }
    this.emit(job);
    return structuredClone(job.snapshot);
  }

  private async run(job: ActionJob): Promise<void> {
    try {
      const baseDirectory = path.resolve(
        job.request.outputDirectory ??
          path.join(this.defaultBaseDirectory, defaultDirectoryName(job.snapshot.type)),
      );
      job.snapshot.outputDirectory = baseDirectory;
      job.snapshot.state = "preparing";
      this.emit(job);
      await mkdir(baseDirectory, { recursive: true });

      for (let index = 0; index < job.targets.length; index += 1) {
        if (job.controller.signal.aborted) break;
        const item = job.snapshot.items[index];
        const target = job.targets[index];
        const sourceName = path.basename(target.path);
        const extension = path.extname(sourceName).slice(1);
        const name = extension
          ? sourceName.slice(0, -extension.length - 1)
          : sourceName;
        const outputRelative = this.outputRelativePath(
          job,
          target.path,
          name,
          extension,
          index,
        );
        const output = path.join(baseDirectory, outputRelative);
        await mkdir(path.dirname(output), { recursive: true });
        if (await exists(output)) {
          item.status = "conflict";
          item.outputPath = output;
          job.snapshot.conflicts.push(output);
          continue;
        }
        try {
          const finalPath = await this.runItem(job, item, output);
          item.outputPath = finalPath;
          item.status = "done";
          job.snapshot.created += 1;
          if (job.request.writeSidecar) {
            await this.writeSidecar(target, finalPath);
          }
        } catch (error) {
          item.status = "failed";
          item.error = error instanceof Error ? error.message : "UNKNOWN_ERROR";
          job.snapshot.failed += 1;
        }
        job.snapshot.processed += 1;
        this.emit(job);
      }

      if (job.controller.signal.aborted) {
        job.snapshot.state = "cancelled";
      } else if (job.snapshot.conflicts.length > 0) {
        job.snapshot.state = "reviewing";
      } else {
        job.snapshot.state = "completed";
        job.snapshot.completedAt = new Date().toISOString();
      }
    } catch (error) {
      job.snapshot.state = "failed";
      job.snapshot.error =
        error instanceof Error ? error.message : "UNKNOWN_ERROR";
    } finally {
      job.snapshot.completedAt ??= new Date().toISOString();
      this.emit(job);
    }
  }

  /** Output path relative to the output directory, honoring keepHierarchy. */
  private outputRelativePath(
    job: ActionJob,
    sourcePath: string,
    name: string,
    extension: string,
    index: number,
  ): string {
    const count = job.targets.length;
    const stem = namingTemplate(job.request.namingTemplate, {
      name,
      index,
      count,
      ext: extension,
    });
    if (job.request.keepHierarchy) {
      const relative = path.relative(this.commonTargetRoot(job), path.dirname(sourcePath));
      const directory = relative.startsWith("..") ? "" : relative;
      return path.join(directory, `${stem}.${this.outputExtension(job, extension)}`);
    }
    return `${stem}.${this.outputExtension(job, extension)}`;
  }

  /** Longest common directory prefix of all target sources. */
  private commonTargetRoot(job: ActionJob): string {
    if (!job.targets.length) return "";
    let root = path.dirname(job.targets[0].path);
    for (const target of job.targets.slice(1)) {
      while (!path.dirname(target.path).startsWith(root)) {
        const parent = path.dirname(root);
        if (parent === root) break;
        root = parent;
      }
    }
    return root;
  }

  private outputExtension(job: ActionJob, sourceExtension: string): string {
    switch (job.snapshot.type) {
      case "convert":
        return (job.request.options as unknown as ConvertOptions).format ?? sourceExtension;
      case "webp":
        return "webp";
      case "video-to-gif":
        return "gif";
      case "change-extension":
        return (job.request.options as unknown as ChangeExtensionOptions).extension.replace(/^\./, "");
      case "merge-images":
        return "png";
      case "export-csv":
        return "csv";
      default:
        return sourceExtension;
    }
  }

  private async runItem(
    job: ActionJob,
    item: AssetActionSnapshot["items"][number],
    presetOutput?: string,
  ): Promise<string> {
    const output =
      presetOutput ??
      item.outputPath ??
      (() => {
        throw new Error("ACTION_OUTPUT_UNRESOLVED");
      })();
    switch (job.snapshot.type) {
      case "convert":
        return this.convert(item.sourcePath, output, job.request.options as unknown as ConvertOptions);
      case "webp":
        return this.convert(item.sourcePath, output, {
          format: "webp",
          quality: (job.request.options as unknown as ConvertOptions).quality,
          maxWidth: (job.request.options as unknown as ConvertOptions).maxWidth,
          maxHeight: (job.request.options as unknown as ConvertOptions).maxHeight,
        });
      case "compress":
        return this.compress(item.sourcePath, output, job.request.options as unknown as CompressOptions);
      case "merge-images":
        return this.mergeImages(job, output);
      case "video-to-gif":
        return this.videoToGif(item.sourcePath, output, job.request.options as unknown as VideoToGifOptions, job.controller.signal);
      case "change-extension":
        await copyFile(item.sourcePath, output);
        return output;
      case "export-csv":
        return this.exportCsv(job, output, job.request.options as unknown as ExportCsvOptions);
      case "export-folder":
        await copyFile(item.sourcePath, output);
        return output;
    }
  }

  private async convert(
    source: string,
    output: string,
    options: ConvertOptions,
  ): Promise<string> {
    let pipeline = sharp(source, { animated: false, failOn: "none" }).rotate();
    if (options.maxWidth || options.maxHeight) {
      pipeline = pipeline.resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    switch (options.format) {
      case "png":
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
      case "jpeg":
        pipeline = pipeline.jpeg({ quality: options.quality ?? 90 });
        break;
      case "webp":
        pipeline = pipeline.webp({ quality: options.quality ?? 88 });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality: options.quality ?? 70 });
        break;
      case "tiff":
        pipeline = pipeline.tiff();
        break;
    }
    await pipeline.toFile(output);
    return output;
  }

  private async compress(
    source: string,
    output: string,
    options: CompressOptions,
  ): Promise<string> {
    const extension = path.extname(source).toLowerCase();
    const quality = options.quality ?? 88;
    if (extension === ".png") {
      await sharp(source, { failOn: "none" })
        .png({ compressionLevel: 9, palette: true, colors: 256 })
        .toFile(output);
    } else if (extension === ".jpg" || extension === ".jpeg") {
      await sharp(source, { failOn: "none" })
        .jpeg({ quality, mozjpeg: true })
        .toFile(output);
    } else if (extension === ".webp") {
      await sharp(source, { failOn: "none" })
        .webp({ quality })
        .toFile(output);
    } else {
      // No lossless path for this format; copy unchanged.
      await copyFile(source, output);
    }
    return output;
  }

  private async mergeImages(
    job: ActionJob,
    output: string,
  ): Promise<string> {
    const options = job.request.options as unknown as MergeImagesOptions;
    const buffers: Buffer[] = [];
    for (const target of job.targets) {
      buffers.push(
        await sharp(target.path, { failOn: "none" }).rotate().png().toBuffer(),
      );
    }
    const direction = options.direction ?? "horizontal";
    const gap = Math.max(0, Math.min(200, options.gap ?? 0));
    const composites = buffers.map((buffer) => ({
      input: buffer,
      left: 0,
      top: 0,
    }));
    if (direction === "horizontal") {
      const metadata = await Promise.all(
        buffers.map((buffer) => sharp(buffer).metadata()),
      );
      const totalWidth =
        metadata.reduce((sum, item) => sum + (item.width ?? 0), 0) +
        gap * Math.max(0, buffers.length - 1);
      const height = Math.max(...metadata.map((item) => item.height ?? 0));
      let left = 0;
      for (let index = 0; index < composites.length; index += 1) {
        composites[index].left = left;
        left += (metadata[index].width ?? 0) + gap;
      }
      await sharp({
        create: {
          width: totalWidth,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(composites)
        .png()
        .toFile(output);
    } else if (direction === "vertical") {
      const metadata = await Promise.all(
        buffers.map((buffer) => sharp(buffer).metadata()),
      );
      const width = Math.max(...metadata.map((item) => item.width ?? 0));
      const totalHeight =
        metadata.reduce((sum, item) => sum + (item.height ?? 0), 0) +
        gap * Math.max(0, buffers.length - 1);
      let top = 0;
      for (let index = 0; index < composites.length; index += 1) {
        composites[index].top = top;
        top += (metadata[index].height ?? 0) + gap;
      }
      await sharp({
        create: {
          width,
          height: totalHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(composites)
        .png()
        .toFile(output);
    } else {
      // Grid: arrange in `columns` columns, left-to-right, top-to-bottom.
      const columns = Math.max(1, Math.min(10, options.columns ?? 2));
      const metadata = await Promise.all(
        buffers.map((buffer) => sharp(buffer).metadata()),
      );
      const cellWidths = metadata.map((item) => item.width ?? 0);
      const cellHeights = metadata.map((item) => item.height ?? 0);
      const rows = Math.ceil(buffers.length / columns);
      const columnWidths: number[] = Array.from({ length: columns }, (_, column) =>
        Math.max(...cellWidths.filter((_, index) => index % columns === column), 0),
      );
      const rowHeights: number[] = Array.from({ length: rows }, (_, row) =>
        Math.max(
          ...cellHeights.filter(
            (_, index) => Math.floor(index / columns) === row,
          ),
          0,
        ),
      );
      const totalWidth =
        columnWidths.reduce((sum, value) => sum + value, 0) +
        gap * Math.max(0, columns - 1);
      const totalHeight =
        rowHeights.reduce((sum, value) => sum + value, 0) +
        gap * Math.max(0, rows - 1);
      let index = 0;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns && index < buffers.length; column += 1) {
          const left = columnWidths
            .slice(0, column)
            .reduce((sum, value) => sum + value + gap, 0);
          const top = rowHeights
            .slice(0, row)
            .reduce((sum, value) => sum + value + gap, 0);
          composites[index].left = left;
          composites[index].top = top;
          index += 1;
        }
      }
      await sharp({
        create: {
          width: totalWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(composites)
        .png()
        .toFile(output);
    }
    return output;
  }

  private async videoToGif(
    source: string,
    output: string,
    options: VideoToGifOptions,
    signal?: AbortSignal,
  ): Promise<string> {
    const args = [
      "-y",
      "-i",
      source,
      "-vf",
      `fps=${options.fps ?? 12},scale=${options.scale ?? 640}:-1:flags=lanczos`,
      "-loop",
      "0",
    ];
    if (options.startMs != null && options.endMs != null) {
      args.push("-ss", String(options.startMs / 1000), "-to", String(options.endMs / 1000));
    }
    args.push(output);
    await execFileAsync(ffmpegExecutable(), args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      signal,
    });
    return output;
  }

  private async exportCsv(
    job: ActionJob,
    output: string,
    options: ExportCsvOptions,
  ): Promise<string> {
    const fields = options.fields ?? [];
    const csvRows: string[][] = [fields];
    for (const target of job.targets) {
      const asset = this.database.getAssetByPath(target.path);
      if (!asset) continue;
      const values: string[] = [];
      for (const field of fields) {
        let value: string | number | null | undefined;
        switch (field) {
          case "title": value = asset.title; break;
          case "path": value = asset.path; break;
          case "extension": value = asset.extension; break;
          case "size": value = asset.size; break;
          case "width": value = asset.width; break;
          case "height": value = asset.height; break;
          case "duration": value = asset.duration; break;
          case "bpm": value = asset.bpm; break;
          case "rating": value = asset.rating; break;
          case "tags": value = asset.tags.join("|"); break;
          case "notes": value = asset.notes; break;
          case "createdAt": value = asset.createdAt; break;
          case "updatedAt": value = asset.updatedAt; break;
        }
        values.push(
          value === null || value === undefined ? "" : `"${String(value).replaceAll('"', '""')}"`,
        );
      }
      csvRows.push(values);
    }
    await writeFile(
      output,
      csvRows.map((row) => row.join(",")).join("\r\n"),
      "utf8",
    );
    return output;
  }

  private async writeSidecar(
    target: { id: string; path: string; title: string },
    output: string,
  ): Promise<void> {
    const asset = this.database.getAssetByPath(target.path);
    const sidecar = {
      format: "refcanvas-sidecar",
      version: 1,
      asset: asset
        ? {
            id: asset.id,
            title: asset.title,
            kind: asset.kind,
            rating: asset.rating,
            favorite: asset.favorite,
            colorLabel: asset.colorLabel,
            tags: asset.tags,
            notes: asset.notes,
            width: asset.width,
            height: asset.height,
            duration: asset.duration,
            bpm: asset.bpm,
            customFields: asset.customFields,
            sourceHash: asset.contentHash,
          }
        : null,
      exportedAt: new Date().toISOString(),
    };
    await writeFile(
      `${output}.refcanvas-meta.json`,
      JSON.stringify(sidecar, null, 2),
      "utf8",
    );
  }

  /** Completes any interrupted conflict-resolution runs at startup. */
  async recoverInterrupted(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.snapshot.state === "reviewing") {
        job.snapshot.state = "completed";
        job.snapshot.completedAt = new Date().toISOString();
        this.emit(job);
      }
    }
  }

  close(): void {
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }
}
