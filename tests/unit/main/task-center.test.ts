import { describe, expect, it, vi } from "vitest";
import type {
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

function sources(overrides: Record<string, unknown> = {}) {
  return {
    listImports: vi.fn(() => []),
    listBatches: vi.fn(() => []),
    listMediaJobs: vi.fn(() => []),
    cancelImport: vi.fn(async () => true),
    cancelBatch: vi.fn(async () => true),
    cancelMedia: vi.fn(async () => true),
    ...overrides,
  };
}

describe("TaskCenterService (FND-007 §8.3)", () => {
  it("aggregates imports and batches into unified snapshots", () => {
    const service = new TaskCenterService(
      sources({
        listImports: vi.fn(() => [importJob()]),
        listBatches: vi.fn(() => [batch()]),
      }) as never,
    );
    const tasks = service.list();
    expect(tasks).toHaveLength(2);
    const importTask = tasks.find((task) => task.kind === "import")!;
    expect(importTask.state).toBe("completed");
    expect(importTask.progress).toBe(1);
    const batchTask = tasks.find((task) => task.kind === "batch")!;
    expect(batchTask.state).toBe("running");
    expect(batchTask.progress).toBe(0.5);
  });

  it("reports partial failures as error codes without failing the task", () => {
    const service = new TaskCenterService(
      sources({
        listImports: vi.fn(() => [
          importJob({ failed: [{ path: "D:\\bad.png", reason: "read" }] }),
        ]),
      }) as never,
    );
    const task = service.list()[0];
    expect(task.errorCode).toBe("IMPORT_PARTIAL_FAILURE");
    expect(task.state).toBe("completed");
  });

  it("cancels running tasks idempotently and returns the current snapshot", async () => {
    const list = sources({ listImports: vi.fn(() => [importJob({ state: "queued" })]) });
    const service = new TaskCenterService(list as never);
    const cancelled = await service.cancel("import-1");
    expect(list.cancelImport).toHaveBeenCalledWith("import-1");
    expect(cancelled?.id).toBe("import-1");
    // 终态任务再次取消返回当前快照（不重复调用取消源）。
    const done = await service.cancel("missing");
    expect(done).toBeNull();
  });

  it("notifies listeners on change", () => {
    const service = new TaskCenterService(
      sources({ listImports: vi.fn(() => [importJob()]) }) as never,
    );
    const listener = vi.fn();
    service.onChanged(listener);
    service.notify("import");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: "import" }));
  });

  it("keeps batch timestamps stable across reads and treats failed jobs as terminal", async () => {
    const failedBatch = batch({ state: "failed", total: 0, processed: 0 });
    const list = sources({ listBatches: vi.fn(() => [failedBatch]) });
    const service = new TaskCenterService(list as never);
    const first = service.list()[0];
    const second = service.list()[0];
    expect(second.updatedAt).toBe(first.updatedAt);
    expect(second.createdAt).toBe(failedBatch.createdAt);
    expect(second.progress).toBe(1);
    await service.cancel(failedBatch.id);
    expect(list.cancelBatch).not.toHaveBeenCalled();
  });
});
