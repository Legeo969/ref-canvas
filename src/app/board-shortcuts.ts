export const defaultBoardShortcuts = {
  commandPalette: "Ctrl+Shift+P",
  undo: "Ctrl+Z",
  redo: "Ctrl+Y",
  duplicate: "Ctrl+D",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  group: "Ctrl+G",
  ungroup: "Ctrl+Shift+G",
  resetTransform: "Ctrl+Shift+T",
  fitAll: "Ctrl+Shift+0",
  fitSelection: "Ctrl+Alt+0",
  focus: "Space",
  comment: "Alt+C",
  parent: "P",
  unparent: "Shift+P",
  delete: "Delete",
  toggleGrid: "G",
} as const;

export type BoardShortcutId = keyof typeof defaultBoardShortcuts;
export type BoardShortcutBindings = Record<BoardShortcutId, string>;

interface KeyboardShortcutEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

const specialKeys: Record<string, string> = {
  " ": "Space",
  Spacebar: "Space",
  Escape: "Esc",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};

export function shortcutFromKeyboardEvent(
  event: KeyboardShortcutEvent,
): string | null {
  if (event.isComposing) return null;
  let key = specialKeys[event.key] ?? event.key;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;
  if (key.length === 1) key = key.toLocaleUpperCase();

  return [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
    key,
  ].filter(Boolean).join("+");
}

export function shortcutMatches(
  event: KeyboardShortcutEvent,
  shortcut: string,
): boolean {
  return Boolean(shortcut) && shortcutFromKeyboardEvent(event) === shortcut;
}

export function loadBoardShortcuts(value: unknown): BoardShortcutBindings {
  const stored =
    value && typeof value === "object"
      ? (value as Partial<Record<BoardShortcutId, unknown>>)
      : {};
  return Object.fromEntries(
    Object.entries(defaultBoardShortcuts).map(([id, fallback]) => {
      const candidate = stored[id as BoardShortcutId];
      return [id, typeof candidate === "string" ? candidate : fallback];
    }),
  ) as BoardShortcutBindings;
}

export function findShortcutConflict(
  bindings: BoardShortcutBindings,
  targetId: BoardShortcutId,
  shortcut: string,
): BoardShortcutId | null {
  if (!shortcut) return null;
  return (
    (Object.keys(bindings) as BoardShortcutId[]).find(
      (id) => id !== targetId && bindings[id] === shortcut,
    ) ?? null
  );
}
