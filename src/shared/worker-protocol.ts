import type { AssetKind } from "./contracts";

/**
 * 统一 worker 任务协议（计划 §5.2）。
 *
 * Main 与 worker 之间通过 utilityProcess / child process / named pipe 传递
 * 经过校验的消息。任务必须可追踪（jobId + providerId + provider version）、
 * 可取消、可设置 deadline，并受 bounded concurrency 约束。
 *
 * 校验 schema 位于 Main 边界（src/main/platform/worker-protocol-validation.ts）；
 * 本文件保持平台无关的纯类型，不引入运行时依赖。
 */

export type WorkerOperation =
  | "probe"
  | "metadata"
  | "thumbnail"
  | "waveform"
  | "preview"
  | "convert";

export interface WorkerJob {
  jobId: string;
  providerId: string;
  operation: WorkerOperation;
  inputPath: string;
  options: Record<string, unknown>;
  deadlineMs: number;
}

export type WorkerJobState =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface WorkerJobUpdate {
  jobId: string;
  state: WorkerJobState;
  progress: number;
  errorCode: string | null;
  error: string | null;
}

/** Worker 返回的载荷：进度更新或最终结果（由具体 operation 定义）。 */
export interface WorkerResult {
  jobId: string;
  /** 结果 JSON（thumbnail 路径、waveform 数据、preview 源等）。 */
  data: Record<string, unknown>;
  /** 同一 cache key 的任务合并时，标记结果来自缓存。 */
  cached?: boolean;
}

// --- Typed provider contract（计划 §6.1）---

export type ProviderCapability =
  | "probe"
  | "metadata"
  | "thumbnail"
  | "waveform"
  | "preview"
  | "convert";

export type ProviderRuntime = "node" | "native-sidecar" | "external-cli";

export interface ResourceProviderManifest {
  id: string;
  version: string;
  kinds: AssetKind[];
  extensions: string[];
  mimeTypes: string[];
  capabilities: ProviderCapability[];
  priority: number;
  runtime: ProviderRuntime;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string;
}

export interface ProviderProbeInput {
  path: string;
  kind: AssetKind;
  extension: string;
  size: number;
}

export interface ProviderProbeResult {
  width: number | null;
  height: number | null;
  duration: number | null;
  /** 格式专属的附加 probe 数据。 */
  extra: Record<string, unknown>;
}

export interface ProviderMetadataInput {
  path: string;
  kind: AssetKind;
  extension: string;
}

export interface ProviderMetadataResult {
  fields: Record<string, unknown>;
}

export interface ProviderThumbnailInput {
  path: string;
  kind: AssetKind;
  extension: string;
  /** 目标宽度（0 表示原尺寸）。 */
  width: number;
  height: number;
  /** 输出 PNG 的固定路径（缓存目录内）；缺省时 provider 自管输出。 */
  outputPath?: string;
  /** HDR/EXR 的通道或 layer 选择（如 R、Beauty.R、Beauty）；缺省为自动合成。 */
  channel?: string;
  /** Optional OCIO config used by HDR/EXR display transforms. */
  ocioConfigPath?: string;
  /** Explicit source color space selected by the HDR/EXR preview UI. */
  inputColorSpace?: string;
  /** Display transform selected by the HDR/EXR preview UI. */
  displayTransform?: "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw";
  /** Main-process cancellation; native sidecars must terminate on abort. */
  signal?: AbortSignal;
}

export interface ProviderThumbnailResult {
  path: string;
  width: number;
  height: number;
}

export interface ProviderPreviewInput {
  path: string;
  kind: AssetKind;
  extension: string;
  /** 预览变体（如 hdr 的 tone-mapped、video 的 frame、3D 的 glb 代理）。 */
  variant: string;
}

export interface ProviderPreviewResult {
  /** 预览源 URL（refbrowse token）或本地路径。 */
  source: string;
  mimeType: string;
}

export interface ProviderConvertInput {
  path: string;
  kind: AssetKind;
  extension: string;
  /** 目标格式（如 "mp4"、"png"）。 */
  targetFormat: string;
  options: Record<string, unknown>;
  /** Main-process cancellation; native sidecars must terminate on abort. */
  signal?: AbortSignal;
}

export interface ProviderConvertResult {
  path: string;
  format: string;
}

export interface ProviderWaveformInput {
  path: string;
  kind: AssetKind;
  extension: string;
  /** 采样宽度（峰值数量）；0 使用 provider 默认。 */
  samples: number;
}

export interface ProviderWaveformResult {
  /** 归一化 0..1 的峰值包络。 */
  peaks: number[];
  /** 每点对应的时间跨度（秒）。 */
  secondsPerPoint: number;
  /** 音频时长（秒）。 */
  duration: number;
  durationSeconds: number | null;
}

/**
 * Typed resource provider 接口。
 *
 * 不支持的 capability 必须在 manifest 中缺省，不能通过运行后抛错伪装支持。
 * 所有方法由 Main 的 provider registry 调度，Renderer 不加载第三方 DLL。
 */
export interface ResourceProvider {
  manifest: ResourceProviderManifest;
  health(): Promise<ProviderHealth>;
  probe(input: ProviderProbeInput): Promise<ProviderProbeResult>;
  metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult>;
  thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult>;
  waveform(input: ProviderWaveformInput): Promise<ProviderWaveformResult>;
  preview(input: ProviderPreviewInput): Promise<ProviderPreviewResult>;
  convert(input: ProviderConvertInput): Promise<ProviderConvertResult>;
  dispose(): Promise<void>;
}

/** provider 实例（可能由 Node 进程直接持有，或通过 worker 间接持有）。 */
export interface ResourceProviderInstance {
  provider: ResourceProvider;
  /** 取消信号：ProviderRegistry 在 Main 退出时发出。 */
  dispose(): Promise<void>;
}
