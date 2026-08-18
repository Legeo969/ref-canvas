import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * SPEC-6：fsync 一个文件，确保其内容与元数据落盘后再 rename/使用。
 * 用于 tmp 文件写完后、rename 前，防止断电时 rename 元数据与文件数据
 * 不一致导致目标文件丢失或损坏。
 */
export async function fsyncFile(filename: string): Promise<void> {
  const handle = await open(filename, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * SPEC-6：fsync 一个目录，确保其中的 rename 元数据落盘。
 * Node 在 Windows 上无法用普通 open 打开目录，此处 best-effort：
 * 失败即忽略（Windows 上目录 fsync 行为本就有限，文件 fsync 已保证数据）。
 */
export async function fsyncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Windows / 不支持目录 fd 的平台：best-effort，忽略。
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * SPEC-6：原子写文件（tmp + fsync + rename + 目录 fsync）。
 * 比裸 `writeFile` 更持久：断电时不会出现"目标文件存在但内容为空/半截"。
 */
export async function writeFileDurable(
  filename: string,
  data: string | Buffer,
  options?: { encoding?: BufferEncoding },
): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, options);
  await fsyncFile(temporary);
  await rename(temporary, filename);
  await fsyncDirectory(path.dirname(filename)).catch(() => undefined);
}

/**
 * SPEC-6：原子复制文件（tmp + fsync + rename + 目录 fsync），用于关键
 * 备份/恢复操作（如 `.before-restore` 回滚副本），确保断电不丢半截文件。
 */
export async function copyFileDurable(source: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await copyFile(source, temporary);
  await fsyncFile(temporary);
  await rename(temporary, target);
  await fsyncDirectory(path.dirname(target)).catch(() => undefined);
}
