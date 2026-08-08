/**
 * AI Design Supervisor IPC（FND-008，found-clone.md §9）。
 *
 * 所有输入先经共享 Zod schema 校验；Renderer 不能直接访问 Sharp、输出目录
 * 或 Provider 密钥，只能通过这里的最小 Preload API 操作。
 * - Mock Provider 只在开发/测试构建可见并可调用；正式打包构建列表隐藏，
 *   手工构造的 mock start 请求也会被拒绝。
 * - 任务进度通过 `ai:changed` 广播（job snapshot，无敏感路径）。
 */
import { z } from "zod";
import type {
  AiJobSnapshot,
  AiProviderKind,
  AiProviderSummary,
  AiSettings,
} from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { AiJobService } from "../services/ai/ai-job-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import {
  aiDesignRequestSchema,
  aiJobIdSchema,
  aiProviderKindSchema,
} from "./schemas";

const aiSettingsPatchSchema = z.object({
  comfyuiAddress: z
    .string()
    .trim()
    .max(2048)
    .optional(),
  comfyuiWorkflowPath: z.string().min(1).max(32_768).nullable().optional(),
  comfyuiBinding: z.unknown().nullable().optional(),
  remoteBaseUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https:\/\//, "Remote Job API 必须是 HTTPS")
    .optional()
    .or(z.literal("").nullable().optional()),
  defaultProvider: aiProviderKindSchema.optional(),
  enabledProviders: z.array(aiProviderKindSchema).min(1).max(3).optional(),
});

const listJobsSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

export interface AiIpcDependencies {
  getDatabase(): RefCanvasDatabase;
  /** AiJobService（index.ts 注入，含已注册 Provider 与 Mock 可用性）。 */
  getAiJobService(): AiJobService;
  /** 是否为 Mock 允许的构建（开发/测试）；打包构建返回 false。 */
  isMockAllowed(): boolean;
  /** 变更广播（index.ts 注入 broadcastAll）。 */
  notifyAiChanged(snapshot: AiJobSnapshot | null): void;
}

const AI_SETTINGS_KEY = "aiSettings";

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  "remote-rest": "Remote REST",
  comfyui: "ComfyUI",
  mock: "Mock（本地确定性）",
};

function summarize(
  provider: { kind: AiProviderKind; available: boolean; detail: string | null },
): AiProviderSummary {
  return {
    kind: provider.kind,
    label: PROVIDER_LABELS[provider.kind],
    available: provider.available,
    detail: provider.detail,
  };
}

const DEFAULT_AI_SETTINGS: AiSettings = {
  comfyuiAddress: "http://127.0.0.1:8188",
  comfyuiWorkflowPath: null,
  comfyuiBinding: null,
  remoteBaseUrl: null,
  remoteConfigured: false,
  defaultProvider: "mock",
  enabledProviders: ["mock"],
};

export function readAiSettings(database: RefCanvasDatabase): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    ...database.getSetting<Partial<AiSettings>>(AI_SETTINGS_KEY, {}),
  };
}

export function writeAiSettings(
  database: RefCanvasDatabase,
  patch: Partial<AiSettings>,
): AiSettings {
  const current = readAiSettings(database);
  const next: AiSettings = { ...current, ...patch };
  if (next.enabledProviders.length === 0) next.enabledProviders = ["mock"];
  database.setSetting(AI_SETTINGS_KEY, next);
  return next;
}

/** 注册 AI IPC（FND-008 §9）。 */
export function registerAiIpc(
  ipc: SecureIpcRegistrar,
  dependencies: AiIpcDependencies,
): void {
  const service = () => dependencies.getAiJobService();

  ipc.handle("ai:list-providers", async () => {
    const providers = await service().listProviders();
    const filtered = dependencies.isMockAllowed()
      ? providers
      : providers.filter((provider) => provider.kind !== "mock");
    return filtered.map(summarize);
  });

  ipc.handle("ai:list-jobs", (input) => {
    const parsed = listJobsSchema.parse(input ?? {});
    return service().list(parsed.limit);
  });

  ipc.handle("ai:get", (id) => {
    const parsed = aiJobIdSchema.parse(id);
    return service().get(parsed);
  });

  ipc.handle("ai:start", async (input) => {
    const parsed = z
      .object({
        provider: aiProviderKindSchema,
        request: aiDesignRequestSchema,
      })
      .parse(input);
    if (parsed.provider === "mock" && !dependencies.isMockAllowed()) {
      throw new Error("AI_MOCK_FORBIDDEN");
    }
    const job = await service().start(parsed.provider, parsed.request);
    dependencies.notifyAiChanged(job);
    return job;
  });

  ipc.handle("ai:cancel", async (id) => {
    const parsed = aiJobIdSchema.parse(id);
    const job = await service().cancel(parsed);
    dependencies.notifyAiChanged(job);
    return job;
  });

  ipc.handle("ai:retry", async (id) => {
    const parsed = aiJobIdSchema.parse(id);
    const job = await service().retry(parsed);
    dependencies.notifyAiChanged(job);
    return job;
  });

  ipc.handle("ai:get-settings", () => readAiSettings(dependencies.getDatabase()));

  ipc.handle("ai:set-settings", (input) => {
    const parsed = aiSettingsPatchSchema.parse(input ?? {});
    const patch: Partial<AiSettings> = { ...parsed };
    if (patch.remoteBaseUrl === null || patch.remoteBaseUrl === "") {
      patch.remoteBaseUrl = null;
      patch.remoteConfigured = false;
    } else if (typeof patch.remoteBaseUrl === "string") {
      patch.remoteConfigured = true;
    }
    return writeAiSettings(dependencies.getDatabase(), patch);
  });

  /** Provider 健康检查（面板状态）。 */
  ipc.handle("ai:health", async (kind) => {
    const parsed = aiProviderKindSchema.parse(kind);
    if (parsed === "mock" && !dependencies.isMockAllowed()) {
      throw new Error("AI_MOCK_FORBIDDEN");
    }
    return service().providerFor(parsed).health();
  });
}
