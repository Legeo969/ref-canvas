import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { AssetRecord } from "../../shared/contracts";
import { translate } from "../app/i18n";
import { ReferenceMatchStudio } from "./ReferenceMatchStudio";

/**
 * 参考图仿色的独立面板。
 *
 * 这个工具需要同时放下分屏对比、示波器读数与一整套参数，塞进预览托盘时
 * 只能在一条窄槽里叠罗汉。这里给它一块接近全屏的工作区：左边画面、右边
 * 参数，两边都按真实可用尺寸排版。
 */
export function ReferenceMatchPanel({
  asset,
  timeMs,
  onClose,
}: {
  asset: AssetRecord;
  timeMs: number;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    // 捕获阶段拦下 Esc：预览层自己也在监听 Esc（退出聚焦），不拦会一起关掉。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="reference-match-panel"
      role="dialog"
      aria-modal="true"
      aria-label={translate("preview.matchOpen")}
    >
      <div className="reference-match-panel-card">
        <header className="reference-match-panel-head">
          <strong>{translate("preview.matchOpen")}</strong>
          <span className="reference-match-panel-source">{asset.title || asset.path.split(/[\\\\/]/).pop()}</span>
          <button
            ref={closeRef}
            type="button"
            className="reference-match-panel-close"
            aria-label={translate("preview.matchClose")}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </header>
        <div className="reference-match-panel-body">
          <ReferenceMatchStudio asset={asset} timeMs={timeMs} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
