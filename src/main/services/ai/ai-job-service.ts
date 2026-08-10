/**
 * AI 任务协调器（found-clone.md §9.2/§9.3）。
 *
 * - 校验输入（源图、0–6 参考图、非空 prompt、1–4 输出、可写输出目录、
 *   单文件 ≤100 MiB、合计 ≤500 MiB、受支持静态图片）。
 * - 任务创建前持久化 `ai_jobs` 行（queued）；状态迁移严格遵循白名单。
 * - start：调 Provider，监听进度并落库；取消通过 token 传播，终态幂等。
 * - retry：创建新尝试并关联原 job；不把 failed 记录改回 queued。
 * - recover：重启后对非终态 job 尝试恢复；Provider 不支持时标记 failed。
 */
import { open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  AiDesignRequest,
  AiJobSnapshot,
  AiProviderKind,
} from "../../../shared/contracts";
import type { AiJobsRepository } from "../../persistence/repositories/ai-jobs-repository";
import {
  createClientRequestId,
  type AiProvider,
  type AiRunToken,
} from "./ai-provider";

const MAX_SINGLE_INPUT_BYTES = 100 * 1024 * 1024; // 100 MiB
const MAX_TOTAL_INPUT_BYTES = 500 * 1024 * 1024; // 500 MiB
const MAX_REFERENCE_COUNT = 6;

/** 受支持的静态图片扩展名（需要时经 Sharp 生成临时 PNG）。 */
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "avif", "tif", "tiff",
]);

/** 校验通过的可提交请求（含脱敏用的请求 JSON 摘要）。 */
export interface ValidatedAiRequest {
  request: AiDesignRequest;
  /** 脱敏请求 JSON：不包含源图/参考图路径（§10 日志脱敏）。 */
  sanitizedRequestJson: string;
}

function sanitizeRequest(request: AiDesignRequest): string {
  return JSON.stringify({
    provider: undefined,
    sourcePath: "[redacted]",
    referencePaths: request.referencePaths.map(() => "[redacted]"),
    prompt: request.prompt.slice(0, 500),
    majorChange: request.majorChange,
    outputCount: request.outputCount,
    outputDirectory: "[redacted]",
  });
}

export class AiJobService {
  constructor(
    private readonly jobs: AiJobsRepository,
    private readonly providers: Map<AiProviderKind, AiProvider>,
    /** 会话内原始请求缓存（retry 复用；不落库，重启后由 UI 重新提交）。 */
    private readonly sessionRequests = new Map<string, AiDesignRequest>(),
    /** jobId → 取消令牌（cancel() 翻转后运行中的 Provider 检查到并中止）。 */
    private readonly cancelTokens = new Map<string, { cancelled: boolean }>(),
  ) {}

  async listProviders(): Promise<
    Array<{ kind: AiProviderKind; available: boolean; detail: string | null }>
  > {
    const results: Array<{ kind: AiProviderKind; available: boolean; detail: string | null }> =
      [];
    for (const [kind, provider] of this.providers) {
      try {
        const health = await provider.health();
        results.push({ kind, available: health.ok, detail: health.detail });
      } catch (error) {
        results.push({
          kind,
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  providerFor(kind: AiProviderKind): AiProvider {
    const provider = this.providers.get(kind);
    if (!provider) throw new Error("AI_PROVIDER_UNAVAILABLE");
    return provider;
  }

  /** 设置变更后原子替换后续任务使用的 Provider；运行中任务保留原实例。 */
  replaceProviders(next: Map<AiProviderKind, AiProvider>): void {
    this.providers.clear();
    for (const [kind, provider] of next) this.providers.set(kind, provider);
  }

  /** 创建任务前的字段级校验（§9.2）。失败时不创建 ai_jobs 行。 */
  async validateRequest(request: AiDesignRequest): Promise<ValidatedAiRequest> {
    const errors: string[] = [];
    if (!request.sourcePath || !request.sourcePath.trim()) {
      errors.push("sourcePath 必填");
    }
    if (request.referencePaths.length > MAX_REFERENCE_COUNT) {
      errors.push(`参考图最多 ${MAX_REFERENCE_COUNT} 张`);
    }
    const prompt = request.prompt.trim();
    if (!prompt) errors.push("提示词不能为空");
    const outputCount = request.outputCount;
    if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 4) {
      errors.push("输出数量范围 1–4");
    }
    if (!request.outputDirectory || !request.outputDirectory.trim()) {
      errors.push("输出目录必填");
    }
    if (errors.length) throw new Error(`AI_VALIDATION:${errors.join(";")}`);

    // 文件级校验：源图 + 参考图大小限制、扩展名支持、输出目录可写。
    const allInputs = [request.sourcePath, ...request.referencePaths];
    let totalBytes = 0;
    for (const filename of allInputs) {
      const info = await stat(filename).catch(() => null);
      if (!info?.isFile()) {
        throw new Error("AI_VALIDATION:输入文件不存在或不可读");
      }
      if (info.size > MAX_SINGLE_INPUT_BYTES) {
        throw new Error("AI_VALIDATION:单文件超过 100 MiB");
      }
      totalBytes += info.size;
      const extension = path.extname(filename).replace(/^\./, "").toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`AI_VALIDATION:不支持的输入格式 .${extension}`);
      }
    }
    if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
      throw new Error("AI_VALIDATION:输入合计超过 500 MiB");
    }
    const outputStat = await stat(request.outputDirectory).catch(() => null);
    if (!outputStat?.isDirectory()) {
      throw new Error("AI_VALIDATION:输出目录不存在或不可写");
    }
    const writeProbe = path.join(
      request.outputDirectory,
      `.refcanvas-write-probe-${createClientRequestId()}.tmp`,
    );
    let probeHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      probeHandle = await open(writeProbe, "wx");
      await probeHandle.writeFile("ok");
    } catch {
      throw new Error("AI_VALIDATION:输出目录不可写");
    } finally {
      await probeHandle?.close().catch(() => undefined);
      await unlink(writeProbe).catch(() => undefined);
    }

    const normalized: AiDesignRequest = {
      sourcePath: path.resolve(request.sourcePath),
      referencePaths: request.referencePaths.map((reference) =>
        path.resolve(reference),
      ),
      prompt,
      majorChange: request.majorChange,
      outputCount,
      outputDirectory: path.resolve(request.outputDirectory),
    };
    return { request: normalized, sanitizedRequestJson: sanitizeRequest(normalized) };
  }

  /** 启动任务。 */
  async start(
    providerKind: AiProviderKind,
    rawRequest: AiDesignRequest,
  ): Promise<AiJobSnapshot> {
    const validated = await this.validateRequest(rawRequest);
    const provider = this.providerFor(providerKind);
    const job = this.jobs.create({
      provider: providerKind,
      externalId: null,
      requestJson: validated.sanitizedRequestJson,
      outputDirectory: validated.request.outputDirectory,
    });
    // 会话内缓存原始请求供 retry 复用；不落库（路径脱敏）。
    this.sessionRequests.set(job.id, validated.request);
    const cancelState = { cancelled: false };
    this.cancelTokens.set(job.id, cancelState);
    const cancelRef = { current: createToken(cancelState) };
    void this.runJob(job.id, provider, validated.request, cancelRef).catch(
      (error) => this.handleRunError(job.id, error),
    );
    return this.jobs.get(job.id)!;
  }

  private handleRunError(jobId: string, error: unknown): void {
    this.cancelTokens.delete(jobId);
    const code = error instanceof Error ? error.message : String(error);
    if (code === "AI_JOB_CANCELLED") {
      this.jobs.transition(jobId, "cancelled", { stage: "cancelled" });
    } else if (this.jobs.get(jobId)?.state !== "completed") {
      this.jobs.fail(jobId, "AI_JOB_FAILED", String(error));
    }
  }

  private async runJob(
    jobId: string,
    provider: AiProvider,
    request: AiDesignRequest,
    cancelRef: { current: AiRunToken },
  ): Promise<void> {
    const clientRequestId = createClientRequestId();
    const result = await provider.start(
      { jobId, request, clientRequestId },
      cancelRef.current,
      (snapshot) => {
        const current = this.jobs.get(jobId);
        if (!current) return;
        if (snapshot.externalId) {
          this.jobs.setExternalId(jobId, snapshot.externalId);
        }
        if (snapshot.state === "completed") {
          this.jobs.transition(jobId, "completed", {
            stage: "completed",
            progress: 1,
            outputs: snapshot.outputs ?? current.outputs,
          });
        } else if (snapshot.state === "failed") {
          this.jobs.fail(
            jobId,
            snapshot.errorCode ?? "AI_JOB_FAILED",
            snapshot.errorMessage ?? "",
          );
        } else {
          this.jobs.transition(jobId, snapshot.state, {
            stage: snapshot.stage,
            progress: snapshot.progress ?? current.progress,
            outputs: snapshot.outputs ?? current.outputs,
          });
        }
      },
    );
    this.jobs.setExternalId(jobId, result.externalId);
    this.cancelTokens.delete(jobId);
  }

  get(id: string): AiJobSnapshot | null {
    return this.jobs.get(id);
  }

  list(limit = 100): AiJobSnapshot[] {
    return this.jobs.list(limit);
  }

  async cancel(id: string): Promise<AiJobSnapshot> {
    const job = this.jobs.get(id);
    if (!job) throw new Error("AI_JOB_NOT_FOUND");
    if (job.state === "completed" || job.state === "cancelled") return job;
    // 翻转会话取消令牌（运行中的 Provider 在下一个阶段检查点中止）。
    const token = this.cancelTokens.get(id);
    if (token) token.cancelled = true;
    const provider = this.providerFor(job.provider);
    const latest = this.jobs.get(id)!;
    const providerResult = await provider.cancel(job.id, latest.externalId);
    const current = this.jobs.get(id)!;
    if (["queued", "uploading", "generating", "downloading"].includes(current.state)) {
      if (!providerResult.cancelled && !token) {
        throw new Error(`AI_CANCEL_REJECTED:${providerResult.reason ?? ""}`);
      }
      return this.jobs.transition(id, "cancelled", { stage: "cancelled" });
    }
    return current;
  }

  /** retry 创建新尝试并关联原 job；旧 failed 记录保留。 */
  async retry(id: string): Promise<AiJobSnapshot> {
    const source = this.jobs.get(id);
    if (!source) throw new Error("AI_JOB_NOT_FOUND");
    if (source.state !== "failed") throw new Error("AI_JOB_NOT_FAILED");
    const provider = this.providerFor(source.provider);
    const originalRequest = this.sessionRequests.get(id);
    if (!originalRequest) {
      throw new Error("AI_RETRY_REQUEST_UNAVAILABLE");
    }
    const validated = await this.validateRequest(originalRequest);
    const job = this.jobs.retryFrom(
      source.id,
      source.provider,
      validated.sanitizedRequestJson,
      validated.request.outputDirectory,
    );
    this.sessionRequests.set(job.id, validated.request);
    const cancelState = { cancelled: false };
    this.cancelTokens.set(job.id, cancelState);
    const cancelRef = { current: createToken(cancelState) };
    void this.runJob(job.id, provider, validated.request, cancelRef).catch(
      (error) => this.handleRunError(job.id, error),
    );
    return this.jobs.get(job.id)!;
  }

  /** 重启恢复：对非终态 job 尝试 Provider.recover；不支持则标记 failed。 */
  async recoverInterrupted(): Promise<number> {
    const interrupted = this.jobs.listNonTerminal();
    let recovered = 0;
    for (const job of interrupted) {
      const provider = this.providers.get(job.provider);
      if (provider?.recover && job.externalId) {
        try {
          await provider.recover(job.id, { externalId: job.externalId });
          recovered += 1;
        } catch {
          this.jobs.failRunningInterrupted(
            job.id,
            "应用重启且 Provider 无法恢复该任务",
          );
        }
      } else {
        this.jobs.failRunningInterrupted(
          job.id,
          "应用重启且 Provider 不支持恢复",
        );
      }
    }
    return recovered;
  }
}

function createToken(cancelState: { cancelled: boolean }): AiRunToken {
  return { isCancelled: () => cancelState.cancelled };
}
