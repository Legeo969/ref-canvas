import { describe, expect, it, vi } from "vitest";
import type {
  AiJobSnapshot,
  DirectoryBatchSnapshot,
  ImportJobSnapshot,
} from "../../../src/shared/contracts";
import { TaskCenterService } from "../../../src/main/services/task-center-service";

function importJob(overrides: Partial<ImportJobSnapshot> = {}): ImportJobSnapshot {
  return {
    id: "import-1",
    state: "completed",
    discovered: 2,
    processed: 2,
    enriched: 2,
    metadataFailed: 0,
    sourcePaths: ["D:\\a.png", "D:\\b.png"],
    imported: 1,
    reused: 1,
    unsupported: 0,
    failed: [],
    relinked: 0,
    conflicted: 0,
    createdAt: "2026-08-08T10:00:00.000Z",
    completedAt: "2026-08-08T10:00:05.000Z",
    ...overrides,
  };
}

function batch(overrides: Partial<DirectoryBatchSnapshot> = {}): DirectoryBatchSnapshot {
  return {
    id: "batch-1",
    state: "running",
    action: { type: "tag", tags: ["x"] },
    total: 4,
    processed: 2,
    failed: [],
    createdAt: "2026-08-08T10:30:00.000Z",
    updatedAt: "2026-08-08T10:30:01.000Z",
    ...overrides,
  };
}

function aiJob(overrides: Partial<AiJobSnapshot> = {}): AiJobSnapshot {
  return {
    id: "ai-1",
    provider: "mock",
    state: "generating",
    stage: "generating",
    progress: 0.4,
    outputs: [],
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-08T11:00:00.000Z",
    updatedAt: "2026-08-08T11:00:01.000Z",
    ...overrides,
  };
}

describe("TaskCenterService (FND-007 §8.3)", () => {
  it("aggregates imports, batches and AI jobs into unified snapshots", () => {
    const sources = {
      listImports: vi.fn(() => [importJob()]),
      listBatches: vi.fn(() => [batch()]),
      listAiJobs: vi.fn(() => [aiJob()]),
      cancelImport: vi.fn(async () => true),
      cancelBatch: vi.fn(async () => true),
      cancelAi: vi.fn(async () => true),
    };
    const service = new TaskCenterService(sources);
    const tasks = service.list();
    expect(tasks).toHaveLength(3);
    const importTask = tasks.find((task) => task.kind === "import")!;
    expect(importTask.state).toBe("completed");
    expect(importTask.progress).toBe(1);
    const batchTask = tasks.find((task) => task.kind === "batch")!;
    expect(batchTask.state).toBe("running");
    expect(batchTask.progress).toBe(0.5);
    const aiTask = tasks.find((task) => task.kind === "ai")!;
    expect(aiTask.state).toBe("running");
    expect(aiTask.stage).toBe("generating");
  });

  it("reports partial failures as error codes without failing the task", () => {
    const sources = {
      listImports: vi.fn(() => [importJob({ failed: [{ path: "D:\\bad.png", reason: "read" }] })]),
      listBatches: vi.fn(() => []),
      listAiJobs: vi.fn(() => []),
      cancelImport: vi.fn(async () => true),
      cancelBatch: vi.fn(async () => true),
      cancelAi: vi.fn(async () => true),
    };
    const service = new TaskCenterService(sources);
    const task = service.list()[0];
    expect(task.errorCode).toBe("IMPORT_PARTIAL_FAILURE");
    expect(task.state).toBe("completed");
  });

  it("cancels running tasks idempotently and returns the current snapshot", async () => {
    const sources = {
      listImports: vi.fn(() => [importJob({ state: "queued" })]),
      listBatches: vi.fn(() => []),
      listAiJobs: vi.fn(() => []),
      cancelImport: vi.fn(async () => true),
      cancelBatch: vi.fn(async () => true),
      cancelAi: vi.fn(async () => true),
    };
    const service = new TaskCenterService(sources);
    const cancelled = await service.cancel("import-1");
    expect(sources.cancelImport).toHaveBeenCalledWith("import-1");
    expect(cancelled?.id).toBe("import-1");
    // 终态任务再次取消返回当前快照（不重复调用取消源）。
    const done = await service.cancel("missing");
    expect(done).toBeNull();
  });

  it("notifies listeners on change", () => {
    const sources = {
      listImports: vi.fn(() => [importJob()]),
      listBatches: vi.fn(() => []),
      listAiJobs: vi.fn(() => []),
      cancelImport: vi.fn(async () => true),
      cancelBatch: vi.fn(async () => true),
      cancelAi: vi.fn(async () => true),
    };
    const service = new TaskCenterService(sources);
    const listener = vi.fn();
    service.onChanged(listener);
    service.notify("import");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: "import" }));
  });

  it("keeps batch timestamps stable across reads and treats failed jobs as terminal", async () => {
    const failedBatch = batch({ state: "failed", total: 0, processed: 0 });
    const sources = {
      listImports: vi.fn(() => []),
      listBatches: vi.fn(() => [failedBatch]),
      listAiJobs: vi.fn(() => []),
      cancelImport: vi.fn(async () => true),
      cancelBatch: vi.fn(async () => true),
      cancelAi: vi.fn(async () => true),
    };
    const service = new TaskCenterService(sources);
    const first = service.list()[0];
    const second = service.list()[0];
    expect(second.updatedAt).toBe(first.updatedAt);
    expect(second.createdAt).toBe(failedBatch.createdAt);
    expect(second.progress).toBe(1);
    await service.cancel(failedBatch.id);
    expect(sources.cancelBatch).not.toHaveBeenCalled();
  });
});
