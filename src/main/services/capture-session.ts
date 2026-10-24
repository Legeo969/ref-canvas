/**
 * 截图会话的宿主锁定：让"截图进行中"成为真正的模态接管。
 *
 * capture rework 后的区域截图只用一个 alwaysOnTop 覆盖窗"盖住"宿主：
 * 宿主被用户置顶时任务栏一点就浮到覆盖层之上，整条标题栏仍可拖动；
 * 键盘焦点也留在宿主，Win+方向键照样能移动/分屏它。商用截图工具
 * （微信/QQ/Snipaste）的共同规则是——会话期间宿主"不可激活、不可拖"。
 *
 * 这里用 setFocusable(false) + setMovable(false)（先记录原值，退出时
 * 原样恢复）落实这条规则，并钳制焦点：宿主即使被任务栏/Alt+Tab 激活，
 * 键盘焦点也立刻还给覆盖窗口。任何退出路径都必须经过 end()，否则
 * 宿主永久残锁——调用方需用 try/finally 与窗口 closed 兜底包住整条
 * 会话生命周期。
 */

/** 需要锁定的宿主窗口最小接口（便于单测伪造，不直接依赖 BrowserWindow）。 */
export interface LockableWindow {
  isDestroyed(): boolean;
  isFocusable(): boolean;
  isMovable(): boolean;
  setFocusable(value: boolean): void;
  setMovable(value: boolean): void;
}

/** 焦点钳制的目标：会话激活期间键盘焦点应所在的覆盖窗口。 */
export interface FocusableWindow {
  isDestroyed(): boolean;
  focus(): void;
}

export interface CaptureSessionCallbacks {
  /** 进入会话时列出需要锁定的宿主窗口（主窗口 + 全部白板窗口）。 */
  getHostWindows(): Array<LockableWindow>;
  getFocusOverlay(): FocusableWindow | null;
}

export interface CaptureSessionListenOptions {
  /**
   * 订阅 app 级窗口聚焦事件；生产实现转发 electron app 的
   * browser-window-focus。注入是为了单测不依赖 electron——被聚焦的
   * 窗口不限于本应用时会收到回调，session 内部自行判定归属。
   */
  onWindowFocus(listen: (window: unknown) => void): () => void;
}

export interface CaptureSession {
  isActive(): boolean;
  /** 开始会话：锁定全部宿主窗口并挂焦点钳制；已有会话时返回 false。 */
  begin(): boolean;
  /** 结束会话：按原值恢复并卸载钳制；未激活时是空操作（幂等）。 */
  end(): void;
}

interface LockedWindowState {
  window: LockableWindow;
  focusable: boolean;
  movable: boolean;
}

export function createCaptureSession(
  callbacks: CaptureSessionCallbacks,
  options: CaptureSessionListenOptions,
): CaptureSession {
  let active = false;
  let unsubscribe: (() => void) | null = null;
  let locked: LockedWindowState[] = [];

  return {
    isActive: () => active,
    begin() {
      if (active) return false;
      locked = callbacks
        .getHostWindows()
        .filter((window) => !window.isDestroyed())
        .map((window) => {
          // 先读后锁：恢复必须回到用户/应用先前的真实状态，而不是想当然的 true。
          const state = {
            window,
            focusable: window.isFocusable(),
            movable: window.isMovable(),
          };
          window.setFocusable(false);
          window.setMovable(false);
          return state;
        });
      active = true;
      unsubscribe = options.onWindowFocus((focused) => {
        // 只钳宿主：切到其他应用是用户的自由（冻结帧方案下画面不受影响），
        // 把别家的焦点抢回来才是打扰。
        if (!active) return;
        if (!locked.some((entry) => entry.window === focused)) return;
        const overlay = callbacks.getFocusOverlay();
        if (overlay && !overlay.isDestroyed()) overlay.focus();
      });
      return true;
    },
    end() {
      if (!active) return;
      active = false;
      unsubscribe?.();
      unsubscribe = null;
      for (const { window, focusable, movable } of locked) {
        if (window.isDestroyed()) continue;
        window.setFocusable(focusable);
        window.setMovable(movable);
      }
      locked = [];
    },
  };
}
