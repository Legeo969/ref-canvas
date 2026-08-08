/**
 * AI Provider 抽象（found-clone.md §9）。
 *
 * Main 侧统一接口：health / start / cancel / recover。任务协调器负责状态机、
 * 持久化、超时、重试与输出落盘；Provider 只负责自身协议。
 */
import type { AiDesignRequest, AiProviderHealth, AiProviderKind } from "../../../shared/contracts";

export interface AiProviderRunContext {
  jobId: string;
  request: AiDesignRequest;
  /** 每次 start/retry 唯一；网络超时重试时保持不变（Remote REST v1）。 */
  clientRequestId: string;
}

export interface AiProviderStartResult {
  externalId: string;
  /** Provider 声明的恢复数据（脱敏，可安全入库）。 */
  recovery: Record<string, unknown>;
}

export interface AiProviderCancelResult {
  cancelled: boolean;
  reason?: string;
}

/**
 * 运行中任务取消令牌：true 表示已请求取消。Provider 必须在每个阶段检查。
 */
export interface AiRunToken {
  isCancelled(): boolean;
}

export interface AiProvider {
  readonly kind: AiProviderKind;
  health(): Promise<AiProviderHealth>;
  /**
   * 启动任务并返回外部 id 与脱敏恢复数据。抛错由协调器统一转为 failed。
   * `onProgress` 在阶段/进度变化时被调用（含 downloading 完成后输出列表）。
   */
  start(
    context: AiProviderRunContext,
    token: AiRunToken,
    onProgress: (snapshot: {
      state: "uploading" | "generating" | "downloading" | "completed" | "failed";
      stage: string;
      progress: number | null;
      outputs?: string[];
      errorCode?: string | null;
      errorMessage?: string | null;
    }) => void,
  ): Promise<AiProviderStartResult>;
  /** 取消任务；对已完成/已取消任务幂等。 */
  cancel(jobId: string, externalId: string | null): Promise<AiProviderCancelResult>;
  /** 应用重启后用 recovery 数据恢复查询；Provider 不支持恢复时抛错。 */
  recover?(jobId: string, recovery: Record<string, unknown>): Promise<void>;
}

export function createClientRequestId(): string {
  return crypto.randomUUID();
}
