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

  constructor(
    private readonly workerPath: string,
    private readonly cacheRoot: string,
  ) {}

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
