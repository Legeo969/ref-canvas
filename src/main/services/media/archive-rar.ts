import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExtractorFromFile } from "node-unrar-js";
import type { ArchiveEntry, ArchiveListing } from "./archive-listing";

/**
 * RAR 支持（node-unrar-js，官方 unrar 源码的 WASM 编译）。
 *
 * 走 createExtractorFromFile：不把整包读进内存，几百 MB 的包也能直接列出。
 * 注意 node-unrar-js 的 header/content 迭代器是懒的，必须遍历到底，
 * 否则 C++ 侧对象不析构（README「Memory Leak」一节）。
 */

/** RAR 的 time 是本地时间无时区（"2023-09-15T19:26:34.000"），统一成 ISO。 */
function rarTimeToIso(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function readRarListing(filename: string): Promise<ArchiveListing> {
  const entries: ArchiveEntry[] = [];
  let totalSize = 0;
  let totalCompressedSize = 0;
  try {
    const extractor = await createExtractorFromFile({ filepath: filename });
    // unrar 是懒打开：损坏包的错误在迭代 headers 时才抛。
    for (const header of extractor.getFileList().fileHeaders) {
      const name = header.name.replaceAll("\\", "/");
      const isDirectory = header.flags.directory || name.endsWith("/");
      totalSize += header.unpSize;
      totalCompressedSize += header.packSize;
      entries.push({
        path: name,
        size: header.unpSize,
        compressedSize: header.packSize,
        isDirectory,
        modifiedAt: rarTimeToIso(header.time),
      });
    }
  } catch (error) {
    // unrar 的 FailReason 统一成可判别的错误码；文件系统错误原样上抛。
    const reason = (error as { reason?: string }).reason;
    if (reason) throw new Error(`ARCHIVE_INVALID:RAR:${reason}`, { cause: error });
    throw error;
  }
  return {
    format: "rar",
    entries,
    totalSize,
    totalCompressedSize,
    truncated: false,
  };
}

/**
 * 提取单个条目。
 *
 * unrar 的 fromFile 模式只写文件系统、不回传内存，所以落临时目录再读回。
 * filenameTransform 强制 flatten 成序号名：既躲开包内路径穿越，
 * 也避免同名条目互相覆盖。
 */
export async function extractRarEntry(filename: string, target: string): Promise<Buffer> {
  const directory = await mkdtemp(path.join(tmpdir(), "refcanvas-rar-"));
  try {
    let counter = 0;
    const extractor = await createExtractorFromFile({
      filepath: filename,
      targetPath: directory,
      filenameTransform: () => `entry-${counter++}`,
    });
    const result = extractor.extract({ files: [target] });
    // 必须把迭代器走完，否则底层归档对象不释放。
    for (const _file of result.files) void _file;
    const written = await readFile(path.join(directory, "entry-0")).catch(() => null);
    if (!written) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
    return written;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
