import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  parseInspectorNumber,
  type InspectorMetrics,
} from "../app/board-inspector";

const FIELDS: Array<{
  key: keyof InspectorMetrics;
  label: string;
  step: number;
}> = [
  { key: "x", label: "X", step: 1 },
  { key: "y", label: "Y", step: 1 },
  { key: "width", label: "宽", step: 1 },
  { key: "height", label: "高", step: 1 },
  { key: "rotation", label: "旋转°", step: 1 },
  { key: "opacity", label: "不透明度", step: 0.05 },
];

/** Pure inspector presentation; all Fabric reads/writes stay in the controller. */
export function BoardInspector({
  selectionCount,
  name,
  metrics,
  onCommit,
  onClose,
}: {
  selectionCount: number;
  name: string | null;
  metrics: InspectorMetrics | null;
  onCommit(key: keyof InspectorMetrics, value: number): void;
  onClose(): void;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<keyof InspectorMetrics, string>>>({});
  useEffect(() => setDrafts({}), [metrics]);

  const commit = (key: keyof InspectorMetrics) => {
    if (!metrics) return;
    const value = parseInspectorNumber(drafts[key] ?? "");
    if (value === undefined) {
      setDrafts((current) => ({ ...current, [key]: String(metrics[key]) }));
      return;
    }
    onCommit(key, value);
    setDrafts((current) => ({ ...current, [key]: String(value) }));
  };

  return (
    <aside className="board-inspector" aria-label="对象检查器">
      <header>
        <strong>检查器</strong>
        <button className="mini-icon-button" aria-label="关闭检查器" onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      {selectionCount === 0 ? (
        <p className="board-inspector-empty">未选择对象</p>
      ) : selectionCount > 1 ? (
        <p className="board-inspector-empty">已选 {selectionCount} 个对象，检查器仅支持单选</p>
      ) : metrics ? (
        <>
          <p className="board-inspector-name" title={name ?? undefined}>{name || "对象"}</p>
          <div className="board-inspector-grid">
            {FIELDS.map((field) => (
              <label key={field.key} className="board-inspector-field">
                <span>{field.label}</span>
                <input
                  type="number"
                  step={field.step}
                  value={drafts[field.key] ?? String(metrics[field.key])}
                  onChange={(event) => setDrafts((current) => ({ ...current, [field.key]: event.target.value }))}
                  onBlur={() => commit(field.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label={field.label}
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}
