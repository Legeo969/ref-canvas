import { useEffect, useState } from "react";
import type { CaptureSource } from "../../shared/contracts";
import { CaptureOverlay } from "./CaptureOverlay";
import { translate } from "../app/i18n";

/**
 * 独立区域截图覆盖窗口（URL `?capture=1` 时由 App 短路渲染）。
 *
 * 覆盖窗口与主窗口完全解耦：主窗口保持可见，用户不再需要“关掉
 * RefCanvas”才能截图。窗口启动后一次性消费主进程暂存的抓屏快照，
 * 框选完成（保存/取消）后由主进程销毁本窗口。
 */
export function CaptureWindow() {
  const [source, setSource] = useState<CaptureSource | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await window.refCanvas.system.getCaptureSource();
        if (cancelled) return;
        if (!pending) {
          setFailed(true);
          return;
        }
        setSource(pending);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="capture-overlay">
        <div className="capture-instructions" data-capture-control>
          {translate("capture.unavailable")}
        </div>
        <div className="capture-actions" data-capture-control>
          <button
            type="button"
            aria-label={translate("capture.cancel")}
            onClick={() => void window.refCanvas.system.cancelRegionCapture()}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (!source) {
    // 快照尚未就绪：维持一个无内容的覆盖背景，避免白屏闪烁。
    return <div className="capture-overlay" />;
  }

  return (
    <CaptureOverlay
      source={source}
      onComplete={async (dataUrl) => {
        await window.refCanvas.system.saveRegionCapture(dataUrl);
      }}
      onCancel={() => {
        void window.refCanvas.system.cancelRegionCapture();
      }}
    />
  );
}
