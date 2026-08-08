import { z } from "zod";

/**
 * Worker 任务协议校验 schema（计划 §5.2）。
 *
 * 校验位于 Main 边界：入站（worker → Main 的 update/result）与出站
 * （Main → worker 的 job）都经 Zod 校验，畸形载荷在进入状态处理前被
 * 丢弃。shared/worker-protocol.ts 保持纯类型，不引入运行时依赖。
 */

/** 出站 WorkerJob（Main → worker）校验。 */
export const workerJobSchema = z.object({
  jobId: z.string().min(1).max(128),
  providerId: z.string().min(1).max(128),
  operation: z.enum([
    "probe",
    "metadata",
    "thumbnail",
    "waveform",
    "preview",
    "convert",
  ]),
  inputPath: z.string().min(1).max(32_768),
  options: z.record(z.string(), z.unknown()),
  deadlineMs: z.number().int().positive().max(3_600_000),
});

/** 入站状态更新（worker → Main）校验。 */
export const workerJobUpdateSchema = z.object({
  jobId: z.string().min(1).max(128),
  state: z.enum(["queued", "running", "completed", "cancelled", "failed"]),
  progress: z.number().min(0).max(1),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
});

/** 入站最终结果载荷（worker → Main）校验。 */
export const workerResultSchema = z.object({
  jobId: z.string().min(1).max(128),
  data: z.record(z.string(), z.unknown()),
  cached: z.boolean().optional(),
});
