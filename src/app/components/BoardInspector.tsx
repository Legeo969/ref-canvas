import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  inspectorMetrics,
  inspectorPatch,
  parseInspectorNumber,
  type InspectorMetrics,
} from "../board-inspector";

/** 检查器操作所需的最小 canvas/对象接口（fabric 结构子集，便于解耦与测试）。 */
interface InspectableCanvas {
  getActiveObject(): InspectableObject | null | undefined;
  getActiveObjects(): InspectableObject[];
  fire(event: string, options?: unknown): void;
  requestRenderAll(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

interface InspectableObject {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  set(props: Record<string, unknown>): void;
  setCoords(): void;
  data?: { name?: string; type?: string };
}

interface BoardInspectorProps {
  canvasRef: { current: InspectableCanvas | null };
  onClose(): void;
}

const SYNC_EVENTS = [
  "selection:created",
  "selection:updated",
  "selection:cleared",
  "object:moving",
  "object:scaling",
  "object:rotating",
];

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

/**
 * 白板对象检查器：选中对象的位置/尺寸/旋转/透明度数值编辑。
 * 修改走 `set + setCoords + fire("object:modified")`，与既有管线
 * （undo 快照 + 500ms 持久化）一致。
 */
export function BoardInspector({ canvasRef, onClose }: BoardInspectorProps) {
  const [drafts, setDrafts] = useState<Partial<Record<keyof InspectorMetrics, string>>>({});
  const [metrics, setMetrics] = useState<InspectorMetrics | null>(null);
  const [selectionCount, setSelectionCount] = useState(0);

  const sync = () => {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject() as InspectableObject | undefined;
    const count = canvas?.getActiveObjects().length ?? 0;
    setSelectionCount(count);
    if (!object || count !== 1) {
      setMetrics(null);
      return;
    }
    setMetrics(inspectorMetrics(object));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    sync();
    for (const event of SYNC_EVENTS) canvas.on(event, sync);
    return () => {
      for (const event of SYNC_EVENTS) canvas.off(event, sync);
    };
  }, [canvasRef]);

  const commit = (key: keyof InspectorMetrics) => {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject() as InspectableObject | undefined;
    if (!canvas || !object || !metrics) return;
    const raw = drafts[key];
    const value = parseInspectorNumber(raw ?? "");
    if (value === undefined) {
      // 非法输入回退为当前值。
      setDrafts((current) => ({ ...current, [key]: String(metrics[key]) }));
      return;
    }
    const patch = inspectorPatch(object, { [key]: value });
    if (Object.keys(patch).length) {
      object.set(patch);
      object.setCoords();
      canvas.fire("object:modified", { target: object });
      canvas.requestRenderAll();
      setMetrics(inspectorMetrics(object));
    }
    setDrafts((current) => ({ ...current, [key]: String(metrics[key]) }));
  };

  const objectName = (() => {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject() as InspectableObject | undefined;
    return object?.data?.name ?? object?.data?.type ?? "";
  })();

  return (
    <aside className="board-inspector" aria-label="对象检查器">
      <header>
        <strong>检查器</strong>
        <button
          className="mini-icon-button"
          aria-label="关闭检查器"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>
      {selectionCount === 0 ? (
        <p className="board-inspector-empty">未选择对象</p>
      ) : selectionCount > 1 ? (
        <p className="board-inspector-empty">已选 {selectionCount} 个对象，检查器仅支持单选</p>
      ) : metrics ? (
        <>
          <p className="board-inspector-name" title={objectName}>
            {objectName || "对象"}
          </p>
          <div className="board-inspector-grid">
            {FIELDS.map((field) => (
              <label key={field.key} className="board-inspector-field">
                <span>{field.label}</span>
                <input
                  type="number"
                  step={field.step}
                  value={drafts[field.key] ?? String(metrics[field.key])}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  onBlur={() => commit(field.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
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
