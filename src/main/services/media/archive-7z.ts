import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import SevenZip from "7z-wasm";
import type { ArchiveEntry, ArchiveListing } from "./archive-listing";

/**
 * 7z 支持（7z-wasm，官方 7-Zip 24.09 的 WASM 编译）。
 *
 * 通过 NODEFS 把宿主目录挂进 WASM 文件系统，7-Zip 直接读真实文件：
 * 数 GB 的包也不需要先复制进内存。清单走 `l -slt`（技术格式，
 * key = value 块），比默认的定宽表格好解析。
 */

const MOUNT_ROOT = "/nodefs";

interface RunResult {
  output: string;
  code: number;
}

/** 跑一次 7zz。Emscripten 在 exit 时抛 ExitStatus，用 status 当退出码。 */
async function runSevenZip(
  args: string[],
  cwd: string,
  extraMount?: { root: string; at: string },
): Promise<RunResult> {
  let output = "";
  let code = 0;
  const module = await SevenZip({
    print: (line: string) => {
      output += `${line}\n`;
    },
    printErr: (line: string) => {
      output += `${line}\n`;
    },
  });
  module.FS.mkdir(MOUNT_ROOT);
  module.FS.mount(module.NODEFS, { root: cwd }, MOUNT_ROOT);
  if (extraMount) {
    module.FS.mkdir(extraMount.at);
    module.FS.mount(module.NODEFS, { root: extraMount.root }, extraMount.at);
  }
  module.FS.chdir(MOUNT_ROOT);
  try {
    module.callMain(args);
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") code = status;
  }
  return { output, code };
}

type SevenZipBlock = Record<string, string>;

/** 按空行切分 key = value 块。 */
function parseBlocks(text: string): SevenZipBlock[] {
  const blocks: SevenZipBlock[] = [];
  let current: SevenZipBlock = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) {
      if (Object.keys(current).length) {
        blocks.push(current);
        current = {};
      }
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9 .]*?)\s*=\s?(.*)$/.exec(line);
    if (!match) continue;
    current[match[1]] = match[2];
  }
  if (Object.keys(current).length) blocks.push(current);
  return blocks;
}

/** `Modified = 2026-10-28 18:10:16.8620000`（本地时间）→ ISO。 */
function sevenZipTimeToIso(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isDirectoryEntry(block: SevenZipBlock): boolean {
  const attributes = block.Attributes ?? "";
  if (attributes.startsWith("D")) return true;
  return (block.Path ?? "").endsWith("/");
}

export async function readSevenZipListing(filename: string): Promise<ArchiveListing> {
  const directory = path.dirname(filename);
  const base = path.basename(filename);
  const { output } = await runSevenZip(["l", "-slt", base], directory);

  // 归档头与条目以一行短横线分隔。
  const separator = /\n-{5,}\n/;
  const parts = output.split(separator);
  const headerText = parts[0] ?? "";
  const entryText = parts.length > 1 ? parts.slice(1).join("\n") : "";
  // 7z 对非归档文件仍会打印 "Listing archive"，但归档头的 Type 为空；
  // 必须拿到非空 Type 才算真的解析出了归档。
  const headerBlock = parseBlocks(headerText).find((block) => Boolean(block.Type));
  if (!headerBlock) throw new Error("ARCHIVE_INVALID:SEVENZIP_LIST_FAILED");
  const entries: ArchiveEntry[] = [];
  let totalSize = 0;
  let totalCompressedSize = 0;
  for (const block of parseBlocks(entryText)) {
    const entryPath = (block.Path ?? "").replaceAll("\\", "/");
    if (!entryPath) continue;
    const isDirectory = isDirectoryEntry(block);
    const size = Number.parseInt(block.Size ?? "0", 10) || 0;
    // 固实压缩下只有块内第一个条目有 Packed Size，其余为空：
    // 按 0 计而不是猜，汇总后 UI 会显示「压缩后 ≈ 只统计首个条目」。
    const packed = Number.parseInt(block["Packed Size"] ?? "0", 10) || 0;
    totalSize += size;
    totalCompressedSize += packed;
    entries.push({
      path: entryPath,
      size,
      compressedSize: packed,
      isDirectory,
      modifiedAt: sevenZipTimeToIso(block.Modified),
    });
  }
  return {
    format: "sevenzip",
    entries,
    totalSize,
    totalCompressedSize,
    truncated: false,
  };
}

/**
 * 提取单个条目：输出到临时目录后读回。
 *
 * 条目的相对路径来自归档本身，可能含 `../`，读回前必须确认结果落在
 * 临时目录内。
 */
export async function extractSevenZipEntry(filename: string, target: string): Promise<Buffer> {
  const archiveDirectory = path.dirname(filename);
  const base = path.basename(filename);
  const outputRoot = await mkdtemp(path.join(tmpdir(), "refcanvas-7z-"));
  try {
    const { output, code } = await runSevenZip(
      ["x", base, `-o${MOUNT_ROOT_OUT}`, "-y", target],
      archiveDirectory,
      { root: outputRoot, at: MOUNT_ROOT_OUT },
    );
    if (code !== 0 && !output.includes("Everything is Ok")) {
      throw new Error("ARCHIVE_ENTRY_UNREADABLE");
    }
    const extracted = path.resolve(outputRoot, ...target.replaceAll("\\", "/").split("/"));
    const rootResolved = path.resolve(outputRoot);
    if (extracted !== rootResolved && !extracted.startsWith(rootResolved + path.sep)) {
      throw new Error("ARCHIVE_ENTRY_INVALID_PATH");
    }
    const info = await stat(extracted).catch(() => null);
    if (!info?.isFile()) throw new Error("ARCHIVE_ENTRY_NOT_FOUND");
    return await readFile(extracted);
  } finally {
    await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 7z 的输出挂载点（与输入目录分开，避免与包内同名路径冲突）。 */
const MOUNT_ROOT_OUT = "/nodefs-out";
