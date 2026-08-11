// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_RETRY_DELAYS_MS,
  previewUrlWithRetry,
  useRetryingPreviewUrl,
} from "../../../../src/renderer/components/useRetryingPreviewUrl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useRetryingPreviewUrl", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function render(source: string | null) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    function Harness({ value }: { value: string | null }) {
      const preview = useRetryingPreviewUrl(value);
      return (
        <div data-status={preview.status} data-url={preview.url ?? ""}>
          <button onClick={preview.markReady}>ready</button>
          <button onClick={preview.markError}>error</button>
          <button onClick={preview.retry}>retry</button>
        </div>
      );
    }
    act(() => root.render(<Harness value={source} />));
    return { host, root, Harness };
  }

  it("adds a retry nonce without changing the existing query", () => {
    expect(previewUrlWithRetry("refbrowse://thumbnail/t?channel=R", 2)).toBe(
      "refbrowse://thumbnail/t?channel=R&previewRetry=2",
    );
  });

  it("recovers after a transient failure and stops retrying when ready", async () => {
    vi.useFakeTimers();
    const { host } = render("refbrowse://thumbnail/token");
    await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(2)")?.click());
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("waiting");
    await act(async () => vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAYS_MS[0]));
    expect(host.firstElementChild?.getAttribute("data-url")).toContain("previewRetry=1");
    await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(1)")?.click());
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("ready");
  });

  it("exhausts bounded retries and manual retry starts a fresh cycle", async () => {
    vi.useFakeTimers();
    const { host } = render("refbrowse://thumbnail/token");
    for (const delay of PREVIEW_RETRY_DELAYS_MS) {
      await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(2)")?.click());
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    }
    await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(2)")?.click());
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("failed");
    const before = host.firstElementChild?.getAttribute("data-url");
    await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(3)")?.click());
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("loading");
    expect(host.firstElementChild?.getAttribute("data-url")).not.toBe(before);
  });

  it("cancels the pending retry when the source changes", async () => {
    vi.useFakeTimers();
    const { host, root, Harness } = render("refbrowse://thumbnail/old");
    await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(2)")?.click());
    await act(async () => root.render(<Harness value="refbrowse://thumbnail/new" />));
    await act(async () => vi.runAllTimersAsync());
    expect(host.firstElementChild?.getAttribute("data-url")).toBe("refbrowse://thumbnail/new");
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("loading");
  });
});
