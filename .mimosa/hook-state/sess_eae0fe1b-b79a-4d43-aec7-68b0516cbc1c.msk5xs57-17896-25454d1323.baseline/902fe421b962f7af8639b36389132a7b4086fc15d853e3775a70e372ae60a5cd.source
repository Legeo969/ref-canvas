import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  fork: vi.fn(),
}));

vi.mock("electron", () => ({
  utilityProcess: { fork: electron.fork },
}));

import { DirectoryIndexClient } from "../../../src/main/platform/directory-index-client";

type Listener = (...args: unknown[]) => void;

class FakeUtilityProcess {
  readonly listeners = new Map<string, Listener[]>();
  readonly messages: Array<Record<string, unknown>> = [];

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

  kill(): void {}
}

beforeEach(() => electron.fork.mockReset());

describe("DirectoryIndexClient", () => {
  it("rejects pending work after a worker exit and starts a fresh worker on retry", async () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    electron.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = new DirectoryIndexClient("worker.js", "index.db");

    const failed = client.list("C:\\", 0, 10);
    first.emit("exit", 1);
    await expect(failed).rejects.toThrow("DIRECTORY_WORKER_EXITED");

    const retried = client.list("C:\\", 0, 10);
    const request = second.messages[0];
    second.emit("message", {
      id: request.id,
      ok: true,
      page: {
        entries: [],
        total: 0,
        totalFiles: 0,
        offset: 0,
        revision: "retry",
        scanState: "complete",
        order: "name",
        nextCursor: null,
      },
    });

    await expect(retried).resolves.toMatchObject({ revision: "retry" });
    expect(electron.fork).toHaveBeenCalledTimes(2);
    client.close();
  });
});
