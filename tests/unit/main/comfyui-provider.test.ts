import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComfyUiProvider, type ComfyHttpResponse, type ComfyTransport } from "../../../src/main/services/ai/comfyui-provider";
import { parseWorkflow, type ComfyWorkflowBinding, type ComfyWorkflowDocument } from "../../../src/main/services/ai/comfyui-workflow";
import type { AiDesignRequest } from "../../../src/shared/contracts";

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

const WORKFLOW_JSON = JSON.stringify({
  nodes: [
    { id: 1, type: "LoadImage", inputs: { image: "" } },
    { id: 2, type: "CLIPTextEncode", inputs: { text: "" } },
    { id: 3, type: "KSampler", inputs: { seed: 0, strength: 1, batch_size: 1 } },
    { id: 4, type: "SaveImage", inputs: { images: "3" }, outputs: [{ name: "images" }] },
  ],
  last_node_id: 4,
});

function binding(): ComfyWorkflowBinding {
  return {
    source: { nodeId: "1", inputName: "image" },
    referenceSlots: [],
    prompt: { nodeId: "2", inputName: "text" },
    batchSize: { nodeId: "3", inputName: "batch_size" },
    majorChange: { nodeId: "3", inputName: "strength", minorValue: 0.5, majorValue: 1.5 },
    seed: { nodeId: "3", inputName: "seed" },
    outputNodeIds: ["4"],
  };
}

/** 内存 stub：模拟 /system_stats、/prompt、/history、/view 与上传。 */
function stubTransport(options: {
  promptReject?: boolean;
  historyError?: boolean;
  delayedHistory?: boolean;
  neverHistory?: boolean;
  queueRunning?: boolean;
  pngBuffer: Buffer;
}) {
  let historyQueries = 0;
  const calls: string[] = [];
  const promptBodies: unknown[] = [];
  const promptId = "prompt-1";
  const transport: ComfyTransport = {
    async fetchJson(pathname: string, init?: { method?: string; body?: unknown }): Promise<ComfyHttpResponse> {
      calls.push(`${init?.method ?? "GET"} ${pathname}`);
      if (pathname === "/system_stats") {
        return { status: 200, headers: {}, body: { system: {} } };
      }
      if (pathname === "/prompt") {
        promptBodies.push(init?.body);
        if (options.promptReject) return { status: 400, headers: {}, body: null };
        return { status: 200, headers: {}, body: { prompt_id: promptId } };
      }
      if (pathname.startsWith("/history/")) {
        historyQueries += 1;
        if (options.neverHistory) {
          return { status: 200, headers: {}, body: {} };
        }
        if (options.delayedHistory && historyQueries < 2) {
          return { status: 200, headers: {}, body: {} };
        }
        if (options.historyError) {
          return {
            status: 200,
            headers: {},
            body: { [promptId]: { status: { status_str: "error" } } },
          };
        }
        return {
          status: 200,
          headers: {},
          body: {
            [promptId]: {
              outputs: {
                "4": { images: [{ filename: "out_00001_.png", type: "output" }] },
              },
              status: { status_str: "success", completed: true },
            },
          },
        };
      }
      if (pathname === "/queue") {
        if (init?.method === "POST") return { status: 200, headers: {}, body: {} };
        return {
          status: 200,
          headers: {},
          body: {
            queue_running: options.queueRunning ? [[0, promptId]] : [],
            queue_pending: options.queueRunning ? [] : [[1, promptId]],
          },
        };
      }
      if (pathname === "/interrupt") {
        return { status: 200, headers: {}, body: {} };
      }
      return { status: 404, headers: {}, body: null };
    },
    async uploadImage(filename: string, _fileBuffer: Buffer) {
      calls.push(`UPLOAD ${filename}`);
      return { name: filename };
    },
    async downloadBuffer(url: string, maxBytes: number) {
      calls.push(`DOWNLOAD ${url.slice(url.lastIndexOf("/view?"))}`);
      return maxBytes >= options.pngBuffer.length ? options.pngBuffer : null;
    },
    async close() {
      // no-op
    },
  };
  return { transport, calls, promptBodies, getHistoryQueries: () => historyQueries };
}

async function makePng(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
}

async function scaffold(transport: ComfyTransport, options: { pollIntervalMs?: number; timeoutMs?: number } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-comfy-"));
  temporaryDirectories.push(directory);
  const source = path.join(directory, "input.png");
  const outputDirectory = path.join(directory, "out");
  const { default: sharp } = await import("sharp");
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .png()
    .toFile(source);
  const provider = new ComfyUiProvider({
    address: "http://127.0.0.1:8188",
    workflow: parseWorkflow(WORKFLOW_JSON)! as ComfyWorkflowDocument,
    binding: binding(),
    transport,
    pollIntervalMs: options.pollIntervalMs ?? 10,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  const request: AiDesignRequest = {
    sourcePath: source,
    referencePaths: [],
    prompt: "cinematic",
    majorChange: true,
    outputCount: 1,
    outputDirectory,
  };
  return { directory, provider, request, source, outputDirectory };
}

describe("comfyui provider (FND-009)", () => {
  it("health reports ok when system_stats responds", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png });
    const { provider } = await scaffold(transport);
    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.kind).toBe("comfyui");
  });

  it("completes a job: upload, prompt, history poll, view download and index", async () => {
    const png = await makePng();
    const { transport, calls } = stubTransport({ pngBuffer: png });
    const { provider, request, outputDirectory } = await scaffold(transport, { pollIntervalMs: 5 });
    const progressStates: string[] = [];
    const result = await provider.start(
      { jobId: "job-1", request, clientRequestId: "req-1" },
      { isCancelled: () => false },
      (snapshot) => progressStates.push(snapshot.state),
    );
    expect(result.externalId).toBe("prompt-1");
    expect(calls.some((call) => call.startsWith("UPLOAD input.png"))).toBe(true);
    expect(calls.some((call) => call.includes("POST /prompt"))).toBe(true);
    expect(calls.some((call) => call.includes("GET /history/"))).toBe(true);
    expect(progressStates).toContain("uploading");
    expect(progressStates).toContain("generating");
    expect(progressStates).toContain("completed");
    // 输出已写入用户目录并可解码。
    const output = path.join(outputDirectory, "out_00001_.png");
    await expect(stat(output)).resolves.toBeDefined();
  });

  it("uses an isolated workflow copy and binds the requested output count", async () => {
    const png = await makePng();
    const { transport, promptBodies } = stubTransport({ pngBuffer: png });
    const { provider, request } = await scaffold(transport);
    await provider.start(
      {
        jobId: "job-batch",
        request: { ...request, outputCount: 3 },
        clientRequestId: "req-batch",
      },
      { isCancelled: () => false },
      () => undefined,
    );
    const submitted = promptBodies[0] as {
      prompt: ComfyWorkflowDocument;
    };
    const sampler = submitted.prompt.nodes?.find((node) => String(node.id) === "3");
    expect(sampler?.inputs?.batch_size).toBe(3);
  });

  it("rejects prompt with field-level failure before creating outputs", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png, promptReject: true });
    const { provider, request } = await scaffold(transport);
    await expect(
      provider.start(
        { jobId: "job-2", request, clientRequestId: "req-2" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("COMFYUI_PROMPT_REJECTED");
  });

  it("surfaces execution errors from history", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png, historyError: true });
    const { provider, request } = await scaffold(transport);
    await expect(
      provider.start(
        { jobId: "job-3", request, clientRequestId: "req-3" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("COMFYUI_EXECUTION_ERROR");
  });

  it("polls history until outputs appear (recovery path)", async () => {
    const png = await makePng();
    const { transport, getHistoryQueries } = stubTransport({ pngBuffer: png, delayedHistory: true });
    const { provider, request } = await scaffold(transport, { pollIntervalMs: 5 });
    const result = await provider.start(
      { jobId: "job-4", request, clientRequestId: "req-4" },
      { isCancelled: () => false },
      () => undefined,
    );
    expect(result.externalId).toBe("prompt-1");
    expect(getHistoryQueries()).toBeGreaterThanOrEqual(2);
  });

  it("times out when history never completes", async () => {
    const png = await makePng();
    // 永不返回输出的 stub：history 总是空。
    const transport: ComfyTransport = {
      async fetchJson(pathname: string): Promise<ComfyHttpResponse> {
        if (pathname === "/system_stats") return { status: 200, headers: {}, body: {} };
        if (pathname === "/prompt") return { status: 200, headers: {}, body: { prompt_id: "p-x" } };
        if (pathname.startsWith("/history/")) return { status: 200, headers: {}, body: {} };
        return { status: 404, headers: {}, body: null };
      },
      async uploadImage(filename: string, _fileBuffer: Buffer) {
        return { name: filename };
      },
      async downloadBuffer() {
        return png;
      },
      async close() {
        // no-op
      },
    };
    const { provider, request } = await scaffold(transport, { pollIntervalMs: 5, timeoutMs: 200 });
    await expect(
      provider.start(
        { jobId: "job-5", request, clientRequestId: "req-5" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("COMFYUI_JOB_TIMEOUT");
  });

  it("cancels by throwing AI_JOB_CANCELLED at the next checkpoint", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png });
    const { provider, request } = await scaffold(transport);
    let cancelled = false;
    await expect(
      provider.start(
        { jobId: "job-6", request, clientRequestId: "req-6" },
        { isCancelled: () => cancelled },
        () => {
          cancelled = true; // 第一次进度回调后取消。
        },
      ),
    ).rejects.toThrow("AI_JOB_CANCELLED");
  });

  it("cancels only its owned running prompt through ComfyUI interrupt", async () => {
    const png = await makePng();
    const { transport, calls } = stubTransport({
      pngBuffer: png,
      neverHistory: true,
      queueRunning: true,
    });
    const { provider, request } = await scaffold(transport, { pollIntervalMs: 5 });
    let cancelled = false;
    let resolveSubmitted!: () => void;
    const submitted = new Promise<void>((resolve) => { resolveSubmitted = resolve; });
    const running = provider.start(
      { jobId: "job-owned", request, clientRequestId: "req-owned" },
      { isCancelled: () => cancelled },
      (snapshot) => {
        if (snapshot.externalId) resolveSubmitted();
      },
    );
    await submitted;
    const result = await provider.cancel("job-owned", "prompt-1");
    expect(result.cancelled).toBe(true);
    cancelled = true;
    await expect(running).rejects.toThrow("AI_JOB_CANCELLED");
    expect(calls).toContain("GET /queue");
    expect(calls).toContain("POST /interrupt");
    const foreign = await provider.cancel("other-job", "prompt-1");
    expect(foreign.cancelled).toBe(false);
  });

  it("rejects LAN address at construction", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png });
    expect(
      () =>
        new ComfyUiProvider({
          address: "http://192.168.1.10:8188",
          workflow: parseWorkflow(WORKFLOW_JSON)! as ComfyWorkflowDocument,
          binding: binding(),
          transport,
        }),
    ).toThrow("COMFYUI_ADDRESS_NOT_LOCAL");
  });

  it("accepts any valid 127/8 loopback address", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png });
    expect(
      () =>
        new ComfyUiProvider({
          address: "http://127.2.3.4:8188",
          workflow: parseWorkflow(WORKFLOW_JSON)! as ComfyWorkflowDocument,
          binding: binding(),
          transport,
        }),
    ).not.toThrow();
  });
});
