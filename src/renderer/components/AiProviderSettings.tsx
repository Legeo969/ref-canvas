/**
 * AI Provider 设置（FND-009 §9.5 / FND-010 §9.6）。
 *
 * - ComfyUI：地址、健康检查、API-format workflow 导入与绑定编辑器。
 * - Remote REST：Job API base URL（HTTPS 公网）、Bearer token 保存/清除
 *   （safeStorage 加密；Renderer 只读 configured 状态）。
 * - 默认 Provider 与启用列表。
 *
 * Renderer 不接触 token 明文、不读取 workflow 文件内容；导入经由
 * `ai:import-comfyui-workflow` 在 Main 完成解析与结构检查。
 */
import { Check, Cloud, Cpu, KeyRound, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AiProviderHealth,
  AiProviderKind,
  AiProviderSummary,
  AiSettings,
} from "../../shared/contracts";
import { translate } from "../app/i18n";
import { SelectMenu } from "./SelectMenu";

type ComfyInputRef = { nodeId: string; inputName: string };

interface WorkflowImportResult {
  valid: boolean;
  errors: string[];
  nodeCount: number;
  outputNodeIds: string[];
  imageInputNodes: Array<{ nodeId: string; type: string }>;
  nodes: Array<{ nodeId: string; type: string; inputNames: string[] }>;
  workflowPath: string;
}

interface BindingDraft {
  source: ComfyInputRef | null;
  referenceSlots: Array<ComfyInputRef | null>;
  prompt: ComfyInputRef | null;
  batchSize: ComfyInputRef | null;
  outputNodeIds: string[];
}

const EMPTY_BINDING: BindingDraft = {
  source: null,
  referenceSlots: [],
  prompt: null,
  batchSize: null,
  outputNodeIds: [],
};

function inputOptions(
  nodes: WorkflowImportResult["nodes"],
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  for (const node of nodes) {
    for (const inputName of node.inputNames) {
      options.push({
        value: `${node.nodeId}:${inputName}`,
        label: `${node.type} #${node.nodeId} · ${inputName}`,
      });
    }
  }
  return options;
}

function parseRef(value: string): ComfyInputRef | null {
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  return { nodeId: value.slice(0, separator), inputName: value.slice(separator + 1) };
}

function toValue(ref: ComfyInputRef | null): string {
  return ref ? `${ref.nodeId}:${ref.inputName}` : "";
}

export function AiProviderSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [providers, setProviders] = useState<AiProviderSummary[]>([]);
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [comfyHealth, setComfyHealth] = useState<AiProviderHealth | null>(null);
  const [remoteHealth, setRemoteHealth] = useState<AiProviderHealth | null>(null);
  const [checking, setChecking] = useState<AiProviderKind | null>(null);
  const [comfyAddress, setComfyAddress] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteUrlError, setRemoteUrlError] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenMessage, setTokenMessage] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowImportResult | null>(null);
  const [binding, setBinding] = useState<BindingDraft>(EMPTY_BINDING);
  const [bindingMessage, setBindingMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const [nextSettings, nextProviders, secretStatus] = await Promise.all([
        window.refCanvas.ai.getSettings(),
        window.refCanvas.ai.listProviders(),
        window.refCanvas.ai.secretStatus(),
      ]);
      setSettings(nextSettings);
      setProviders(nextProviders);
      setSecretConfigured(secretStatus.configured);
      setComfyAddress(nextSettings.comfyuiAddress);
      setRemoteUrl(nextSettings.remoteBaseUrl ?? "");
      if (nextSettings.comfyuiWorkflowPath) {
        const imported = await window.refCanvas.ai.importComfyuiWorkflow(
          nextSettings.comfyuiWorkflowPath,
        );
        setWorkflow(imported);
      } else {
        setWorkflow(null);
      }
      const stored = nextSettings.comfyuiBinding as Partial<BindingDraft> | null;
      setBinding({
        source: stored?.source ?? null,
        referenceSlots: stored?.referenceSlots ?? [],
        prompt: stored?.prompt ?? null,
        batchSize: stored?.batchSize ?? null,
        outputNodeIds: stored?.outputNodeIds ?? [],
      });
    } catch {
      // 面板未就绪时保持现有状态。
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const availableProviders = useMemo(
    () =>
      providers.filter((item) =>
        settings?.enabledProviders?.length
          ? settings.enabledProviders.includes(item.kind)
          : true,
      ),
    [providers, settings],
  );

  const checkHealth = async (kind: AiProviderKind) => {
    setChecking(kind);
    try {
      const health = await window.refCanvas.ai.health(kind);
      if (kind === "comfyui") setComfyHealth(health);
      else setRemoteHealth(health);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const fallback: AiProviderHealth = {
        kind,
        ok: false,
        detail: message,
        latencyMs: null,
      };
      if (kind === "comfyui") setComfyHealth(fallback);
      else setRemoteHealth(fallback);
    } finally {
      setChecking(null);
    }
  };

  const saveComfyAddress = async () => {
    setError("");
    try {
      const next = await window.refCanvas.ai.setSettings({
        comfyuiAddress: comfyAddress.trim() || "http://127.0.0.1:8188",
      });
      setSettings(next);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const updateRemoteUrl = (value: string) => {
    setRemoteUrl(value);
    const trimmed = value.trim();
    if (trimmed && !/^https:\/\//.test(trimmed)) {
      setRemoteUrlError(translate("aiSettings.urlRejected"));
    } else {
      setRemoteUrlError("");
    }
  };

  const saveRemoteUrl = async () => {
    if (remoteUrlError) return;
    const trimmed = remoteUrl.trim();
    try {
      const next = await window.refCanvas.ai.setSettings({
        remoteBaseUrl: trimmed || null,
      });
      setSettings(next);
      setRemoteHealth(null);
      await refresh();
    } catch (caught) {
      setRemoteUrlError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const saveToken = async () => {
    setTokenMessage("");
    const token = tokenInput.trim();
    if (!token) return;
    try {
      const status = await window.refCanvas.ai.saveSecret(token);
      setSecretConfigured(status.configured);
      setTokenInput("");
      setTokenMessage(translate("aiSettings.tokenConfigured"));
      setProviders(await window.refCanvas.ai.listProviders());
    } catch (caught) {
      setTokenMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const clearToken = async () => {
    setTokenMessage("");
    try {
      const status = await window.refCanvas.ai.clearSecret();
      setSecretConfigured(status.configured);
      setTokenMessage(translate("aiSettings.tokenUnconfigured"));
      setProviders(await window.refCanvas.ai.listProviders());
    } catch (caught) {
      setTokenMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const importWorkflow = async () => {
    setError("");
    setBindingMessage("");
    const picked = await window.refCanvas.system.pickFile({
      title: translate("aiSettings.importWorkflow"),
      filters: [{ name: translate("aiSettings.fileFilterWorkflow"), extensions: ["json"] }],
    });
    if (!picked[0]) return;
    try {
      const result = await window.refCanvas.ai.importComfyuiWorkflow(picked[0]);
      setWorkflow(result);
      if (!result.valid) {
        setBindingMessage(translate("aiSettings.workflowErrors"));
      }
      setBinding(EMPTY_BINDING);
    } catch (caught) {
      setBindingMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const saveBinding = async () => {
    setBindingMessage("");
    if (
      !binding.source ||
      !binding.prompt ||
      !binding.batchSize ||
      binding.outputNodeIds.length === 0
    ) {
      setBindingMessage(translate("aiSettings.bindingInvalid"));
      return;
    }
    try {
      const next = await window.refCanvas.ai.setSettings({
        comfyuiBinding: {
          source: binding.source,
          referenceSlots: binding.referenceSlots.filter(Boolean),
          prompt: binding.prompt,
          batchSize: binding.batchSize,
          outputNodeIds: binding.outputNodeIds,
        },
      });
      setSettings(next);
      setBindingMessage(translate("aiSettings.imported"));
      await refresh();
    } catch (caught) {
      setBindingMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const setEnabled = async (kind: AiProviderKind, enabled: boolean) => {
    if (!settings) return;
    const enabledProviders = enabled
      ? [...settings.enabledProviders, kind]
      : settings.enabledProviders.filter((item) => item !== kind);
    const next = await window.refCanvas.ai.setSettings({ enabledProviders });
    setSettings(next);
  };

  const inputOptionsList = inputOptions(workflow?.nodes ?? []);
  const sourceCandidates = workflow
    ? workflow.imageInputNodes
        .map((node) => {
          const inputs = workflow.nodes.find(
            (candidate) => candidate.nodeId === node.nodeId,
          )?.inputNames ?? [];
          return inputs.map((name) => ({
            value: `${node.nodeId}:${name}`,
            label: `${node.type} #${node.nodeId} · ${name}`,
          }));
        })
        .flat()
    : [];

  return (
    <div className="ai-settings">
      <div className="settings-group">
        <h3>
          <Cpu size={15} /> ComfyUI · {translate("aiSettings.healthCheck")}
        </h3>
        <label className="settings-row">
          <span>{translate("aiSettings.comfyuiAddress")}</span>
          <input
            value={comfyAddress}
            onChange={(event) => setComfyAddress(event.target.value)}
            onBlur={() => void saveComfyAddress()}
          />
        </label>
        <div className="ai-settings-actions">
          <button
            className="secondary-button"
            disabled={checking === "comfyui"}
            onClick={() => void checkHealth("comfyui")}
          >
            <RefreshCw size={13} className={checking === "comfyui" ? "spin" : ""} />
            {checking === "comfyui"
              ? translate("aiSettings.healthChecking")
              : translate("aiSettings.healthCheck")}
          </button>
          {comfyHealth && (
            <span className={`ai-health ${comfyHealth.ok ? "ok" : "fail"}`}>
              {comfyHealth.ok ? (
                <Check size={12} />
              ) : (
                <X size={12} />
              )}
              {comfyHealth.ok
                ? translate("aiSettings.healthy")
                : translate("aiSettings.unhealthy")}
              {comfyHealth.detail ? ` · ${comfyHealth.detail}` : ""}
            </span>
          )}
        </div>

        <label className="settings-row">
          <span>{translate("aiSettings.workflowFile")}</span>
          <button className="secondary-button" onClick={() => void importWorkflow()}>
            <Plus size={13} />
            {translate("aiSettings.importWorkflow")}
          </button>
        </label>
        {workflow && (
          <p className="ai-settings-note">
            {translate("aiSettings.imported")}:{" "}
            <code title={workflow.workflowPath}>
              {workflow.workflowPath.split(/[\\/]/).pop()}
            </code>
          </p>
        )}
        {workflow && !workflow.valid && (
          <ul className="ai-settings-errors">
            {workflow.errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}

        {workflow && workflow.valid && (
          <div className="ai-binding-editor">
            <h4>{translate("aiSettings.binding")}</h4>
            {workflow.nodes.length === 0 ? (
              <p>{translate("aiSettings.noNodes")}</p>
            ) : (
              <>
                <label className="settings-row">
                  <span>{translate("aiSettings.bindingSource")}</span>
                  <SelectMenu
                    value={toValue(binding.source)}
                    ariaLabel={translate("aiSettings.bindingSource")}
                    options={[
                      { value: "", label: "—" },
                      ...sourceCandidates,
                    ]}
                    onValueChange={(value) =>
                      setBinding((current) => ({
                        ...current,
                        source: parseRef(value),
                      }))
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>{translate("aiSettings.bindingPrompt")}</span>
                  <SelectMenu
                    value={toValue(binding.prompt)}
                    ariaLabel={translate("aiSettings.bindingPrompt")}
                    options={[
                      { value: "", label: "—" },
                      ...inputOptionsList,
                    ]}
                    onValueChange={(value) =>
                      setBinding((current) => ({
                        ...current,
                        prompt: parseRef(value),
                      }))
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>{translate("aiSettings.bindingBatchSize")}</span>
                  <SelectMenu
                    value={toValue(binding.batchSize)}
                    ariaLabel={translate("aiSettings.bindingBatchSize")}
                    options={[
                      { value: "", label: "—" },
                      ...inputOptionsList,
                    ]}
                    onValueChange={(value) =>
                      setBinding((current) => ({
                        ...current,
                        batchSize: parseRef(value),
                      }))
                    }
                  />
                </label>
                <div className="settings-row ai-binding-row">
                  <span>{translate("aiSettings.bindingOutputs")}</span>
                  <div className="ai-binding-outputs">
                    {workflow.outputNodeIds.map((nodeId) => (
                      <label key={nodeId}>
                        <input
                          type="checkbox"
                          checked={binding.outputNodeIds.includes(nodeId)}
                          onChange={(event) =>
                            setBinding((current) => ({
                              ...current,
                              outputNodeIds: event.target.checked
                                ? [...current.outputNodeIds, nodeId]
                                : current.outputNodeIds.filter((id) => id !== nodeId),
                            }))
                          }
                        />
                        #{nodeId}
                      </label>
                    ))}
                  </div>
                </div>
                <button className="secondary-button" onClick={() => void saveBinding()}>
                  {translate("aiSettings.saveToken")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="settings-group">
        <h3>
          <Cloud size={15} /> Remote REST
        </h3>
        <label className="settings-row">
          <span>{translate("aiSettings.remoteUrl")}</span>
          <input
            value={remoteUrl}
            placeholder="https://api.example.com"
            onChange={(event) => updateRemoteUrl(event.target.value)}
            onBlur={() => void saveRemoteUrl()}
          />
        </label>
        {remoteUrlError && <p className="ai-settings-errors">{remoteUrlError}</p>}
        <div className="ai-settings-actions">
          <button
            className="secondary-button"
            disabled={checking === "remote-rest" || !settings?.remoteBaseUrl}
            onClick={() => void checkHealth("remote-rest")}
          >
            <RefreshCw size={13} className={checking === "remote-rest" ? "spin" : ""} />
            {checking === "remote-rest"
              ? translate("aiSettings.healthChecking")
              : translate("aiSettings.healthCheck")}
          </button>
          {remoteHealth && (
            <span className={`ai-health ${remoteHealth.ok ? "ok" : "fail"}`}>
              {remoteHealth.ok ? <Check size={12} /> : <X size={12} />}
              {remoteHealth.ok
                ? translate("aiSettings.healthy")
                : translate("aiSettings.unhealthy")}
              {remoteHealth.detail ? ` · ${remoteHealth.detail}` : ""}
            </span>
          )}
        </div>
        <label className="settings-row">
          <span>
            <KeyRound size={13} /> {translate("aiSettings.remoteToken")}
          </span>
          <input
            type="password"
            value={tokenInput}
            placeholder={translate("aiSettings.remoteTokenPlaceholder")}
            onChange={(event) => setTokenInput(event.target.value)}
          />
        </label>
        <p className="ai-settings-note">
          {secretConfigured
            ? translate("aiSettings.tokenConfigured")
            : translate("aiSettings.tokenUnconfigured")}
        </p>
        <div className="ai-settings-actions">
          <button className="secondary-button" disabled={!tokenInput.trim()} onClick={() => void saveToken()}>
            {translate("aiSettings.saveToken")}
          </button>
          <button className="secondary-button danger" disabled={!secretConfigured} onClick={() => void clearToken()}>
            <Trash2 size={13} />
            {translate("aiSettings.clearToken")}
          </button>
          {tokenMessage && <span className="ai-settings-note">{tokenMessage}</span>}
        </div>
      </div>

      <div className="settings-group">
        <h3>{translate("aiSettings.enabledProviders")}</h3>
        {providers.map((provider) => (
          <label className="settings-toggle" key={provider.kind}>
            <input
              type="checkbox"
              checked={settings?.enabledProviders.includes(provider.kind) ?? false}
              onChange={(event) => void setEnabled(provider.kind, event.target.checked)}
            />
            <span>
              {provider.label}
              {provider.available ? "" : ` · ${translate("aiSettings.notConfigured")}`}
            </span>
          </label>
        ))}
        <label className="settings-row">
          <span>{translate("aiSettings.defaultProvider")}</span>
          <SelectMenu
            value={
              settings?.defaultProvider ??
              availableProviders[0]?.kind ??
              "remote-rest"
            }
            ariaLabel={translate("aiSettings.defaultProvider")}
            options={availableProviders.map((provider) => ({
              value: provider.kind,
              label: provider.label,
            }))}
            disabled={availableProviders.length === 0}
            onValueChange={(value) =>
              void window.refCanvas.ai
                .setSettings({ defaultProvider: value as AiProviderKind })
                .then(setSettings)
            }
          />
        </label>
      </div>

      {bindingMessage && <p className="ai-settings-note">{bindingMessage}</p>}
      {error && <p className="ai-settings-errors">{error}</p>}
    </div>
  );
}
