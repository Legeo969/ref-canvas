import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

interface FileManagerShell {
  openPath(filename: string): Promise<string>;
  showItemInFolder(filename: string): void;
}

export async function revealInFileManager(
  filename: string,
  fileManager: FileManagerShell,
  statPath: (filename: string) => Promise<Stats> = stat,
): Promise<void> {
  const resolved = path.resolve(filename);
  const info = await statPath(resolved).catch(() => null);
  if (info?.isFile()) {
    fileManager.showItemInFolder(resolved);
    return;
  }

  const directory = info?.isDirectory() ? resolved : path.dirname(resolved);
  if (!info) {
    const parentInfo = await statPath(directory).catch(() => null);
    if (!parentInfo?.isDirectory()) throw new Error("PATH_NOT_FOUND");
  }

  const error = await fileManager.openPath(directory);
  if (error) throw new Error(error);
}
