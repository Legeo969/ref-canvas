import { X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  parseInspectorNumber,
  type InspectorMetrics,
} from "../app/board-inspector";
import { translate } from "../app/i18n";

const FIELDS: Array<{
  key: keyof InspectorMetrics;
  labelKey?: "board.inspectorWidth" | "board.inspectorHeight" | "board.inspectorRotation" | "board.inspectorOpacity";
  step: number;
}> = [
  { key: "x", step: 1 },
  { key: "y", step: 1 },
  { key: "width", labelKey: "board.inspectorWidth", step: 1 },
  { key: "height", labelKey: "board.inspectorHeight", step: 1 },
  { key: "rotation", labelKey: "board.inspectorRotation", step: 1 },
  { key: "opacity", labelKey: "board.inspectorOpacity", step: 0.05 },
];

/** Pure inspector presentation; all Fabric reads/writes stay in the controller. */
export function BoardInspector({
  selectionCount,
  name,
  metrics,
  onCommit,
  onClose,
  style,
}: {
  selectionCount: number;
  name: string | null;
  metrics: InspectorMetrics | null;
  onCommit(key: keyof InspectorMetrics, value: number): void;
  onClose(): void;
  /** 双开避让：父级用内联样式把检查器压到图层面板下方。 */
  style?: CSSProperties;
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
    <aside
      className="board-inspector"
      style={style}
      aria-label={translate("board.inspectorLabel")}
    >
      <header>
        <strong>{translate("board.inspectorTitle")}</strong>
        <button className="mini-icon-button" aria-label={translate("board.inspectorClose")} onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      {selectionCount === 0 ? (
        <p className="board-inspector-empty">{translate("board.inspectorEmpty")}</p>
      ) : selectionCount > 1 ? (
        <p className="board-inspector-empty">{translate("board.inspectorMultiSelection").replace("{count}", String(selectionCount))}</p>
      ) : metrics ? (
        <>
          <p className="board-inspector-name" title={name ?? undefined}>{name || translate("board.objectDefaultName")}</p>
          <div className="board-inspector-grid">
            {FIELDS.map((field) => {
              const label = field.labelKey
                ? translate(field.labelKey)
                : field.key.toUpperCase();
              return (
                <label key={field.key} className="board-inspector-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    step={field.step}
                    value={drafts[field.key] ?? String(metrics[field.key])}
                    onChange={(event) => setDrafts((current) => ({ ...current, [field.key]: event.target.value }))}
                    onBlur={() => commit(field.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    aria-label={label}
                  />
                </label>
              );
            })}
          </div>
        </>
      ) : null}
    </aside>
  );
}
