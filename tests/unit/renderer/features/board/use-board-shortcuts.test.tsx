// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBoardShortcuts } from "../../../../../src/renderer/app/board-shortcuts";
import {
  useBoardShortcuts,
  type BoardShortcutCommand,
} from "../../../../../src/renderer/features/board/use-board-shortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function ShortcutHarness({
  dispatch,
}: {
  dispatch(command: BoardShortcutCommand): void;
}) {
  useBoardShortcuts(
    loadBoardShortcuts(null),
    {
      gestureActive: false,
      colorSampling: false,
      commandPaletteOpen: false,
      shortcutSettingsOpen: false,
      focused: false,
      pureRef: true,
      hasSelection: false,
      clipboardHasItems: false,
    },
    dispatch,
  );
  return null;
}

describe("useBoardShortcuts", () => {
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("leaves Alt+S unhandled after focus playback is removed", async () => {
    const dispatch = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<ShortcutHarness dispatch={dispatch} />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
