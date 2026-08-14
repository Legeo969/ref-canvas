import { Focus, Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 全屏预览走窗口级系统全屏（主进程 setFullScreen）：HTML5
 * requestFullscreen 在 titleBarOverlay 窗口上不可靠（不触发窗口全屏、
 * 系统按钮不隐藏），窗口级全屏才是「真全屏」——任务栏隐藏、窗口铺满
 * 显示器、系统按钮不再绘制。渲染进程经 system:set-presentation-mode
 * 请求，主进程 enter/leave-full-screen 事件回推状态。
 */
export function usePreviewSessionMode(
  assetKey: string | null,
  onClose?: () => void,
) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    // 聚焦与全屏互斥：任何进入全屏的路径都清除聚焦，两个沉浸模式
    // 按钮任意时刻至多一个激活。
    const onPresentationModeChanged = (enabled: boolean) => {
      setFullscreen(enabled);
      if (enabled) setFocused(false);
    };
    const unsubscribe = window.refCanvas?.system?.onPresentationModeChanged?.(
      onPresentationModeChanged,
    );
    return () => unsubscribe?.();
  }, []);

  // 切换资产时退出沉浸状态；setFullScreen(false) 对非全屏窗口幂等。
  useEffect(() => {
    setFocused(false);
    setFullscreen(false);
    void window.refCanvas?.system?.setPresentationMode?.(false);
  }, [assetKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fullscreen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void window.refCanvas?.system?.setPresentationMode?.(false);
        return;
      }
      if (focused) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFocused(false);
        return;
      }
      if (onClose) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focused, fullscreen, onClose]);

  // 聚焦（软沉浸）与全屏互斥：全屏中点击聚焦 = 退出全屏，而不是叠加。
  const toggleFocus = useCallback(() => {
    if (fullscreen) {
      void window.refCanvas?.system?.setPresentationMode?.(false);
      return;
    }
    setFocused((value) => !value);
  }, [fullscreen]);

  const toggleFullscreen = useCallback(async () => {
    await window.refCanvas?.system?.setPresentationMode?.(!fullscreen);
  }, [fullscreen]);

  return {
    rootRef,
    focused,
    fullscreen,
    className: focused ? "preview-session-focused" : "",
    toggleFocus,
    toggleFullscreen,
  };
}

export function PreviewSessionModeButtons({
  focused,
  fullscreen,
  onToggleFocus,
  onToggleFullscreen,
  showFocus = true,
}: {
  focused: boolean;
  fullscreen: boolean;
  onToggleFocus(): void;
  onToggleFullscreen(): void;
  showFocus?: boolean;
}) {
  return (
    <div className="preview-session-mode-actions" role="group" aria-label="预览显示模式">
      {showFocus && (
        <button
          type="button"
          className={focused ? "active" : ""}
          aria-label={focused ? "退出聚焦预览" : "聚焦预览"}
          title={focused ? "退出聚焦预览" : "聚焦预览"}
          aria-pressed={focused}
          onClick={onToggleFocus}
        >
          <Focus size={16} />
        </button>
      )}
      <button
        type="button"
        className={fullscreen ? "active" : ""}
        aria-label={fullscreen ? "退出全屏预览" : "全屏预览"}
        title={fullscreen ? "退出全屏预览" : "全屏预览"}
        aria-pressed={fullscreen}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}
