import { randomUUID } from "node:crypto";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
  EnumeratedImportPath,
  ImportEnumerator,
} from "../services/import-enumerator";

interface WorkerMessage {
  id: string;
  type: "batch" | "done" | "error";
  batchId?: number;
  items?: EnumeratedImportPath[];
  discovered?: number;
  error?: string;
}

interface PendingEnumeration {
  resolve(discovered: number): void;
  reject(error: unknown): void;
  onBatch(items: EnumeratedImportPath[]): Promise<void>;
  removeAbortListener(): void;
}

export class ImportEnumeratorClient implements ImportEnumerator {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingEnumeration>();

  constructor(private readonly workerPath: string) {}

  enumerate(
    inputPaths: string[],
    signal: AbortSignal,
    onBatch: (items: EnumeratedImportPath[]) => Promise<void>,
    excludedRoots: string[] = [],
  ): Promise<number> {
    signal.throwIfAborted();
    const id = randomUUID();
    const child = this.ensureChild();
    return new Promise<number>((resolve, reject) => {
      const onAbort = () => child.postMessage({ id, type: "cancel" });
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        onBatch,
        removeAbortListener: () => signal.removeEventListener("abort", onAbort),
      });
      child.postMessage({ id, type: "start", inputPaths, excludedRoots });
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      pending.removeAbortListener();
      pending.reject(new Error("IMPORT_ENUMERATOR_CLOSED"));
    }
    this.pending.clear();
    this.child?.kill();
    this.child = null;
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "RefCanvas Import Enumerator",
    });
    child.on("message", (message: unknown) => {
      void this.handleMessage(child, message as WorkerMessage);
    });
    const fail = (error: Error) => {
      if (this.child === child) this.child = null;
      for (const pending of this.pending.values()) {
        pending.removeAbortListener();
        pending.reject(error);
      }
      this.pending.clear();
    };
    child.once("exit", () => fail(new Error("IMPORT_ENUMERATOR_EXITED")));
    this.child = child;
    return child;
  }

  private async handleMessage(
    child: UtilityProcess,
    message: WorkerMessage,
  ): Promise<void> {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === "batch" && message.items && message.batchId !== undefined) {
      try {
        await pending.onBatch(message.items);
        child.postMessage({ id: message.id, type: "ack", batchId: message.batchId });
      } catch (error) {
        child.postMessage({ id: message.id, type: "cancel" });
        this.finish(message.id, () => pending.reject(error));
      }
      return;
    }
    if (message.type === "done") {
      this.finish(message.id, () => pending.resolve(message.discovered ?? 0));
    } else if (message.type === "error") {
      this.finish(message.id, () =>
        pending.reject(new Error(message.error ?? "IMPORT_ENUMERATION_FAILED")));
    }
  }

  private finish(id: string, complete: () => void): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.removeAbortListener();
    complete();
  }
}
