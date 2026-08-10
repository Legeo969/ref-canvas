import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { AiJobService } from "../../../src/main/services/ai/ai-job-service";
import { MockAiProvider } from "../../../src/main/services/ai/mock-ai-provider";
import type { AiDesignRequest, AiProviderKind } from "../../../src/shared/contracts";

const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeDirectory));
});

interface TestContext {
  directory: string;
  db: RefCanvasDatabase;
  service: AiJobService;
  request: (patch?: Partial<AiDesignRequest>) => AiDesignRequest;
  source: string;
  outputDirectory: string;
}

/** 生成真实源图与可写输出目录，注册临时目录到清理队列。 */
async function scaffold(
  mockOptions: ConstructorParameters<typeof MockAiProvider>[0] = { stageDelayMs: 5 },
): Promise<TestContext> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-ai-"));
  temporaryDirectories.push(directory);
  const db = new RefCanvasDatabase(path.join(directory, "app.db"));
  const source = path.join(directory, "source.png");
  const outputDirectory = path.join(directory, "out");
  await mkdir(outputDirectory, { recursive: true });
  const { default: sharp } = await import("sharp");
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toFile(source);
  const providers = new Map<AiProviderKind, MockAiProvider>([
    ["mock", new MockAiProvider(mockOptions)],
  ]);
  const service = new AiJobService(db.aiJobs(), providers);
  const request = (patch: Partial<AiDesignRequest> = {}): AiDesignRequest => ({
    sourcePath: source,
    referencePaths: [],
    prompt: "warm palette",
    majorChange: false,
    outputCount: 2,
    outputDirectory,
    ...patch,
  });
  return { directory, db, service, request, source, outputDirectory };
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("WAIT_TIMEOUT");
}

describe("ai job service (FND-008 §9.2/§9.3)", () => {
  it("runs a mock job to completion producing the requested output count", async () => {
    const { service, request, outputDirectory, db } = await scaffold();
    try {
      const job = await service.start("mock", request());
      await waitFor(async () => service.get(job.id)?.state === "completed");
      const snapshot = service.get(job.id)!;
      expect(snapshot.state).toBe("completed");
      expect(snapshot.progress).toBe(1);
      expect(snapshot.outputs).toHaveLength(2);
      for (const output of snapshot.outputs) {
        await expect(stat(output)).resolves.toBeDefined();
        expect(path.dirname(output)).toBe(path.resolve(outputDirectory));
      }
      // ai_jobs 行已持久化。
      expect(db.aiJobs().count()).toBe(1);
    } finally {
      db.close();
    }
  });

  it("same request twice produces byte-identical outputs", async () => {
    const { service, request, db } = await scaffold();
    try {
      const first = await service.start("mock", request());
      await waitFor(async () => service.get(first.id)?.state === "completed");
      const second = await service.start("mock", request());
      await waitFor(async () => service.get(second.id)?.state === "completed");
      const firstOutputs = service.get(first.id)!.outputs;
      const secondOutputs = service.get(second.id)!.outputs;
      expect(firstOutputs.length).toBe(secondOutputs.length);
      for (let index = 0; index < firstOutputs.length; index += 1) {
        const a = await readFile(firstOutputs[index]);
        const b = await readFile(secondOutputs[index]);
        expect(a.equals(b)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("rejects invalid input before creating an ai_jobs row", async () => {
    const { service, request, directory, db } = await scaffold();
    try {
      const rowsBefore = db.aiJobs().count();
      await expect(
        service.start(
          "mock",
          request({ referencePaths: Array.from({ length: 7 }, () => "x.png") }),
        ),
      ).rejects.toThrow("AI_VALIDATION");
      await expect(
        service.start("mock", request({ prompt: "   " })),
      ).rejects.toThrow("AI_VALIDATION");
      await expect(
        service.start("mock", request({ outputCount: 9 })),
      ).rejects.toThrow("AI_VALIDATION");
      await expect(
        service.start(
          "mock",
          request({ sourcePath: path.join(directory, "missing.png") }),
        ),
      ).rejects.toThrow("AI_VALIDATION");
      const txt = path.join(directory, "notes.txt");
      await writeFile(txt, "hello");
      await expect(
        service.start("mock", request({ sourcePath: txt })),
      ).rejects.toThrow("AI_VALIDATION");
      expect(db.aiJobs().count()).toBe(rowsBefore);
    } finally {
      db.close();
    }
  });

  it("probes output writability and removes the temporary probe", async () => {
    const { service, request, outputDirectory, db } = await scaffold();
    try {
      await service.validateRequest(request());
      expect((await readdir(outputDirectory)).filter((name) => name.startsWith(".refcanvas-write-probe-"))).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("persists repeated progress updates within the same running state", async () => {
    const { service, request, db } = await scaffold({ stageDelayMs: 150 });
    try {
      const job = await service.start("mock", request());
      await waitFor(() => service.get(job.id)?.progress === 0.8);
      expect(service.get(job.id)?.state).toBe("generating");
      await waitFor(() => service.get(job.id)?.state === "completed");
      expect(db.aiJobs().get(job.id)?.externalId).toBe(`mock-${job.id}`);
    } finally {
      db.close();
    }
  });

  it("cancels a running job and repeated cancel is idempotent", async () => {
    const { service, request, db } = await scaffold({
      stageDelayMs: 400,
    });
    try {
      const job = await service.start("mock", request());
      await waitFor(async () => {
        const current = service.get(job.id);
        return current?.state === "generating" || current?.state === "uploading";
      });
      const cancelled = await service.cancel(job.id);
      expect(cancelled.state).toBe("cancelled");
      const snapshot = service.get(job.id)!;
      expect(snapshot.state).toBe("cancelled");
      const again = await service.cancel(job.id);
      expect(again.id).toBe(job.id);
    } finally {
      db.close();
    }
  });

  it("injected failure transitions to failed and retry creates a new job", async () => {
    const { db: scaffoldDb, directory, request } = await scaffold({
      stageDelayMs: 5,
      injectFailure: { stage: "generating", code: "MOCK_INJECTED_FAILURE" },
    });
    const db = new RefCanvasDatabase(path.join(directory, "app2.db"));
    const providers = new Map<AiProviderKind, MockAiProvider>([
      [
        "mock",
        new MockAiProvider({
          stageDelayMs: 5,
          injectFailure: { stage: "generating", code: "MOCK_INJECTED_FAILURE" },
        }),
      ],
    ]);
    const service = new AiJobService(db.aiJobs(), providers);
    try {
      const job = await service.start("mock", request());
      await waitFor(async () => service.get(job.id)?.state === "failed");
      const failed = service.get(job.id)!;
      expect(failed.state).toBe("failed");
      expect(failed.errorCode).toBe("AI_JOB_FAILED");
      const rowsBefore = db.aiJobs().count();
      const retried = await service.retry(job.id);
      expect(retried.id).not.toBe(job.id);
      // retry 创建新行；旧 failed 记录保留。
      expect(db.aiJobs().count()).toBe(rowsBefore + 1);
      expect(service.get(job.id)?.state).toBe("failed");
      // 等待重试任务结束（注入失败 → failed），避免后台写库竞态。
      await waitFor(async () => {
        const current = service.get(retried.id);
        return current?.state === "failed" || current?.state === "completed";
      });
    } finally {
      db.close();
      scaffoldDb.close();
    }
  });

  it("recoverInterrupted marks non-recoverable running jobs failed with reason", async () => {
    const { db: scaffoldDb, directory, outputDirectory } = await scaffold();
    const db = new RefCanvasDatabase(path.join(directory, "app3.db"));
    try {
      const jobs = db.aiJobs();
      const job = jobs.create({
        provider: "mock",
        externalId: null,
        requestJson: '{"prompt":"x"}',
        outputDirectory,
      });
      jobs.transition(job.id, "generating", { stage: "generating" });
      const service = new AiJobService(
        jobs,
        new Map<AiProviderKind, MockAiProvider>([["mock", new MockAiProvider()]]),
      );
      await service.recoverInterrupted();
      const recovered = jobs.get(job.id)!;
      expect(recovered.state).toBe("failed");
      expect(recovered.errorCode).toBe("AI_JOB_INTERRUPTED");
      expect(recovered.errorMessage).toContain("不支持恢复");
    } finally {
      db.close();
      scaffoldDb.close();
    }
  });
});
