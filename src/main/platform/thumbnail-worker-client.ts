import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

interface WorkerReply {
  id: string;
  ok: boolean;
  error?: string;
}

interface PendingRequest {
  outputPath: string;
  finalPath: string;
  resolve(value: Buffer): void;
  reject(error: unknown): void;
}

export class ThumbnailWorkerClient {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;
  /** 最近一次配置的 libvips 并发；worker 未启动时记住，首次拉起后补发。 */
  private pendingConcurrency: number | undefined;

  constructor(
    private readonly workerPath: string,
    private readonly cacheRoot: string,
    initialConcurrency?: number,
  ) {
    this.pendingConcurrency = initialConcurrency;
  }

  async convert(
    sourcePath: string,
    finalPath: string,
    signal?: AbortSignal,
    size: { width: number; height: number } = { width: 480, height: 320 },
  ): Promise<Buffer> {
    if (this.closed) throw new Error("THUMBNAIL_WORKER_CLOSED");
    this.assertCachePath(finalPath);
    if (signal?.aborted) throw new Error("THUMBNAIL_WORKER_ABORTED");
    await mkdir(path.dirname(finalPath), { recursive: true });
    const id = randomUUID();
    const outputPath = `${finalPath}.${id}.tmp.png`;
    const child = this.ensureChild();
    const promise = new Promise<Buffer>((resolve, reject) => {
      this.pending.set(id, { outputPath, finalPath, resolve, reject });
    });
    signal?.addEventListener(
      "abort",
      () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        void rm(outputPath, { force: true });
        pending.reject(new Error("THUMBNAIL_WORKER_ABORTED"));
      },
      { once: true },
    );
    child.postMessage({
      id,
      type: "convert",
      sourcePath,
      outputPath,
      width: size.width,
      height: size.height,
    });
    return promise;
  }

  close(): void {
    this.closed = true;
    this.rejectPending(new Error("THUMBNAIL_WORKER_CLOSED"));
    this.child?.kill();
    this.child = null;
  }

  /** 运行时调整 libvips 并发（阶段 5：性能偏好）。worker 未启动时记住该值，首次拉起后补发。 */
  setConcurrency(threads: number): void {
    this.pendingConcurrency = threads;
    this.child?.postMessage({ type: "configure", concurrency: threads });
  }

  private assertCachePath(filename: string): void {
    const relative = path.relative(path.resolve(this.cacheRoot), path.resolve(filename));
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("THUMBNAIL_WORKER_OUTPUT_OUTSIDE_CACHE");
    }
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "RefCanvas Thumbnail Converter",
    });
    child.on("message", (message: unknown) => {
      void this.handleMessage(message as WorkerReply);
    });
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      this.rejectPending(new Error("THUMBNAIL_WORKER_EXITED"));
    });
    // 启动期配置在 spawn 后补发：fork 后立刻 postMessage 可能落在 worker
    // 模块求值之前；spawn 保证 IPC 通道已建立，configure 按序先于 convert。
    child.once("spawn", () => {
      if (this.pendingConcurrency !== undefined) {
        child.postMessage({ type: "configure", concurrency: this.pendingConcurrency });
      }
    });
    this.child = child;
    return child;
  }

  private async handleMessage(message: WorkerReply): Promise<void> {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (!message.ok) {
      await rm(pending.outputPath, { force: true });
      pending.reject(new Error(message.error ?? "THUMBNAIL_WORKER_FAILED"));
      return;
    }
    try {
      await rename(pending.outputPath, pending.finalPath);
      pending.resolve(await readFile(pending.finalPath));
    } catch (error) {
      await rm(pending.outputPath, { force: true });
      pending.reject(error);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      void rm(pending.outputPath, { force: true });
      pending.reject(error);
    }
    this.pending.clear();
  }
}
