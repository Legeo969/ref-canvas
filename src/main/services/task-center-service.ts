/**
 * 统一任务中心（FND-007 §8.3）。
 *
 * 聚合导入/批处理/转换/导出/归档/AI 任务为统一的 TaskSnapshot，并对外
 * 提供 list/get/cancel 与变更订阅。任务源各自维护内部状态；本服务只做
 * 只读聚合与取消转发（取消幂等，终态任务再次取消返回当前快照）。
 */
import { EventEmitter } from "node:events";
import type {
  AiJobSnapshot,
  DirectoryBatchSnapshot,
  ImportJobSnapshot,
  TaskKind,
  TaskSnapshot,
} from "../../shared/contracts";

export interface TaskSources {
  listImports(): ImportJobSnapshot[];
  listBatches(): DirectoryBatchSnapshot[];
  listAiJobs(): AiJobSnapshot[];
  cancelImport(id: string): Promise<boolean>;
  cancelBatch(id: string): Promise<boolean>;
  cancelAi(id: string): Promise<boolean>;
}

export class TaskCenterService {
  private readonly events = new EventEmitter();
  private readonly sources: TaskSources;

  constructor(sources: TaskSources) {
    this.sources = sources;
  }

  onChanged(listener: (snapshot: TaskSnapshot) => void): () => void {
    this.events.on("change", listener);
    return () => this.events.off("change", listener);
  }

  /** 任务源上报变化时调用（index.ts 注入）。 */
  notify(source: TaskKind): void {
    const snapshots = this.list(200);
    const latest = snapshots.find((item) => item.kind === source);
    if (latest) this.events.emit("change", latest);
  }

  list(limit = 100): TaskSnapshot[] {
    const collected: TaskSnapshot[] = [
      ...this.sources.listImports().map((job) => importToTask(job)),
      ...this.sources.listBatches().map((batch) => batchToTask(batch)),
      ...this.sources.listAiJobs().map((job) => aiToTask(job)),
    ];
    collected.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return collected.slice(0, limit);
  }

  get(id: string): TaskSnapshot | null {
    return this.list(10_000).find((task) => task.id === id) ?? null;
  }

  async cancel(id: string): Promise<TaskSnapshot | null> {
    const task = this.get(id);
    if (!task) return null;
    if (task.state === "completed" || task.state === "cancelled") return task;
    let cancelled = false;
    if (task.kind === "import") {
      cancelled = await this.sources.cancelImport(id);
    } else if (task.kind === "batch") {
      cancelled = await this.sources.cancelBatch(id);
    } else if (task.kind === "ai") {
      cancelled = await this.sources.cancelAi(id);
    }
    return cancelled ? (this.get(id) ?? task) : task;
  }
}

function importToTask(job: ImportJobSnapshot): TaskSnapshot {
  const finished = ["completed", "cancelled", "failed"].includes(job.state);
  const total = job.sourcePaths.length || 1;
  const processed = job.imported + job.reused + job.unsupported + job.failed.length;
  return {
    id: job.id,
    kind: "import",
    state: importStateToTask(job.state),
    stage: finished ? job.state : "importing",
    progress: finished ? 1 : Math.min(1, processed / total),
    output: job.sourcePaths[0] ?? null,
    errorCode: job.failed.length > 0 ? "IMPORT_PARTIAL_FAILURE" : null,
    errorMessage:
      job.failed.length > 0 ? `${job.failed.length} 个文件导入失败` : null,
    createdAt: job.createdAt,
    updatedAt: job.completedAt ?? job.createdAt,
  };
}

function importStateToTask(
  state: ImportJobSnapshot["state"],
): "queued" | "running" | "completed" | "failed" | "cancelled" {
  if (state === "completed") return "completed";
  if (state === "cancelled") return "cancelled";
  if (state === "failed") return "failed";
  return "running";
}

function batchToTask(batch: DirectoryBatchSnapshot): TaskSnapshot {
  return {
    id: batch.id,
    kind: "batch",
    state: batch.state,
    stage: batch.state === "running" ? "processing" : batch.state,
    progress: batch.total > 0 ? batch.processed / batch.total : null,
    output: null,
    errorCode: batch.failed.length > 0 ? "BATCH_PARTIAL_FAILURE" : null,
    errorMessage:
      batch.failed.length > 0 ? `${batch.failed.length} 项失败` : null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function aiToTask(job: AiJobSnapshot): TaskSnapshot {
  return {
    id: job.id,
    kind: "ai",
    state: aiStateToTask(job.state),
    stage: job.stage,
    progress: job.progress ?? null,
    output: job.outputs[0] ?? null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function aiStateToTask(
  state: AiJobSnapshot["state"],
): "queued" | "running" | "completed" | "failed" | "cancelled" {
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  if (state === "cancelled") return "cancelled";
  if (state === "queued") return "queued";
  return "running";
}
