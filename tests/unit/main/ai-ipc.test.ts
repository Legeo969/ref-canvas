import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { registerAiIpc } from "../../../src/main/ipc/ai-ipc";
import { AiJobService } from "../../../src/main/services/ai/ai-job-service";
import { MockAiProvider } from "../../../src/main/services/ai/mock-ai-provider";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";
import {
  aiDesignRequestSchema,
  aiJobIdSchema,
  aiProviderKindSchema,
} from "../../../src/main/ipc/schemas";

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

describe("AI IPC shared Zod schemas (FND-008 §9.1)", () => {
  it("accepts a valid design request", () => {
    const parsed = aiDesignRequestSchema.safeParse({
      sourcePath: "D:\\src\\a.png",
      referencePaths: ["D:\\ref\\r1.png", "D:\\ref\\r2.png"],
      prompt: "  cinematic  ",
      majorChange: true,
      outputCount: 3,
      outputDirectory: "D:\\out",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.prompt).toBe("cinematic");
    }
  });

  it("rejects >6 references, empty prompt, out-of-range outputCount and missing fields", () => {
    const base = {
      sourcePath: "D:\\a.png",
      referencePaths: [],
      prompt: "x",
      majorChange: false,
      outputCount: 2,
      outputDirectory: "D:\\out",
    };
    expect(
      aiDesignRequestSchema.safeParse({
        ...base,
        referencePaths: Array.from({ length: 7 }, () => "D:\\r.png"),
      }).success,
    ).toBe(false);
    expect(
      aiDesignRequestSchema.safeParse({ ...base, prompt: "   " }).success,
    ).toBe(false);
    expect(aiDesignRequestSchema.safeParse({ ...base, outputCount: 5 }).success).toBe(
      false,
    );
    expect(aiDesignRequestSchema.safeParse({ ...base, sourcePath: "" }).success).toBe(
      false,
    );
    // 缺 outputDirectory 字段（用类型断言构造运行时缺字段对象）。
    const withoutOutput = base as unknown as { outputDirectory?: string };
    delete withoutOutput.outputDirectory;
    expect(aiDesignRequestSchema.safeParse(withoutOutput).success).toBe(false);
  });

  it("accepts 0..6 references and 1..4 outputs", () => {
    for (const count of [0, 1, 6]) {
      expect(
        aiDesignRequestSchema.safeParse({
          sourcePath: "D:\\a.png",
          referencePaths: Array.from({ length: count }, () => "D:\\r.png"),
          prompt: "x",
          majorChange: false,
          outputCount: count === 0 ? 1 : 4,
          outputDirectory: "D:\\out",
        }).success,
      ).toBe(true);
    }
  });

  it("validates provider kind and job id", () => {
    expect(aiProviderKindSchema.safeParse("mock").success).toBe(true);
    expect(aiProviderKindSchema.safeParse("comfyui").success).toBe(true);
    expect(aiProviderKindSchema.safeParse("remote-rest").success).toBe(true);
    expect(aiProviderKindSchema.safeParse("aether").success).toBe(false);
    expect(aiJobIdSchema.safeParse("job-abc").success).toBe(true);
    expect(aiJobIdSchema.safeParse("").success).toBe(false);
  });
});

describe("AI IPC registration (FND-008 §9)", () => {
  async function setup(options: { mockAllowed?: boolean } = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-aiipc-"));
    temporaryDirectories.push(directory);
    const database = new RefCanvasDatabase(path.join(directory, "app.db"));
    const service = new AiJobService(
      database.aiJobs(),
      new Map(options.mockAllowed === false ? [] : [["mock", new MockAiProvider()]]),
    );
    const notifyAiChanged = vi.fn();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    } as unknown as SecureIpcRegistrar;
    registerAiIpc(ipc, {
      getDatabase: () => database,
      getAiJobService: () => service,
      isMockAllowed: () => options.mockAllowed !== false,
      notifyAiChanged,
    });
    const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const handler = handlers.get(channel)!;
      return await handler(...args);
    };
    return { database, service, handlers, notifyAiChanged, directory, invoke };
  }

  it("lists providers, filters mock in packaged builds, and persists settings", async () => {
    const { database, invoke } = await setup({ mockAllowed: true });
    try {
      const providers = (await invoke("ai:list-providers")) as Array<{
        kind: string;
        label: string;
        available: boolean;
      }>;
      expect(providers.some((provider) => provider.kind === "mock")).toBe(true);
      expect(providers.find((provider) => provider.kind === "mock")?.label).toBeTruthy();

      const settings = (await invoke("ai:get-settings")) as {
        defaultProvider: string;
        enabledProviders: string[];
      };
      expect(settings.defaultProvider).toBe("mock");
      expect(settings.enabledProviders).toContain("mock");

      const updated = (await invoke("ai:set-settings", {
        defaultProvider: "comfyui",
        enabledProviders: ["comfyui"],
        remoteBaseUrl: "https://example.invalid/jobs",
      })) as { defaultProvider: string; remoteConfigured: boolean };
      expect(updated.defaultProvider).toBe("comfyui");
      expect(updated.remoteConfigured).toBe(true);
      expect(database.getSetting("aiSettings", null)).not.toBeNull();
    } finally {
      database.close();
    }
  });

  it("hides mock and rejects mock start in packaged-style builds", async () => {
    const { database, directory, invoke } = await setup({ mockAllowed: false });
    try {
      const providers = (await invoke("ai:list-providers")) as Array<{ kind: string }>;
      expect(providers.some((provider) => provider.kind === "mock")).toBe(false);
      const source = path.join(directory, "a.png");
      await writeFile(source, Buffer.alloc(16, 1));
      await expect(
        invoke("ai:start", {
          provider: "mock",
          request: {
            sourcePath: source,
            referencePaths: [],
            prompt: "x",
            majorChange: false,
            outputCount: 1,
            outputDirectory: directory,
          },
        }),
      ).rejects.toThrow("AI_MOCK_FORBIDDEN");
    } finally {
      database.close();
    }
  });

  it("starts a mock job, reports progress, completes, cancels and retries", async () => {
    const { database, directory, invoke } = await setup({ mockAllowed: true });
    try {
      const source = path.join(directory, "a.png");
      const output = path.join(directory, "out");
      await writeFile(source, Buffer.alloc(64, 1));
      await mkdir(output, { recursive: true });
      const started = (await invoke("ai:start", {
        provider: "mock",
        request: {
          sourcePath: source,
          referencePaths: [],
          prompt: "cinematic lighting",
          majorChange: true,
          outputCount: 2,
          outputDirectory: output,
        },
      })) as { id: string; state: string; outputs: string[] };

      // Mock 全阶段很快完成；轮询等待终态。
      let job = started;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (job.state === "completed" || job.state === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
        job = (await invoke("ai:get", started.id)) as typeof started;
      }
      expect(job.state).toBe("completed");
      expect(job.outputs).toHaveLength(2);

      const list = (await invoke("ai:list-jobs")) as Array<{ id: string }>;
      expect(list.some((item) => item.id === started.id)).toBe(true);

      // 对 completed 任务 cancel 幂等返回原状态。
      const cancelled = (await invoke("ai:cancel", started.id)) as { state: string };
      expect(cancelled.state).toBe("completed");

      // retry 只对 failed 允许。
      await expect(invoke("ai:retry", started.id)).rejects.toThrow("AI_JOB_NOT_FAILED");
    } finally {
      database.close();
    }
  });

  it("rejects invalid inputs before creating an ai_jobs row", async () => {
    const { database, directory, invoke } = await setup({ mockAllowed: true });
    try {
      const source = path.join(directory, "a.png");
      await writeFile(source, Buffer.alloc(64, 1));
      await expect(
        invoke("ai:start", {
          provider: "mock",
          request: {
            sourcePath: source,
            referencePaths: Array.from({ length: 7 }, () => source),
            prompt: "x",
            majorChange: false,
            outputCount: 2,
            outputDirectory: directory,
          },
        }),
      ).rejects.toThrow();
      expect(database.aiJobs().count()).toBe(0);
    } finally {
      database.close();
    }
  });
});
