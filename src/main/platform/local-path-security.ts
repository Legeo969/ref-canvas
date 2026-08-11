import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type CanonicalPathMode = "existing" | "destination";

function windowsDrive(filename: string): string | null {
  if (/^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/.test(filename)) return null;
  if (!/^[A-Za-z]:[\\/]/.test(filename)) return null;
  return `${filename[0].toUpperCase()}:`;
}

function hasUnsafeWindowsComponent(filename: string): boolean {
  if (filename.slice(2).includes(":")) return true; // NTFS alternate data stream.
  return filename
    .slice(3)
    .split(/[\\/]/)
    .some((segment) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}

/** Only absolute local filesystem paths are accepted; URLs, UNC/device and relatives are rejected. */
export function assertAbsoluteLocalPath(filename: string): string {
  if (typeof filename !== "string" || filename.length === 0 || filename.length > 32_768) {
    throw new Error("INVALID_LOCAL_PATH");
  }
  if (process.platform === "win32" || /^[A-Za-z]:[\\/]/.test(filename)) {
    if (!windowsDrive(filename) || hasUnsafeWindowsComponent(filename)) {
      throw new Error("INVALID_LOCAL_PATH");
    }
    return path.win32.normalize(filename);
  }
  if (!path.isAbsolute(filename) || filename.startsWith("//")) {
    throw new Error("INVALID_LOCAL_PATH");
  }
  return path.normalize(filename);
}

export function driveForLocalPath(filename: string): string {
  const local = assertAbsoluteLocalPath(filename);
  const drive = windowsDrive(local);
  return drive ?? path.parse(local).root;
}

async function nearestExistingAncestor(filename: string): Promise<{
  realAncestor: string;
  suffix: string[];
}> {
  const suffix: string[] = [];
  let cursor = filename;
  while (true) {
    try {
      await lstat(cursor);
      return { realAncestor: await realpath(cursor), suffix };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error("LOCAL_PATH_PARENT_NOT_FOUND", { cause: error });
      }
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function canonicalizeLocalPath(
  filename: string,
  mode: CanonicalPathMode,
): Promise<string> {
  const local = assertAbsoluteLocalPath(filename);
  if (mode === "existing") {
    await lstat(local);
    return assertAbsoluteLocalPath(await realpath(local));
  }
  const { realAncestor, suffix } = await nearestExistingAncestor(local);
  const canonical = path.resolve(realAncestor, ...suffix);
  const relative = path.relative(realAncestor, canonical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("LOCAL_PATH_PARENT_ESCAPE");
  }
  return assertAbsoluteLocalPath(canonical);
}

export function isPathInsideRoot(filename: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
