import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const electron = vi.hoisted(() => ({
  fork: vi.fn(),
}));

vi.mock("electron", () => ({
  utilityProcess: { fork: electron.fork },
}));

import { ThumbnailWorkerClient } from "../../../src/main/platform/thumbnail-worker-client";

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

function configureMessages(child: FakeUtilityProcess): number[] {
  return child.messages
    .filter((message) => message.type === "configure")
    .map((message) => message.concurrency as number);
}

beforeEach(() => electron.fork.mockReset());

describe("ThumbnailWorkerClient concurrency", () => {
  async function withTempCache(
    run: (directory: string) => Promise<void>,
  ): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-thumb-"));
    try {
      await run(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** convert 内部先 await 一次 mkdir（异步 I/O），等 fork 真正发生后才能 emit("spawn")。 */
  async function awaitFork(): Promise<void> {
    await vi.waitFor(() => {
      expect(electron.fork).toHaveBeenCalledTimes(1);
    });
  }

  it("applies the initial concurrency when the worker first spawns", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    await withTempCache(async (directory) => {
      const client = new ThumbnailWorkerClient(
        "thumbnail-worker.js",
        directory,
        3,
      );
      // worker 懒启动：spawn 前不发送 configure。
      const convert = client.convert(
        path.join(directory, "src.png"),
        path.join(directory, "out.png"),
      );
      await awaitFork();
      expect(configureMessages(child)).toEqual([]);
      child.emit("spawn");
      expect(configureMessages(child)).toEqual([3]);
      convert.catch(() => undefined);
    });
  });

  it("remembers setConcurrency before spawn and applies it on spawn", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    await withTempCache(async (directory) => {
      const client = new ThumbnailWorkerClient("thumbnail-worker.js", directory);
      client.setConcurrency(6);
      const convert = client.convert(
        path.join(directory, "src.png"),
        path.join(directory, "out.png"),
      );
      await awaitFork();
      child.emit("spawn");
      expect(configureMessages(child)).toEqual([6]);
      convert.catch(() => undefined);
    });
  });

  it("applies setConcurrency immediately when the worker is already running", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    await withTempCache(async (directory) => {
      const client = new ThumbnailWorkerClient("thumbnail-worker.js", directory);
      const convert = client.convert(
        path.join(directory, "src.png"),
        path.join(directory, "out.png"),
      );
      await awaitFork();
      child.emit("spawn");
      client.setConcurrency(2);
      expect(configureMessages(child)).toEqual([2]);
      convert.catch(() => undefined);
    });
  });

  it("keeps the latest concurrency when the worker respawns", async () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    electron.fork
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    await withTempCache(async (directory) => {
      const client = new ThumbnailWorkerClient("thumbnail-worker.js", directory);
      client.setConcurrency(5);
      let convert = client.convert(
        path.join(directory, "src.png"),
        path.join(directory, "out.png"),
      );
      convert.catch(() => undefined);
      await vi.waitFor(() => {
        expect(electron.fork).toHaveBeenCalledTimes(1);
      });
      first.emit("spawn");
      expect(configureMessages(first)).toEqual([5]);
      // worker 崩溃退出后再次 convert：新子进程按最近配置补发。
      first.emit("exit");
      convert = client.convert(
        path.join(directory, "src2.png"),
        path.join(directory, "out2.png"),
      );
      convert.catch(() => undefined);
      await vi.waitFor(() => {
        expect(electron.fork).toHaveBeenCalledTimes(2);
      });
      expect(configureMessages(second)).toEqual([]);
      second.emit("spawn");
      expect(configureMessages(second)).toEqual([5]);
    });
  });
});
