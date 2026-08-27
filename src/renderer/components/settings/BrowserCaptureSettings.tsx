import { Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  CapturePairingCode,
  CapturePairingRecord,
} from "../../../shared/contracts";
import { useDialog } from "../DialogProvider";

function pairingTime(value: string | null): string {
  if (!value) return "尚未使用";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function BrowserCaptureSettings() {
  const dialog = useDialog();
  const [pairings, setPairings] = useState<CapturePairingRecord[]>([]);
  const [pairingCode, setPairingCode] = useState<CapturePairingCode | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const reload = useCallback(async () => {
    setPairings(await window.refCanvas.browserCapture.listPairings());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!pairingCode) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((Date.parse(pairingCode.expiresAt) - Date.now()) / 1_000),
      );
      setRemainingSeconds(remaining);
      if (remaining === 0) setPairingCode(null);
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [pairingCode]);

  const createCode = async () => {
    setPairingCode(await window.refCanvas.browserCapture.createPairingCode());
  };

  const revoke = async (pairing: CapturePairingRecord) => {
    const confirmed = await dialog.requestConfirm({
      title: "撤销浏览器配对",
      description: `撤销后，“${pairing.label}”需要重新输入配对码才能捕获。`,
      confirmLabel: "撤销",
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.browserCapture.revokePairing(pairing.id);
    await reload();
  };

  return (
    <div className="settings-group browser-capture-settings">
      <h3>浏览器捕获</h3>
      <p className="settings-note">
        Chrome 和 Edge 扩展只连接本机。首次输入配对码后，日常捕获不会再弹出授权提示。
      </p>

      <div className="capture-pairing-row">
        {pairingCode ? (
          <div className="capture-pairing-code" aria-live="polite">
            <strong>{pairingCode.code}</strong>
            <span>{remainingSeconds} 秒后失效</span>
            <button
              className="icon-button"
              aria-label="复制配对码"
              onClick={() => void navigator.clipboard.writeText(pairingCode.code)}
            >
              <Copy size={15} />
            </button>
          </div>
        ) : (
          <span className="settings-note">配对码仅显示 60 秒，使用一次后立即失效。</span>
        )}
        <button className="secondary-button" onClick={() => void createCode()}>
          {pairingCode ? <RefreshCw size={15} /> : <Link2 size={15} />}
          {pairingCode ? "重新生成" : "生成配对码"}
        </button>
      </div>

      <h3>已配对浏览器</h3>
      {pairings.length === 0 ? (
        <p className="settings-note">尚无已配对浏览器。</p>
      ) : (
        <div className="capture-pairing-list">
          {pairings.map((pairing) => (
            <div className="capture-pairing-item" key={pairing.id}>
              <div>
                <strong>{pairing.label}</strong>
                <small>最近使用：{pairingTime(pairing.lastUsedAt)}</small>
              </div>
              <button
                className="icon-button danger"
                aria-label={`撤销 ${pairing.label}`}
                onClick={() => void revoke(pairing)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
