// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectMenu } from "../../../../src/renderer/components/SelectMenu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const options = [
  { value: "original", label: "原始尺寸" },
  { value: "half", label: "半尺寸 (1/2)" },
  { value: "quarter", label: "四分之一尺寸 (1/4)" },
] as const;

describe("SelectMenu", () => {
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function render(onValueChange = vi.fn()) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <SelectMenu
          ariaLabel="缩放尺寸"
          value="original"
          options={options}
          onValueChange={onValueChange}
        />,
      );
    });
    return {
      host,
      onValueChange,
      trigger: host.querySelector<HTMLButtonElement>("[role='combobox']")!,
    };
  }

  it("portals the menu and selects an option", () => {
    const view = render();

    act(() => view.trigger.click());

    const menu = document.body.querySelector<HTMLElement>("[role='listbox']");
    const menuOptions = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("[role='option']"),
    );
    expect(menu).not.toBeNull();
    expect(view.host.contains(menu)).toBe(false);
    expect(menuOptions).toHaveLength(3);
    expect(menuOptions[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => menuOptions[1]?.click());

    expect(view.onValueChange).toHaveBeenCalledWith("half");
    expect(document.body.querySelector("[role='listbox']")).toBeNull();
  });

  it("supports keyboard navigation and selection", () => {
    const view = render();

    act(() => {
      view.trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      view.trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      view.trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(view.onValueChange).toHaveBeenCalledWith("half");
    expect(view.trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
