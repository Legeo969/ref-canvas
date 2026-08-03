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

/** 允许的最大递归深度，防止符号链接环导致栈溢出。 */
const MAX_DEPTH = 256;

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

/** 校验目录树内没有任何符号链接/结账逃逸出允许根（计划 §8.2）。 */
async function assertNoEscapingSymlinks(
  directory: string,
  allowedRoots: string[],
  depth = 0,
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error("TREE_DEPTH_EXCEEDED");
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = await realpath(fullPath).catch(() => null);
      if (!resolved) throw new Error("UNRESOLVABLE_SYMLINK");
      let within = false;
      for (const root of allowedRoots) {
        const resolvedRoot = await realpath(root).catch(() => null);
        if (!resolvedRoot) continue;
        const relative = path.relative(resolvedRoot, resolved);
        if (
          relative === "" ||
          (!relative.startsWith("..") && !path.isAbsolute(relative))
        ) {
          within = true;
          break;
        }
      }
      if (!within) throw new Error("SYMLINK_ESCAPES_SCOPE");
    } else if (entry.isDirectory()) {
      await assertNoEscapingSymlinks(fullPath, allowedRoots, depth + 1);
    }
  }
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
  /**
   * 破坏性操作前的 scan revision 校验（计划 §8.2）：目录扫描过期则拒绝
   * 执行，防止基于陈旧快照的破坏。options.revision 缺失时跳过。
   */
  validateRevision?: (directoryPath: string, revision: string) => Promise<void>;
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
    const resolved = await assertWithinRoots(filename, this.roots());
    const info = await stat(resolved);
    if (info.isDirectory()) {
      await assertNoEscapingSymlinks(resolved, this.roots());
    }
    return resolved;
  }

  private async validateRevision(options: FileOperationOptions): Promise<void> {
    if (!this.dependencies.validateRevision) return;
    if (!options.revision || !options.directoryPath) return;
    await this.dependencies.validateRevision(options.directoryPath, options.revision);
  }

  private async verifyTargetDirectory(directory: string): Promise<string> {
    const resolved = await assertWithinRoots(directory, this.roots());
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error("TARGET_NOT_DIRECTORY");
    return resolved;
  }

  /** 新建文件夹：同名冲突时追加序号，返回创建后的路径。 */
  async createFolder(
    parentPath: string,
    name: string,
    options: FileOperationOptions = {},
  ): Promise<string> {
    await this.validateRevision(options);
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
    await this.validateRevision(options);
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
    await this.validateRevision(options);
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
    const renamed = targetExists && conflict === "rename";
    if (options.kind === "move") {
      await this.moveAcrossVolumes(source, target, replaced);
      return { target, skipped: false, replaced, renamed };
    }
    // 复制到临时目标，成功后替换现有目标（原子性：copy 失败不删除现有目标）。
    await this.copyInto(source, target, replaced);
    return { target, skipped: false, replaced, renamed };
  }

  /**
   * 复制 source → target。replaced 时先复制到临时路径，成功后再原子替换，
   * 避免 copy 失败时永久删除现有目标。
   */
  private async copyInto(source: string, target: string, replaced: boolean): Promise<void> {
    if (!replaced) {
      await cp(source, target, { recursive: true, force: false });
      return;
    }
    const temporary = `${target}.${Date.now()}.${Math.random().toString(16).slice(2)}.partial`;
    try {
      await cp(source, temporary, { recursive: true, force: false });
      await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 移动：优先原子 rename；跨卷（EXDEV）走 copy→SHA-256 校验→回收站原文件。
   * 校验失败时删除已复制的目标，保持源文件完整。replace 冲突同样先写临时
   * 目标再原子替换，避免失败时丢失现有目标。
   */
  private async moveAcrossVolumes(
    source: string,
    target: string,
    replaced: boolean,
  ): Promise<void> {
    const renameFile = this.dependencies.renameForTest ?? rename;
    if (replaced) {
      // replace 跨卷 move：copy→校验→回收站，缺一不可（计划 §8.2）。
      await this.copyInto(source, target, true);
      try {
        await this.verifyCopy(source, target);
      } catch (error) {
        // 校验失败：回收已替换的目标，源文件保持完整。
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      await this.dependencies.trash(source);
      return;
    }
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

  /** 迭代式 SHA-256 校验（显式 worklist，避免深目录栈溢出）。 */
  private async verifyCopy(source: string, target: string): Promise<void> {
    const pending: Array<{ source: string; target: string }> = [
      { source, target },
    ];
    while (pending.length) {
      const { source: left, target: right } = pending.pop()!;
      const leftInfo = await stat(left);
      if (leftInfo.isFile()) {
        const [leftHash, rightHash] = await Promise.all([
          this.hashFile(left),
          this.hashFile(right),
        ]);
        if (leftHash !== rightHash) throw new Error("FILE_COPY_VERIFICATION_FAILED");
        continue;
      }
      if (!leftInfo.isDirectory()) throw new Error("UNSUPPORTED_SOURCE_TYPE");
      const [leftEntries, rightEntries] = await Promise.all([
        readdir(left, { withFileTypes: true }),
        readdir(right, { withFileTypes: true }),
      ]);
      const leftNames = new Set(leftEntries.map((entry) => entry.name));
      const rightNames = new Set(rightEntries.map((entry) => entry.name));
      if (leftNames.size !== rightNames.size) {
        throw new Error("FILE_COPY_VERIFICATION_FAILED");
      }
      for (const entry of leftEntries) {
        if (!rightNames.has(entry.name)) {
          throw new Error("FILE_COPY_VERIFICATION_FAILED");
        }
        pending.push({
          source: path.join(left, entry.name),
          target: path.join(right, entry.name),
        });
      }
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
