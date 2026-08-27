/**
 * 流式 ZIP 归档服务（FND-007 §8.2）。
 *
 * 纯 Node 进程内实现，不引入第三方依赖：
 * - 逐个条目流式写入（local header → data → data descriptor → central directory）。
 * - 支持取消：每个条目之间与数据块之间检查取消令牌，取消后清理临时文件。
 * - 不跟随符号链接目录（环保护）；单个符号链接文件跳过并记录。
 * - 目标冲突默认编号（`name (2).zip`），绝不覆盖已有文件。
 * - 输出先写唯一临时文件，完成后原子移动到目标；失败时清理临时文件。
 */
import { lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream, statSync } from "node:fs";
import { crc32 } from "node:zlib";
import path from "node:path";

export interface ArchiveCancellation {
  cancelled: boolean;
}

export interface ArchiveEntryResult {
  path: string;
  /** 跳过原因（null = 已归档）。 */
  skippedReason: string | null;
}

export interface ArchiveProgress {
  totalEntries: number;
  completed: number;
  skipped: number;
  bytesWritten: number;
}

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

export interface ZipArchiveOptions {
  /** 调用方提供的任务 id（取消用）。 */
  jobId: string;
  /** 冲突编号基数（默认 "name (2).zip"）。 */
  targetDirectory: string;
  /** 归档文件 basename（不含扩展名）。 */
  baseName: string;
  /** 取消令牌（模块级共享：跨服务实例可取消）。 */
  cancellation?: ArchiveCancellation;
  /** 进度回调。 */
  onProgress?: (progress: ArchiveProgress) => void;
}

interface CentralRecord {
  name: string;
  isDirectory: boolean;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;

function dosDateTime(date: Date): { time: number; date: number } {
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { time: dosTime, date: dosDate };
}

function encodeUtf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

/** 目录递归收集：返回文件与目录（含相对路径），跳过符号链接目录环。 */
async function collectEntries(
  root: string,
  cancellation: ArchiveCancellation,
): Promise<{ files: string[]; directories: string[]; skipped: Array<{ path: string; reason: string }> }> {
  const files: string[] = [];
  const directories: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const visitedReal = new Set<string>();
  const walk = async (current: string, relative: string): Promise<void> => {
    if (cancellation.cancelled) return;
    const info = await lstat(current).catch(() => null);
    if (!info) return;
    if (info.isSymbolicLink()) {
      // 符号链接目录不跟随（环保护）；链接文件跳过并记录。
      const target = await stat(current).catch(() => null);
      if (target?.isDirectory()) {
        skipped.push({ path: current, reason: "symlink-directory" });
      } else {
        skipped.push({ path: current, reason: "symlink-file" });
      }
      return;
    }
    if (info.isDirectory()) {
      const real = await stat(current).then((item) => item.dev + ":" + item.ino).catch(() => null);
      if (real && visitedReal.has(real)) {
        skipped.push({ path: current, reason: "symlink-loop" });
        return;
      }
      if (real) visitedReal.add(real);
      directories.push(relative || ".");
      const children = await readdir(current).catch(() => []);
      for (const child of children) {
        await walk(path.join(current, child), relative ? `${relative}/${child}` : child);
      }
      return;
    }
    files.push(relative || path.basename(current));
  };
  await walk(root, "");
  return { files, directories, skipped };
}

/** 目录项 → ZIP 目录条目（以 / 结尾）。 */
function directoryEntryName(relative: string): string {
  if (relative === ".") return "";
  return `${relative.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
}

/**
 * 生成 ZIP 归档。返回最终快照。
 * - 输入可以是单个文件或目录（含嵌套子目录）。
 * - 输出临时文件 + 原子移动；冲突编号。
 */
export class ZipArchiveService {
  /** 进行中的归档任务（jobId → 取消令牌）。模块级共享（跨服务实例可取消）。 */
  private static readonly inFlight = new Map<string, ArchiveCancellation>();

  private static nextUniqueTarget(targetDirectory: string, baseName: string): string {
    const root = path.resolve(targetDirectory);
    const safeBase = baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 128) || "archive";
    let candidate = `${safeBase}.zip`;
    let index = 2;
    for (;;) {
      const target = path.resolve(root, candidate);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("ARCHIVE_PATH_ESCAPE");
      }
      // 目标不存在才使用；已存在则尝试编号候选（绝不覆盖）。
      if (!requireStat(target)) return target;
      candidate = `${safeBase} (${index}).zip`;
      index += 1;
    }
  }

  async archive(
    sources: string[],
    options: ZipArchiveOptions,
  ): Promise<ArchiveSnapshot> {
    const token = options.cancellation ?? { cancelled: false };
    ZipArchiveService.inFlight.set(options.jobId, token);
    try {
      return await this.runArchive(sources, options, token);
    } finally {
      ZipArchiveService.inFlight.delete(options.jobId);
    }
  }

  /** 取消进行中的归档；返回是否找到任务。 */
  cancel(jobId: string): boolean {
    const token = ZipArchiveService.inFlight.get(jobId);
    if (!token) return false;
    token.cancelled = true;
    return true;
  }

  private async runArchive(
    sources: string[],
    options: ZipArchiveOptions,
    token: ArchiveCancellation,
  ): Promise<ArchiveSnapshot> {
    const root = path.resolve(options.targetDirectory);
    await mkdir(root, { recursive: true });
    const finalTarget = ZipArchiveService.nextUniqueTarget(root, options.baseName);
    const tempFile = path.join(
      root,
      `.refcanvas-${options.jobId}-${Date.now()}.zip.tmp`,
    );

    const skipped: Array<{ path: string; reason: string }> = [];
    const failed: Array<{ path: string; reason: string }> = [];
    const central: CentralRecord[] = [];
    let bytesWritten = 0;
    let offset = 0;
    let completed = 0;

    const writer = createWriteStream(tempFile, { flags: "wx" });
    const written = new Promise<void>((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    const writerClosed = new Promise<void>((resolve) => {
      if (writer.closed) {
        resolve();
        return;
      }
      writer.once("close", resolve);
    });

    const removeTempFile = async (): Promise<void> => {
      // Windows can release the stream handle one event-loop turn after close.
      // Retry briefly so cancellation never leaves a visible .zip.tmp artifact.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await rm(tempFile, { force: true });
          return;
        } catch {
          if (attempt === 5) return;
          await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
      }
    };

    /** 写入并尊重背压：write() 返回 false 时等待 drain（流式、内存有界）。 */
    const writeBuffer = async (buffer: Buffer): Promise<void> => {
      if (token.cancelled) throw new Error("ARCHIVE_CANCELLED");
      const canContinue = writer.write(buffer);
      bytesWritten += buffer.length;
      if (!canContinue) {
        await new Promise<void>((resolve) => writer.once("drain", resolve));
      }
    };

    const totalEstimate = sources.length;
    const progress = () => {
      options.onProgress?.({
        totalEntries: totalEstimate,
        completed,
        skipped: skipped.length,
        bytesWritten,
      });
    };

    const addEntry = async (relativePath: string, filePath: string, isDirectory: boolean): Promise<void> => {
      if (token.cancelled) throw new Error("ARCHIVE_CANCELLED");
      const name = isDirectory ? directoryEntryName(relativePath) : relativePath.replace(/\\/g, "/");
      // ZIP 不允许空文件名：跳过归档根目录本身的空条目。
      if (!name) {
        completed += 1;
        progress();
        return;
      }
      const nameBuffer = encodeUtf8(name);
      const { time: dosTime, date: dosDate } = dosDateTime(new Date());

      let fileSize = 0;
      let crc = 0;
      if (!isDirectory) {
        const info = await stat(filePath).catch(() => null);
        if (!info?.isFile()) {
          failed.push({ path: filePath, reason: "not-readable" });
          completed += 1;
          progress();
          return;
        }
        fileSize = info.size;
        crc = 0;
      }

      // Local file header（使用 data descriptor：flag bit 3，size 占位为 0）。
      const entryOffset = offset;
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0x0008, 6); // general purpose flag（bit 3 data descriptor）
      localHeader.writeUInt16LE(isDirectory ? 0 : 0, 8); // method：store
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(0, 14); // crc（descriptor 提供）
      localHeader.writeUInt32LE(0, 18); // compressed size
      localHeader.writeUInt32LE(0, 22); // uncompressed size
      localHeader.writeUInt16LE(nameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra
      await writeBuffer(localHeader);
      await writeBuffer(nameBuffer);
      offset += 30 + nameBuffer.length;

      if (!isDirectory) {
        const handle = await open(filePath, "r").catch(() => null);
        if (!handle) {
          failed.push({ path: filePath, reason: "open-failed" });
          completed += 1;
          progress();
          return;
        }
        try {
          const chunk = Buffer.alloc(64 * 1024);
          let totalRead = 0;
          for (;;) {
            if (token.cancelled) throw new Error("ARCHIVE_CANCELLED");
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, totalRead);
            if (bytesRead === 0) break;
            const slice = chunk.subarray(0, bytesRead);
            crc = crc32(slice, crc) >>> 0;
            await writeBuffer(slice);
            offset += bytesRead;
            totalRead += bytesRead;
          }
        } finally {
          await handle.close();
        }
      }

      // Data descriptor。
      const compressedSize = offset - entryOffset - 30 - nameBuffer.length;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIGNATURE, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(fileSize, 12); // uncompressed size
      await writeBuffer(descriptor);
      offset += 16;

      central.push({
        name,
        isDirectory,
        crc,
        compressedSize,
        uncompressedSize: fileSize,
        offset: entryOffset,
        dosTime,
        dosDate,
      });
      completed += 1;
      progress();
    };

    try {
      for (const source of sources) {
        if (token.cancelled) throw new Error("ARCHIVE_CANCELLED");
        const resolved = path.resolve(source);
        const info = await stat(resolved).catch(() => null);
        if (!info) {
          failed.push({ path: source, reason: "not-found" });
          completed += 1;
          progress();
          continue;
        }
        if (info.isDirectory()) {
          const collected = await collectEntries(resolved, token);
          skipped.push(...collected.skipped);
          // 先写目录条目（稳定顺序），再写文件。
          for (const relative of [...collected.directories].sort()) {
            await addEntry(relative, resolved, true);
          }
          for (const relative of collected.files.sort()) {
            await addEntry(relative, path.join(resolved, relative), false);
          }
        } else if (info.isFile()) {
          await addEntry(path.basename(resolved), resolved, false);
        } else {
          skipped.push({ path: source, reason: "not-file-or-directory" });
        }
      }

      // Central directory。
      const centralStart = offset;
      for (const record of central) {
        const nameBuffer = encodeUtf8(record.name);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(CENTRAL_SIGNATURE, 0);
        entry.writeUInt16LE((20 << 8) | 0, 4); // version made by
        entry.writeUInt16LE(20, 6); // version needed
        entry.writeUInt16LE(0x0008, 8); // flag
        entry.writeUInt16LE(0, 10); // method store
        entry.writeUInt16LE(record.dosTime, 12);
        entry.writeUInt16LE(record.dosDate, 14);
        entry.writeUInt32LE(record.crc, 16);
        entry.writeUInt32LE(record.compressedSize, 20);
        entry.writeUInt32LE(record.uncompressedSize, 24);
        entry.writeUInt16LE(nameBuffer.length, 28);
        entry.writeUInt16LE(0, 30); // extra
        entry.writeUInt16LE(0, 32); // comment
        entry.writeUInt16LE(0, 34); // disk
        entry.writeUInt16LE(0, 36); // internal attrs
        entry.writeUInt32LE(record.isDirectory ? 0x10 : 0, 38); // external attrs
        entry.writeUInt32LE(record.offset, 42); // local header offset
        await writeBuffer(entry);
        await writeBuffer(nameBuffer);
        offset += 46 + nameBuffer.length;
      }
      const centralSize = offset - centralStart;

      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
      eocd.writeUInt16LE(0, 4); // disk
      eocd.writeUInt16LE(0, 6); // cd disk
      eocd.writeUInt16LE(central.length, 8); // entries on disk
      eocd.writeUInt16LE(central.length, 10); // total entries
      eocd.writeUInt32LE(centralSize, 12);
      eocd.writeUInt32LE(centralStart, 16);
      eocd.writeUInt16LE(0, 20); // comment
      await writeBuffer(eocd);

      writer.end();
      await written;
      await rename(tempFile, finalTarget);

      return {
        id: options.jobId,
        state: "completed",
        archivePath: finalTarget,
        entries: central.length,
        skipped,
        failed,
        bytesWritten,
        errorCode: failed.length > 0 ? "ARCHIVE_PARTIAL_FAILURE" : null,
        errorMessage: failed.length > 0 ? `${failed.length} 个条目归档失败` : null,
      };
    } catch (error) {
      writer.destroy();
      void written.catch(() => undefined);
      await writerClosed.catch(() => undefined);
      await removeTempFile();
      if (token.cancelled) {
        return {
          id: options.jobId,
          state: "cancelled",
          archivePath: null,
          entries: completed,
          skipped,
          failed,
          bytesWritten,
          errorCode: "ARCHIVE_CANCELLED",
          errorMessage: "归档已取消；临时文件已清理",
        };
      }
      return {
        id: options.jobId,
        state: "failed",
        archivePath: null,
        entries: completed,
        skipped,
        failed,
        bytesWritten,
        errorCode: "ARCHIVE_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function requireStat(filename: string): boolean {
  try {
    return statSync(filename).isFile();
  } catch {
    return false;
  }
}
