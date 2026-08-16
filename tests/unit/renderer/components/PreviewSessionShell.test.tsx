// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
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

setLanguage("zh-CN"); // 全屏/聚焦按钮已迁移到 i18n；断言基于简体中文。

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
  let presentationListeners: Set<(enabled: boolean) => void>;

  /**
   * 全屏预览走窗口级系统全屏：mock 主进程 setPresentationMode。契约与
   * system-ipc.ts 一致——达到请求状态时返回请求值（进入成功 → true、
   * 退出成功 → false），超时返回实际状态；成功时回推 presentation-mode-changed。
   */
  function installFullscreenMock() {
    presentationListeners = new Set();
    (window as unknown as { refCanvas?: unknown }).refCanvas = {
      system: {
        setPresentationMode: vi.fn(async (enabled: boolean) => {
          presentationListeners.forEach((listener) => listener(enabled));
          return enabled;
        }),
        onPresentationModeChanged: vi.fn((listener: (enabled: boolean) => void) => {
          presentationListeners.add(listener);
          return () => presentationListeners.delete(listener);
        }),
      },
    };
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
    (window as unknown as { refCanvas?: unknown }).refCanvas = undefined;
    vi.restoreAllMocks();
  });

  it("keeps focus and fullscreen mutually exclusive and returns to the plain mode after exit", async () => {
    installFullscreenMock();
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);

    // 普通模式 → 全屏：窗口级系统全屏生效，只亮全屏。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");

    // 全屏中点击聚焦 = 退出全屏，不进入聚焦。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");

    // 普通模式 → 聚焦：只亮聚焦。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("true");

    // 聚焦中进入全屏：聚焦被互斥清除，只亮全屏（不再叠加）。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");

    // 退出全屏回到普通模式，不残留聚焦。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="退出全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("keeps focus when the fullscreen request fails", async () => {
    installFullscreenMock();
    // 主进程拒绝全屏：不回推 presentation-mode-changed。
    (window as unknown as { refCanvas: { system: { setPresentationMode: ReturnType<typeof vi.fn> } } })
      .refCanvas.system.setPresentationMode.mockImplementation(async () => false);
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    // 请求失败：聚焦保留，全屏不生效。
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("true");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("stays exited when the exit request succeeds without a leave event", async () => {
    installFullscreenMock();
    // 退出成功且 leave-full-screen 事件丢失（浮动预览窗口无该监听）：
    // 主进程返回 false（= 请求值），UI 必须保持退出，绝不回滚回全屏。
    (window as unknown as { refCanvas: { system: { setPresentationMode: ReturnType<typeof vi.fn> } } })
      .refCanvas.system.setPresentationMode.mockImplementation(async (enabled: boolean) => enabled);
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="退出全屏预览"]')?.click();
    });
    // 回归：退出成功返回 false 时不得触发 rollback（旧实现 applied === false
    // 把「退出成功」误判为「被拒绝」，回滚导致全屏 UI 回弹/卡死）。
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("keeps the fullscreen overlay when the exit request fails", async () => {
    installFullscreenMock();
    // 退出失败/超时：主进程仍处于全屏（返回 true），不回推事件。
    // UI 必须保持全屏态，不能出现「窗口还全屏、面板已退出」的失步。
    (window as unknown as { refCanvas: { system: { setPresentationMode: ReturnType<typeof vi.fn> } } })
      .refCanvas.system.setPresentationMode.mockImplementation(async () => true);
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="退出全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
  });

  it("applies the fullscreen overlay optimistically when the window event never arrives", async () => {
    installFullscreenMock();
    // 主进程确认全屏生效（返回 true）但不回推 presentation-mode-changed：
    // 乐观更新必须让 overlay 类立即加上（回归：全屏后看到主界面内容）。
    (window as unknown as { refCanvas: { system: { setPresentationMode: ReturnType<typeof vi.fn> } } })
      .refCanvas.system.setPresentationMode.mockImplementation(async () => true);
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
    // Escape 退出同样乐观复位。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("false");
  });

  it("unwinds Escape in fullscreen then close order without double handling", async () => {
    installFullscreenMock();
    const onClose = vi.fn();
    const host = await render(<SessionHarness assetKey="a" onClose={onClose} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    // 聚焦与全屏互斥：进入全屏时聚焦被清除，不会两个按钮同时激活。
    expect(host.querySelector('[aria-label="退出全屏预览"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="聚焦预览"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="全屏预览"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets focus but keeps window fullscreen when the asset changes", async () => {
    installFullscreenMock();
    const host = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="聚焦预览"]')?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
    await act(async () => {
      root?.render(<SessionHarness assetKey="b" onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // 资产切换只重置聚焦；全屏是窗口级状态，不随资产变化退出（否则
    // QuickPreview 等其它实例的 assetKey 变化会把刚进入的全屏闪掉）。
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-focused")).toBe("false");
    expect(host.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
  });

  it("keeps window fullscreen when another session's asset changes", async () => {
    // 主窗口全屏中，QuickPreview 等其它实例的 assetKey 随 hover 变化，
    // 不得把窗口全屏退掉（「全屏闪一下」回归）。
    installFullscreenMock();
    const hostA = await render(<SessionHarness assetKey="a" onClose={() => undefined} />);
    await render(<SessionHarness assetKey="hover-1" onClose={() => undefined} />);
    await act(async () => {
      hostA.querySelector<HTMLButtonElement>('[aria-label="全屏预览"]')?.click();
    });
    expect(hostA.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
    await act(async () => {
      root?.render(<SessionHarness assetKey="hover-2" onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // hostB 的 assetKey 变化不应触发 setPresentationMode(false)。
    expect(hostA.querySelector(".preview-session-shell")?.getAttribute("data-preview-fullscreen")).toBe("true");
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
