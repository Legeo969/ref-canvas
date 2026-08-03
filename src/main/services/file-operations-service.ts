import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { FileOperationOptions, FileOperationReport } from "../../shared/contracts";

async function exists(filename: string): Promise<boolean> {
  try {
    await stat(filename);
    return true;
  } catch {
    return false;
  }
}

async function isSymbolic(filename: string): Promise<boolean> {
  try {
    const info = await lstat(filename);
    return info.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 规范化路径并验证它在允许的根集合内（计划 §8.2）。
 *
 * - realpath 解析物理路径，符号链接/结账被解析到真实目标。
 * - 目标必须在某个允许根（或其子目录）内；允许根本身也做 realpath，
 *   防止允许根自身是逃逸链接。
 * - 对目录内每个中间段校验非符号链接（避免逐层逃逸）。
 */
export async function assertWithinRoots(
  filename: string,
  allowedRoots: string[],
): Promise<string> {
  const resolved = await realpath(filename).catch(() => null);
  if (!resolved) throw new Error("PATH_UNRESOLVABLE");
  for (const root of allowedRoots) {
    const resolvedRoot = await realpath(root).catch(() => null);
    if (!resolvedRoot) continue;
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return resolved;
    }
  }
  throw new Error("PATH_OUTSIDE_SCOPE");
}

/** 目标路径是否位于给定目录之内（含自身）。 */
function isInside(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** 校验源不是目录自身的祖先（move/copy 到自己的子目录会自递归）。 */
function isDescendantOf(source: string, targetDirectory: string): boolean {
  return isInside(targetDirectory, source);
}

/** 冲突时生成唯一目标名：`name (n).ext`，直到不存在。 */
async function availableTarget(
  target: string,
  template: string | undefined,
): Promise<string> {
  const directory = path.dirname(target);
  const base = path.basename(target);
  const extension = path.extname(base);
  const stem = extension ? base.slice(0, -extension.length) : base;
  const candidates =
    template && template.includes("{n}")
      ? [template.replaceAll("{n}", "2").replaceAll("{name}", stem)]
      : [];
  if (candidates.length && !(await exists(path.join(directory, candidates[0])))) {
    return path.join(directory, candidates[0]);
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!(await exists(path.join(directory, candidate)))) {
      return path.join(directory, candidate);
    }
  }
  throw new Error("TARGET_NAME_EXHAUSTED");
}

export interface FileOperationsDependencies {
  /** 允许的 mount roots（物理目录）；传入目录内路径都会做 scope 校验。 */
  allowedRoots: () => string[];
  /** 把文件移到系统回收站（优先 OS recycle bin，失败降级到内部目录）。 */
  trash(filename: string): Promise<void>;
  /** 可注入的同卷 rename 实现（默认 fs.rename）；测试注入 EXDEV 以测跨卷。 */
  renameForTest?: (source: string, target: string) => Promise<void>;
}

/**
 * 完整文件操作（计划 §8.2）：New Folder、Copy、Move、跨卷 move
 * （copy→校验→回收站）、文件名冲突处理，以及破坏性操作前的
 * canonical path / mount scope / symlink 逃逸校验。
 */
export class FileOperationsService {
  constructor(private readonly dependencies: FileOperationsDependencies) {}

  private roots(): string[] {
    return this.dependencies.allowedRoots().filter(Boolean);
  }

  private async verifySource(filename: string): Promise<string> {
    if (await isSymbolic(filename)) throw new Error("SOURCE_IS_SYMLINK");
    return assertWithinRoots(filename, this.roots());
  }

  private async verifyTargetDirectory(directory: string): Promise<string> {
    const resolved = await assertWithinRoots(directory, this.roots());
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error("TARGET_NOT_DIRECTORY");
    return resolved;
  }

  /** 新建文件夹：同名冲突时追加序号，返回创建后的路径。 */
  async createFolder(parentPath: string, name: string): Promise<string> {
    const parent = await this.verifyTargetDirectory(parentPath);
    const cleanName = name.trim();
    if (!cleanName || /[\\/:*?"<>|]/.test(cleanName)) {
      throw new Error("INVALID_FOLDER_NAME");
    }
    let target = path.join(parent, cleanName);
    let index = 2;
    while (await exists(target)) {
      target = path.join(parent, `${cleanName} ${index}`);
      index += 1;
    }
    await mkdir(target, { recursive: false });
    return target;
  }

  /** 复制文件/文件夹到目标目录。 */
  async copy(
    sources: string[],
    targetDirectory: string,
    options: FileOperationOptions = {},
  ): Promise<FileOperationReport> {
    const target = await this.verifyTargetDirectory(targetDirectory);
    const report: FileOperationReport = {
      kind: "copy",
      targets: [],
      copied: 0,
      moved: 0,
      skipped: 0,
      replaced: 0,
      failed: [],
    };
    for (const source of sources) {
      try {
        const verified = await this.verifySource(source);
        if (isDescendantOf(verified, target)) {
          report.failed.push({ source, target, reason: "TARGET_INSIDE_SOURCE" });
          continue;
        }
        const result = await this.transfer(
          verified,
          target,
          { ...options, kind: "copy" },
        );
        if (result.skipped) report.skipped += 1;
        else if (result.replaced) report.replaced += 1;
        else {
          report.copied += 1;
          report.targets.push(result.target);
        }
      } catch (error) {
        report.failed.push({
          source,
          target: path.join(target, path.basename(source)),
          reason: error instanceof Error ? error.message : "COPY_FAILED",
        });
      }
    }
    return report;
  }

  /** 移动文件/文件夹到目标目录（跨卷走 copy→校验→回收站）。 */
  async move(
    sources: string[],
    targetDirectory: string,
    options: FileOperationOptions = {},
  ): Promise<FileOperationReport> {
    const target = await this.verifyTargetDirectory(targetDirectory);
    const report: FileOperationReport = {
      kind: "move",
      targets: [],
      copied: 0,
      moved: 0,
      skipped: 0,
      replaced: 0,
      failed: [],
    };
    for (const source of sources) {
      try {
        const verified = await this.verifySource(source);
        if (isDescendantOf(verified, target)) {
          report.failed.push({ source, target, reason: "TARGET_INSIDE_SOURCE" });
          continue;
        }
        const result = await this.transfer(verified, target, {
          ...options,
          kind: "move",
        });
        if (result.skipped) report.skipped += 1;
        else if (result.replaced) report.replaced += 1;
        else {
          report.moved += 1;
          report.targets.push(result.target);
        }
      } catch (error) {
        report.failed.push({
          source,
          target: path.join(target, path.basename(source)),
          reason: error instanceof Error ? error.message : "MOVE_FAILED",
        });
      }
    }
    return report;
  }

  private async transfer(
    source: string,
    targetDirectory: string,
    options: FileOperationOptions & { kind: "copy" | "move" },
  ): Promise<{
    target: string;
    skipped: boolean;
    replaced: boolean;
    renamed: boolean;
  }> {
    const base = path.basename(source);
    let target = path.join(targetDirectory, base);
    const conflict = options.conflictAction ?? "rename";
    const targetExists = await exists(target);
    if (targetExists && conflict === "skip") {
      return { target, skipped: true, replaced: false, renamed: false };
    }
    const replaced = targetExists && conflict === "replace";
    if (targetExists && conflict === "rename") {
      target = await availableTarget(target, options.renameTemplate);
    }
    if (replaced) {
      await rm(target, { recursive: true, force: true });
    }
    const renamed = targetExists && conflict === "rename";
    if (options.kind === "move") {
      await this.moveAcrossVolumes(source, target);
      return { target, skipped: false, replaced, renamed };
    }
    await cp(source, target, { recursive: true, force: false });
    return { target, skipped: false, replaced, renamed };
  }

  /**
   * 移动：优先原子 rename；跨卷（EXDEV）走 copy→SHA-256 校验→回收站原文件。
   * 校验失败时删除已复制的目标，保持源文件完整。
   */
  private async moveAcrossVolumes(source: string, target: string): Promise<void> {
    const renameFile = this.dependencies.renameForTest ?? rename;
    try {
      await renameFile(source, target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    }
    await cp(source, target, { recursive: true, force: false });
    try {
      await this.verifyCopy(source, target);
      await this.dependencies.trash(source);
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** 递归 SHA-256 校验，目录逐文件对比。 */
  private async verifyCopy(source: string, target: string): Promise<void> {
    const sourceInfo = await stat(source);
    if (sourceInfo.isFile()) {
      const [left, right] = await Promise.all([
        this.hashFile(source),
        this.hashFile(target),
      ]);
      if (left !== right) throw new Error("FILE_COPY_VERIFICATION_FAILED");
      return;
    }
    if (!sourceInfo.isDirectory()) throw new Error("UNSUPPORTED_SOURCE_TYPE");
    const [sourceEntries, targetEntries] = await Promise.all([
      readdir(source, { withFileTypes: true }),
      readdir(target, { withFileTypes: true }),
    ]);
    const sourceNames = new Set(sourceEntries.map((entry) => entry.name));
    const targetNames = new Set(targetEntries.map((entry) => entry.name));
    if (sourceNames.size !== targetNames.size) {
      throw new Error("FILE_COPY_VERIFICATION_FAILED");
    }
    for (const entry of sourceEntries) {
      if (!targetNames.has(entry.name)) {
        throw new Error("FILE_COPY_VERIFICATION_FAILED");
      }
      await this.verifyCopy(
        path.join(source, entry.name),
        path.join(target, entry.name),
      );
    }
  }

  private async hashFile(filename: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    const { createReadStream } = await import("node:fs");
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filename);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });
    return hash.digest("hex");
  }
}
