import { act } from "react";
import { createRoot } from "react-dom/client";
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardObjectComment } from "../../../../src/renderer/components/BoardObjectComment";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("BoardObjectComment", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  it("shows the saved object comment and exposes an edit action", async () => {
    const onEdit = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <BoardObjectComment
          name="参考图"
          comment={"降低饱和度\n保留轮廓"}
          onEdit={onEdit}
        />,
      );
    });

    expect(host.textContent).toContain("降低饱和度");
    expect(host.textContent).toContain("保留轮廓");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="编辑对象评论"]')?.click();
    });
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
