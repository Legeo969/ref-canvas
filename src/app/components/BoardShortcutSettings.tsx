import { RotateCcw, X } from "lucide-react";
import { useState } from "react";
import {
  defaultBoardShortcuts,
  findShortcutConflict,
  loadBoardShortcuts,
  shortcutFromKeyboardEvent,
  type BoardShortcutBindings,
  type BoardShortcutId,
} from "../board-shortcuts";

export const boardShortcutDefinitions: Array<{
  id: BoardShortcutId;
  label: string;
  group: string;
}> = [
  { id: "commandPalette", label: "打开命令面板", group: "界面" },
  { id: "undo", label: "撤销", group: "编辑" },
  { id: "redo", label: "重做", group: "编辑" },
  { id: "duplicate", label: "复制对象", group: "编辑" },
  { id: "copy", label: "复制到白板剪贴板", group: "编辑" },
  { id: "paste", label: "粘贴白板对象", group: "编辑" },
  { id: "delete", label: "删除对象", group: "编辑" },
  { id: "group", label: "组合", group: "对象" },
  { id: "ungroup", label: "取消组合", group: "对象" },
  { id: "parent", label: "建立父子关系", group: "对象" },
  { id: "unparent", label: "解除父级", group: "对象" },
  { id: "resetTransform", label: "重置变换", group: "变换" },
  { id: "comment", label: "添加或编辑对象评论", group: "对象" },
  { id: "fitAll", label: "适应全部对象", group: "视图" },
  { id: "fitSelection", label: "适应选区", group: "视图" },
  { id: "focus", label: "聚焦选中图片", group: "视图" },
  { id: "toggleGrid", label: "显示或隐藏网格", group: "视图" },
];

interface BoardShortcutSettingsProps {
  bindings: BoardShortcutBindings;
  onChange(bindings: BoardShortcutBindings): void;
  onClose(): void;
}

export function BoardShortcutSettings({
  bindings,
  onChange,
  onClose,
}: BoardShortcutSettingsProps) {
  const [recordingId, setRecordingId] = useState<BoardShortcutId | null>(null);
  const [error, setError] = useState("");

  const assign = (id: BoardShortcutId, shortcut: string) => {
    const conflict = findShortcutConflict(bindings, id, shortcut);
    if (conflict) {
      const definition = boardShortcutDefinitions.find(
        (item) => item.id === conflict,
      );
      setError(`“${shortcut}”已用于“${definition?.label ?? conflict}”`);
      return;
    }
    onChange({ ...bindings, [id]: shortcut });
    setError("");
    setRecordingId(null);
  };

  const close = () => {
    setRecordingId(null);
    onClose();
  };

  return (
    <div className="shortcut-settings-backdrop" onMouseDown={close}>
      <section
        className="shortcut-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">白板设置</span>
            <h2 id="shortcut-settings-title">快捷键</h2>
            <p>覆盖白板触发命令；鼠标拖动和连续操作保持原有方式。</p>
          </div>
          <button type="button" onClick={close} aria-label="关闭快捷键设置">
            <X size={17} />
          </button>
        </header>
        {error && (
          <div className="shortcut-settings-error" role="alert">
            {error}
          </div>
        )}
        <div className="shortcut-settings-list">
          {boardShortcutDefinitions.map((definition) => {
            const recording = recordingId === definition.id;
            const shortcut = bindings[definition.id];
            return (
              <div className="shortcut-settings-row" key={definition.id}>
                <span>
                  <strong>{definition.label}</strong>
                  <small>
                    {definition.group} · 默认 {defaultBoardShortcuts[definition.id]}
                  </small>
                </span>
                <button
                  className={`shortcut-capture ${recording ? "recording" : ""}`}
                  type="button"
                  onClick={() => {
                    setError("");
                    setRecordingId(definition.id);
                  }}
                  onKeyDown={(event) => {
                    if (!recording) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setRecordingId(null);
                      return;
                    }
                    const next = shortcutFromKeyboardEvent(event);
                    if (!next) return;
                    if (
                      ["Tab", "F11", "Ctrl+K", "Ctrl+Shift+C", "Ctrl+Shift+R"]
                        .includes(next)
                    ) {
                      setError(`“${next}”由全应用或系统功能保留`);
                      return;
                    }
                    assign(definition.id, next);
                  }}
                  aria-label={`修改${definition.label}快捷键`}
                >
                  {recording ? "请按新组合键…" : shortcut || "未设置"}
                </button>
                <button
                  type="button"
                  onClick={() => assign(definition.id, "")}
                  aria-label={`清除${definition.label}快捷键`}
                  disabled={!shortcut}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <footer>
          <span>点击当前键位后直接按新组合键，Esc 取消录入。</span>
          <button
            type="button"
            onClick={() => {
              onChange(loadBoardShortcuts(null));
              setRecordingId(null);
              setError("");
            }}
          >
            <RotateCcw size={15} />
            恢复全部默认值
          </button>
        </footer>
      </section>
    </div>
  );
}
