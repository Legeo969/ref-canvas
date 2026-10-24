import { useEffect, useState } from "react";
import type { CaptureSource } from "../../shared/contracts";
import { CaptureOverlay } from "./CaptureOverlay";

/**
 * 独立区域截图覆盖窗口（URL `?capture=1` 时由 App 短路渲染）。
 *
 * 窗口由主进程常驻复用：每次截图只把底图推过来（capture:source），不再
 * 每次新建窗口、也不再跨窗口索取一次快照。底图是 refbrowse:// token，
 * 由 Chromium 直接读取文件，渲染端不接触图像字节。
 *
 * 抓屏失败不会走到这里——主窗口负责提示，覆盖窗口根本不会显示。
 */
export function CaptureWindow() {
  const [source, setSource] = useState<CaptureSource | null>(null);

  useEffect(
    () => window.refCanvas.system.onCaptureSource(setSource),
    [],
  );

  if (!source) {
    // 底图尚未到达：维持无内容的覆盖背景，避免白屏闪烁。
    return <div className="capture-overlay" />;
  }

  return (
    // key=imageUrl：每次推送新底图都强制重新挂载，清掉上一次残留的选区
    // state。否则第二次截图打开时旧选区还在，双击空白会误存上一次的框。
    <CaptureOverlay
      key={source.imageUrl}
      source={source}
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
