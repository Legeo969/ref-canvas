import { describe, expect, it, vi } from "vitest";
import { createCaptureSession } from "../../../src/main/services/capture-session";

function lockableWindow(overrides: Partial<{ focusable: boolean; movable: boolean }> = {}) {
  const state = { focusable: overrides.focusable ?? true, movable: overrides.movable ?? true, destroyed: false };
  return {
    state,
    isDestroyed: () => state.destroyed,
    isFocusable: () => state.focusable,
    isMovable: () => state.movable,
    setFocusable: vi.fn((value: boolean) => {
      state.focusable = value;
    }),
    setMovable: vi.fn((value: boolean) => {
      state.movable = value;
    }),
  };
}

function overlayWindow() {
  return {
    focus: vi.fn(),
    isDestroyed: () => false,
  };
}

/** 收集 onWindowFocus 注入的监听器，测试里直接回调模拟"窗口被聚焦"。 */
function focusTap() {
  let listener: ((window: unknown) => void) | null = null;
  return {
    emit(window: unknown) {
      listener?.(window);
    },
    onWindowFocus: (listen: (window: unknown) => void) => {
      listener = listen;
      return () => {
        listener = null;
      };
    },
  };
}

describe("capture-session", () => {
  it("begin locks every host window", () => {
    const host = lockableWindow();
    const board = lockableWindow();
    const tap = focusTap();
    const overlay = overlayWindow();
    const session = createCaptureSession(
      { getHostWindows: () => [host, board], getFocusOverlay: () => overlay },
      { onWindowFocus: tap.onWindowFocus },
    );

    expect(session.begin()).toBe(true);
    expect(session.isActive()).toBe(true);
    expect(host.state.focusable).toBe(false);
    expect(host.state.movable).toBe(false);
    expect(board.state.focusable).toBe(false);
    expect(board.state.movable).toBe(false);
  });

  it("skips destroyed hosts instead of crashing", () => {
    const alive = lockableWindow();
    const dead = lockableWindow();
    dead.state.destroyed = true;
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [alive, dead], getFocusOverlay: () => null },
      { onWindowFocus: tap.onWindowFocus },
    );

    expect(session.begin()).toBe(true);
    expect(dead.setFocusable).not.toHaveBeenCalled();
    expect(alive.setFocusable).toHaveBeenCalledWith(false);
  });

  it("begin returns false while a session is active", () => {
    const host = lockableWindow();
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [host], getFocusOverlay: () => null },
      { onWindowFocus: tap.onWindowFocus },
    );

    expect(session.begin()).toBe(true);
    expect(session.begin()).toBe(false);
    // 第二次 begin 不应把锁定当成"新会话"重放一遍。
    expect(host.setFocusable).toHaveBeenCalledTimes(1);
    expect(host.setMovable).toHaveBeenCalledTimes(1);
  });

  it("end restores the recorded per-window values", () => {
    // movable:false 是真实场景：某些宿主窗口可能本来就不可拖。
    const pinned = lockableWindow({ focusable: false, movable: true });
    const plain = lockableWindow();
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [pinned, plain], getFocusOverlay: () => null },
      { onWindowFocus: tap.onWindowFocus },
    );

    session.begin();
    session.end();
    expect(pinned.state.focusable).toBe(false);
    expect(pinned.state.movable).toBe(true);
    expect(plain.state.focusable).toBe(true);
    expect(plain.state.movable).toBe(true);
  });

  it("end is idempotent and skips windows destroyed mid-session", () => {
    const host = lockableWindow();
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [host], getFocusOverlay: () => null },
      { onWindowFocus: tap.onWindowFocus },
    );

    session.begin();
    host.state.destroyed = true;
    expect(() => {
      session.end();
      session.end();
    }).not.toThrow();
    expect(session.isActive()).toBe(false);
  });

  it("a new session can start after end", () => {
    const host = lockableWindow();
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [host], getFocusOverlay: () => null },
      { onWindowFocus: tap.onWindowFocus },
    );

    session.begin();
    session.end();
    expect(session.begin()).toBe(true);
    expect(host.state.movable).toBe(false);
    session.end();
    expect(host.state.movable).toBe(true);
  });

  it("clamps focus back to the overlay when a host gains focus", () => {
    const host = lockableWindow();
    const overlay = overlayWindow();
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [host], getFocusOverlay: () => overlay },
      { onWindowFocus: tap.onWindowFocus },
    );

    session.begin();
    tap.emit(host);
    expect(overlay.focus).toHaveBeenCalledTimes(1);

    // 非宿主窗口（其他应用/覆盖窗自身）聚焦时不抢焦点。
    tap.emit({ some: "other window" });
    expect(overlay.focus).toHaveBeenCalledTimes(1);

    // 会话结束后不再钳制。
    session.end();
    tap.emit(host);
    expect(overlay.focus).toHaveBeenCalledTimes(1);
  });

  it("tolerates a destroyed overlay during focus clamping", () => {
    const host = lockableWindow();
    const overlay = { ...overlayWindow(), isDestroyed: () => true };
    const tap = focusTap();
    const session = createCaptureSession(
      { getHostWindows: () => [host], getFocusOverlay: () => overlay },
      { onWindowFocus: tap.onWindowFocus },
    );

    session.begin();
    expect(() => tap.emit(host)).not.toThrow();
  });
});
