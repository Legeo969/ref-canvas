import { BoardHistoryController } from "./controllers/history-controller";

export interface BoardPersistenceOperations {
  readonly blocked: () => boolean;
  readonly capture: () => Record<string, unknown>;
  readonly save: (snapshot: Record<string, unknown>) => Promise<void>;
  readonly setSaved: (saved: boolean) => void;
  readonly onSnapshot: () => void;
}

/** Owns history coalescing and debounced persistence independently of React. */
export class BoardPersistenceController {
  private animationFrame: number | null = null;
  private saveTimer: number | null = null;
  private pendingSnapshot: Record<string, unknown> | null = null;

  constructor(
    private readonly history: BoardHistoryController,
    private readonly operations: BoardPersistenceOperations,
  ) {}

  schedule(): void {
    if (this.operations.blocked() || this.animationFrame !== null) return;
    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = null;
      if (this.operations.blocked()) return;
      const snapshot = this.operations.capture();
      this.pendingSnapshot = snapshot;
      this.history.push(JSON.stringify(snapshot));
      this.operations.setSaved(false);
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        const pending = this.pendingSnapshot;
        if (!pending) return;
        void this.operations.save(pending).then(() => this.operations.setSaved(true));
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

  dispose(): void {
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.animationFrame = null;
    this.saveTimer = null;
    this.pendingSnapshot = null;
  }
}
