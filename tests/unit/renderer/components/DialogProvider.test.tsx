// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DialogProvider, useDialog } from "../../../../src/renderer/components/DialogProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("DialogProvider textarea", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  it("preserves multiline input and submits with Ctrl+Enter", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    function Harness() {
      const dialog = useDialog();
      const [result, setResult] = useState("");
      return (
        <>
          <button
            onClick={async () => {
              const values = await dialog.requestForm({
                title: "编辑对象评论",
                fields: [
                  {
                    name: "comment",
                    label: "评论",
                    type: "textarea",
                    initialValue: "第一行\n第二行",
                    maxLength: 5000,
                  },
                ],
              });
              setResult(values?.comment ?? "");
            }}
          >
            打开
          </button>
          <output>{result}</output>
        </>
      );
    }

    await act(async () => {
      root.render(
        <DialogProvider>
          <Harness />
        </DialogProvider>,
      );
    });
    await act(async () => {
      (document.querySelector("button") as HTMLButtonElement).click();
    });

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("第一行\n第二行");
    expect(document.querySelector(".form-field-count")?.textContent).toContain(
      "7 / 5000",
    );

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "构图方向\n降低饱和度");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("output")?.textContent).toBe(
      "构图方向\n降低饱和度",
    );
  });

  it("submits the selected option value", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    function Harness() {
      const dialog = useDialog();
      const [result, setResult] = useState("");
      return (
        <>
          <button
            onClick={async () => {
              const values = await dialog.requestForm({
                title: "添加到文件夹",
                fields: [
                  {
                    name: "collection",
                    label: "文件夹",
                    type: "select",
                    initialValue: "collection-1",
                    options: [
                      { value: "collection-1", label: "参考" },
                      { value: "collection-2", label: "归档" },
                    ],
                  },
                ],
              });
              setResult(values?.collection ?? "");
            }}
          >
            打开
          </button>
          <output>{result}</output>
        </>
      );
    }

    await act(async () => {
      root.render(
        <DialogProvider>
          <Harness />
        </DialogProvider>,
      );
    });
    await act(async () => {
      (document.querySelector("button") as HTMLButtonElement).click();
    });

    await act(async () => {
      const combobox = document.querySelector('[role="combobox"]') as HTMLButtonElement;
      combobox.click();
    });
    await act(async () => {
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((item) => item.textContent?.includes("归档"));
      option?.click();
    });
    await act(async () => {
      (document.querySelector("button[type=submit]") as HTMLButtonElement).click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(document.querySelector("output")?.textContent).toBe("collection-2");
  });
});
