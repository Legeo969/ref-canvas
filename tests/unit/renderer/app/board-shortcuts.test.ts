import { describe, expect, it } from "vitest";
import {
  defaultBoardShortcuts,
  findShortcutConflict,
  loadBoardShortcuts,
  shortcutFromKeyboardEvent,
  shortcutMatches,
} from "../../../../src/renderer/app/board-shortcuts";

function keyboard(
  overrides: Partial<Parameters<typeof shortcutFromKeyboardEvent>[0]> = {},
) {
  return {
    key: "z",
    code: "KeyZ",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("board shortcuts", () => {
  it("normalizes modifiers and uses physical letter codes for non-English input", () => {
    expect(
      shortcutFromKeyboardEvent(
        keyboard({ key: "脏", code: "KeyZ", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("Ctrl+Shift+Z");
    expect(shortcutFromKeyboardEvent(keyboard({ key: " ", code: "Space" }))).toBe(
      "Space",
    );
  });

  it("matches exact modifiers and restores defaults around stored overrides", () => {
    expect(
      shortcutMatches(
        keyboard({ key: "z", code: "KeyZ", ctrlKey: true }),
        "Ctrl+Z",
      ),
    ).toBe(true);
    expect(
      shortcutMatches(
        keyboard({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }),
        "Ctrl+Z",
      ),
    ).toBe(false);
    expect(loadBoardShortcuts({ undo: "Alt+Z", redo: 42 })).toEqual({
      ...defaultBoardShortcuts,
      undo: "Alt+Z",
    });
  });

  it("detects conflicts while allowing a shortcut to remain on its own action", () => {
    const bindings = loadBoardShortcuts({ undo: "Alt+Z" });
    expect(findShortcutConflict(bindings, "redo", "Alt+Z")).toBe("undo");
    expect(findShortcutConflict(bindings, "undo", "Alt+Z")).toBeNull();
    expect(findShortcutConflict(bindings, "redo", "")).toBeNull();
  });
});
