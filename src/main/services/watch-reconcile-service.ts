import { watch as watchNative, type FSWatcher as NativeFSWatcher } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { WatchRoot } from "../../shared/contracts";

export interface WatchReconcileCallbacks {
  onAdd(filename: string): void;
  onChange(filename: string): void;
  onUnlink(filename: string): void;
  onDirectoryChange(filename: string): void;
  onNativePath(filename: string, root: string): void;
  onError(rootId?: string): void;
}

export class WatchReconcileService {
  private watcher: FSWatcher | null = null;
  private readonly nativeWatchers = new Map<string, NativeFSWatcher>();
  private readonly nativeWatchTimers = new Map<string, NodeJS.Timeout>();
  private callbacks: WatchReconcileCallbacks | null = null;

  get active(): boolean {
    return this.callbacks !== null;
  }

  async start(
    roots: WatchRoot[],
    callbacks: WatchReconcileCallbacks,
  ): Promise<void> {
    if (this.active || !roots.length) return;
    this.callbacks = callbacks;
    if (process.platform === "win32") {
      for (const root of roots) {
        const resolvedRoot = path.resolve(root.path);
        // A recursive watcher on `C:\\` observes the app's own database,
        // cache, and dev build output, creating a self-triggering import loop.
        // Drive roots are still valid for manual browsing, but are too broad
        // to monitor safely.
        if (path.parse(resolvedRoot).root === resolvedRoot) continue;
        try {
          this.startNativeRoot(root);
        } catch {
          callbacks.onError(root.id);
        }
      }
      return;
    }
    this.watcher = watch(roots.map((item) => item.path), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
    });
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.watcher!.once("ready", settle);
      this.watcher!.once("error", settle);
      this.watcher!.on("add", callbacks.onAdd);
      this.watcher!.on("change", callbacks.onChange);
      this.watcher!.on("unlink", callbacks.onUnlink);
      this.watcher!.on("addDir", callbacks.onDirectoryChange);
      this.watcher!.on("unlinkDir", callbacks.onDirectoryChange);
      this.watcher!.on("error", () => callbacks.onError());
    });
  }

  addRoot(root: WatchRoot): void {
    if (!this.callbacks) return;
    if (process.platform === "win32") {
      const resolvedRoot = path.resolve(root.path);
      if (path.parse(resolvedRoot).root === resolvedRoot) return;
      try {
        this.startNativeRoot(root);
      } catch {
        this.callbacks.onError(root.id);
      }
    }
    else this.watcher?.add(path.resolve(root.path));
  }

  async removeRoot(rootPath: string): Promise<void> {
    const resolved = path.resolve(rootPath);
    await this.watcher?.unwatch(resolved);
    this.nativeWatchers.get(resolved)?.close();
    this.nativeWatchers.delete(resolved);
    for (const [filename, timer] of this.nativeWatchTimers) {
      if (filename === resolved || filename.startsWith(`${resolved}${path.sep}`)) {
        clearTimeout(timer);
        this.nativeWatchTimers.delete(filename);
      }
    }
  }

  async stop(): Promise<void> {
    this.callbacks = null;
    for (const timer of this.nativeWatchTimers.values()) clearTimeout(timer);
    this.nativeWatchTimers.clear();
    for (const watcher of this.nativeWatchers.values()) watcher.close();
    this.nativeWatchers.clear();
    await this.watcher?.close();
    this.watcher = null;
  }

  private startNativeRoot(root: WatchRoot): void {
    const resolvedRoot = path.resolve(root.path);
    if (this.nativeWatchers.has(resolvedRoot)) return;
    const watcher = watchNative(
      resolvedRoot,
      { persistent: false, recursive: true },
      (_event, relativeName) => {
        const callbacks = this.callbacks;
        if (!callbacks) return;
        if (!relativeName) {
          callbacks.onError(root.id);
          return;
        }
        const filename = path.join(resolvedRoot, relativeName.toString());
        const existing = this.nativeWatchTimers.get(filename);
        if (existing) clearTimeout(existing);
        this.nativeWatchTimers.set(
          filename,
          setTimeout(() => {
            this.nativeWatchTimers.delete(filename);
            this.callbacks?.onDirectoryChange(filename);
            this.callbacks?.onNativePath(filename, resolvedRoot);
          }, 700),
        );
      },
    );
    watcher.on("error", () => {
      watcher.close();
      this.nativeWatchers.delete(resolvedRoot);
      this.callbacks?.onError(root.id);
    });
    this.nativeWatchers.set(resolvedRoot, watcher);
  }
}
