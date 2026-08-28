import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface EnumeratedImportPath {
  filename: string;
  sourceRoot: string | null;
}

export interface ImportEnumerator {
  enumerate(
    inputPaths: string[],
    signal: AbortSignal,
    onBatch: (items: EnumeratedImportPath[]) => Promise<void>,
    excludedRoots?: string[],
  ): Promise<number>;
  close(): void;
}

export function isExcludedImportPath(
  filename: string,
  excludedRoots: string[],
): boolean {
  const resolved = path.resolve(filename);
  return excludedRoots.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

export class LocalImportEnumerator implements ImportEnumerator {
  async enumerate(
    inputPaths: string[],
    signal: AbortSignal,
    onBatch: (items: EnumeratedImportPath[]) => Promise<void>,
    excludedRoots: string[] = [],
  ): Promise<number> {
    let batch: EnumeratedImportPath[] = [];
    let discovered = 0;
    const flush = async () => {
      if (!batch.length) return;
      const ready = batch;
      batch = [];
      await onBatch(ready);
    };
    for (const inputPath of inputPaths) {
      signal.throwIfAborted();
      const resolved = path.resolve(inputPath);
      if (isExcludedImportPath(resolved, excludedRoots)) continue;
      const info = await stat(resolved);
      if (info.isFile()) {
        batch.push({ filename: resolved, sourceRoot: null });
        discovered += 1;
        if (batch.length === 512) await flush();
        continue;
      }
      if (!info.isDirectory()) continue;
      const directories = [resolved];
      for (let index = 0; index < directories.length; index += 1) {
        signal.throwIfAborted();
        const directory = directories[index];
        if (isExcludedImportPath(directory, excludedRoots)) continue;
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          const filename = path.join(directory, entry.name);
          if (isExcludedImportPath(filename, excludedRoots)) continue;
          if (entry.isDirectory()) directories.push(filename);
          else if (entry.isFile()) {
            batch.push({ filename, sourceRoot: resolved });
            discovered += 1;
            if (batch.length === 512) await flush();
          }
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    await flush();
    return discovered;
  }

  close(): void {}
}
