/**
 * 媒体任务注册表（FND-007 §8.3 扩展）。
 *
 * 负责把 `resources-ipc` 里的媒体导出/转换任务（GIF/MP4/帧/通道/降采样等）
 * 以统一 TaskSnapshot 形式暴露给任务中心，并提供取消桥接。内部快速任务
 * （取帧/取色/缩略图）不注册，避免任务中心被瞬时操作刷屏。
 */
import { EventEmitter } from "node:events";
import type { TaskKind, TaskSnapshot, TaskState } from "../../shared/contracts";

export type TrackedMediaKind = Extract<TaskKind, "convert" | "export" | "batch">;

export interface MediaJobStartMeta {
  kind: TrackedMediaKind;
  /** 当前阶段描述（human readable）。 */
  stage: string;
  /** 输出路径（文件/目录）；未知可为 null。 */
  output?: string | null;
  progress?: number | null;
}

interface ActiveMediaJob {
  snapshot: TaskSnapshot;
  controller: AbortController | null;
}

const terminalStates: ReadonlySet<TaskState> = new Set([
  "completed",
  "cancelled",
  "failed",
]);

export class MediaJobRegistry {
  private readonly jobs = new Map<string, ActiveMediaJob>();
  private readonly events = new EventEmitter();

  onChanged(listener: (snapshot: TaskSnapshot) => void): () => void {
    this.events.on("change", listener);
    return () => this.events.off("change", listener);
  }

  start(jobId: string, meta: MediaJobStartMeta): void {
    const now = new Date().toISOString();
    const snapshot: TaskSnapshot = {
      id: jobId,
      kind: meta.kind,
      state: "running",
      stage: meta.stage,
      progress: meta.progress ?? null,
      output: meta.output ?? null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(jobId, { snapshot, controller: null });
    this.emit(snapshot);
  }

  attachController(jobId: string, controller: AbortController): void {
    const job = this.jobs.get(jobId);
    if (job) job.controller = controller;
  }

  update(
    jobId: string,
    patch: Partial<Pick<TaskSnapshot, "stage" | "progress" | "output">>,
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.snapshot = {
      ...job.snapshot,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.emit(job.snapshot);
  }

  complete(jobId: string, output?: string | null): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.snapshot = {
      ...job.snapshot,
      state: "completed",
      stage: "completed",
      progress: 1,
      output: output ?? job.snapshot.output,
      updatedAt: new Date().toISOString(),
    };
    job.controller = null;
    this.emit(job.snapshot);
  }

  fail(jobId: string, errorCode: string, errorMessage: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    // 已取消的任务保持 cancelled，不被后续 abort 异常覆盖成 failed。
    if (job.snapshot.state === "cancelled") return;
    job.snapshot = {
      ...job.snapshot,
      state: "failed",
      stage: "failed",
      errorCode,
      errorMessage,
      updatedAt: new Date().toISOString(),
    };
    job.controller = null;
    this.emit(job.snapshot);
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (terminalStates.has(job.snapshot.state)) return true;
    job.controller?.abort(new Error("MEDIA_JOB_CANCELLED"));
    job.snapshot = {
      ...job.snapshot,
      state: "cancelled",
      stage: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    job.controller = null;
    this.emit(job.snapshot);
    return true;
  }

  list(limit = 100): TaskSnapshot[] {
    return [...this.jobs.values()]
      .map((job) => job.snapshot)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  private emit(snapshot: TaskSnapshot): void {
    this.events.emit("change", snapshot);
  }
}
