import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockAiProvider } from "../../../src/main/services/ai/mock-ai-provider";
import type { AiDesignRequest } from "../../../src/shared/contracts";

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

async function runMock(
  options: { stageDelayMs?: number; injectFailure?: { stage: string; code: string } },
  request: AiDesignRequest,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mock-"));
  temporaryDirectories.push(directory);
  const provider = new MockAiProvider(options);
  const outputs: string[] = [];
  const cancelled = false;
  const progress: Array<{ state: string; progress: number | null }> = [];
  try {
    const result = await provider.start(
      { jobId: "job-1", request, clientRequestId: "req-1" },
      { isCancelled: () => cancelled },
      (snapshot) => {
        progress.push({ state: snapshot.state, progress: snapshot.progress });
        // downloading 与 completed 会重复携带同一输出列表，这里去重。
        if (snapshot.outputs) {
          for (const output of snapshot.outputs) {
            if (!outputs.includes(output)) outputs.push(output);
          }
        }
      },
    );
    return { result, outputs, progress, directory };
  } catch (error) {
    return {
      result: null as never,
      error: error instanceof Error ? error.message : String(error),
      outputs,
      progress,
      directory,
    };
  }
}

function requestWith(
  directory: string,
  patch: Partial<AiDesignRequest> = {},
): AiDesignRequest {
  return {
    sourcePath: path.join(directory, "in.png"),
    referencePaths: [],
    prompt: "palette",
    majorChange: false,
    outputCount: 2,
    outputDirectory: path.join(directory, "out"),
    ...patch,
  };
}

describe("mock ai provider (FND-008 §9.4)", () => {
  it("produces deterministic outputs for identical inputs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mock2-"));
    temporaryDirectories.push(directory);
    const request = requestWith(directory);
    const first = await runMock({ stageDelayMs: 0 }, request);
    const second = await runMock({ stageDelayMs: 0 }, request);
    expect(first.outputs.length).toBe(2);
    expect(second.outputs.length).toBe(2);
    for (let index = 0; index < 2; index += 1) {
      const a = await readFile(first.outputs[index]);
      const b = await readFile(second.outputs[index]);
      expect(a.equals(b)).toBe(true);
    }
  });

  it("changes prompt or count changes pixel output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mock3-"));
    temporaryDirectories.push(directory);
    const base = requestWith(directory);
    const a = await runMock({ stageDelayMs: 0 }, { ...base, prompt: "red" });
    const b = await runMock({ stageDelayMs: 0 }, { ...base, prompt: "blue" });
    const pixelsA = await readFile(a.outputs[0]);
    const pixelsB = await readFile(b.outputs[0]);
    expect(pixelsA.equals(pixelsB)).toBe(false);
  });

  it("writes outputs into the selected directory with unique names on conflict", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mock4-"));
    temporaryDirectories.push(directory);
    const request = requestWith(directory);
    const first = await runMock({ stageDelayMs: 0 }, request);
    // 预置同名文件 → 第二次导出生成编号，不覆盖。
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(first.outputs[0], Buffer.alloc(8, 7)),
    );
    const second = await runMock({ stageDelayMs: 0 }, request);
    expect(second.outputs[0]).not.toBe(first.outputs[0]);
    await expect(stat(first.outputs[0])).resolves.toBeDefined();
    expect((await readFile(first.outputs[0])).equals(Buffer.alloc(8, 7))).toBe(true);
  });

  it("respects cancellation token between stages", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mock5-"));
    temporaryDirectories.push(directory);
    const provider = new MockAiProvider({ stageDelayMs: 200 });
    let cancelled = false;
    const onProgress = () => {
      cancelled = true; // 第一阶段后取消。
    };
    await expect(
      provider.start(
        { jobId: "job-c", request: requestWith(directory), clientRequestId: "c1" },
        { isCancelled: () => cancelled },
        onProgress,
      ),
    ).rejects.toThrow("AI_JOB_CANCELLED");
  });

  it("injected failure throws the configured code", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-mock6-"));
    temporaryDirectories.push(directory);
    const result = await runMock(
      { stageDelayMs: 0, injectFailure: { stage: "generating", code: "MOCK_INJECTED" } },
      requestWith(directory),
    );
    expect(result.error).toBe("MOCK_INJECTED");
  });
});
