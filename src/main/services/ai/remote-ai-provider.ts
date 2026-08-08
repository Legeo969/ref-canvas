/**
 * Remote REST v1 Provider（found-clone.md §9.6）。
 *
 * 协议端点：
 * 1. POST /v1/uploads/prepare：为每个输入取得 upload id、预签名 URL、所需
 *    headers 和过期时间。
 * 2. 客户端直接 PUT 上传到预签名 URL。
 * 3. POST /v1/design-jobs：提交上传 id、提示词、重大改动、输出数量与
 *    clientRequestId。
 * 4. GET /v1/design-jobs/{id}：读取状态、进度、错误与输出下载描述。
 * 5. POST /v1/design-jobs/{id}/cancel：请求取消。
 *
 * 安全约束（remote-ai-security.ts）：Job API 必须是公网 HTTPS、禁止重定向；
 * 预签名上传/下载最多一次 HTTPS 重定向并重新校验公网地址；不向预签名地址
 * 转发 Bearer token；轮询退避 1/2/4/8 秒后固定 10 秒。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AiDesignRequest,
  AiProviderHealth,
  AiProviderKind,
} from "../../../shared/contracts";
import {
  type AiProvider,
  type AiProviderCancelResult,
  type AiProviderRunContext,
  type AiProviderStartResult,
  type AiRunToken,
} from "./ai-provider";
import {
  filterUploadHeaders,
  validatePublicHttpsUrl,
  validateRedirectTarget,
} from "./remote-ai-security";

const MAX_SINGLE_DOWNLOAD_BYTES = 250 * 1024 * 1024; // 250 MiB
const MAX_TOTAL_DOWNLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface RemoteHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface RemoteDownloadResult {
  buffer: Buffer;
  mime: string;
  sha256: string | null;
}

/** 可注入传输（测试用本地 HTTPS stub）。 */
export interface RemoteTransport {
  request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyBuffer?: Buffer;
    maxRedirects?: number;
    timeoutMs: number;
  }): Promise<RemoteHttpResponse>;
  download(options: {
    url: string;
    headers?: Record<string, string>;
    maxBytes: number;
    timeoutMs: number;
  }): Promise<RemoteDownloadResult | null>;
}

export interface RemoteProviderOptions {
  baseUrl: string;
  transport: RemoteTransport;
  resolveDns?: (hostname: string) => Promise<string[]>;
  /** 轮询退避基数（默认 1s，测试可注入更快节奏）。 */
  pollBaseMs?: number;
  timeoutMs?: number;
}

export interface RemotePreparedUpload {
  clientFileId: string;
  uploadId: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export class RemoteRestProvider implements AiProvider {
  readonly kind: AiProviderKind = "remote-rest";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pollBaseMs: number;

  constructor(private readonly options: RemoteProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollBaseMs = options.pollBaseMs ?? 1_000;
  }

  private backoffMs(attempt: number, retryAfterSeconds?: number): number {
    const base = attempt <= 3 ? this.pollBaseMs * 2 ** attempt : this.pollBaseMs * 10;
    if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
      return Math.max(base, retryAfterSeconds * 1000);
    }
    return base;
  }

  async health(): Promise<AiProviderHealth> {
    const started = Date.now();
    const validation = await validatePublicHttpsUrl(
      this.baseUrl,
      this.options.resolveDns,
    );
    if (!validation.ok) {
      return { kind: "remote-rest", ok: false, detail: validation.reason ?? "URL 无效", latencyMs: Date.now() - started };
    }
    return {
      kind: "remote-rest",
      ok: true,
      detail: "已配置（连接在首个任务时验证）",
      latencyMs: Date.now() - started,
    };
  }

  private async assertBaseUrlAllowed(): Promise<void> {
    const validation = await validatePublicHttpsUrl(this.baseUrl, this.options.resolveDns);
    if (!validation.ok) {
      throw new Error(`REMOTE_URL_REJECTED:${validation.reason ?? ""}`);
    }
  }

  async start(
    context: AiProviderRunContext,
    token: AiRunToken,
    onProgress: Parameters<AiProvider["start"]>[2],
  ): Promise<AiProviderStartResult> {
    await this.assertBaseUrlAllowed();
    const { request, clientRequestId } = context;

    // 1) prepare 上传。
    onProgress({ state: "uploading", stage: "prepare", progress: 0.05 });
    const prepared = await this.prepareUploads(request);
    // 2) 上传源图与参考图（不携带 Bearer token，只发送 allowlist headers）。
    onProgress({ state: "uploading", stage: "uploading", progress: 0.15 });
    const uploadIds: Record<string, string> = {};
    for (const entry of prepared) {
      this.checkCancelled(token);
      const sourcePath =
        entry.clientFileId === "source"
          ? request.sourcePath
          : request.referencePaths[Number(entry.clientFileId)];
      const buffer = await this.readInput(sourcePath);
      await this.uploadToPresigned(entry, buffer);
      uploadIds[entry.clientFileId] = entry.uploadId;
    }
    onProgress({ state: "uploading", stage: "uploading", progress: 0.3 });

    // 3) 创建设计任务（clientRequestId 幂等）。
    this.checkCancelled(token);
    const createResponse = await this.transport.request({
      method: "POST",
      url: `${this.baseUrl}/v1/design-jobs`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.token()}` },
      body: {
        clientRequestId,
        sourceUploadId: uploadIds["source"],
        referenceUploadIds: request.referencePaths.map(
          (_reference, index) => uploadIds[String(index)],
        ),
        prompt: request.prompt,
        majorChange: request.majorChange,
        outputCount: request.outputCount,
      },
      timeoutMs: this.timeoutMs,
    });
    if (createResponse.status === 409) {
      // 幂等冲突：同 clientRequestId 已存在 → 读取既有任务。
      const existing = await this.getJobByRequestId(clientRequestId);
      return { externalId: existing.id, recovery: { remoteJobId: existing.id } };
    }
    if (createResponse.status !== 201 && createResponse.status !== 200) {
      throw new Error(`REMOTE_CREATE_JOB_REJECTED:${createResponse.status}`);
    }
    const created = createResponse.body as { id?: string };
    if (!created?.id) throw new Error("REMOTE_JOB_ID_MISSING");

    // 4) 轮询状态。
    onProgress({ state: "generating", stage: "generating", progress: 0.35 });
    const outputs = await this.pollUntilComplete(
      created.id,
      token,
      onProgress,
    );
    // 5) 下载输出。
    onProgress({ state: "downloading", stage: "downloading", progress: 0.95 });
    const downloaded = await this.downloadOutputs(outputs, request.outputDirectory, token);
    onProgress({ state: "completed", stage: "completed", progress: 1, outputs: downloaded });
    return { externalId: created.id, recovery: { remoteJobId: created.id } };
  }

  async cancel(_jobId: string, externalId: string | null): Promise<AiProviderCancelResult> {
    if (!externalId) return { cancelled: false, reason: "无外部任务 id" };
    const response = await this.transport.request({
      method: "POST",
      url: `${this.baseUrl}/v1/design-jobs/${encodeURIComponent(externalId)}/cancel`,
      headers: { Authorization: `Bearer ${await this.token()}` },
      timeoutMs: 30_000,
    });
    return { cancelled: response.status === 200 || response.status === 202 };
  }

  private async token(): Promise<string> {
    // 由协调器在构造前注入 tokenProvider；未配置抛错。
    if (!this.tokenProvider) throw new Error("REMOTE_TOKEN_NOT_CONFIGURED");
    return this.tokenProvider();
  }

  private tokenProvider: (() => Promise<string>) | null = null;

  /** 协调器注入 token 读取函数（Renderer 永不接触明文）。 */
  setTokenProvider(provider: () => Promise<string>): void {
    this.tokenProvider = provider;
  }

  private async prepareUploads(
    request: AiDesignRequest,
  ): Promise<RemotePreparedUpload[]> {
    const files = [
      { clientFileId: "source", name: path.basename(request.sourcePath), path: request.sourcePath },
      ...request.referencePaths.map((reference, index) => ({
        clientFileId: String(index),
        name: path.basename(reference),
        path: reference,
      })),
    ];
    const fileDescriptors: Array<{ clientFileId: string; name: string; size: number; mime: string; sha256: string }> = [];
    for (const file of files) {
      const info = await stat(file.path).catch(() => null);
      if (!info?.isFile()) throw new Error("REMOTE_INPUT_MISSING");
      const buffer = await this.readInput(file.path);
      fileDescriptors.push({
        clientFileId: file.clientFileId,
        name: file.name,
        size: buffer.length,
        mime: "image/png",
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
    }
    const response = await this.transport.request({
      method: "POST",
      url: `${this.baseUrl}/v1/uploads/prepare`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.token()}` },
      body: { files: fileDescriptors },
      timeoutMs: this.timeoutMs,
    });
    if (response.status !== 200) throw new Error(`REMOTE_PREPARE_REJECTED:${response.status}`);
    const body = response.body as { uploads?: Array<Record<string, unknown>> };
    const uploads = body?.uploads ?? [];
    return uploads.map((entry) => ({
      clientFileId: String(entry.clientFileId),
      uploadId: String(entry.uploadId),
      method: (entry.method ?? "PUT") as "PUT",
      url: String(entry.url),
      headers: (entry.headers as Record<string, string>) ?? {},
      expiresAt: String(entry.expiresAt ?? ""),
    }));
  }

  private async uploadToPresigned(
    prepared: RemotePreparedUpload,
    buffer: Buffer,
  ): Promise<void> {
    // 预签名 URL 公网校验 + 一次 HTTPS 重定向。
    const validation = await validateRedirectTarget(prepared.url, this.options.resolveDns);
    if (!validation.ok) throw new Error("REMOTE_PRESIGNED_URL_REJECTED");
    const headers = filterUploadHeaders(prepared.headers);
    const response = await this.transport.request({
      method: "PUT",
      url: prepared.url,
      headers,
      bodyBuffer: buffer,
      maxRedirects: 1,
      timeoutMs: 60_000,
    });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`REMOTE_UPLOAD_REJECTED:${response.status}`);
    }
  }

  private async getJobByRequestId(clientRequestId: string): Promise<{ id: string }> {
    const response = await this.transport.request({
      method: "POST",
      url: `${this.baseUrl}/v1/design-jobs`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.token()}` },
      body: { clientRequestId, sourceUploadId: "", referenceUploadIds: [], prompt: "", majorChange: false, outputCount: 1 },
      timeoutMs: this.timeoutMs,
    });
    const body = response.body as { id?: string };
    if (!body?.id) throw new Error("REMOTE_JOB_ID_MISSING");
    return { id: body.id };
  }

  private async pollUntilComplete(
    remoteJobId: string,
    token: AiRunToken,
    onProgress: Parameters<AiProvider["start"]>[2],
  ): Promise<Array<{ id: string; url: string; mime: string; size: number; sha256?: string }>> {
    const started = Date.now();
    let attempt = 0;
    for (;;) {
      this.checkCancelled(token);
      if (Date.now() - started > this.timeoutMs) throw new Error("REMOTE_JOB_TIMEOUT");
      const response = await this.transport.request({
        method: "GET",
        url: `${this.baseUrl}/v1/design-jobs/${encodeURIComponent(remoteJobId)}`,
        headers: { Authorization: `Bearer ${await this.token()}` },
        timeoutMs: 30_000,
      });
      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers["retry-after"] ?? "0");
        attempt += 1;
        await sleep(this.backoffMs(attempt, retryAfter));
        continue;
      }
      if (response.status !== 200) throw new Error(`REMOTE_POLL_REJECTED:${response.status}`);
      const job = response.body as {
        id: string;
        state?: string;
        stage?: string;
        progress?: number;
        outputs?: Array<{ id: string; url: string; mime: string; size: number; sha256?: string }>;
        error?: { code?: string; message?: string };
      };
      if (job.state === "completed") {
        const outputs = job.outputs ?? [];
        if (outputs.length > 0) return outputs;
        // 无输出视为完成但为空。
        return [];
      }
      if (job.state === "failed" || job.state === "cancelled") {
        throw new Error(`REMOTE_JOB_${job.state.toUpperCase()}:${job.error?.code ?? ""} ${job.error?.message ?? ""}`);
      }
      if (job.stage) {
        onProgress({ state: job.stage === "downloading" ? "downloading" : "generating", stage: job.stage, progress: job.progress ?? null });
      }
      attempt += 1;
      const retryAfter = Number(response.headers["retry-after"] ?? "0");
      await sleep(this.backoffMs(attempt, retryAfter));
    }
  }

  private async downloadOutputs(
    outputs: Array<{ id: string; url: string; mime: string; size: number; sha256?: string }>,
    outputDirectory: string,
    token: AiRunToken,
  ): Promise<string[]> {
    const resolvedDirectory = path.resolve(outputDirectory);
    await mkdir(resolvedDirectory, { recursive: true });
    const downloaded: string[] = [];
    let totalBytes = 0;
    for (const output of outputs) {
      this.checkCancelled(token);
      const validation = await validateRedirectTarget(output.url, this.options.resolveDns);
      if (!validation.ok) throw new Error("REMOTE_OUTPUT_URL_REJECTED");
      const result = await this.transport.download({
        url: output.url,
        headers: {}, // 不转发 Bearer token。
        maxBytes: MAX_SINGLE_DOWNLOAD_BYTES,
        timeoutMs: this.timeoutMs,
      });
      if (!result) throw new Error("REMOTE_DOWNLOAD_FAILED");
      if (result.buffer.length > MAX_SINGLE_DOWNLOAD_BYTES) throw new Error("REMOTE_DOWNLOAD_TOO_LARGE");
      totalBytes += result.buffer.length;
      if (totalBytes > MAX_TOTAL_DOWNLOAD_BYTES) throw new Error("REMOTE_TOTAL_DOWNLOAD_TOO_LARGE");
      // MIME 与图片解码验证。
      if (!result.mime.startsWith("image/")) throw new Error("REMOTE_OUTPUT_MIME_INVALID");
      await this.verifyImage(result.buffer);
      // 可选 SHA-256 校验。
      if (output.sha256) {
        const actual = createHash("sha256").update(result.buffer).digest("hex");
        if (actual !== output.sha256) throw new Error("REMOTE_OUTPUT_HASH_MISMATCH");
      }
      // 临时文件 + 原子移动。
      const tempFile = path.join(resolvedDirectory, `.download-${randomUUID()}.tmp`);
      const target = await this.nextTarget(resolvedDirectory, path.basename(output.url.split("?")[0]) || "output.png");
      await writeFile(tempFile, result.buffer);
      await rename(tempFile, target);
      downloaded.push(target);
    }
    return downloaded;
  }

  private async readInput(filename: string): Promise<Buffer> {
    const { readFile } = await import("node:fs/promises");
    return readFile(filename);
  }

  private async verifyImage(buffer: Buffer): Promise<void> {
    const { default: sharp } = await import("sharp");
    await sharp(buffer).metadata();
  }

  private async nextTarget(directory: string, base: string): Promise<string> {
    const root = path.resolve(directory);
    let candidate = base;
    let index = 2;
    const parsed = path.parse(base);
    for (;;) {
      const target = path.resolve(root, candidate);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("REMOTE_OUTPUT_PATH_ESCAPE");
      }
      const exists = await stat(target).then(() => true, () => false);
      if (!exists) return target;
      candidate = `${parsed.name} (${index})${parsed.ext}`;
      index += 1;
    }
  }

  private checkCancelled(token: AiRunToken): void {
    if (token.isCancelled()) throw new Error("AI_JOB_CANCELLED");
  }

  private get transport(): RemoteTransport {
    return this.options.transport;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
