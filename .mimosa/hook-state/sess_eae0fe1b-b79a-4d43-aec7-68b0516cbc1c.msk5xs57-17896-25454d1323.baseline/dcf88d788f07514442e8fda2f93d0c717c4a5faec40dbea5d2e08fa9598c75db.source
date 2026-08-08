import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord, MediaProbeResult } from "../../shared/contracts";

/**
 * 降级提示（阶段 4 验收：缺少 proprietary runtime 时有明确降级，
 * 不显示虚假支持）。
 *
 * JXL / 相机 RAW / PDF / Office / DCC（Alembic、Blend、Max…）等
 * 无本地解码器时，probe 返回 unsupportedReason，此处展示说明，
 * 而非假装能预览。
 */

export function UnsupportedNotice({ asset }: { asset: AssetRecord }) {
  const [reason, setReason] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setReason(null);
    setChecking(true);
    if (!window.refCanvas.media?.probe) {
      setChecking(false);
      return;
    }
    void window.refCanvas.media
      .probe(asset.path)
      .then((result: MediaProbeResult) => {
        if (cancelled) return;
        const value = result.extra?.unsupportedReason;
        setReason(typeof value === "string" ? value : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.path]);

  if (checking || !reason) return null;
  return (
    <div className="unsupported-notice" role="note">
      <AlertTriangle size={15} />
      <span>{reason}</span>
    </div>
  );
}
