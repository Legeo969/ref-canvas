// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { AiDesignSupervisorPanel } from "../../../../src/renderer/components/AiDesignSupervisor";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    provider: "mock",
    state: "completed",
    stage: "completed",
    progress: 1,
    outputs: ["D:\\out\\mock_0.png", "D:\\out\\mock_1.png"],
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:01.000Z",
    ...overrides,
  };
}

function baseRefCanvas() {
  const ai = {
    listProviders: vi.fn(async () => [
      { kind: "mock", label: "Mock", available: true, detail: "deterministic" },
    ]),
    listJobs: vi.fn(async () => [jobFixture()]),
    getJob: vi.fn(async () => null),
    start: vi.fn(async () => jobFixture()),
    cancel: vi.fn(async () => jobFixture({ state: "cancelled" })),
    retry: vi.fn(async () => jobFixture({ id: "job-2" })),
    getSettings: vi.fn(async () => ({
      comfyuiAddress: "http://127.0.0.1:8188",
      comfyuiWorkflowPath: null,
      comfyuiBinding: null,
      remoteBaseUrl: null,
      remoteConfigured: false,
      defaultProvider: "mock",
      enabledProviders: ["mock"],
    })),
    setSettings: vi.fn(async () => ({})),
    health: vi.fn(async () => ({ kind: "mock", ok: true, detail: "ok", latencyMs: 0 })),
    onChanged: () => () => undefined,
  };
  return {
    refCanvas: {
      ai,
      filesystem: {
        previewToken: vi.fn(),
      },
      library: {
        pathsForFiles: (files: File[]) => files.map((file) => file.name),
      },
      system: {
        pickFile: vi.fn(async () => ["D:\\src\\a.png", "D:\\ref\\r1.png"]),
        pickDirectory: vi.fn(async () => "D:\\out"),
      },
    } as unknown as RefCanvasApi,
    ai,
  };
}

describe("AiDesignSupervisorPanel (FND-008)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("shows the form, loads providers and renders job history", async () => {
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AiDesignSupervisorPanel onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("AI 设计");
    expect(host.querySelector("textarea#ai-prompt")).toBeTruthy();
    expect(host.textContent).toContain("任务历史");
    expect(host.textContent).toContain("2 个输出");
  });

  it("adds source + references from the file picker and runs a job", async () => {
    const { refCanvas, ai } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AiDesignSupervisorPanel onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // 选择输入图片。
    await act(async () => {
      host
        .querySelector('[aria-label="选择输入图片"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("源图");

    // 填提示词与输出目录。
    const prompt = host.querySelector<HTMLTextAreaElement>("textarea#ai-prompt")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(prompt, "cinematic lighting");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const output = host.querySelector<HTMLInputElement>("#ai-output")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(output, "D:\\out");
      output.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".ai-panel-footer .primary-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ai.start).toHaveBeenCalledWith("mock", {
      sourcePath: "D:\\src\\a.png",
      referencePaths: ["D:\\ref\\r1.png"],
      prompt: "cinematic lighting",
      majorChange: false,
      outputCount: 2,
      outputDirectory: "D:\\out",
    });
  });

  it("shows field errors for missing prompt and output directory", async () => {
    const { refCanvas, ai } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AiDesignSupervisorPanel onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // 未选源图直接运行 → 提示选择源图。
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".ai-panel-footer .primary-button")?.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("请选择源图");
    expect(ai.start).not.toHaveBeenCalled();
  });

  it("renders failed jobs with retry and running jobs with cancel", async () => {
    const { refCanvas } = baseRefCanvas();
    Object.assign(window, { refCanvas });
    const ai = refCanvas.ai as unknown as {
      listJobs: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
      retry: ReturnType<typeof vi.fn>;
    };
    ai.listJobs.mockResolvedValueOnce([
      jobFixture({ id: "j-fail", state: "failed", errorCode: "AI_JOB_FAILED", outputs: [] }),
      jobFixture({ id: "j-run", state: "generating", progress: 0.4, outputs: [] }),
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<AiDesignSupervisorPanel onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("AI_JOB_FAILED");
    expect(host.textContent).toContain("重试");
    expect(host.textContent).toContain("生成中");
    const cancel = host.querySelector('[aria-label^="取消任务"]');
    expect(cancel).toBeTruthy();
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ai.cancel).toHaveBeenCalledWith("j-run");
  });
});
