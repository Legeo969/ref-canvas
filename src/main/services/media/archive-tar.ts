import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import type { ArchiveEntry, ArchiveListing } from "./archive-listing";

/**
 * TAR / TAR.GZ / GZ 的流式读取。
 *
 * tar 没有索引，只能顺序扫描；但扫描只需要读 512 字节头，数据块可以丢弃。
 * 因此几 GB 的 tar 也不会占用对等内存 —— 这是这组函数存在的理由。
 */

/** 单条目解压上限，与 zip 分支一致。 */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/**
 * 顺序字节流：只保留未消费的尾部，允许「跳过」而不缓存。
 * 输入可以是文件流，也可以是 gunzip 之后的流。
 */
class ByteStream {
  private readonly iterator: AsyncIterator<Buffer>;
  private pending: Buffer = Buffer.alloc(0);
  private ended = false;

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async pull(): Promise<boolean> {
    if (this.ended) return false;
    const { value, done } = await this.iterator.next();
    if (done || !value) {
      this.ended = true;
      return false;
    }
    this.pending = this.pending.length ? Buffer.concat([this.pending, value]) : value;
    return true;
  }

  /** 读满 n 字节；返回不足 n 表示流已结束。结果已复制，不持有内部块。 */
  async take(n: number): Promise<Buffer> {
    while (this.pending.length < n && (await this.pull())) {
      // 持续填充
    }
    const slice = this.pending.subarray(0, Math.min(n, this.pending.length));
    this.pending = this.pending.subarray(slice.length);
    return Buffer.from(slice);
  }

  /** 跳过 n 字节，不保留内容。 */
  async discard(n: number): Promise<void> {
    let remaining = n;
    while (remaining > 0) {
      if (!this.pending.length && !(await this.pull())) return;
      const step = Math.min(remaining, this.pending.length);
      this.pending = this.pending.subarray(step);
      remaining -= step;
    }
  }

  /** 把剩余内容读成一个 Buffer；超过 limit 抛错。 */
  async drain(limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    if (this.pending.length) {
      total += this.pending.length;
      chunks.push(this.pending);
      this.pending = Buffer.alloc(0);
    }
    while (await this.pull()) {
      total += this.pending.length;
      if (total > limit) throw new Error("ARCHIVE_ENTRY_TOO_LARGE");
      chunks.push(this.pending);
      this.pending = Buffer.alloc(0);
    }
    return Buffer.concat(chunks);
  }

  /** 消费剩余内容并返回字节数（用于 gz 清单，不保留数据）。 */
  async count(): Promise<number> {
    let total = this.pending.length;
    this.pending = Buffer.alloc(0);
    while (await this.pull()) {
      total += this.pending.length;
      this.pending = Buffer.alloc(0);
    }
    return total;
  }
}

interface TarHeader {
  name: string;
  size: number;
  isDirectory: boolean;
  mtimeIso: string | null;
}

/** 解析 ustar 头；返回 null 表示结束块或无效块。 */
function parseTarHeader(header: Buffer): TarHeader | null {
  if (header.every((byte) => byte === 0)) return null;
  const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
  if (!rawName) return null;
  // ustar 前缀字段（POSIX 长路径）。
  const prefix =
    header.subarray(257, 263).toString("latin1") === "ustar"
      ? header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "")
      : "";
  const name = (prefix ? `${prefix}/${rawName}` : rawName).replaceAll("\\", "/").replace(/^\/+/, "");
  const sizeField = header.subarray(124, 136).toString("latin1").replace(/\0.*$/, "").trim();
  const size = Number.parseInt(sizeField, 8) || 0;
  const mtimeField = header.subarray(136, 148).toString("latin1").replace(/\0.*$/, "").trim();
  const seconds = Number.parseInt(mtimeField, 8);
  return {
    name,
    size,
    isDirectory: rawName.endsWith("/"),
    mtimeIso: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
  };
}

/**
 * 顺序走一遍 tar。
 *
 * - 只给 onEntry：列清单位置，数据块直接丢弃；
 * - 给 target：命中时把该条目读出来并结束。
 */
async function walkTar(
  stream: ByteStream,
  options: { onEntry?: (entry: ArchiveEntry) => void; target?: string },
): Promise<Buffer | null> {
  while (true) {
    const headerBuffer = await stream.take(512);
    if (headerBuffer.length < 512) return null;
    const header = parseTarHeader(headerBuffer);
    if (!header) return null;
    const padded = Math.ceil(header.size / 512) * 512;

    if (options.target !== undefined && header.name === options.target) {
      if (header.isDirectory) return Buffer.alloc(0);
      if (header.size > MAX_ENTRY_BYTES) throw new Error("ARCHIVE_ENTRY_TOO_LARGE");
      return await stream.take(header.size);
    }
    options.onEntry?.({
      path: header.name,
      size: header.size,
      compressedSize: header.size,
      isDirectory: header.isDirectory,
      modifiedAt: header.mtimeIso,
    });
    await stream.discard(padded);
  }
}

function tarSource(filename: string): AsyncIterable<Buffer> {
  return createReadStream(filename);
}

function tgzSource(filename: string): AsyncIterable<Buffer> {
  return Readable.from(createReadStream(filename).pipe(createGunzip())) as AsyncIterable<Buffer>;
}

async function listFromStream(
  source: AsyncIterable<Buffer>,
  format: ArchiveListing["format"],
): Promise<ArchiveListing> {
  const entries: ArchiveEntry[] = [];
  let totalSize = 0;
  await walkTar(new ByteStream(source), {
    onEntry: (entry) => {
      totalSize += entry.size;
      entries.push(entry);
    },
  });
  return {
    format,
    entries,
    totalSize,
    totalCompressedSize: totalSize,
    truncated: false,
  };
}

export function readTarListing(filename: string): Promise<ArchiveListing> {
  return listFromStream(tarSource(filename), "tar");
}

export function readTgzListing(filename: string): Promise<ArchiveListing> {
  return listFromStream(tgzSource(filename), "tar");
}

/** gz 是单个字节流，清单就是“解压后多大”，流式计数而不保留内容。 */
export async function readGzipListing(
  filename: string,
  compressedSize: number,
): Promise<ArchiveListing> {
  const stream = new ByteStream(
    Readable.from(createReadStream(filename).pipe(createGunzip())) as AsyncIterable<Buffer>,
  );
  const size = await stream.count();
  return {
    format: "gzip",
    entries: [
      {
        path: filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""),
        size,
        compressedSize,
        isDirectory: false,
        modifiedAt: null,
      },
    ],
    totalSize: size,
    totalCompressedSize: compressedSize,
    truncated: false,
  };
}

/** gz 单文件提取：整个解压结果就是内容。 */
export async function extractGzipEntry(filename: string): Promise<Buffer> {
  const stream = new ByteStream(
    Readable.from(createReadStream(filename).pipe(createGunzip())) as AsyncIterable<Buffer>,
  );
  return stream.drain(MAX_ENTRY_BYTES);
}

export async function extractTarEntry(
  filename: string,
  target: string,
  gzipped: boolean,
): Promise<Buffer | null> {
  const source = gzipped ? tgzSource(filename) : tarSource(filename);
  return walkTar(new ByteStream(source), { target });
}
