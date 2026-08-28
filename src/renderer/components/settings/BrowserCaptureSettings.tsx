import { Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  CapturePairingCode,
  CapturePairingRecord,
} from "../../../shared/contracts";
import { getLanguage, translate } from "../../app/i18n";
import { useDialog } from "../DialogProvider";

function pairingTime(value: string | null): string {
  if (!value) return translate("settings.capture.notUsed");
  return new Intl.DateTimeFormat(getLanguage(), {
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
      title: translate("settings.capture.revokeTitle"),
      description: translate("settings.capture.revokeDescription").replace(
        "{label}",
        pairing.label,
      ),
      confirmLabel: translate("settings.capture.revoke"),
      danger: true,
    });
    if (!confirmed) return;
    await window.refCanvas.browserCapture.revokePairing(pairing.id);
    await reload();
  };

  return (
    <div className="settings-group browser-capture-settings">
      <h3>{translate("settings.capture")}</h3>
      <p className="settings-note">
        {translate("settings.capture.description")}
      </p>

      <div className="capture-pairing-row">
        {pairingCode ? (
          <div className="capture-pairing-code" aria-live="polite">
            <strong>{pairingCode.code}</strong>
            <span>{translate("settings.capture.expiresIn").replace("{seconds}", String(remainingSeconds))}</span>
            <button
              className="icon-button"
              aria-label={translate("settings.capture.copyCode")}
              onClick={() => void navigator.clipboard.writeText(pairingCode.code)}
            >
              <Copy size={15} />
            </button>
          </div>
        ) : (
          <span className="settings-note">{translate("settings.capture.codeHint")}</span>
        )}
        <button className="secondary-button" onClick={() => void createCode()}>
          {pairingCode ? <RefreshCw size={15} /> : <Link2 size={15} />}
          {pairingCode ? translate("settings.capture.regenerate") : translate("settings.capture.generate")}
        </button>
      </div>

      <h3>{translate("settings.capture.pairedTitle")}</h3>
      {pairings.length === 0 ? (
        <p className="settings-note">{translate("settings.capture.pairedEmpty")}</p>
      ) : (
        <div className="capture-pairing-list">
          {pairings.map((pairing) => (
            <div className="capture-pairing-item" key={pairing.id}>
              <div>
                <strong>{pairing.label}</strong>
                <small>{translate("settings.capture.lastUsed").replace("{time}", pairingTime(pairing.lastUsedAt))}</small>
              </div>
              <button
                className="icon-button danger"
                aria-label={translate("settings.capture.revokePairing").replace("{label}", pairing.label)}
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
