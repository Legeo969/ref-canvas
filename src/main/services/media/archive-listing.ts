import { open, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "fflate";
import { readRarListing, extractRarEntry } from "./archive-rar";
import { readSevenZipListing, extractSevenZipEntry } from "./archive-7z";
import {
  readTarListing,
  readTgzListing,
  readGzipListing,
  extractTarEntry,
  extractGzipEntry,
} from "./archive-tar";

/**
 * 压缩包浏览（只读，不解压到磁盘）。
 *
 * 支持范围按「零新增依赖」划界：
 * - zip / jar / apk：直读中央目录索引，不读条目数据，任意大小都秒开；
 * - tar / tar.gz / tgz / gz：tar 无索引，顺序扫描头部（跳过数据块）；
 * - rar / 7z：私有算法，Node 侧无内置实现，明确不支持（不伪装）。
 *
 * 浏览（清单）与取用（单条目）分离：清单永不展开数据，单条目只在
 * 用户点开时展开那一条。
 */

export interface ArchiveEntry {
  /** 包内相对路径（统一 / 分隔）。 */
  path: string;
  /** 解压后字节数；目录为 0。 */
  size: number;
  /** 压缩后字节数；tar 无压缩时等于 size。 */
  compressedSize: number;
  isDirectory: boolean;
  /** 修改时间（ISO）；格式未记录时为 null。 */
  modifiedAt: string | null;
}

export interface ArchiveListing {
  format: "zip" | "tar" | "gzip" | "rar" | "sevenzip";
  entries: ArchiveEntry[];
  totalSize: number;
  totalCompressedSize: number;
  /** 条目过多时截断（只影响列表展示，不影响统计）。 */
  truncated: boolean;
}

export interface ExtractedArchiveEntry {
  data: Buffer;
  entry: ArchiveEntry;
}

/** 支持的扩展名 → 解析器。epub 不在其列：它已由文字提取预览。 */
export const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "jar",
  "apk",
  "tar",
  "tgz",
  "gz",
  "rar",
  "7z",
]);

/**
 * 清单条目上限。zip 走中央目录，列全量成本很低（5 万条约几毫秒）；
 * 上限只防病态包把内存吃光，不是常规截断点。
 */
const MAX_ENTRIES = 200_000;

/** 单条目解压上限：挡住 zip bomb 与误点巨大条目。 */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/** ZIP 中央目录与本地头签名。 */
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

const UINT32_MAX = 0xffffffff;

function normalizeEntryName(name: string): string {
  return name.replaceAll("\\", "/").replace(/^\/+/, "");
}

/** 从指定偏移读满 length 字节；EOF 提前时返回实际读到的长度。 */
async function readExactly(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

interface ZipCentralEntry extends ArchiveEntry {
  /** 本地文件头偏移：取用单条目时从它开始读。 */
  localOffset: number;
  method: number;
  flags: number;
}

interface ZipCentralDirectory {
  entries: ZipCentralEntry[];
  truncated: boolean;
  totalSize: number;
  totalCompressedSize: number;
}

/** 找 EOCD：居中目录大小与偏移的唯一定位点，容忍末尾 64KB 注释。 */
function locateEocd(tail: Buffer): number {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** 读 zip64 扩展记录，用于 >4GB 包或 >65535 条目。 */
async function readZip64Directory(
  handle: FileHandle,
  fileSize: number,
  tailOffsetInFile: number,
): Promise<{ cdSize: number; cdOffset: number } | null> {
  // zip64 EOCD locator 紧邻 EOCD 之前（20 字节）。
  if (tailOffsetInFile < 20) return null;
  const locator = await readExactly(handle, tailOffsetInFile - 20, 20);
  if (locator.length < 20 || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) return null;
  const zip64Offset = Number(locator.readBigUInt64LE(8));
  if (zip64Offset <= 0 || zip64Offset >= fileSize) return null;
  const record = await readExactly(handle, zip64Offset, 56);
  if (record.length < 56 || record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) return null;
  return {
    cdSize: Number(record.readBigUInt64LE(40)),
    cdOffset: Number(record.readBigUInt64LE(48)),
  };
}

/**
 * 读中央目录（不触碰任何条目数据）。
 *
 * 这是能浏览 9GB 包的原因：只读文件尾部的目录区（几 MB），
 * 不把整个包读进内存。
 */
async function readZipCentralDirectory(
  handle: FileHandle,
  fileSize: number,
): Promise<ZipCentralDirectory> {
  const tailLength = Math.min(fileSize, 65_557);
  const tailStart = fileSize - tailLength;
  const tail = await readExactly(handle, tailStart, tailLength);
  const eocd = locateEocd(tail);
  if (eocd === -1) throw new Error("ARCHIVE_INVALID:NO_EOCD");

  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdSize === UINT32_MAX || cdOffset === UINT32_MAX) {
    const zip64 = await readZip64Directory(handle, fileSize, tailStart + eocd);
    if (!zip64) throw new Error("ARCHIVE_INVALID:BAD_ZIP64_DIRECTORY");
    cdSize = zip64.cdSize;
    cdOffset = zip64.cdOffset;
  }
  if (cdSize <= 0 || cdOffset <= 0 || cdOffset + cdSize > fileSize) {
    throw new Error("ARCHIVE_INVALID:BAD_CENTRAL_DIRECTORY");
  }

  const directory = await readExactly(handle, cdOffset, cdSize);
  const entries: ZipCentralEntry[] = [];
  let totalSize = 0;
  let totalCompressedSize = 0;
  let offset = 0;
  while (offset + 46 <= directory.length) {
    if (directory.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) break;
    const flags = directory.readUInt16LE(offset + 8);
    const method = directory.readUInt16LE(offset + 10);
    const compressedSize = directory.readUInt32LE(offset + 20);
    const uncompressedSize = directory.readUInt32LE(offset + 24);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const dosTime = directory.readUInt16LE(offset + 12);
    const dosDate = directory.readUInt16LE(offset + 14);
    const localOffset = directory.readUInt32LE(offset + 42);
    const name = normalizeEntryName(
      directory.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
    );
    const extra = directory.subarray(
      offset + 46 + nameLength,
      offset + 46 + nameLength + extraLength,
    );
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name) continue;

    const resolved = readZip64Extra(extra, {
      uncompressedSize,
      compressedSize,
      localOffset,
    });
    const isDirectory = name.endsWith("/");
    totalSize += resolved.uncompressedSize;
    totalCompressedSize += resolved.compressedSize;
    if (entries.length < MAX_ENTRIES) {
      entries.push({
        path: name,
        size: resolved.uncompressedSize,
        compressedSize: resolved.compressedSize,
        isDirectory,
        modifiedAt: dosDateTimeToIso(dosDate, dosTime),
        localOffset: resolved.localOffset,
        method,
        flags,
      });
    }
  }
  return { entries, truncated: entries.length >= MAX_ENTRIES, totalSize, totalCompressedSize };
}

/**
 * zip64 扩展字段（0x0001）：只包含「32 位字段为 0xFFFFFFFF 的那些值」，
 * 按未压缩大小 → 压缩大小 → 本地头偏移 的顺序出现。
 * 不能按固定三个字段读：没被扩展的字段不会出现，错位会把偏移当大小。
 */
function readZip64Extra(
  extra: Buffer,
  base: { uncompressedSize: number; compressedSize: number; localOffset: number },
): { uncompressedSize: number; compressedSize: number; localOffset: number } {
  if (
    base.uncompressedSize !== UINT32_MAX &&
    base.compressedSize !== UINT32_MAX &&
    base.localOffset !== UINT32_MAX
  ) {
    return base;
  }
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    if (id === 0x0001) {
      let field = 0;
      const next = (): number | null => {
        if (field + 8 > body.length) return null;
        const value = Number(body.readBigUInt64LE(field));
        field += 8;
        return value;
      };
      const uncompressedSize =
        base.uncompressedSize === UINT32_MAX
          ? (next() ?? base.uncompressedSize)
          : base.uncompressedSize;
      const compressedSize =
        base.compressedSize === UINT32_MAX ? (next() ?? base.compressedSize) : base.compressedSize;
      const localOffset =
        base.localOffset === UINT32_MAX ? (next() ?? base.localOffset) : base.localOffset;
      return { uncompressedSize, compressedSize, localOffset };
    }
    cursor += 4 + size;
  }
  return base;
}

/** DOS 日期时间 → ISO；字段为 0 时返回 null。 */
function dosDateTimeToIso(date: number, time: number): string | null {
  if (!date) return null;
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hours = (time >> 11) & 0x1f;
  const minutes = (time >> 5) & 0x3f;
  const seconds = (time & 0x1f) * 2;
  const value = new Date(year, month, day, hours, minutes, seconds);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function isZipExtension(extension: string): boolean {
  return extension === "zip" || extension === "jar" || extension === "apk";
}

/**
 * 读取压缩包清单。不支持或损坏时抛错，由调用方降级为图标卡片。
 */
export async function readArchiveListing(filename: string): Promise<ArchiveListing> {
  const extension = path.extname(filename).replace(/^\./, "").toLowerCase();
  // rar / 7z 自带文件访问（WASM 侧挂载目录），tar 系流式扫描，都不走 handle。
  if (extension === "rar") return readRarListing(filename);
  if (extension === "7z") return readSevenZipListing(filename);
  if (extension === "tar") return readTarListing(filename);
  if (extension === "tgz") return readTgzListing(filename);
  if (extension === "gz") {
    const info = await stat(filename);
    return readGzipListing(filename, info.size);
  }
  if (!isZipExtension(extension)) throw new Error("ARCHIVE_FORMAT_UNSUPPORTED");

  const handle = await open(filename, "r");
  try {
    const info = await handle.stat();
    const directory = await readZipCentralDirectory(handle, info.size);
    return {
      format: "zip",
      entries: directory.entries.map(toPublicEntry),
      totalSize: directory.totalSize,
      totalCompressedSize: directory.totalCompressedSize,
      truncated: directory.truncated,
    };
  } finally {
    await handle.close();
  }
}

function toPublicEntry(entry: ZipCentralEntry): ArchiveEntry {
  return {
    path: entry.path,
    size: entry.size,
    compressedSize: entry.compressedSize,
    isDirectory: entry.isDirectory,
    modifiedAt: entry.modifiedAt,
  };
}

/** 从本地文件头定位条目数据区；中央目录的偏移是权威值。 */
async function readZipEntryData(handle: FileHandle, entry: ZipCentralEntry): Promise<Buffer> {
  if (entry.flags & 0x0001) throw new Error("ARCHIVE_ENTRY_ENCRYPTED");
  if (entry.isDirectory) return Buffer.alloc(0);
  if (entry.size > MAX_ENTRY_BYTES) throw new Error("ARCHIVE_ENTRY_TOO_LARGE");
  const localHeader = await readExactly(handle, entry.localOffset, 30);
  if (localHeader.length < 30 || localHeader.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error("ARCHIVE_INVALID:BAD_LOCAL_HEADER");
  }
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = await readExactly(handle, dataStart, entry.compressedSize);
  if (compressed.length < entry.compressedSize) {
    throw new Error("ARCHIVE_INVALID:TRUNCATED_ENTRY");
  }
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return Buffer.from(inflateSync(compressed));
  // bzip2 / lzma / zstd / AES 等：不内置解码器，明确拒绝而不是给出坏数据。
  throw new Error("ARCHIVE_METHOD_UNSUPPORTED");
}

/**
 * 解压单个条目（浏览压缩包内容用）。
 *
 * zip 只读该条目的本地头 + 压缩数据，不读整个包；tar 需先扫描定位。
 */
export async function extractArchiveEntry(
  filename: string,
  entryPath: string,
): Promise<ExtractedArchiveEntry> {
  const extension = path.extname(filename).replace(/^\./, "").toLowerCase();
  const target = normalizeEntryName(entryPath);
  if (!target) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
  if (extension === "rar") {
    const listing = await readRarListing(filename);
    const entry = listing.entries.find((candidate) => candidate.path === target);
    if (!entry) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
    return { data: await extractRarEntry(filename, target), entry };
  }
  if (extension === "7z") {
    const listing = await readSevenZipListing(filename);
    const entry = listing.entries.find((candidate) => candidate.path === target);
    if (!entry) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
    return { data: await extractSevenZipEntry(filename, target), entry };
  }
  if (extension === "tar" || extension === "tgz") {
    const gzipped = extension === "tgz";
    const data = await extractTarEntry(filename, target, gzipped);
    if (!data) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
    return {
      data,
      entry: {
        path: target,
        size: data.byteLength,
        compressedSize: data.byteLength,
        isDirectory: false,
        modifiedAt: null,
      },
    };
  }
  if (extension === "gz") {
    const data = await extractGzipEntry(filename);
    const info = await stat(filename);
    return {
      data,
      entry: {
        path: path.basename(filename, path.extname(filename)),
        size: data.byteLength,
        compressedSize: info.size,
        isDirectory: false,
        modifiedAt: null,
      },
    };
  }
  if (!isZipExtension(extension)) throw new Error("ARCHIVE_FORMAT_UNSUPPORTED");

  const handle = await open(filename, "r");
  try {
    const info = await handle.stat();
    const directory = await readZipCentralDirectory(handle, info.size);
    const entry = directory.entries.find((candidate) => candidate.path === target);
    if (!entry) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
    return { data: await readZipEntryData(handle, entry), entry: toPublicEntry(entry) };
  } finally {
    await handle.close();
  }
}
