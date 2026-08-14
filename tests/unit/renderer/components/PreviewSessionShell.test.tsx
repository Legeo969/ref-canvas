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

  it("keeps focus and fullscreen mutually exclusive and returns to the plain mode after exit", async () => {
    installFullscreenMock();
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);

    // 普通模式 → 全屏：只亮全屏。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");

    // 全屏中点击聚焦 = 退出全屏，不进入聚焦。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");

    // 普通模式 → 聚焦：只亮聚焦。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("true");

    // 聚焦中进入全屏：聚焦被清除，只亮全屏（不再叠加）。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");

    // 退出全屏回到普通模式，不残留聚焦。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="退出全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("clears focus when fullscreen lands after a pending toggle race", async () => {
    // 全屏请求 pending 期间用户点了聚焦：全屏生效时必须清除聚焦，
    // 不能出现两个沉浸按钮同时激活。
    installFullscreenMock();
    let resolveFullscreen: (() => void) | null = null;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => new Promise<void>((resolve) => {
        resolveFullscreen = resolve;
      })),
    });
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    // 请求尚未落地：此时聚焦可用并已被用户点亮。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    // 全屏随后生效（触发 fullscreenchange）：聚焦必须被清除。
    await act(async () => {
      fullscreenElement = host.querySelector(".preview-session-shell");
      document.dispatchEvent(new Event("fullscreenchange"));
      resolveFullscreen?.();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
  });

  it("restores focus when the fullscreen request is rejected", async () => {
    installFullscreenMock();
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => { throw new Error("denied"); }),
    });
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("true");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("unwinds Escape in fullscreen then close order without double handling", async () => {
    installFullscreenMock();
    const onClose = vi.fn();
    const host = await render(<SessionHarness assetKey="a" onClose={onClose} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
      await Promise.resolve();
    });
    // 聚焦与全屏互斥：进入全屏时聚焦被清除，不会两个按钮同时激活。
    expect(host.querySelector('[aria-label="退出全屏预览"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="全屏预览"]')).toBeTruthy();

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
    // 全屏生效时聚焦已被互斥清除，退出全屏回到普通模式。
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeTruthy();
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
