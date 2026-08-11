// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "../../../../src/shared/contracts";
import {
  PreviewSessionModeButtons,
  usePreviewSessionMode,
} from "../../../../src/renderer/components/PreviewSessionMode";
import {
  PreviewSessionShell,
  PreviewSessionTitle,
  PreviewSurface,
  previewRendererKind,
} from "../../../../src/renderer/components/PreviewSessionShell";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function SessionHarness({ assetKey, onClose }: { assetKey: string; onClose(): void }) {
  const session = usePreviewSessionMode(assetKey, onClose);
  return (
    <PreviewSessionShell
      elementRef={session.rootRef}
      focused={session.focused}
      fullscreen={session.fullscreen}
    >
      <div data-testid="nested-renderer" />
      <PreviewSessionModeButtons
        focused={session.focused}
        fullscreen={session.fullscreen}
        onToggleFocus={session.toggleFocus}
        onToggleFullscreen={() => void session.toggleFullscreen()}
      />
    </PreviewSessionShell>
  );
}

function asset(kind: AssetRecord["kind"], extension: string): Pick<AssetRecord, "kind" | "extension"> {
  return { kind, extension };
}

describe("shared preview session", () => {
  let root: Root | null = null;
  let fullscreenElement: Element | null = null;

  function installFullscreenMock() {
    fullscreenElement = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = document.querySelector(".preview-session-shell");
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
  }

  async function render(ui: ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(ui));
    return host;
  }

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("keeps focus and fullscreen independent and preserves focus after fullscreen exit", async () => {
    installFullscreenMock();
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="退出全屏预览"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="退出全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("true");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("unwinds Escape in fullscreen, focus, close order without double handling", async () => {
    installFullscreenMock();
    const onClose = vi.fn();
    const host = await render(<SessionHarness assetKey="a" onClose={onClose} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="退出聚焦预览"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats a fullscreen renderer descendant as session-owned", async () => {
    installFullscreenMock();
    const onClose = vi.fn();
    const host = await render(<SessionHarness assetKey="a" onClose={onClose} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    fullscreenElement = host.querySelector('[data-testid="nested-renderer"]');
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(host.querySelector('[aria-label="退出全屏预览"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-label="退出聚焦预览"]')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not claim fullscreen owned outside the session", async () => {
    installFullscreenMock();
    const outside = document.createElement("div");
    document.body.append(outside);
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    fullscreenElement = outside;
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeTruthy();
  });

  it("resets focus and exits owned fullscreen when the asset changes", async () => {
    installFullscreenMock();
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    fullscreenElement = host.querySelector('[data-testid="nested-renderer"]');
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
    await act(async () => {
      root?.render(<SessionHarness assetKey="b" onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("keeps fullscreen inactive when requestFullscreen rejects", async () => {
    installFullscreenMock();
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => { throw new Error("denied"); }),
    });
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector('[aria-label="全屏预览"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("exits descendant fullscreen during session unmount", async () => {
    installFullscreenMock();
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    fullscreenElement = host.querySelector('[data-testid="nested-renderer"]');
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
    await act(async () => root?.unmount());
    root = null;
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("uses the same title and surface slots for image, HDR, video and generic renderers", async () => {
    const cases = [
      asset("image", "png"),
      asset("image", "exr"),
      asset("video", "mp4"),
      asset("generic", "zip"),
    ];
    const host = await render(
      <PreviewSessionShell>
        <PreviewSessionTitle title="sample" subtitle="metadata" />
        {cases.map((item) => {
          const renderer = previewRendererKind(item);
          return <PreviewSurface key={renderer} renderer={renderer}><span>{renderer}</span></PreviewSurface>;
        })}
      </PreviewSessionShell>,
    );
    expect(host.querySelectorAll(".preview-session-shell")).toHaveLength(1);
    expect(host.querySelector(".preview-session-title-region")).toBeTruthy();
    expect([...host.querySelectorAll<HTMLElement>(".preview-surface")].map((node) => node.dataset.previewRenderer))
      .toEqual(["image", "hdr", "video", "generic"]);
  });
});
