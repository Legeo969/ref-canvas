import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
  WorkerJob,
  WorkerJobUpdate,
  WorkerOperation,
  WorkerResult,
} from "../../shared/worker-protocol";

interface ReplyEnvelope {
  type: "update" | "result";
  update?: WorkerJobUpdate;
  result?: WorkerResult;
}

interface JobEntry {
  job: WorkerJob;
  cacheKey: string | null;
  resolve(result: WorkerResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout | null;
  state: "queued" | "running" | "cancelled" | "failed";
  /** 附加到同一 cacheKey 上的等待者（cache-key 合并）。 */
  followers: Array<{ resolve(result: WorkerResult): void; reject(error: Error): void }>;
}

export interface SubmitJobOptions {
  providerId: string;
  operation: WorkerOperation;
  inputPath: string;
  options?: Record<string, unknown>;
  deadlineMs?: number;
  /**
   * 相同 cache key 的任务合并：若同 key 任务仍在运行/排队，则共享其结果，
   * 不重复下发到 worker。
   */
  cacheKey?: string;
  signal?: AbortSignal;
}

export interface WorkerSupervisorOptions {
  workerPath: string;
  serviceName: string;
  /** 同时运行的任务上限（bounded concurrency）。 */
  maxConcurrency?: number;
  /** worker 崩溃后 Main 重启的次数上限（默认 1 次）。 */
  maxRestarts?: number;
  /** 未显式指定 deadline 时的默认超时（ms，默认 30s）。 */
  defaultDeadlineMs?: number;
}

/**
 * 统一 worker 任务监督器（计划 §5.2）。
 *
 * 职责：惰性拉起 utilityProcess worker、按 bounded concurrency 派发
 * WorkerJob、支持进度更新、取消、deadline 超时、cache-key 合并，以及
 * worker 崩溃后由 Main 重启（最多 {@link maxRestarts} 次）。
 *
 * 单任务损坏只能使当前任务失败；worker 崩溃时在途任务被拒绝，等待队列
 * 中的任务在重启后的 worker 上重试一次，绝不阻塞主窗口。
 */
export class WorkerSupervisor {
  private child: UtilityProcess | null = null;
  private readonly events = new EventEmitter();
  private readonly pending = new Map<string, JobEntry>();
  private readonly queue: JobEntry[] = [];
  private readonly cacheQueue = new Map<string, JobEntry>();
  private running = 0;
  private restartCount = 0;
  private closing = false;
  private readonly maxConcurrency: number;
  private readonly maxRestarts: number;
  private readonly defaultDeadlineMs: number;
  private readonly workerPath: string;
  private readonly serviceName: string;

  constructor(options: WorkerSupervisorOptions) {
    this.workerPath = options.workerPath;
    this.serviceName = options.serviceName;
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.maxRestarts = options.maxRestarts ?? 1;
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? 30_000;
  }

  /** 已排队/运行中的任务数（含 cache followers）。 */
  size(): number {
    return this.pending.size + this.queue.length;
  }

  runningCount(): number {
    return this.running;
  }

  /** 订阅 worker 上报的任务进度/状态更新（§5.2）。 */
  onProgress(listener: (update: WorkerJobUpdate) => void): () => void {
    this.events.on("progress", listener);
    return () => this.events.off("progress", listener);
  }

  submit(options: SubmitJobOptions): Promise<WorkerResult> {
    const job: WorkerJob = {
      jobId: randomUUID(),
      providerId: options.providerId,
      operation: options.operation,
      inputPath: options.inputPath,
      options: options.options ?? {},
      deadlineMs: options.deadlineMs ?? this.defaultDeadlineMs,
    };
    if (this.closing) return Promise.reject(new Error("WORKER_SUPERVISOR_CLOSED"));

    return new Promise<WorkerResult>((resolve, reject) => {
      const entry: JobEntry = {
        job,
        cacheKey: options.cacheKey ?? null,
        resolve,
        reject,
        timer: null,
        state: "queued",
        followers: [],
      };
      if (options.signal) {
        if (options.signal.aborted) {
          reject(new Error("WORKER_JOB_CANCELLED"));
          return;
        }
        options.signal.addEventListener("abort", () => {
          this.cancelJob(entry);
        });
      }
      if (options.cacheKey && this.cacheQueue.has(options.cacheKey)) {
        // cache-key 合并：附加到既有任务，不重复下发。
        const primary = this.cacheQueue.get(options.cacheKey)!;
        if (primary.state === "cancelled" || primary.state === "failed") {
          this.cacheQueue.delete(options.cacheKey);
        } else {
          primary.followers.push({ resolve, reject });
          return;
        }
      }
      if (options.cacheKey) this.cacheQueue.set(options.cacheKey, entry);
      this.pending.set(job.jobId, entry);
      this.queue.push(entry);
      this.drain();
    });
  }

  /** 取消一个已排队/运行中的任务。 */
  private cancelJob(entry: JobEntry): void {
    if (entry.state === "cancelled" || entry.state === "failed") return;
    const wasQueued = entry.state === "queued";
    const wasRunning = entry.state === "running";
    entry.state = "cancelled";
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
    this.failFollowers(entry, new Error("WORKER_JOB_CANCELLED"));
    if (wasQueued) {
      const index = this.queue.indexOf(entry);
      if (index >= 0) this.queue.splice(index, 1);
    }
    this.pending.delete(entry.job.jobId);
    entry.reject(new Error("WORKER_JOB_CANCELLED"));
    if (this.child && wasRunning) {
      this.child.postMessage({ type: "cancel", jobId: entry.job.jobId });
    }
  }

  private drain(): void {
    while (this.running < this.maxConcurrency && this.queue.length) {
      const entry = this.queue.shift()!;
      if (entry.state === "cancelled") continue;
      this.running += 1;
      entry.state = "running";
      const child = this.ensureChild();
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (entry.state !== "running") return;
        entry.state = "failed";
        this.running -= 1;
        this.pending.delete(entry.job.jobId);
        if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
        this.failFollowers(entry, new Error("WORKER_JOB_TIMEOUT"));
        entry.reject(new Error("WORKER_JOB_TIMEOUT"));
        child.postMessage({ type: "cancel", jobId: entry.job.jobId });
        this.drain();
      }, entry.job.deadlineMs);
      child.postMessage({ type: "job", job: entry.job });
    }
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: this.serviceName,
    });
    child.on("message", (message: unknown) => this.handleMessage(message as ReplyEnvelope));
    child.once("error", () => this.handleWorkerDown());
    child.once("exit", () => this.handleWorkerDown());
    this.child = child;
    return child;
  }

  private handleMessage(message: ReplyEnvelope): void {
    if (message.type === "update") {
      const update = message.update;
      if (!update) return;
      // 转发进度/状态更新（§5.2：job ID 与 state 可追踪）。
      this.events.emit("progress", update);
      if (update.state === "failed") {
        const entry = this.pending.get(update.jobId);
        if (entry) this.failJob(entry, update.error ?? "WORKER_JOB_FAILED");
      }
      return;
    }
    if (message.type === "result" && message.result) {
      const entry = this.pending.get(message.result.jobId);
      if (!entry) return;
      this.completeJob(entry, message.result);
    }
  }

  private completeJob(entry: JobEntry, result: WorkerResult): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.state === "cancelled" || entry.state === "failed") return;
    entry.state = "failed"; // terminal guard：防止重复 resolve
    this.running = Math.max(0, this.running - 1);
    this.pending.delete(entry.job.jobId);
    if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
    for (const follower of entry.followers) follower.resolve(result);
    entry.followers = [];
    entry.resolve(result);
    this.drain();
  }

  private failJob(entry: JobEntry, message: string): void {
    if (entry.state === "cancelled" || entry.state === "failed") return;
    entry.state = "failed";
    if (entry.timer) clearTimeout(entry.timer);
    this.running = Math.max(0, this.running - 1);
    this.pending.delete(entry.job.jobId);
    if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
    const error = new Error(message);
    for (const follower of entry.followers) follower.reject(error);
    entry.followers = [];
    entry.reject(error);
    this.drain();
  }

  private failFollowers(entry: JobEntry, error: Error): void {
    for (const follower of entry.followers) follower.reject(error);
    entry.followers = [];
  }

  /** worker 崩溃/退出：拒绝在途任务，重启 worker（最多 maxRestarts 次），重试队列。 */
  private handleWorkerDown(): void {
    if (this.child) this.child = null;
    // 拒绝在途任务（它们的状态已不可靠）。
    for (const entry of [...this.pending.values()]) {
      if (entry.state !== "running") continue;
      entry.state = "failed";
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(entry.job.jobId);
      if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
      this.failFollowers(entry, new Error("WORKER_CRASHED"));
      entry.reject(new Error("WORKER_CRASHED"));
    }
    this.running = 0;
    // 重启计数：超限则直接失败剩余排队任务。
    if (this.restartCount >= this.maxRestarts) {
      const queued = this.queue.splice(0);
      for (const entry of queued) {
        if (entry.state === "cancelled") {
          this.pending.delete(entry.job.jobId);
          if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
          continue;
        }
        this.failFollowers(entry, new Error("WORKER_RESTART_EXHAUSTED"));
        entry.reject(new Error("WORKER_RESTART_EXHAUSTED"));
        this.pending.delete(entry.job.jobId);
        if (entry.cacheKey) this.cacheQueue.delete(entry.cacheKey);
      }
      return;
    }
    this.restartCount += 1;
    // 队列中的任务在新 worker 上重试（已失败的在途任务不重试）。
    this.drain();
  }

  /** 按 Main 退出顺序停止：script → geometry → media → index（由调用方排序）。 */
  async close(): Promise<void> {
    this.closing = true;
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      this.failFollowers(entry, new Error("WORKER_SUPERVISOR_CLOSED"));
      entry.reject(new Error("WORKER_SUPERVISOR_CLOSED"));
    }
    for (const entry of this.queue.splice(0)) {
      this.failFollowers(entry, new Error("WORKER_SUPERVISOR_CLOSED"));
      entry.reject(new Error("WORKER_SUPERVISOR_CLOSED"));
    }
    this.pending.clear();
    this.cacheQueue.clear();
    this.events.removeAllListeners();
    if (this.child) {
      this.child.postMessage({ type: "close" });
      this.child.kill();
      this.child = null;
    }
  }
}
