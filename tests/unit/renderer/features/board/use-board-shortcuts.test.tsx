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
  pureRef = true,
}: {
  dispatch(command: BoardShortcutCommand): void;
  pureRef?: boolean;
}) {
  useBoardShortcuts(
    loadBoardShortcuts(null),
    {
      gestureActive: false,
      colorSampling: false,
      commandPaletteOpen: false,
      shortcutSettingsOpen: false,
      focused: false,
      pureRef,
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

  it("leaves Space to the BoardCanvas pan/focus path instead of toggling focus", async () => {
    const dispatch = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<ShortcutHarness dispatch={dispatch} />);
    });

    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(dispatch).not.toHaveBeenCalledWith("toggleFocus");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "moves a layer down with Ctrl+] and up with Ctrl+[ (pureRef: %s)",
    async (pureRef) => {
      const dispatch = vi.fn();
      const host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => {
        root?.render(<ShortcutHarness dispatch={dispatch} pureRef={pureRef} />);
      });

      const down = new KeyboardEvent("keydown", {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(down);

      const up = new KeyboardEvent("keydown", {
        key: "[",
        code: "BracketLeft",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(up);

      expect(down.defaultPrevented).toBe(true);
      expect(up.defaultPrevented).toBe(true);
      expect(dispatch).toHaveBeenNthCalledWith(1, "moveLayer", true);
      expect(dispatch).toHaveBeenNthCalledWith(2, "moveLayer", false);
    },
  );
});
