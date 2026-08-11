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
import path from "node:path";
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
import {
  assertComfyAddressAllowed,
  inspectBinding,
  inspectWorkflow,
  parseWorkflow,
  type ComfyWorkflowBinding,
} from "../services/ai/comfyui-workflow";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";

const comfyInputRefSchema = z.object({
  nodeId: z.string().min(1).max(256),
  inputName: z.string().min(1).max(256),
});

const comfyBindingSchema = z.object({
  source: comfyInputRefSchema,
  referenceSlots: z.array(comfyInputRefSchema).max(6),
  prompt: comfyInputRefSchema,
  batchSize: comfyInputRefSchema,
  majorChange: comfyInputRefSchema.extend({
    minorValue: z.number().finite(),
    majorValue: z.number().finite(),
  }).optional(),
  seed: comfyInputRefSchema.optional(),
  outputNodeIds: z.array(z.string().min(1).max(256)).min(1).max(64),
});

const aiSettingsPatchSchema = z.object({
  comfyuiAddress: z
    .string()
    .trim()
    .max(2048)
    .optional(),
  comfyuiWorkflowPath: z.string().min(1).max(32_768).nullable().optional(),
  comfyuiBinding: comfyBindingSchema.nullable().optional(),
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

const saveSecretSchema = z.object({
  token: z.string().min(1).max(4096),
});

const importWorkflowSchema = z.object({
  path: z.string().min(1).max(4096),
});

/** workflow 导入结果：inspection + 节点输入元数据（绑定编辑器用）。 */
export interface ComfyWorkflowImportResult {
  valid: boolean;
  errors: string[];
  nodeCount: number;
  outputNodeIds: string[];
  imageInputNodes: Array<{ nodeId: string; type: string }>;
  /** 节点 input 名列表（按节点分组，供绑定下拉）。 */
  nodes: Array<{ nodeId: string; type: string; inputNames: string[] }>;
  workflowPath: string;
}

export interface AiSecretStatus {
  configured: boolean;
  source: "safe-storage" | "test";
}

export interface AiIpcDependencies {
  getDatabase(): RefCanvasDatabase;
  /** AiJobService（index.ts 注入，含已注册 Provider 与 Mock 可用性）。 */
  getAiJobService(): AiJobService;
  /** 是否为 Mock 允许的构建（开发/测试）；打包构建返回 false。 */
  isMockAllowed(): boolean;
  /** Bearer token 加密存储（Renderer 只读 configured 状态）。 */
  getSecretStore(): import("../services/ai/ai-secret-store").AiSecretStore;
  /** 设置落盘后重建 Provider，使修改无需重启应用。 */
  reloadProviders?(): Promise<void>;
  /** 变更广播（index.ts 注入 broadcastAll）。 */
  notifyAiChanged(snapshot: AiJobSnapshot | null): void;
  windowForSender?(event: IpcMainInvokeEvent): BrowserWindow;
  writeAccess?: WriteAccessController;
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
  const security = (event: IpcMainInvokeEvent) => {
    if (!dependencies.writeAccess || !dependencies.windowForSender) {
      throw new Error("WRITE_AUTHORIZATION_UNAVAILABLE");
    }
    return { access: dependencies.writeAccess, window: dependencies.windowForSender(event) };
  };

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

  ipc.handleWithEvent("ai:start", async (event, input) => {
    const parsed = z
      .object({
        provider: aiProviderKindSchema,
        request: aiDesignRequestSchema,
      })
      .parse(input);
    if (parsed.provider === "mock" && !dependencies.isMockAllowed()) {
      throw new Error("AI_MOCK_FORBIDDEN");
    }
    const secured = security(event);
    const [outputDirectory] = await secured.access.authorize(
      secured.window, "export", [
        { path: assertAbsoluteLocalPath(parsed.request.outputDirectory), mode: "destination" },
      ],
    );
    const job = await service().start(parsed.provider, {
      ...parsed.request,
      outputDirectory,
    });
    dependencies.notifyAiChanged(job);
    return job;
  });

  ipc.handle("ai:cancel", async (id) => {
    const parsed = aiJobIdSchema.parse(id);
    const job = await service().cancel(parsed);
    dependencies.notifyAiChanged(job);
    return job;
  });

  ipc.handleWithEvent("ai:retry", async (event, id) => {
    const parsed = aiJobIdSchema.parse(id);
    const secured = security(event);
    const [outputDirectory] = await secured.access.authorize(
      secured.window, "export", [
        { path: service().authorizationDirectoryForRetry(parsed), mode: "destination" },
      ],
    );
    const job = await service().retry(parsed, outputDirectory);
    dependencies.notifyAiChanged(job);
    return job;
  });

  ipc.handle("ai:get-settings", () => readAiSettings(dependencies.getDatabase()));

  ipc.handle("ai:set-settings", async (input) => {
    const parsed = aiSettingsPatchSchema.parse(input ?? {});
    const patch: Partial<AiSettings> = { ...parsed };
    if (patch.remoteBaseUrl === null || patch.remoteBaseUrl === "") {
      patch.remoteBaseUrl = null;
      patch.remoteConfigured = false;
    } else if (typeof patch.remoteBaseUrl === "string") {
      patch.remoteConfigured = true;
    }
    // ComfyUI 只允许本机地址：保存时同样拒绝局域网/公网（§9.5）。
    if (typeof patch.comfyuiAddress === "string" && patch.comfyuiAddress.trim()) {
      patch.comfyuiAddress = assertComfyAddressAllowed(patch.comfyuiAddress);
    }
    if (patch.comfyuiBinding) {
      const current = readAiSettings(dependencies.getDatabase());
      if (!current.comfyuiWorkflowPath) {
        throw new Error("COMFYUI_WORKFLOW_NOT_IMPORTED");
      }
      const { readFile } = await import("node:fs/promises");
      const workflow = parseWorkflow(
        await readFile(current.comfyuiWorkflowPath, "utf8"),
      );
      if (!workflow) throw new Error("COMFYUI_WORKFLOW_INVALID_JSON");
      const validation = inspectBinding(
        workflow,
        patch.comfyuiBinding as ComfyWorkflowBinding,
      );
      if (!validation.valid) {
        throw new Error(`COMFYUI_BINDING_INVALID:${validation.errors.join(";")}`);
      }
    }
    const settings = writeAiSettings(dependencies.getDatabase(), patch);
    await dependencies.reloadProviders?.();
    return settings;
  });

  /** Provider 健康检查（面板状态）。 */
  ipc.handle("ai:health", async (kind) => {
    const parsed = aiProviderKindSchema.parse(kind);
    if (parsed === "mock" && !dependencies.isMockAllowed()) {
      throw new Error("AI_MOCK_FORBIDDEN");
    }
    return service().providerFor(parsed).health();
  });

  /** Bearer token 状态（Renderer 只读 configured，永不接触明文）。 */
  ipc.handle("ai:secret-status", () =>
    dependencies.getSecretStore().status(),
  );

  /** 保存 Bearer token（safeStorage 加密落盘；SQLite/日志无明文）。 */
  ipc.handle("ai:save-secret", async (input) => {
    const parsed = saveSecretSchema.parse(input ?? {});
    await dependencies.getSecretStore().save(parsed.token);
    await dependencies.reloadProviders?.();
    return dependencies.getSecretStore().status();
  });

  /** 清除 Bearer token。 */
  ipc.handle("ai:clear-secret", async () => {
    await dependencies.getSecretStore().clear();
    await dependencies.reloadProviders?.();
    return dependencies.getSecretStore().status();
  });

  /** 导入 API-format workflow：解析、结构检查并保存路径，返回绑定元数据。 */
  ipc.handle("ai:import-comfyui-workflow", async (input) => {
    const parsed = importWorkflowSchema.parse(input ?? {});
    if (path.extname(parsed.path).toLowerCase() !== ".json") {
      throw new Error("COMFYUI_WORKFLOW_EXTENSION_INVALID");
    }
    const { readFile, stat } = await import("node:fs/promises");
    const info = await stat(parsed.path).catch(() => null);
    if (!info?.isFile() || info.size > 10 * 1024 * 1024) {
      throw new Error("COMFYUI_WORKFLOW_FILE_INVALID");
    }
    const raw = await readFile(parsed.path, "utf8");
    const workflow = parseWorkflow(raw);
    if (!workflow) {
      throw new Error("COMFYUI_WORKFLOW_INVALID_JSON");
    }
    const inspection = inspectWorkflow(workflow);
    const nodes = (workflow.nodes ?? []).map((node) => ({
      nodeId: String(node.id),
      type: node.type,
      inputNames: Object.keys(node.inputs ?? {}),
    }));
    const result: ComfyWorkflowImportResult = {
      valid: inspection.valid,
      errors: inspection.errors,
      nodeCount: inspection.nodeCount,
      outputNodeIds: inspection.outputNodeIds,
      imageInputNodes: inspection.imageInputNodes,
      nodes,
      workflowPath: parsed.path,
    };
    const currentSettings = readAiSettings(dependencies.getDatabase());
    writeAiSettings(dependencies.getDatabase(), {
      comfyuiWorkflowPath: parsed.path,
      // 路径变化时旧绑定必然不可信；读取同一已导入文件的元数据时保留绑定。
      comfyuiBinding:
        currentSettings.comfyuiWorkflowPath === parsed.path
          ? currentSettings.comfyuiBinding
          : null,
    });
    await dependencies.reloadProviders?.();
    return result;
  });
}
