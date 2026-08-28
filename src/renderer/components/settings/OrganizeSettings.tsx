import { Eye, Pencil, Plus, Tags, Trash2, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AutoTagRule,
  AutoTagRulePreview,
} from "../../../shared/contracts";
import { translate } from "../../app/i18n";
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
      title: translate("settings.organize.deleteTitle"),
      description: translate("settings.organize.deleteDescription").replace(
        "{name}",
        rule.name,
      ),
      confirmLabel: translate("settings.organize.delete"),
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.library.deleteAutoTagRule(rule.id);
    await reload();
  };

  const applyHistory = async () => {
    const tagged = await window.refCanvas.library.applyAutoTagRules();
    setAppliedMessage(
      translate("settings.organize.historyUpdated").replace(
        "{count}",
        String(tagged),
      ),
    );
  };

  return (
    <div className="settings-group organize-settings">
      <div className="settings-section-heading">
        <div>
          <h3>{translate("settings.organize.autoTag")}</h3>
          <p>{translate("settings.organize.description")}</p>
        </div>
        <button className="secondary-button" onClick={() => edit()}>
          <Plus size={15} /> {translate("settings.organize.newRule")}
        </button>
      </div>

      <div className="auto-tag-rule-list">
        {rules.length === 0 && <p className="settings-note">{translate("settings.organize.empty")}</p>}
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
            <button className="icon-button" aria-label={translate("settings.organize.editRule").replace("{name}", rule.name)} onClick={() => edit(rule)}>
              <Pencil size={14} />
            </button>
            <button className="icon-button danger" aria-label={translate("settings.organize.deleteRule").replace("{name}", rule.name)} onClick={() => void remove(rule)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {editingId && (
        <div className="auto-tag-editor">
          <h3>{editingId === "new" ? translate("settings.organize.newRule") : translate("settings.organize.editRuleTitle")}</h3>
          <label>{translate("settings.organize.ruleName")}<input value={draft.name} onChange={(event) => change({ name: event.target.value })} /></label>
          <div className="auto-tag-condition-grid">
            <label>{translate("settings.organize.filenamePattern")}<input value={draft.filenamePattern ?? ""} placeholder="*concept*" onChange={(event) => change({ filenamePattern: cleanOptional(event.target.value) })} /></label>
            <label>{translate("settings.organize.pathPattern")}<input value={draft.pathPattern ?? ""} placeholder="references" onChange={(event) => change({ pathPattern: cleanOptional(event.target.value) })} /></label>
            <label>{translate("settings.organize.extension")}<input value={draft.extension ?? ""} placeholder="png" onChange={(event) => change({ extension: cleanOptional(event.target.value.replace(/^\./, "").toLowerCase()) })} /></label>
          </div>
          <label>{translate("settings.organize.tags")}<input value={draft.tags.join(", ")} placeholder={translate("settings.organize.tagsPlaceholder")} onChange={(event) => change({ tags: [...new Set(event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 64) })} /></label>
          <div className="auto-tag-editor-actions">
            <button className="secondary-button" onClick={() => void previewRule()} disabled={!draft.name.trim() || draft.tags.length === 0}>
              <Eye size={15} /> {translate("settings.organize.previewMatches")}
            </button>
            <button className="primary-button" onClick={() => void save()} disabled={previewSignature !== signature}>
              <Tags size={15} /> {translate("settings.organize.saveRule")}
            </button>
            <button className="secondary-button" onClick={() => setEditingId(null)}>{translate("dialogs.cancel")}</button>
          </div>
          {preview && (
            <div className="auto-tag-preview" aria-live="polite">
              <strong>{translate("settings.organize.matchCount").replace("{count}", String(preview.total))}</strong>
              {preview.samples.map((sample) => (
                <span key={sample.id} title={sample.path}>{sample.title}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-section-heading history-apply-row">
        <div>
          <h3>{translate("settings.organize.history")}</h3>
          {appliedMessage && <p aria-live="polite">{appliedMessage}</p>}
        </div>
        <button className="secondary-button" onClick={() => void applyHistory()} disabled={rules.every((rule) => !rule.enabled)}>
          <WandSparkles size={15} /> {translate("settings.organize.applyEnabled")}
        </button>
      </div>
    </div>
  );
}
