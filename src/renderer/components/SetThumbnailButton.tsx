import { ChevronDown, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { translate } from "../app/i18n";

/**
 * 缩略图出口（截图为主、选图为辅）。
 *
 * 两种呈现形态：
 * - toolbar：预览面板头部的图标按钮，与「打开素材／在文件夹中显示」并列；
 * - overlay：降级壳右下角的浮层分裂按钮（无真实预览的格式）。
 *
 * 统一走两条后端通道：captureThumbnail（区域截图，25–30ms 原生抓屏）
 * 与 setThumbnailFromFile（选已有图片）。
 */
export interface SetThumbnailButtonProps {
  assetId: string;
  onUpdated?: (revision: string) => void;
  variant?: "overlay" | "toolbar";
}

export function SetThumbnailButton({
  assetId,
  onUpdated,
  variant = "overlay",
}: SetThumbnailButtonProps) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const run = (action: (id: string) => Promise<{ updatedAt: string } | null>) => {
    setMenuOpen(false);
    setBusy(true);
    setFeedback(null);
    void action(assetId)
      .then((asset) => {
        if (!asset) return;
        setFeedback(translate("preview.thumbnailUpdated"));
        // updatedAt 由数据库写入时刷新，用作 URL revision 绕过旧缓存。
        onUpdated?.(asset.updatedAt);
      })
      .catch(() => setFeedback(translate("preview.thumbnailFailed")))
      .finally(() => setBusy(false));
  };

  const isToolbar = variant === "toolbar";
  /** 工具栏形态下反馈文案改挂 body，避免把 header 撑高。 */
  const feedbackNode = feedback ? (
    <span className={isToolbar ? "set-thumbnail-toast" : "set-thumbnail-feedback"}>
      {feedback}
    </span>
  ) : null;

  return (
    <div
      className={`set-thumbnail-control${isToolbar ? " is-toolbar" : ""}`}
      ref={rootRef}
    >
      <div className={`set-thumbnail-split${busy ? " busy" : ""}`}>
        <button
          type="button"
          className={isToolbar ? "workbench-external-action set-thumbnail-main" : "set-thumbnail-main"}
          disabled={busy}
          aria-label={translate("preview.captureThumbnail")}
          onClick={() => run((id) => window.refCanvas.system.captureThumbnail(id))}
        >
          <ImagePlus size={isToolbar ? 15 : 14} />
          {isToolbar ? null : (
            <span>
              {busy
                ? translate("preview.settingThumbnail")
                : translate("preview.captureThumbnail")}
            </span>
          )}
        </button>
        <button
          type="button"
          className={isToolbar ? "workbench-external-action set-thumbnail-more" : "set-thumbnail-more"}
          disabled={busy}
          aria-label={translate("preview.thumbnailMoreActions")}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {menuOpen && (
        <div className="set-thumbnail-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => run((id) => window.refCanvas.system.setThumbnailFromFile(id))}
          >
            {translate("preview.pickThumbnailFile")}
          </button>
        </div>
      )}
      {feedbackNode}
    </div>
  );
}
