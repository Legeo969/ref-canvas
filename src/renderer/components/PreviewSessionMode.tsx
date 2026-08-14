import { Focus, Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function ownsPreviewFullscreen(root: HTMLElement | null): boolean {
  const fullscreenElement = document.fullscreenElement;
  return Boolean(
    root && fullscreenElement &&
      (fullscreenElement === root || root.contains(fullscreenElement)),
  );
}

async function exitOwnedFullscreen(root: HTMLElement | null): Promise<boolean> {
  if (!ownsPreviewFullscreen(root) || typeof document.exitFullscreen !== "function") {
    return false;
  }
  try {
    await document.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

export function usePreviewSessionMode(
  assetKey: string | null,
  onClose?: () => void,
) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    setFocused(false);
    if (!ownsPreviewFullscreen(root)) {
      setFullscreen(false);
    }
    return () => {
      if (ownsPreviewFullscreen(root)) {
        void exitOwnedFullscreen(root);
      }
    };
  }, [assetKey]);

  useEffect(() => {
    // 聚焦（软沉浸）与全屏互斥：任何全屏生效的瞬间都清除聚焦，堵住
    // 「全屏请求 pending 期间点击聚焦」的竞态窗口，保证两个沉浸模式
    // 按钮任意时刻至多一个激活。
    const onFullscreenChange = () => {
      const owns = ownsPreviewFullscreen(rootRef.current);
      setFullscreen(owns);
      if (owns) setFocused(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (ownsPreviewFullscreen(rootRef.current)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void exitOwnedFullscreen(rootRef.current);
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
  }, [focused, onClose]);

  const toggleFocus = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    // 全屏中点击聚焦 = 退出全屏，而不是叠加进入聚焦（两个沉浸模式互斥）。
    if (fullscreen) {
      void exitOwnedFullscreen(root);
      return;
    }
    setFocused((value) => !value);
  }, [fullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    if (ownsPreviewFullscreen(root)) {
      await exitOwnedFullscreen(root);
      return;
    }
    if (typeof root.requestFullscreen !== "function") return;
    // 进入全屏前清除聚焦；请求被拒时恢复原聚焦状态。
    const wasFocused = focused;
    setFocused(false);
    try {
      await root.requestFullscreen();
    } catch {
      setFullscreen(ownsPreviewFullscreen(root));
      setFocused(wasFocused);
    }
  }, [focused]);

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
