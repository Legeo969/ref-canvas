import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  ImportJobSnapshot,
  ImportOptions,
} from "../../shared/contracts";

export interface ImportJob {
  snapshot: ImportJobSnapshot;
  controller: AbortController;
  options: ImportOptions;
  lastEmittedAt: number;
}

export class ImportCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly jobs = new Map<string, ImportJob>();

  constructor(
    private readonly onProgress: (snapshot: ImportJobSnapshot) => void,
  ) {}

  create(inputPaths: string[], options: ImportOptions): ImportJob {
    const snapshot: ImportJobSnapshot = {
      id: randomUUID(),
      state: "queued",
      discovered: 0,
      processed: 0,
      enriched: 0,
      metadataFailed: 0,
      sourcePaths: inputPaths.map((item) => path.resolve(item)),
      imported: 0,
      reused: 0,
      unsupported: 0,
      failed: [],
      relinked: 0,
      conflicted: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    const job = {
      snapshot,
      controller: new AbortController(),
      options,
      lastEmittedAt: 0,
    };
    this.jobs.set(snapshot.id, job);
    return job;
  }

  enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task, task);
    void this.tail;
  }

  enqueueJob(job: ImportJob, task: (job: ImportJob) => Promise<void>): void {
    this.enqueue(() => task(job));
  }

  emit(job: ImportJob, force = false): void {
    const now = Date.now();
    if (!force && now - job.lastEmittedAt < 100) return;
    job.lastEmittedAt = now;
    this.onProgress(structuredClone(job.snapshot));
  }

  snapshot(id: string): ImportJobSnapshot | null {
    const job = this.jobs.get(id);
    return job ? structuredClone(job.snapshot) : null;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || ["completed", "cancelled", "failed"].includes(job.snapshot.state)) {
      return false;
    }
    job.controller.abort();
    return true;
  }

  retryInput(id: string): { paths: string[]; options: ImportOptions } {
    const job = this.jobs.get(id);
    if (!job) throw new Error("IMPORT_JOB_NOT_FOUND");
    const failedPaths = job.snapshot.failed.map((item) => item.path);
    return {
      paths: failedPaths.length ? failedPaths : job.snapshot.sourcePaths,
      options: job.options,
    };
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) job.controller.abort();
  }

  whenIdle(): Promise<void> {
    return this.tail;
  }
}
