import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  fork: vi.fn(),
}));

vi.mock("electron", () => ({
  utilityProcess: { fork: electron.fork },
}));

import { WorkerSupervisor } from "../../../src/main/platform/worker-supervisor";
import type { WorkerJob, WorkerResult } from "../../../src/shared/worker-protocol";

type Listener = (...args: unknown[]) => void;

class FakeUtilityProcess {
  readonly listeners = new Map<string, Listener[]>();
  readonly messages: Array<Record<string, unknown>> = [];
  killed = false;

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  once(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  kill(): void {
    this.killed = true;
  }
}

function reply(child: FakeUtilityProcess, job: WorkerJob, data: Record<string, unknown> = {}): void {
  const result: WorkerResult = { jobId: job.jobId, data };
  child.emit("message", { type: "result", result });
}

function submittedJob(child: FakeUtilityProcess, index = 0): WorkerJob {
  const message = child.messages.filter((m) => m.type === "job")[index] as
    | { job: WorkerJob }
    | undefined;
  if (!message) throw new Error("no job submitted");
  return message.job;
}

beforeEach(() => electron.fork.mockReset());

describe("WorkerSupervisor", () => {
  it("forwards a job to the worker and resolves with the result", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
    });

    const promise = supervisor.submit({
      providerId: "generic-provider",
      operation: "probe",
      inputPath: "C:\\file.png",
      deadlineMs: 1_000,
    });
    const job = submittedJob(child);
    expect(job.providerId).toBe("generic-provider");
    expect(job.operation).toBe("probe");
    expect(job.inputPath).toBe("C:\\file.png");
    reply(child, job, { size: 123 });

    await expect(promise).resolves.toMatchObject({ data: { size: 123 } });
    supervisor.close();
  });

  it("enforces bounded concurrency", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxConcurrency: 2,
    });

    const jobs = [1, 2, 3].map((n) =>
      supervisor.submit({
        providerId: "p",
        operation: "probe",
        inputPath: `C:\\f${n}`,
      }),
    );
    // 前两个立即派发，第三个排队。
    expect(child.messages.filter((m) => m.type === "job")).toHaveLength(2);
    const first = submittedJob(child, 0);
    const second = submittedJob(child, 1);
    reply(child, first, { n: 1 });
    reply(child, second, { n: 2 });
    const third = submittedJob(child, 2);
    reply(child, third, { n: 3 });
    await expect(Promise.all(jobs)).resolves.toHaveLength(3);
    supervisor.close();
  });

  it("rejects on deadline timeout and cancels the worker job", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
    });

    const promise = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f",
      deadlineMs: 5,
    });
    await expect(promise).rejects.toThrow("WORKER_JOB_TIMEOUT");
    expect(
      child.messages.some((m) => m.type === "cancel"),
    ).toBe(true);
    supervisor.close();
  });

  it("rejects on abort signal and stops queued work", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxConcurrency: 1,
    });
    const controller = new AbortController();
    const first = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f1",
    });
    const second = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f2",
      signal: controller.signal,
    });
    controller.abort();
    await expect(second).rejects.toThrow("WORKER_JOB_CANCELLED");
    reply(child, submittedJob(child, 0), {});
    await expect(first).resolves.toMatchObject({});
    supervisor.close();
  });

  it("merges jobs sharing a cache key", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxConcurrency: 2,
    });

    const first = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f",
      cacheKey: "thumb:abc",
    });
    const second = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f",
      cacheKey: "thumb:abc",
    });
    // 只有第一个任务下发到 worker。
    expect(child.messages.filter((m) => m.type === "job")).toHaveLength(1);
    const job = submittedJob(child, 0);
    reply(child, job, { cached: true });
    const [a, b] = await Promise.all([first, second]);
    expect(a.data).toMatchObject({ cached: true });
    expect(b.data).toMatchObject({ cached: true });
    supervisor.close();
  });

  it("restarts a crashed worker once and retries queued jobs", async () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    electron.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxRestarts: 1,
      maxConcurrency: 1,
    });

    // 任务 1 立即派发运行；任务 2 排队。
    const running = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f",
    });
    const queued = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\g",
    });
    // 崩溃：在途任务失败，排队任务在新 worker 上重试。
    first.emit("exit", 1);
    await expect(running).rejects.toThrow("WORKER_CRASHED");

    const job = submittedJob(second, 0);
    expect(job.inputPath).toBe("C:\\g");
    reply(second, job, { retried: true });
    await expect(queued).resolves.toMatchObject({ data: { retried: true } });
    expect(electron.fork).toHaveBeenCalledTimes(2);
    supervisor.close();
  });

  it("fails remaining work when restart budget is exhausted", async () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    const third = new FakeUtilityProcess();
    electron.fork.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxConcurrency: 1,
      maxRestarts: 1,
    });

    // 任务 1 运行中，任务 2/3 排队。
    const running = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\r",
    });
    const queued2 = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\q2",
    });
    const queued3 = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\q3",
    });
    expect(first.messages.filter((m) => m.type === "job")).toHaveLength(1);

    first.emit("exit", 1); // 崩溃 1：在途失败，排队任务重试到 second
    await expect(running).rejects.toThrow("WORKER_CRASHED");
    expect(second.messages.filter((m) => m.type === "job")).toHaveLength(1);

    second.emit("exit", 1); // 崩溃 2：重启预算耗尽，剩余排队任务失败
    await expect(queued2).rejects.toThrow("WORKER_CRASHED");
    await expect(queued3).rejects.toThrow("WORKER_RESTART_EXHAUSTED");
    supervisor.close();
  });

  it("recovers the restart budget after a healthy job completes", async () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    const third = new FakeUtilityProcess();
    electron.fork
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxConcurrency: 1,
      maxRestarts: 1,
    });

    // 首次崩溃耗尽预算。
    const crashing = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\crash",
    });
    first.emit("exit", 1);
    await expect(crashing).rejects.toThrow("WORKER_CRASHED");

    // 下一个健康任务拉起新 worker（第二次 fork）并完成 → 预算恢复。
    const healthy = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\healthy",
    });
    reply(second, submittedJob(second, 0), { ok: true });
    await expect(healthy).resolves.toMatchObject({ data: { ok: true } });
    expect(electron.fork).toHaveBeenCalledTimes(2);

    // 再次崩溃时，排队任务应能在新 worker 上重试，而不是直接被
    // WORKER_RESTART_EXHAUSTED 拒绝（预算已恢复）。
    const runningAgain = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\r2",
    });
    const queuedAfterRecovery = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\q4",
    });
    second.emit("exit", 1);
    await expect(runningAgain).rejects.toThrow("WORKER_CRASHED");
    const retried = submittedJob(third, 0);
    expect(retried.inputPath).toBe("C:\\q4");
    reply(third, retried, { recovered: true });
    await expect(queuedAfterRecovery).resolves.toMatchObject({ data: { recovered: true } });
    supervisor.close();
  });

  it("rejects pending and queued work on close", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxConcurrency: 1,
    });
    const first = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f1",
    });
    const second = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f2",
    });
    await supervisor.close();
    await expect(first).rejects.toThrow("WORKER_SUPERVISOR_CLOSED");
    await expect(second).rejects.toThrow("WORKER_SUPERVISOR_CLOSED");
    expect(child.killed).toBe(true);
  });

  it("rejects an outbound job with invalid fields at submit time", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
    });

    await expect(
      supervisor.submit({
        providerId: "",
        operation: "probe",
        inputPath: "C:\\f",
      }),
    ).rejects.toThrow("WORKER_JOB_INVALID");
    expect(child.messages.filter((m) => m.type === "job")).toHaveLength(0);
    supervisor.close();
  });

  it("processes a crash only once when both error and exit fire", async () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    electron.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const supervisor = new WorkerSupervisor({
      workerPath: "worker.js",
      serviceName: "test",
      maxRestarts: 1,
      maxConcurrency: 1,
    });

    const running = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\f",
    });
    const queued = supervisor.submit({
      providerId: "p",
      operation: "probe",
      inputPath: "C:\\g",
    });
    // error 和 exit 同时触发：只应处理一次（一个 WORKER_CRASHED，一次重启）。
    first.emit("error", new Error("boom"));
    first.emit("exit", 1);
    await expect(running).rejects.toThrow("WORKER_CRASHED");

    const job = submittedJob(second, 0);
    expect(job.inputPath).toBe("C:\\g");
    reply(second, job, { retried: true });
    await expect(queued).resolves.toMatchObject({ data: { retried: true } });
    expect(electron.fork).toHaveBeenCalledTimes(2);
    supervisor.close();
  });
});
