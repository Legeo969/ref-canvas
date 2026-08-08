/**
 * 确定性 Mock Provider（found-clone.md §9.4）。
 *
 * - 仅在开发、单元测试和显式测试构建中注册；正式打包版本不可选择。
 * - 使用 Sharp 根据输入指纹、提示词和序号生成确定性图片变体，模拟阶段进度
 *   并支持取消。
 * - 相同输入与配置产生相同像素输出，便于 UI 与端到端测试。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
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

export const MOCK_PROVIDER_KIND: AiProviderKind = "mock";

/** 阶段延迟（毫秒），测试可通过选项注入。 */
export interface MockProviderOptions {
  stageDelayMs?: number;
  /** 注入失败（测试用）：在指定阶段抛出指定错误码。 */
  injectFailure?: { stage: string; code: string };
  /** 输出目录必须为真实可写目录；临时输出写入后原子移动。 */
  tempDirectory?: string;
}

function hashInput(request: AiDesignRequest, index: number): string {
  const hash = createHash("sha256");
  hash.update(request.sourcePath);
  for (const reference of request.referencePaths) hash.update(reference);
  hash.update(request.prompt);
  hash.update(request.majorChange ? "major" : "minor");
  hash.update(String(index));
  return hash.digest("hex").slice(0, 16);
}

export class MockAiProvider implements AiProvider {
  readonly kind = MOCK_PROVIDER_KIND;

  constructor(private readonly options: MockProviderOptions = {}) {}

  async health(): Promise<AiProviderHealth> {
    return { kind: "mock", ok: true, detail: "deterministic mock", latencyMs: 0 };
  }

  async start(
    context: AiProviderRunContext,
    token: AiRunToken,
    onProgress: Parameters<AiProvider["start"]>[2],
  ): Promise<AiProviderStartResult> {
    const { request, jobId } = context;
    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    onProgress({ state: "uploading", stage: "uploading", progress: 0.1 });
    await delay(this.options.stageDelayMs ?? 50);
    this.checkCancelled(token);
    this.checkInjected("uploading");

    onProgress({ state: "generating", stage: "generating", progress: 0.4 });
    await delay(this.options.stageDelayMs ?? 120);
    this.checkCancelled(token);
    this.checkInjected("generating");

    onProgress({ state: "generating", stage: "generating", progress: 0.8 });
    await delay(this.options.stageDelayMs ?? 120);
    this.checkCancelled(token);
    this.checkInjected("generating");

    // 确定性地生成输出图片。
    const outputs = await this.renderOutputs(request, token);
    onProgress({
      state: "downloading",
      stage: "downloading",
      progress: 0.95,
      outputs,
    });
    await delay(this.options.stageDelayMs ?? 40);
    this.checkCancelled(token);
    this.checkInjected("downloading");

    onProgress({
      state: "completed",
      stage: "completed",
      progress: 1,
      outputs,
    });
    return { externalId: `mock-${jobId}`, recovery: {} };
  }

  async cancel(): Promise<AiProviderCancelResult> {
    return { cancelled: true };
  }

  private checkCancelled(token: AiRunToken): void {
    if (token.isCancelled()) {
      throw new Error("AI_JOB_CANCELLED");
    }
  }

  private checkInjected(stage: string): void {
    if (this.options.injectFailure?.stage === stage) {
      throw new Error(this.options.injectFailure.code);
    }
  }

  /** 用 Sharp 生成确定性 PNG（同输入同像素）。 */
  private async renderOutputs(
    request: AiDesignRequest,
    token: AiRunToken,
  ): Promise<string[]> {
    const outputDirectory = path.resolve(request.outputDirectory);
    await mkdir(outputDirectory, { recursive: true });
    const tempRoot = path.resolve(
      this.options.tempDirectory ??
        path.join(outputDirectory, `.refcanvas-ai-${randomUuidShort()}`),
    );
    await mkdir(tempRoot, { recursive: true });
    const outputs: string[] = [];
    try {
      const { default: sharp } = await import("sharp");
      for (let index = 0; index < request.outputCount; index += 1) {
        this.checkCancelled(token);
        const seed = hashInput(request, index);
        // 确定性颜色由 seed 派生（不含系统时间）。
        const r = Number.parseInt(seed.slice(0, 2), 16);
        const g = Number.parseInt(seed.slice(2, 4), 16);
        const b = Number.parseInt(seed.slice(4, 6), 16);
        const tempFile = path.join(tempRoot, `output_${index}.png`);
        await sharp({
          create: {
            width: 512,
            height: 512,
            channels: 3,
            background: { r, g, b },
          },
        })
          .png()
          .toFile(tempFile);
        const target = await this.nextTarget(outputDirectory, `mock_${index}.png`);
        await writeFile(target, await readFileBuffer(tempFile));
        outputs.push(target);
      }
      return outputs;
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** 冲突编号：`mock_0.png` 已存在时依次尝试 `mock_0 (2).png`，绝不覆盖。 */
  private async nextTarget(directory: string, base: string): Promise<string> {
    const root = path.resolve(directory);
    let candidate = base;
    let index = 2;
    const parsed = path.parse(base);
    for (;;) {
      const target = path.resolve(root, candidate);
      // 目标必须留在输出目录内（candidate 由固定基名 + 数字派生，防御性校验）。
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("AI_OUTPUT_PATH_ESCAPE");
      }
      const exists = await stat(target).then(
        () => true,
        () => false,
      );
      if (!exists) return target;
      candidate = `${parsed.name} (${index})${parsed.ext}`;
      index += 1;
    }
  }
}

async function readFileBuffer(filename: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(filename);
}

function randomUuidShort(): string {
  return randomUUID().slice(0, 8);
}
