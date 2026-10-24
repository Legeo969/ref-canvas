import { useEffect, useState } from "react";
import type { CaptureSource } from "../../shared/contracts";
import { translate } from "../app/i18n";
import { CaptureOverlay } from "./CaptureOverlay";

/**
 * 独立区域截图覆盖窗口（URL `?capture=1` 时由 App 短路渲染）。
 *
 * 窗口由主进程按显示器管理（常驻屏复用，其余屏会话内现建）：每次截图只
 * 把底图推过来（capture:source），底图是 refbrowse:// token，渲染端不接触
 * 图像字节。多屏会话每屏一个覆盖窗口、各收各的底图。
 *
 * 跨屏选区互斥：本屏开始框选时上报主进程，其余屏转纯遮罩（capture:
 * overlay-mode）；全局任一时刻只有一个选区，Enter 保存的永远是它。
 *
 * 抓屏失败不会走到这里——主窗口负责提示，覆盖窗口根本不会显示。
 */
export function CaptureWindow() {
  const [source, setSource] = useState<CaptureSource | null>(null);
  const [passive, setPassive] = useState(false);

  // 就绪信号：现场新建的覆盖窗上，主进程 did-finish-load 的底图推送可能
  // 早于本组件挂载（订阅 onCaptureSource 之前）而丢失，窗口黑屏、用户
  // 被迫再截一次。发一次 ready，主进程据此重推缓存底图。
  useEffect(() => {
    window.refCanvas.system.captureReady();
  }, []);
  useEffect(
    () =>
      window.refCanvas.system.onCaptureSource((next) => {
        setSource(next);
        // 新会话（或新一轮底图）：本屏默认恢复可框选。
        setPassive(false);
      }),
    [],
  );
  useEffect(
    () =>
      window.refCanvas.system.onOverlayMode((mode) =>
        setPassive(mode === "passive"),
      ),
    [],
  );

  if (!source) {
    // 底图尚未到达：黑底 + 加载提示，避免"黑屏无反应"的错觉。
    return (
      <div className="capture-overlay">
        <div className="capture-instructions" data-capture-control>
          {translate("capture.loading")}
        </div>
      </div>
    );
  }

  return (
    // key=imageUrl：每次推送新底图都强制重新挂载，清掉上一次残留的选区
    // state。否则第二次截图打开时旧选区还在，双击空白会误存上一次的框。
    <CaptureOverlay
      key={source.imageUrl}
      source={source}
      passive={passive}
      onSelectionActivity={(active) =>
        window.refCanvas.system.notifySelectionActive(active)
      }
      onComplete={async (crop) => {
        await window.refCanvas.system.saveRegionCapture(crop);
        // 保存成功后主进程隐藏窗口；清掉底图，下次显示先等新推送。
        setSource(null);
      }}
      onCancel={() => {
        setSource(null);
        void window.refCanvas.system.cancelRegionCapture();
      }}
    />
  );
}
