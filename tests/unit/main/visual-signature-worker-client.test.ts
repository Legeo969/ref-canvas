import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ fork: vi.fn() }));

vi.mock("electron", () => ({
  utilityProcess: { fork: electron.fork },
}));

import {
  VisualSignatureWorkerClient,
  VISUAL_SIGNATURE_WORKER_TIMEOUT_MS,
} from "../../../src/main/platform/visual-signature-worker-client";

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

const signature = {
  visualHash: "0123456789abcdef",
  colorSignature: Buffer.alloc(48, 128).toString("base64"),
  dominantColor: { r: 128, g: 128, b: 128 },
};

function request(child: FakeUtilityProcess, index = 0): Record<string, unknown> {
  const message = child.messages.filter((item) => item.type === "read")[index];
  if (!message) throw new Error("no visual signature request");
  return message;
}

beforeEach(() => electron.fork.mockReset());
afterEach(() => vi.useRealTimers());

describe("VisualSignatureWorkerClient", () => {
  it("returns a validated signature from the utility process", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const client = new VisualSignatureWorkerClient("visual-signature-worker.js");
    const result = client.read("C:\\images\\source.png");
    child.emit("message", { id: request(child).id, ok: true, signature });

    await expect(result).resolves.toEqual(signature);
    client.close();
  });

  it("serializes decoding so one native failure identifies one image", async () => {
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const client = new VisualSignatureWorkerClient("visual-signature-worker.js");
    const first = client.read("C:\\images\\first.webp");
    const second = client.read("C:\\images\\second.webp");
    expect(child.messages.filter((item) => item.type === "read")).toHaveLength(1);

    child.emit("message", { id: request(child).id, ok: true, signature });
    await expect(first).resolves.toEqual(signature);
    expect(child.messages.filter((item) => item.type === "read")).toHaveLength(2);
    child.emit("message", { id: request(child, 1).id, ok: true, signature });
    await expect(second).resolves.toEqual(signature);
    client.close();
  });

  it("contains a native worker crash and continues with the next image", async () => {
    const firstChild = new FakeUtilityProcess();
    const secondChild = new FakeUtilityProcess();
    electron.fork.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const client = new VisualSignatureWorkerClient("visual-signature-worker.js");
    const crashing = client.read("C:\\images\\bad.webp");
    const next = client.read("C:\\images\\good.webp");

    firstChild.emit("exit", 1);
    await expect(crashing).rejects.toThrow("VISUAL_SIGNATURE_WORKER_CRASHED");
    expect(electron.fork).toHaveBeenCalledTimes(2);
    secondChild.emit("message", {
      id: request(secondChild).id,
      ok: true,
      signature,
    });
    await expect(next).resolves.toEqual(signature);
    client.close();
  });

  it("kills a worker that does not answer before the deadline", async () => {
    vi.useFakeTimers();
    const child = new FakeUtilityProcess();
    electron.fork.mockReturnValue(child);
    const client = new VisualSignatureWorkerClient("visual-signature-worker.js");
    const result = client.read("C:\\images\\stuck.webp");
    const rejection = expect(result).rejects.toThrow("VISUAL_SIGNATURE_WORKER_TIMEOUT");

    await vi.advanceTimersByTimeAsync(VISUAL_SIGNATURE_WORKER_TIMEOUT_MS);
    await rejection;
    expect(child.killed).toBe(true);
    client.close();
  });
});
