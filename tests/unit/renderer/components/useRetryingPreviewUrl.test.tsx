// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_ATTEMPT_TIMEOUT_MS,
  PREVIEW_RETRY_DELAYS_MS,
  previewUrlWithRetry,
  resetReadyPreviewCache,
  useRetryingPreviewUrl,
} from "../../../../src/renderer/components/useRetryingPreviewUrl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useRetryingPreviewUrl", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    resetReadyPreviewCache();
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
    // 只推进旧重试窗口：新 source 的重试定时器被取消，stall 超时（60s）未到。
    await act(async () => vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAYS_MS[0]));
    expect(host.firstElementChild?.getAttribute("data-url")).toBe("refbrowse://thumbnail/new");
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("loading");
  });

  it("times out a stalled request and converges through bounded retries to failed", async () => {
    vi.useFakeTimers();
    const { host } = render("refbrowse://thumbnail/token");
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("loading");
    // 主进程迟迟不返回（worker 卡死等）：stall 超时 → waiting → 重试，循环
    // 有界，最终收敛到明确的 failed 态，而不是永远「正在生成预览」。
    for (let index = 0; index < PREVIEW_RETRY_DELAYS_MS.length; index += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(PREVIEW_ATTEMPT_TIMEOUT_MS));
      expect(host.firstElementChild?.getAttribute("data-status")).toBe("waiting");
      await act(async () => vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAYS_MS[index]));
      expect(host.firstElementChild?.getAttribute("data-url")).toContain(
        `previewRetry=${index + 1}`,
      );
    }
    await act(async () => vi.advanceTimersByTimeAsync(PREVIEW_ATTEMPT_TIMEOUT_MS));
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("failed");
  });

  it("does not stall-timeout a preview that already became ready", async () => {
    vi.useFakeTimers();
    const { host } = render("refbrowse://thumbnail/token");
    await act(async () => host.querySelector<HTMLButtonElement>("button:nth-of-type(1)")?.click());
    await act(async () => vi.advanceTimersByTimeAsync(PREVIEW_ATTEMPT_TIMEOUT_MS * 2));
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("ready");
    expect(host.firstElementChild?.getAttribute("data-url")).toBe("refbrowse://thumbnail/token");
  });

  it("remounts a previously-loaded source straight to ready (no loading flash)", () => {
    // 「切窗口回来/虚拟网格重挂」场景：同一 URL 本会话已 ready，重挂后直接
    // ready 起步，不再闪 loading 占位图（卡片重挂是虚拟化的正常行为）。
    const first = render("refbrowse://thumbnail/token");
    expect(first.host.firstElementChild?.getAttribute("data-status")).toBe("loading");
    act(() => first.host.querySelector<HTMLButtonElement>("button:nth-of-type(1)")?.click());
    expect(first.host.firstElementChild?.getAttribute("data-status")).toBe("ready");

    act(() => first.root.unmount());
    roots.splice(roots.indexOf(first.root), 1);
    document.body.replaceChildren();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    function Harness2({ value }: { value: string | null }) {
      const preview = useRetryingPreviewUrl(value);
      return <div data-status={preview.status}>{value ?? ""}</div>;
    }
    act(() => root.render(<Harness2 value="refbrowse://thumbnail/token" />));
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("ready");
  });
});
