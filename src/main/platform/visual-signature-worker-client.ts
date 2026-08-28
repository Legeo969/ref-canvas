import { randomUUID } from "node:crypto";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { VisualSignature } from "../services/visual-signature-service";

export const VISUAL_SIGNATURE_WORKER_TIMEOUT_MS = 120_000;

interface WorkerReply {
  id: string;
  ok: boolean;
  signature?: VisualSignature;
  error?: string;
}

interface RequestEntry {
  id: string;
  filename: string;
  signal?: AbortSignal;
  onAbort?: () => void;
  timer: NodeJS.Timeout | null;
  resolve(signature: VisualSignature): void;
  reject(error: Error): void;
}

function isVisualSignature(value: unknown): value is VisualSignature {
  if (!value || typeof value !== "object") return false;
  const signature = value as Partial<VisualSignature>;
  return (
    typeof signature.visualHash === "string" &&
    /^[0-9a-f]{16}$/i.test(signature.visualHash) &&
    typeof signature.colorSignature === "string" &&
    signature.colorSignature.length > 0 &&
    typeof signature.dominantColor?.r === "number" &&
    typeof signature.dominantColor?.g === "number" &&
    typeof signature.dominantColor?.b === "number"
  );
}

/**
 * Runs Sharp in a disposable utility process. Native decoder failures cannot
 * terminate Electron's main process; only the current image fails and the next
 * request starts a fresh worker.
 */
export class VisualSignatureWorkerClient {
  private child: UtilityProcess | null = null;
  private active: RequestEntry | null = null;
  private readonly queue: RequestEntry[] = [];
  private closed = false;

  constructor(private readonly workerPath: string) {}

  read(filename: string, signal?: AbortSignal): Promise<VisualSignature> {
    if (this.closed) return Promise.reject(new Error("VISUAL_SIGNATURE_WORKER_CLOSED"));
    if (!path.isAbsolute(filename)) {
      return Promise.reject(new Error("VISUAL_SIGNATURE_PATH_NOT_ABSOLUTE"));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("VISUAL_SIGNATURE_WORKER_ABORTED"));
    }
    return new Promise<VisualSignature>((resolve, reject) => {
      const entry: RequestEntry = {
        id: randomUUID(),
        filename,
        signal,
        timer: null,
        resolve,
        reject,
      };
      if (signal) {
        entry.onAbort = () => this.abort(entry);
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.queue.push(entry);
      this.drain();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("VISUAL_SIGNATURE_WORKER_CLOSED");
    if (this.active) {
      const active = this.active;
      this.active = null;
      this.settle(active, error);
    }
    for (const entry of this.queue.splice(0)) this.settle(entry, error);
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private drain(): void {
    if (this.closed || this.active) return;
    const entry = this.queue.shift();
    if (!entry) return;
    if (entry.signal?.aborted) {
      this.settle(entry, new Error("VISUAL_SIGNATURE_WORKER_ABORTED"));
      this.drain();
      return;
    }
    this.active = entry;
    const child = this.ensureChild();
    entry.timer = setTimeout(() => {
      if (this.active !== entry) return;
      this.active = null;
      this.settle(entry, new Error("VISUAL_SIGNATURE_WORKER_TIMEOUT"));
      if (this.child === child) this.child = null;
      child.kill();
      this.drain();
    }, VISUAL_SIGNATURE_WORKER_TIMEOUT_MS);
    child.postMessage({ id: entry.id, type: "read", filename: entry.filename });
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "RefCanvas Visual Signature Worker",
    });
    let down = false;
    const markDown = () => {
      if (down || this.child !== child) return;
      down = true;
      this.child = null;
      const active = this.active;
      if (active) {
        this.active = null;
        this.settle(active, new Error("VISUAL_SIGNATURE_WORKER_CRASHED"));
      }
      this.drain();
    };
    child.on("message", (message: unknown) => this.handleMessage(message));
    child.once("error", markDown);
    child.once("exit", markDown);
    this.child = child;
    return child;
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const reply = message as Partial<WorkerReply>;
    const active = this.active;
    if (!active || reply.id !== active.id || typeof reply.ok !== "boolean") return;
    this.active = null;
    if (reply.ok && isVisualSignature(reply.signature)) {
      this.settle(active, reply.signature);
    } else {
      this.settle(active, new Error(reply.error ?? "VISUAL_SIGNATURE_WORKER_FAILED"));
    }
    this.drain();
  }

  private abort(entry: RequestEntry): void {
    if (this.active === entry) {
      this.active = null;
      this.settle(entry, new Error("VISUAL_SIGNATURE_WORKER_ABORTED"));
      const child = this.child;
      this.child = null;
      child?.kill();
      this.drain();
      return;
    }
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
    this.settle(entry, new Error("VISUAL_SIGNATURE_WORKER_ABORTED"));
  }

  private settle(entry: RequestEntry, result: VisualSignature | Error): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
    if (result instanceof Error) entry.reject(result);
    else entry.resolve(result);
  }
}
