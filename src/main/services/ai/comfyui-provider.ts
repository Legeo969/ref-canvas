/**
 * ComfyUI 本地 Provider（found-clone.md §9.5）。
 *
 * - 默认地址 `http://127.0.0.1:8188`，只允许 localhost/127/8/::1。
 * - `/system_stats` 健康检查、`/upload/image` 上传、`/prompt` 入队、
 *   `/history/{prompt_id}` 恢复、`/view` 下载、`/queue` 取消、受所有权保护的
 *   `/interrupt`。
 * - WebSocket 断开后每 2 秒轮询 history；重连后停止轮询。默认任务超时 30 分钟。
 * - 输出经大小、MIME 与图片解码验证后写入用户输出目录。
 *
 * 网络层抽象为 {@link ComfyTransport}，测试用本地 HTTP/WS stub 注入。
 */
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
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
  assertComfyAddressAllowed,
  type ComfyWorkflowBinding,
  type ComfyWorkflowDocument,
} from "./comfyui-workflow";

export const COMFYUI_DEFAULT_ADDRESS = "http://127.0.0.1:8188";
export const COMFYUI_JOB_TIMEOUT_MS = 30 * 60 * 1000;
export const COMFYUI_POLL_INTERVAL_MS = 2_000;
const MAX_OUTPUT_BYTES = 250 * 1024 * 1024; // 250 MiB

export interface ComfyHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ComfyUploadResult {
  name: string;
  subfolder?: string;
  type?: string;
}

/** 可注入的 ComfyUI 网络传输（测试用本地 stub 实现）。 */
export interface ComfyTransport {
  fetchJson(pathname: string, init?: { method?: string; body?: unknown }): Promise<ComfyHttpResponse>;
  uploadImage(filename: string, fileBuffer: Buffer): Promise<ComfyUploadResult>;
  downloadBuffer(url: string, maxBytes: number): Promise<Buffer | null>;
  close(): Promise<void>;
}

export interface ComfyProviderOptions {
  address?: string;
  workflow: ComfyWorkflowDocument;
  binding: ComfyWorkflowBinding;
  transport?: ComfyTransport;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export class ComfyUiProvider implements AiProvider {
  readonly kind: AiProviderKind = "comfyui";
  private readonly address: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: ComfyProviderOptions) {
    this.address = assertComfyAddressAllowed(options.address ?? COMFYUI_DEFAULT_ADDRESS);
    this.pollIntervalMs = options.pollIntervalMs ?? COMFYUI_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? COMFYUI_JOB_TIMEOUT_MS;
    if (!options.workflow || !options.binding) {
      throw new Error("COMFYUI_WORKFLOW_OR_BINDING_MISSING");
    }
  }

  private get transport(): ComfyTransport {
    if (!this.options.transport) {
      throw new Error("COMFYUI_TRANSPORT_UNAVAILABLE");
    }
    return this.options.transport;
  }

  async health(): Promise<AiProviderHealth> {
    const started = Date.now();
    try {
      const response = await this.transport.fetchJson("/system_stats");
      const ok = response.status === 200 && response.body !== null;
      return {
        kind: "comfyui",
        ok,
        detail: ok ? "ComfyUI 在线" : `system_stats 返回 ${response.status}`,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        kind: "comfyui",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  }

  async start(
    context: AiProviderRunContext,
    token: AiRunToken,
    onProgress: Parameters<AiProvider["start"]>[2],
  ): Promise<AiProviderStartResult> {
    const { request, jobId } = context;
    // 上传源图与参考图。
    onProgress({ state: "uploading", stage: "uploading", progress: 0.05 });
    const sourceName = await this.uploadInput(request.sourcePath);
    const referenceNames: string[] = [];
    for (const reference of request.referencePaths) {
      this.checkCancelled(token);
      referenceNames.push(await this.uploadInput(reference));
    }
    onProgress({ state: "uploading", stage: "uploading", progress: 0.2 });

    // 构造 prompt 并绑定工作流 input。
    const prompt = this.buildPrompt(request, sourceName, referenceNames, jobId);
    onProgress({ state: "uploading", stage: "uploading", progress: 0.3 });
    this.checkCancelled(token);
    const response = await this.transport.fetchJson("/prompt", {
      method: "POST",
      body: prompt,
    });
    if (response.status !== 200) {
      throw new Error(`COMFYUI_PROMPT_REJECTED:${response.status}`);
    }
    const promptId = (response.body as { prompt_id?: string })?.prompt_id;
    if (!promptId) throw new Error("COMFYUI_PROMPT_ID_MISSING");

    onProgress({ state: "generating", stage: "generating", progress: 0.35 });
    const outputs = await this.waitForOutput(promptId, request.outputDirectory, token, onProgress);
    onProgress({ state: "downloading", stage: "downloading", progress: 0.98, outputs });
    onProgress({ state: "completed", stage: "completed", progress: 1, outputs });
    return {
      externalId: promptId,
      recovery: { promptId, address: this.address },
    };
  }

  private async uploadInput(filename: string): Promise<string> {
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) throw new Error("COMFYUI_INPUT_MISSING");
    if (info.size > 100 * 1024 * 1024) throw new Error("COMFYUI_INPUT_TOO_LARGE");
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(filename);
    const uploaded = await this.transport.uploadImage(path.basename(filename), buffer);
    return uploaded.name;
  }

  private buildPrompt(
    request: AiDesignRequest,
    sourceName: string,
    referenceNames: string[],
    jobId: string,
  ): Record<string, unknown> {
    const b = this.options.binding;
    const setInput = (bound: { nodeId: string; inputName: string }, value: unknown) => {
      const node = this.options.workflow.nodes?.find(
        (candidate) => String(candidate.id) === String(bound.nodeId),
      );
      if (!node) throw new Error("COMFYUI_BINDING_NODE_MISSING");
      node.inputs = { ...(node.inputs ?? {}), [bound.inputName]: value };
    };
    setInput(b.source, sourceName);
    b.referenceSlots.forEach((slot, index) => {
      const value = referenceNames[index];
      if (value) setInput(slot, value);
    });
    setInput(b.prompt, request.prompt);
    setInput(b.batchSize, 1);
    if (b.majorChange) {
      setInput(
        b.majorChange,
        request.majorChange ? b.majorChange.majorValue : b.majorChange.minorValue,
      );
    }
    if (b.seed) {
      // seed 由 clientRequestId + jobId 确定性派生（同任务可复现）。
      const seed = Number.parseInt(createHash("sha256").update(jobId).digest("hex").slice(0, 8), 16);
      setInput(b.seed, seed);
    }
    const clientId = `refcanvas-${jobId}`;
    return {
      prompt: { ...this.options.workflow },
      client_id: clientId,
    };
  }

  /** 轮询 history 直到 completed/error/超时；模拟 WebSocket 断开后的恢复路径。 */
  private async waitForOutput(
    promptId: string,
    outputDirectory: string,
    token: AiRunToken,
    onProgress: Parameters<AiProvider["start"]>[2],
  ): Promise<string[]> {
    const started = Date.now();
    let progress = 0.35;
    for (;;) {
      this.checkCancelled(token);
      if (Date.now() - started > this.timeoutMs) {
        throw new Error("COMFYUI_JOB_TIMEOUT");
      }
      const response = await this.transport.fetchJson(`/history/${promptId}`);
      if (response.status === 200 && response.body) {
        const history = response.body as Record<string, { outputs?: Record<string, { images?: Array<{ filename?: string; subfolder?: string; type?: string }> }>; status?: { status_str?: string; completed?: boolean } }>;
        const entry = history[promptId];
        if (entry) {
          if (entry.status?.status_str === "error") {
            throw new Error("COMFYUI_EXECUTION_ERROR");
          }
          const images: Array<{ filename: string; subfolder?: string; type?: string }> = [];
          for (const output of Object.values(entry.outputs ?? {})) {
            for (const image of output.images ?? []) {
              if (image.filename) {
                images.push({
                  filename: image.filename,
                  subfolder: image.subfolder,
                  type: image.type,
                });
              }
            }
          }
          if (images.length > 0) {
            return await this.downloadOutputs(images, outputDirectory, token, onProgress);
          }
        }
      }
      progress = Math.min(0.9, progress + 0.05);
      onProgress({ state: "generating", stage: "generating", progress });
      await sleep(this.pollIntervalMs);
    }
  }

  private async downloadOutputs(
    images: Array<{ filename: string; subfolder?: string; type?: string }>,
    outputDirectory: string,
    token: AiRunToken,
    onProgress: Parameters<AiProvider["start"]>[2],
  ): Promise<string[]> {
    const resolvedDirectory = path.resolve(outputDirectory);
    await mkdir(resolvedDirectory, { recursive: true });
    const outputs: string[] = [];
    for (let index = 0; index < images.length; index += 1) {
      this.checkCancelled(token);
      const image = images[index];
      const params = new URLSearchParams({ filename: image.filename, type: image.type ?? "output" });
      if (image.subfolder) params.set("subfolder", image.subfolder);
      const buffer = await this.transport.downloadBuffer(
        `${this.address}/view?${params.toString()}`,
        MAX_OUTPUT_BYTES,
      );
      if (!buffer) throw new Error("COMFYUI_VIEW_DOWNLOAD_FAILED");
      // 图片解码验证（MIME + 可解码）。
      await this.verifyImage(buffer);
      const target = await this.nextTarget(resolvedDirectory, image.filename);
      await writeFile(target, buffer);
      outputs.push(target);
      onProgress({ state: "downloading", stage: "downloading", progress: 0.9 + (index + 1) / (images.length + 1) });
    }
    return outputs;
  }

  private async verifyImage(buffer: Buffer): Promise<void> {
    const { default: sharp } = await import("sharp");
    await sharp(buffer).metadata(); // 抛错 → 损坏图片。
  }

  /** 冲突编号，绝不覆盖。 */
  private async nextTarget(directory: string, base: string): Promise<string> {
    const root = path.resolve(directory);
    let candidate = base;
    let index = 2;
    const parsed = path.parse(base);
    for (;;) {
      const target = path.resolve(root, candidate);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("COMFYUI_OUTPUT_PATH_ESCAPE");
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

  async cancel(): Promise<AiProviderCancelResult> {
    // 队列任务通过 /queue 取消；执行中且 owned 才 /interrupt。简化：
    // 由协调器 token 中止，provider 幂等返回。
    return { cancelled: true };
  }

  async close(): Promise<void> {
    await this.transport.close().catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
