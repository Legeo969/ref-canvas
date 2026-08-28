// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { AiProviderSettings } from "../../../../src/renderer/components/AiProviderSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 组件已迁移到 i18n key；断言基于简体中文 catalog。

function baseSettings() {
  return {
    comfyuiAddress: "http://127.0.0.1:8188",
    comfyuiWorkflowPath: null,
    comfyuiBinding: null,
    remoteBaseUrl: null,
    remoteConfigured: false,
    defaultProvider: "mock",
    enabledProviders: ["mock", "comfyui", "remote-rest"],
  };
}

function installRefCanvas(overrides: Record<string, unknown> = {}) {
  const ai = {
    listProviders: vi.fn(async () => [
      { kind: "mock", label: "Mock（本地确定性）", available: true, detail: null },
      { kind: "comfyui", label: "ComfyUI", available: false, detail: "offline" },
      { kind: "remote-rest", label: "Remote REST", available: false, detail: "未配置" },
    ]),
    getSettings: vi.fn(async () => baseSettings()),
    setSettings: vi.fn(async (patch: Record<string, unknown>) => ({
      ...baseSettings(),
      ...patch,
    })),
    health: vi.fn(async (kind: string) => ({
      kind,
      ok: true,
      detail: "ok",
      latencyMs: 5,
    })),
    secretStatus: vi.fn(async () => ({ configured: false, source: "test" })),
    saveSecret: vi.fn(async () => ({ configured: true, source: "test" })),
    clearSecret: vi.fn(async () => ({ configured: false, source: "test" })),
    importComfyuiWorkflow: vi.fn(async (path: string) => ({
      valid: true,
      errors: [],
      nodeCount: 2,
      outputNodeIds: ["9"],
      imageInputNodes: [{ nodeId: "1", type: "LoadImage" }],
      nodes: [
        {
          nodeId: "1",
          type: "LoadImage",
          inputNames: ["image"],
        },
        { nodeId: "9", type: "SaveImage", inputNames: ["images"] },
      ],
      workflowPath: path,
    })),
    ...(overrides.ai ?? {}),
  };
  const system = {
    pickFile: vi.fn(async () => ["D:\\workflow.json"]),
    ...(overrides.system ?? {}),
  };
  Object.assign(window, { refCanvas: { ai, system } });
  return { ai, system };
}

describe("AiProviderSettings (FND-009/010)", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  it("uses stacked full-width controls throughout AI settings", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/renderer/styles/ai.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.ai-settings \.settings-row\s*\{[\s\S]*?align-items:\s*stretch;[\s\S]*?flex-direction:\s*column;/,
    );
    expect(css).toMatch(
      /\.ai-settings \.settings-row > input:not\(\[type\]\)[\s\S]*?\.ai-settings \.settings-row > \.secondary-button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/,
    );
  });

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function render() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    return { host, root };
  }

  it("loads settings, provider list and secret status", async () => {
    const { ai } = installRefCanvas();
    const { host, root } = render();
    await act(async () => {
      root.render(<AiProviderSettings />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ai.getSettings).toHaveBeenCalled();
    expect(ai.listProviders).toHaveBeenCalled();
    expect(ai.secretStatus).toHaveBeenCalled();
    const addressInput = host.querySelector<HTMLInputElement>('input[value="http://127.0.0.1:8188"]');
    expect(addressInput).toBeTruthy();
    expect(host.textContent).toContain("未配置");
  });

  it("runs a ComfyUI health check and shows the result", async () => {
    const { ai } = installRefCanvas();
    const { host, root } = render();
    await act(async () => {
      root.render(<AiProviderSettings />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const buttons = host.querySelectorAll("button");
    const checkButton = Array.from(buttons).find((button) =>
      button.textContent?.includes("检查连接"),
    );
    expect(checkButton).toBeTruthy();
    await act(async () => {
      checkButton!.click();
      await Promise.resolve();
    });
    expect(ai.health).toHaveBeenCalledWith("comfyui");
    expect(host.textContent).toContain("可用");
  });

  it("saves and clears the bearer token via secret IPC", async () => {
    const { ai } = installRefCanvas();
    const { host, root } = render();
    await act(async () => {
      root.render(<AiProviderSettings />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const tokenInput = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => {
      setInputValue(tokenInput, "sk-live-token");
    });
    const saveButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存") && !button.closest(".ai-binding-editor"),
    );
    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });
    expect(ai.saveSecret).toHaveBeenCalledWith("sk-live-token");
    // 明文不进入 DOM（password 输入已清空，仅显示 configured 状态）。
    expect(host.textContent).not.toContain("sk-live-token");
    const clearButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("清除"),
    );
    await act(async () => {
      clearButton!.click();
      await Promise.resolve();
    });
    expect(ai.clearSecret).toHaveBeenCalled();
  });

  it("rejects a non-HTTPS remote URL before saving", async () => {
    const { ai } = installRefCanvas();
    const { host, root } = render();
    await act(async () => {
      root.render(<AiProviderSettings />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const urlInput = host.querySelector<HTMLInputElement>(
      'input[placeholder="https://api.example.com"]',
    )!;
    await act(async () => {
      setInputValue(urlInput, "http://private.example.com");
    });
    expect(host.textContent).toContain("必须为 HTTPS 公网地址");
    expect(ai.setSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ remoteBaseUrl: "http://private.example.com" }),
    );
  });

  it("imports a workflow and blocks incomplete bindings", async () => {
    const { ai } = installRefCanvas();
    const { host, root } = render();
    await act(async () => {
      root.render(<AiProviderSettings />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const importButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("导入 API workflow"),
    );
    await act(async () => {
      importButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ai.importComfyuiWorkflow).toHaveBeenCalledWith("D:\\workflow.json");
    // 绑定未填写 → 保存被阻止（绑定编辑器内的保存按钮）。
    const saveBindingButton = host.querySelector<HTMLButtonElement>(
      ".ai-binding-editor > .secondary-button",
    );
    expect(saveBindingButton).toBeTruthy();
    await act(async () => {
      saveBindingButton!.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("绑定不完整");
  });
});
