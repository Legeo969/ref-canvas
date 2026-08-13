import { BoardHistoryController } from "./controllers/history-controller";

export interface BoardPersistenceOperations {
  readonly blocked: () => boolean;
  readonly capture: () => Record<string, unknown>;
  readonly save: (snapshot: Record<string, unknown>) => Promise<void>;
  readonly setSaved: (saved: boolean) => void;
  readonly onSnapshot: () => void;
  readonly onSaveError?: (
    error: unknown,
    snapshot: Record<string, unknown>,
  ) => void | Promise<void>;
}

/** Owns history coalescing and debounced persistence independently of React. */
export class BoardPersistenceController {
  private animationFrame: number | null = null;
  private saveTimer: number | null = null;
  private pendingSnapshot: Record<string, unknown> | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private lastSaveError: unknown = null;

  constructor(
    private readonly history: BoardHistoryController,
    private readonly operations: BoardPersistenceOperations,
  ) {}

  schedule(): void {
    if (this.operations.blocked() || this.animationFrame !== null) return;
    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = null;
      if (this.operations.blocked()) return;
      this.captureSnapshot();
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        this.queuePendingSave();
      }, 500);
      this.operations.onSnapshot();
    });
  }

  historyEntry(offset: -1 | 1) {
    return this.history.entry(offset);
  }

  commitHistory(index: number): void {
    this.history.commit(index);
  }

  /** Persists the latest captured document and waits for any in-flight save. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      if (!this.operations.blocked()) this.captureSnapshot();
    }
    this.queuePendingSave();
    await this.saveChain;
    if (this.lastSaveError) throw this.lastSaveError;
  }

  dispose(): void {
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.animationFrame = null;
    this.saveTimer = null;
    this.pendingSnapshot = null;
  }

  private queuePendingSave(): void {
    const pending = this.pendingSnapshot;
    if (!pending) return;
    this.pendingSnapshot = null;
    this.saveChain = this.saveChain.catch(() => undefined).then(async () => {
      try {
        await this.operations.save(pending);
        this.lastSaveError = null;
        this.operations.setSaved(true);
      } catch (error) {
        this.lastSaveError = error;
        await this.operations.onSaveError?.(error, pending);
      }
    });
  }

  private captureSnapshot(): void {
    const snapshot = this.operations.capture();
    this.pendingSnapshot = snapshot;
    this.history.push(JSON.stringify(snapshot));
    this.operations.setSaved(false);
    this.operations.onSnapshot();
  }
}
