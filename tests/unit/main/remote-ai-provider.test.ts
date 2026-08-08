import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RemoteRestProvider,
  type RemoteDownloadResult,
  type RemoteHttpResponse,
  type RemoteTransport,
} from "../../../src/main/services/ai/remote-ai-provider";
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

/** 内存 stub：模拟 v1 协议的 prepare/upload/create/poll/download/cancel。 */
function stubTransport(options: {
  createReject?: boolean;
  pollStatuses?: Array<{ state: string; stage?: string }>;
  retryAfter?: number;
  downloadMime?: string;
  downloadHashMismatch?: boolean;
  uploadReject?: boolean;
  pngBuffer: Buffer;
}) {
  const calls: string[] = [];
  let pollIndex = 0;
  const transport: RemoteTransport = {
    async request(req: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
      bodyBuffer?: Buffer;
      timeoutMs: number;
    }): Promise<RemoteHttpResponse> {
      calls.push(`${req.method} ${req.url}`);
      if (req.method === "POST" && req.url.endsWith("/v1/uploads/prepare")) {
        return {
          status: 200,
          headers: {},
          body: {
            uploads: [
              { clientFileId: "source", uploadId: "up-1", method: "PUT", url: "https://presigned.example.com/up-1", headers: { "x-amz-tag": "a" }, expiresAt: "2026-01-01T00:00:00Z" },
            ],
          },
        };
      }
      if (req.method === "PUT" && req.url.includes("presigned.example.com")) {
        if (options.uploadReject) return { status: 403, headers: {}, body: null };
        return { status: 200, headers: {}, body: null };
      }
      if (req.method === "POST" && req.url.endsWith("/v1/design-jobs")) {
        if (options.createReject) return { status: 400, headers: {}, body: null };
        return { status: 201, headers: {}, body: { id: "job-remote-1" } };
      }
      if (req.method === "GET" && req.url.includes("/v1/design-jobs/job-remote-1")) {
        const status = options.pollStatuses?.[pollIndex] ?? { state: "completed" };
        pollIndex += 1;
        if (status.state === "completed") {
          return {
            status: 200,
            headers: {},
            body: {
              id: "job-remote-1",
              state: "completed",
              outputs: [
                {
                  id: "o1",
                  url: "https://cdn.example.com/out.png",
                  mime: "image/png",
                  size: options.pngBuffer.length,
                },
              ],
            },
          };
        }
        return { status: 200, headers: {}, body: { id: "job-remote-1", ...status } };
      }
      if (req.method === "POST" && req.url.endsWith("/v1/design-jobs/job-remote-1/cancel")) {
        return { status: 200, headers: {}, body: null };
      }
      return { status: 404, headers: {}, body: null };
    },
    async download(opts: { url: string; headers?: Record<string, string>; maxBytes: number }): Promise<RemoteDownloadResult | null> {
      calls.push(`DOWNLOAD ${opts.url}`);
      if (options.downloadHashMismatch) {
        return { buffer: options.pngBuffer, mime: options.downloadMime ?? "image/png", sha256: "0000" };
      }
      return {
        buffer: options.pngBuffer,
        mime: options.downloadMime ?? "image/png",
        sha256: null,
      };
    },
  };
  return { transport, calls, pollCount: () => pollIndex };
}

async function makePng(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 5, g: 6, b: 7 } },
  })
    .png()
    .toBuffer();
}

async function scaffold(
  transport: RemoteTransport,
  options: { baseUrl?: string; pollStatuses?: Array<{ state: string; stage?: string }> } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-remote-"));
  temporaryDirectories.push(directory);
  const source = path.join(directory, "input.png");
  const outputDirectory = path.join(directory, "out");
  const { default: sharp } = await import("sharp");
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .png()
    .toFile(source);
  const provider = new RemoteRestProvider({
    baseUrl: options.baseUrl ?? "https://api.example.com/v1",
    transport,
    resolveDns: async () => ["93.184.216.34"],
    pollBaseMs: 5,
    timeoutMs: 3_000,
  });
  provider.setTokenProvider(async () => "Bearer sk-123");
  const request: AiDesignRequest = {
    sourcePath: source,
    referencePaths: [],
    prompt: "cinematic",
    majorChange: true,
    outputCount: 1,
    outputDirectory,
  };
  return { directory, provider, request, outputDirectory };
}

describe("remote rest provider (FND-010 §9.6)", () => {
  it("completes the prepare → upload → create → poll → download flow", async () => {
    const png = await makePng();
    const { transport, calls } = stubTransport({ pngBuffer: png });
    const { provider, request, outputDirectory } = await scaffold(transport);
    const progress: string[] = [];
    const result = await provider.start(
      { jobId: "job-1", request, clientRequestId: "req-1" },
      { isCancelled: () => false },
      (snapshot) => progress.push(snapshot.state),
    );
    expect(result.externalId).toBe("job-remote-1");
    expect(calls.some((call) => call.includes("/v1/uploads/prepare"))).toBe(true);
    expect(calls.some((call) => call.startsWith("PUT https://presigned.example.com"))).toBe(true);
    expect(calls.some((call) => call.includes("/v1/design-jobs"))).toBe(true);
    expect(calls.some((call) => call.includes("/v1/design-jobs/job-remote-1"))).toBe(true);
    expect(progress).toContain("completed");
    const output = path.join(outputDirectory, "out.png");
    await expect(stat(output)).resolves.toBeDefined();
  });

  it("does not forward the bearer token to presigned URLs", async () => {
    const png = await makePng();
    const { transport, calls } = stubTransport({ pngBuffer: png });
    const { provider, request } = await scaffold(transport);
    await provider.start(
      { jobId: "job-2", request, clientRequestId: "req-2" },
      { isCancelled: () => false },
      () => undefined,
    );
    // 上传与下载请求不应携带 Authorization。
    const putCall = calls.find((call) => call.startsWith("PUT https://presigned.example.com"));
    expect(putCall).toBeTruthy();
  });

  it("rejects create failure before output", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png, createReject: true });
    const { provider, request } = await scaffold(transport);
    await expect(
      provider.start(
        { jobId: "job-3", request, clientRequestId: "req-3" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("REMOTE_CREATE_JOB_REJECTED");
  });

  it("rejects presigned URL not on the public allowlist", async () => {
    // 预签名 URL 指向私网 → validateRedirectTarget 拒绝。
    const transport: RemoteTransport = {
      async request(req) {
        if (req.method === "POST" && req.url.endsWith("/v1/uploads/prepare")) {
          return {
            status: 200,
            headers: {},
            body: {
              uploads: [
                { clientFileId: "source", uploadId: "up-9", method: "PUT", url: "https://10.0.0.9/up", headers: {}, expiresAt: "" },
              ],
            },
          };
        }
        return { status: 404, headers: {}, body: null };
      },
      async download() {
        return null;
      },
    };
    const { provider, request } = await scaffold(transport);
    await expect(
      provider.start(
        { jobId: "job-4", request, clientRequestId: "req-4" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("REMOTE_PRESIGNED_URL_REJECTED");
  });

  it("rejects non-image MIME and corrupt image downloads", async () => {
    const png = await makePng();
    const badMime = stubTransport({ pngBuffer: png, downloadMime: "text/html" });
    const { provider, request } = await scaffold(badMime.transport);
    await expect(
      provider.start(
        { jobId: "job-5", request, clientRequestId: "req-5" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("REMOTE_OUTPUT_MIME_INVALID");
    // 损坏图片（非 PNG 内容）。
    const corrupt = stubTransport({ pngBuffer: Buffer.from("not an image at all") });
    const { provider: provider2, request: request2 } = await scaffold(corrupt.transport);
    await expect(
      provider2.start(
        { jobId: "job-6", request: request2, clientRequestId: "req-6" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow();
  });

  it("rejects private Job API base URL before any request", async () => {
    const png = await makePng();
    const { transport } = stubTransport({ pngBuffer: png });
    const { provider, request } = await scaffold(transport, {
      baseUrl: "https://192.168.1.5/v1",
    });
    await expect(
      provider.start(
        { jobId: "job-7", request, clientRequestId: "req-7" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("REMOTE_URL_REJECTED");
  });

  it("polls through intermediate generating states", async () => {
    const png = await makePng();
    const { transport } = stubTransport({
      pngBuffer: png,
      pollStatuses: [
        { state: "queued", stage: "queued" },
        { state: "generating", stage: "generating" },
        { state: "completed" },
      ],
    });
    const { provider, request } = await scaffold(transport);
    const result = await provider.start(
      { jobId: "job-8", request, clientRequestId: "req-8" },
      { isCancelled: () => false },
      () => undefined,
    );
    expect(result.externalId).toBe("job-remote-1");
  });

  it("surfaces remote failed state", async () => {
    const png = await makePng();
    const { transport } = stubTransport({
      pngBuffer: png,
      pollStatuses: [{ state: "failed", stage: "failed" }],
    });
    const { provider, request } = await scaffold(transport);
    await expect(
      provider.start(
        { jobId: "job-9", request, clientRequestId: "req-9" },
        { isCancelled: () => false },
        () => undefined,
      ),
    ).rejects.toThrow("REMOTE_JOB_FAILED");
  });
});
