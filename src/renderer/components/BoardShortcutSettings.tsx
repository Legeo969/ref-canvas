import { RotateCcw, X } from "lucide-react";
import { useState } from "react";
import {
  defaultBoardShortcuts,
  findShortcutConflict,
  loadBoardShortcuts,
  shortcutFromKeyboardEvent,
  type BoardShortcutBindings,
  type BoardShortcutId,
} from "../app/board-shortcuts";
import { translate, type MessageKey } from "../app/i18n";

export const boardShortcutDefinitions: Array<{
  id: BoardShortcutId;
  labelKey: MessageKey;
  groupKey: MessageKey;
}> = [
  { id: "commandPalette", labelKey: "board.openCommandPalette", groupKey: "board.shortcutGroupInterface" },
  { id: "undo", labelKey: "board.undo", groupKey: "board.groupEdit" },
  { id: "redo", labelKey: "board.redo", groupKey: "board.groupEdit" },
  { id: "duplicate", labelKey: "board.duplicate", groupKey: "board.groupEdit" },
  { id: "copy", labelKey: "board.copyClipboard", groupKey: "board.groupEdit" },
  { id: "paste", labelKey: "board.pasteObject", groupKey: "board.groupEdit" },
  { id: "delete", labelKey: "board.delete", groupKey: "board.groupEdit" },
  { id: "group", labelKey: "board.group", groupKey: "board.groupObject" },
  { id: "ungroup", labelKey: "board.ungroup", groupKey: "board.groupObject" },
  { id: "parent", labelKey: "board.parent", groupKey: "board.groupObject" },
  { id: "unparent", labelKey: "board.unparent", groupKey: "board.groupObject" },
  { id: "resetTransform", labelKey: "board.shortcutResetTransform", groupKey: "board.groupTransform" },
  { id: "comment", labelKey: "board.shortcutComment", groupKey: "board.groupObject" },
  { id: "fitAll", labelKey: "board.fitAll", groupKey: "board.groupView" },
  { id: "fitSelection", labelKey: "board.fitSelection", groupKey: "board.groupView" },
  { id: "focus", labelKey: "board.focusSelection", groupKey: "board.groupView" },
  { id: "toggleGrid", labelKey: "board.shortcutToggleGrid", groupKey: "board.groupView" },
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
      setError(
        translate("board.shortcutConflict")
          .replace("{shortcut}", shortcut)
          .replace("{label}", definition ? translate(definition.labelKey) : conflict),
      );
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
            <span className="eyebrow">{translate("board.shortcutSettingsEyebrow")}</span>
            <h2 id="shortcut-settings-title">{translate("board.shortcuts")}</h2>
            <p>{translate("board.shortcutSettingsDescription")}</p>
          </div>
          <button type="button" onClick={close} aria-label={translate("board.shortcutSettingsClose")}>
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
            const label = translate(definition.labelKey);
            const group = translate(definition.groupKey);
            return (
              <div className="shortcut-settings-row" key={definition.id}>
                <span>
                  <strong>{label}</strong>
                  <small>
                    {translate("board.shortcutDefault")
                      .replace("{group}", group)
                      .replace("{default}", defaultBoardShortcuts[definition.id])}
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
                      setError(translate("board.shortcutReserved").replace("{shortcut}", next));
                      return;
                    }
                    assign(definition.id, next);
                  }}
                  aria-label={translate("board.shortcutModify").replace("{label}", label)}
                >
                  {recording ? translate("board.shortcutRecording") : shortcut || translate("board.shortcutUnset")}
                </button>
                <button
                  type="button"
                  onClick={() => assign(definition.id, "")}
                  aria-label={translate("board.shortcutClear").replace("{label}", label)}
                  disabled={!shortcut}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <footer>
          <span>{translate("board.shortcutHint")}</span>
          <button
            type="button"
            onClick={() => {
              onChange(loadBoardShortcuts(null));
              setRecordingId(null);
              setError("");
            }}
          >
            <RotateCcw size={15} />
            {translate("board.shortcutResetAll")}
          </button>
        </footer>
      </section>
    </div>
  );
}
