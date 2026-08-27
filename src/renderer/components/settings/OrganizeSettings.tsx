import { Eye, Pencil, Plus, Tags, Trash2, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AutoTagRule,
  AutoTagRulePreview,
} from "../../../shared/contracts";
import { useDialog } from "../DialogProvider";

type RuleDraft = Omit<AutoTagRule, "id" | "createdAt" | "updatedAt">;

const EMPTY_RULE: RuleDraft = {
  name: "",
  filenamePattern: null,
  pathPattern: null,
  extension: null,
  tags: [],
  enabled: true,
};

function cleanOptional(value: string): string | null {
  const cleaned = value.trim();
  return cleaned || null;
}

export function OrganizeSettings() {
  const dialog = useDialog();
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_RULE);
  const [preview, setPreview] = useState<AutoTagRulePreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [appliedMessage, setAppliedMessage] = useState("");
  const signature = useMemo(() => JSON.stringify(draft), [draft]);

  const reload = useCallback(async () => {
    setRules(await window.refCanvas.library.listAutoTagRules());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const change = (patch: Partial<RuleDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setPreviewSignature("");
  };

  const edit = (rule?: AutoTagRule) => {
    setEditingId(rule?.id ?? "new");
    setDraft(rule ? {
      name: rule.name,
      filenamePattern: rule.filenamePattern,
      pathPattern: rule.pathPattern,
      extension: rule.extension,
      tags: rule.tags,
      enabled: rule.enabled,
    } : EMPTY_RULE);
    setPreview(null);
    setPreviewSignature("");
  };

  const previewRule = async () => {
    const result = await window.refCanvas.library.previewAutoTagRule(draft);
    setPreview(result);
    setPreviewSignature(signature);
  };

  const save = async () => {
    if (!draft.name.trim() || draft.tags.length === 0 || previewSignature !== signature) return;
    if (editingId === "new") {
      await window.refCanvas.library.createAutoTagRule(draft);
    } else if (editingId) {
      await window.refCanvas.library.updateAutoTagRule(editingId, draft);
    }
    setEditingId(null);
    setPreview(null);
    await reload();
  };

  const remove = async (rule: AutoTagRule) => {
    const confirmed = await dialog.requestConfirm({
      title: "删除自动标签规则",
      description: `删除“${rule.name}”不会移除已经添加到素材上的标签。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.library.deleteAutoTagRule(rule.id);
    await reload();
  };

  const applyHistory = async () => {
    const tagged = await window.refCanvas.library.applyAutoTagRules();
    setAppliedMessage(`已更新 ${tagged} 个历史素材`);
  };

  return (
    <div className="settings-group organize-settings">
      <div className="settings-section-heading">
        <div>
          <h3>自动标签</h3>
          <p>新索引素材会使用已启用规则；历史素材只在你主动应用时更新。</p>
        </div>
        <button className="secondary-button" onClick={() => edit()}>
          <Plus size={15} /> 新建规则
        </button>
      </div>

      <div className="auto-tag-rule-list">
        {rules.length === 0 && <p className="settings-note">尚无自动标签规则。</p>}
        {rules.map((rule) => (
          <div className="auto-tag-rule-row" key={rule.id}>
            <label className="settings-toggle compact">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={async (event) => {
                  await window.refCanvas.library.updateAutoTagRule(rule.id, {
                    enabled: event.target.checked,
                  });
                  await reload();
                }}
              />
              <span>
                {rule.name}
                <small>{rule.tags.map((tag) => `#${tag}`).join(" ")}</small>
              </span>
            </label>
            <button className="icon-button" aria-label={`编辑 ${rule.name}`} onClick={() => edit(rule)}>
              <Pencil size={14} />
            </button>
            <button className="icon-button danger" aria-label={`删除 ${rule.name}`} onClick={() => void remove(rule)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {editingId && (
        <div className="auto-tag-editor">
          <h3>{editingId === "new" ? "新建规则" : "编辑规则"}</h3>
          <label>规则名称<input value={draft.name} onChange={(event) => change({ name: event.target.value })} /></label>
          <div className="auto-tag-condition-grid">
            <label>文件名（支持 *）<input value={draft.filenamePattern ?? ""} placeholder="*concept*" onChange={(event) => change({ filenamePattern: cleanOptional(event.target.value) })} /></label>
            <label>路径包含<input value={draft.pathPattern ?? ""} placeholder="references" onChange={(event) => change({ pathPattern: cleanOptional(event.target.value) })} /></label>
            <label>扩展名<input value={draft.extension ?? ""} placeholder="png" onChange={(event) => change({ extension: cleanOptional(event.target.value.replace(/^\./, "").toLowerCase()) })} /></label>
          </div>
          <label>添加标签<input value={draft.tags.join(", ")} placeholder="概念图, 待整理" onChange={(event) => change({ tags: [...new Set(event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 64) })} /></label>
          <div className="auto-tag-editor-actions">
            <button className="secondary-button" onClick={() => void previewRule()} disabled={!draft.name.trim() || draft.tags.length === 0}>
              <Eye size={15} /> 预览命中
            </button>
            <button className="primary-button" onClick={() => void save()} disabled={previewSignature !== signature}>
              <Tags size={15} /> 保存规则
            </button>
            <button className="secondary-button" onClick={() => setEditingId(null)}>取消</button>
          </div>
          {preview && (
            <div className="auto-tag-preview" aria-live="polite">
              <strong>命中 {preview.total} 个素材</strong>
              {preview.samples.map((sample) => (
                <span key={sample.id} title={sample.path}>{sample.title}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-section-heading history-apply-row">
        <div>
          <h3>历史素材</h3>
          {appliedMessage && <p aria-live="polite">{appliedMessage}</p>}
        </div>
        <button className="secondary-button" onClick={() => void applyHistory()} disabled={rules.every((rule) => !rule.enabled)}>
          <WandSparkles size={15} /> 应用已启用规则
        </button>
      </div>
    </div>
  );
}
