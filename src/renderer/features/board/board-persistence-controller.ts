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
  /** 宏任务兜底句柄：隐藏窗口 rAF 停摆时仍能捕获快照（见 schedule 注释）。 */
  private scheduleFallback: number | null = null;
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
    // 隐藏/被遮挡的窗口里 Chromium 把 requestAnimationFrame 节流到 0
    // （Electron backgroundThrottling）：只靠 rAF 捕获快照，用户切走窗口
    // 后的编辑会永远落不了盘（打包冒烟 BOARD_PNG_FORMAT_CARD 的成因——
    // 对象已上画布，但快照从未被捕获，磁盘文档始终为空）。
    // 用宏任务兜底与 rAF 竞速：谁先触发谁执行并取消另一路；正常前台时
    // rAF 先到，批处理语义与原来完全一致。
    let fired = false;
    const run = () => {
      if (fired) return;
      fired = true;
      if (this.animationFrame !== null) {
        window.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      if (this.scheduleFallback !== null) {
        window.clearTimeout(this.scheduleFallback);
        this.scheduleFallback = null;
      }
      if (this.operations.blocked()) return;
      this.captureSnapshot();
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        this.queuePendingSave();
      }, 500);
      this.operations.onSnapshot();
    };
    this.animationFrame = window.requestAnimationFrame(run);
    this.scheduleFallback = window.setTimeout(run, 32);
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
    if (this.animationFrame !== null || this.scheduleFallback !== null) {
      if (this.animationFrame !== null) {
        window.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      if (this.scheduleFallback !== null) {
        window.clearTimeout(this.scheduleFallback);
        this.scheduleFallback = null;
      }
      if (!this.operations.blocked()) this.captureSnapshot();
    }
    this.queuePendingSave();
    await this.saveChain;
    if (this.lastSaveError) throw this.lastSaveError;
  }

  dispose(): void {
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    if (this.scheduleFallback !== null) window.clearTimeout(this.scheduleFallback);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.animationFrame = null;
    this.scheduleFallback = null;
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
