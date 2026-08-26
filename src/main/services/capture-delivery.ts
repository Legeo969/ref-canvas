/**
 * 浏览器扩展捕获的可靠投递。
 *
 * 此前的投递是 fire-and-forget：主进程把捕获路径 webContents.send 给
 * mainWindow 就完事——窗口不存在（后台驻留/关闭中）、渲染端导入抛错、
 * 只开了白板子窗口等场景下事件被静默丢弃：托盘里显示"已连接"、徽标 OK，
 * 白板上却永远不出现，文件还在宽限期后被孤儿清理删掉。
 *
 * 这里改为「确认制」：
 * - 投递时附带 captureId，渲染端完成导入后经 browser:capture-ack 回执；
 * - 无存活目标立即入队；有目标但超时未回执也入队；
 * - 队列在新窗口就绪 / second-instance 时重投（flushQueue）；
 * - 入队即通过托盘气泡告知用户「已暂存 N 个网页捕获」（防抖合并）。
 */

/** 投递目标需要的最小窗口接口（便于单测伪造）。 */
export interface CaptureDeliveryTarget {
  readonly id: number | string;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  /** 可选：聚焦优先——用户正盯着的窗口先收到捕获。 */
  isFocused?(): boolean;
}

export interface CapturedPayload {
  path: string;
  sourceUrl: string;
}

export interface CaptureDeliveryOptions {
  /** 按优先级排列的目标（第一项为默认收件人）。 */
  getTargets: () => CaptureDeliveryTarget[];
  /** 回执超时（ms），默认 15s：隐藏节流的渲染端也需要留足时间。 */
  ackTimeoutMs?: number;
  /** 入队暂存时的用户提示（托盘气泡），参数为当前队列长度。 */
  notifyStored?: (queuedCount: number) => void;
  /** 提示防抖窗口（ms），默认 2s，测试可调小。 */
  notifyDebounceMs?: number;
}

const MAX_QUEUE = 100;

export class CaptureDeliveryService {
  private readonly options: CaptureDeliveryOptions;
  private readonly pendingAcks = new Map<string, () => void>();
  private readonly queue: CapturedPayload[] = [];
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: CaptureDeliveryOptions) {
    this.options = options;
  }

  /**
   * 捕获服务器写盘后的入口：挑一个存活目标投递并等待回执；
   * 没有目标或回执超时则入队暂存（幂等：调用方只管发）。
   */
  deliver(capture: CapturedPayload): void {
    const targets = this.options.getTargets().filter((t) => !t.isDestroyed());
    const target =
      targets.find((t) => t.isFocused?.()) ?? targets[0] ?? null;
    if (!target) {
      this.enqueue(capture);
      return;
    }
    const captureId = this.issueCapture(target, capture);
    const timeoutMs = this.options.ackTimeoutMs ?? 15_000;
    const timer = setTimeout(() => {
      if (!this.pendingAcks.has(captureId)) return;
      this.pendingAcks.delete(captureId);
      // 目标没死但迟迟不回执（挂起/卡死）：换队列入栈，等待下次重投。
      this.enqueue(capture);
    }, timeoutMs);
    this.pendingAcks.set(captureId, () => clearTimeout(timer));
  }

  /** 渲染端导入完成后的回执（ipcMain.on("browser:capture-ack") 转发到这里）。 */
  handleAck(captureId: string): void {
    const settle = this.pendingAcks.get(captureId);
    if (!settle) return;
    this.pendingAcks.delete(captureId);
    settle();
  }

  /**
   * 重投队列（新窗口 ready-to-show / second-instance / 托盘打开时调用）。
   * 队列非空且有存活目标时逐条重新走 deliver（重新计 ack 超时）。
   */
  flushQueue(): void {
    while (this.queue.length > 0) {
      const targets = this.options.getTargets().filter((t) => !t.isDestroyed());
      if (targets.length === 0) return;
      const next = this.queue.shift();
      if (next) this.deliver(next);
    }
  }

  /** 当前暂存量（诊断用）。 */
  get queuedCount(): number {
    return this.queue.length;
  }

  private issueCapture(
    target: CaptureDeliveryTarget,
    capture: CapturedPayload,
  ): string {
    const captureId = globalThis.crypto.randomUUID();
    target.send("browser:capture", { ...capture, captureId });
    return captureId;
  }

  private enqueue(capture: CapturedPayload): void {
    this.queue.push(capture);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.scheduleNotify();
  }

  /** 防抖合并：一串连续入队只弹一次气泡，且带最终数量。 */
  private scheduleNotify(): void {
    if (!this.options.notifyStored) return;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    const debounceMs = this.options.notifyDebounceMs ?? 2_000;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.options.notifyStored?.(this.queue.length);
    }, debounceMs);
  }

  /** 测试辅助：清掉内部定时器，避免 vitest 句柄泄漏告警。 */
  dispose(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    for (const settle of this.pendingAcks.values()) settle();
    this.pendingAcks.clear();
  }
}
