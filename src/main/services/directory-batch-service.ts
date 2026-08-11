import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  DirectoryBatchAction,
  DirectoryBatchSnapshot,
  DirectorySelectionScope,
} from "../../shared/contracts";

interface BatchDependencies {
  resolveSelection(
    selection: Exclude<DirectorySelectionScope, { mode: "explicit" }>,
    offset: number,
  ): Promise<{ paths: string[]; nextOffset: number | null; total: number }>;
  process(path: string, action: DirectoryBatchAction): Promise<void>;
}

export class DirectoryBatchService {
  private readonly jobs = new Map<string, DirectoryBatchSnapshot>();
  private readonly cancelled = new Set<string>();
  private readonly events = new EventEmitter();
  private readonly pathGuards = new Map<string, (filename: string) => Promise<string>>();

  constructor(private readonly dependencies: BatchDependencies) {}

  onProgress(listener: (snapshot: DirectoryBatchSnapshot) => void): () => void {
    this.events.on("progress", listener);
    return () => this.events.off("progress", listener);
  }

  start(
    selection: DirectorySelectionScope,
    action: DirectoryBatchAction,
    pathGuard?: (filename: string) => Promise<string>,
  ): DirectoryBatchSnapshot {
    const now = new Date().toISOString();
    const snapshot: DirectoryBatchSnapshot = {
      id: randomUUID(),
      state: "running",
      action,
      total: selection.mode === "explicit" ? selection.paths.length : 0,
      processed: 0,
      failed: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(snapshot.id, snapshot);
    if (pathGuard) this.pathGuards.set(snapshot.id, pathGuard);
    void this.run(snapshot, selection);
    return { ...snapshot, failed: [...snapshot.failed] };
  }

  get(id: string): DirectoryBatchSnapshot | null {
    const snapshot = this.jobs.get(id);
    return snapshot ? { ...snapshot, failed: [...snapshot.failed] } : null;
  }

  /** 全部批处理快照（新到旧）。 */
  list(): DirectoryBatchSnapshot[] {
    return [...this.jobs.values()]
      .map((snapshot) => ({ ...snapshot, failed: [...snapshot.failed] }))
      .reverse();
  }

  cancel(id: string): boolean {
    const snapshot = this.jobs.get(id);
    if (!snapshot || snapshot.state !== "running") return false;
    this.cancelled.add(id);
    return true;
  }

  close(): void {
    for (const snapshot of this.jobs.values()) {
      if (snapshot.state === "running") this.cancelled.add(snapshot.id);
    }
    this.events.removeAllListeners();
  }

  private emit(snapshot: DirectoryBatchSnapshot): void {
    snapshot.updatedAt = new Date().toISOString();
    this.events.emit("progress", this.get(snapshot.id));
  }

  private async run(
    snapshot: DirectoryBatchSnapshot,
    selection: DirectorySelectionScope,
  ): Promise<void> {
    try {
      if (selection.mode === "explicit") {
        await this.processPaths(snapshot, selection.paths);
      } else {
        let offset = 0;
        while (!this.cancelled.has(snapshot.id)) {
          const page = await this.dependencies.resolveSelection(selection, offset);
          snapshot.total = page.total;
          await this.processPaths(snapshot, page.paths);
          if (page.nextOffset === null) break;
          offset = page.nextOffset;
        }
      }
      snapshot.state = this.cancelled.has(snapshot.id) ? "cancelled" : "completed";
    } catch (error) {
      snapshot.state = "failed";
      snapshot.failed.push({
        path:
          selection.mode === "all"
            ? selection.directoryPath
            : selection.mode === "search"
              ? selection.searchId
              : "",
        reason: error instanceof Error ? error.message : "DIRECTORY_BATCH_FAILED",
      });
    } finally {
      this.cancelled.delete(snapshot.id);
      this.pathGuards.delete(snapshot.id);
      this.emit(snapshot);
    }
  }

  private async processPaths(
    snapshot: DirectoryBatchSnapshot,
    paths: string[],
  ): Promise<void> {
    for (const filename of paths) {
      if (this.cancelled.has(snapshot.id)) return;
      try {
        const guarded = await this.pathGuards.get(snapshot.id)?.(filename) ?? filename;
        await this.dependencies.process(guarded, snapshot.action);
      } catch (error) {
        snapshot.failed.push({
          path: filename,
          reason: error instanceof Error ? error.message : "DIRECTORY_BATCH_ITEM_FAILED",
        });
      }
      snapshot.processed += 1;
      if (snapshot.processed % 25 === 0) this.emit(snapshot);
    }
  }
}
