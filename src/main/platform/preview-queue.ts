export interface PreviewQueueStats {
  active: number;
  queued: number;
  inFlight: number;
}

export interface PreviewQueueOptions {
  /** Smaller values run first. */
  priority?: number;
  signal?: AbortSignal;
}

interface QueueItem<T> {
  key: string;
  priority: number;
  sequence: number;
  task: (signal: AbortSignal) => Promise<T>;
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  controller: AbortController;
  active: boolean;
  persistentConsumers: number;
  signalConsumers: Set<AbortSignal>;
}

/** Bounded, priority-aware and deduplicated background work queue. */
export class PreviewQueue<T> {
  private readonly queue: QueueItem<T>[] = [];
  private readonly inFlight = new Map<string, QueueItem<T>>();
  private active = 0;
  private sequence = 0;

  constructor(
    private maximumConcurrent = 4,
    private readonly maximumQueued = 512,
  ) {
    if (maximumConcurrent < 1 || maximumQueued < 1) {
      throw new Error("PREVIEW_QUEUE_LIMIT_INVALID");
    }
  }

  /** 运行时调整并发（阶段 5：性能偏好）。 */
  setConcurrency(concurrent: number): void {
    if (concurrent < 1) throw new Error("PREVIEW_QUEUE_LIMIT_INVALID");
    this.maximumConcurrent = concurrent;
  }

  enqueue(
    key: string,
    task: ((signal: AbortSignal) => Promise<T>) | (() => Promise<T>),
    options: PreviewQueueOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(new Error("PREVIEW_QUEUE_ABORTED"));
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      this.addConsumer(existing, options.signal);
      const priority = options.priority ?? existing.priority;
      if (!existing.active && priority < existing.priority) {
        existing.priority = priority;
        this.sortQueue();
      }
      return existing.promise;
    }
    if (this.queue.length >= this.maximumQueued) {
      return Promise.reject(new Error("PREVIEW_QUEUE_FULL"));
    }

    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const item: QueueItem<T> = {
      key,
      priority: options.priority ?? 20,
      sequence: this.sequence++,
      task,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      controller: new AbortController(),
      active: false,
      persistentConsumers: 0,
      signalConsumers: new Set(),
    };
    this.addConsumer(item, options.signal);
    this.inFlight.set(key, item);
    this.queue.push(item);
    this.sortQueue();
    this.pump();
    return promise;
  }

  stats(): PreviewQueueStats {
    return {
      active: this.active,
      queued: this.queue.length,
      inFlight: this.inFlight.size,
    };
  }

  clear(reason = "PREVIEW_QUEUE_CLEARED"): void {
    for (const item of this.queue.splice(0)) {
      this.inFlight.delete(item.key);
      item.controller.abort();
      item.reject(new Error(reason));
    }
    for (const item of this.inFlight.values()) {
      if (item.active) item.controller.abort();
    }
  }

  private addConsumer(item: QueueItem<T>, signal?: AbortSignal): void {
    if (!signal) {
      item.persistentConsumers += 1;
      return;
    }
    if (item.signalConsumers.has(signal)) return;
    item.signalConsumers.add(signal);
    signal.addEventListener(
      "abort",
      () => {
        item.signalConsumers.delete(signal);
        if (item.persistentConsumers || item.signalConsumers.size) return;
        if (item.active) {
          // 进行中的任务已持有解码器/子进程：结果会写入持久缓存，中止只会
          // 浪费已完成的工作并让下一次相同请求从头再来。布局拖拽会高频中止
          // 预览请求（重排→旧 fetch 作废），若连带杀死解码，大目录缩略图
          // 会一直「正在生成预览」。让任务跑完即可，无人等待也无妨。
          return;
        }
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        this.inFlight.delete(item.key);
        item.controller.abort();
        item.reject(new Error("PREVIEW_QUEUE_ABORTED"));
      },
      { once: true },
    );
  }

  private sortQueue(): void {
    this.queue.sort(
      (left, right) =>
        left.priority - right.priority || left.sequence - right.sequence,
    );
  }

  private pump(): void {
    while (this.active < this.maximumConcurrent && this.queue.length) {
      const item = this.queue.shift()!;
      item.active = true;
      this.active += 1;
      void Promise.resolve()
        .then(() => item.task(item.controller.signal))
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.inFlight.delete(item.key);
          this.pump();
        });
    }
  }
}
