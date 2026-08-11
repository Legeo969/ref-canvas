import { Clipboard, FolderOpen, Trash2 } from "lucide-react";
import type { AppInfo } from "../../../shared/contracts";
import { translate } from "../../app/i18n";

export function AboutSettings({
  appInfo,
  versionInfo,
  uninstallError,
  onRequestUninstall,
}: {
  appInfo: AppInfo | null;
  versionInfo: string;
  uninstallError: string;
  onRequestUninstall(): void;
}) {
  return (
    <div className="settings-group about-group">
      <h3>{translate("settings.about")}</h3>
      <div className="about-mark">
        <span className="brand-mark">R</span>
        <div><strong>RefCanvas</strong><span>{appInfo?.appVersion ?? "…"}</span></div>
      </div>
      <dl className="about-list">
        <div><dt>安装渠道</dt><dd>{appInfo?.installChannel ?? "…"}</dd></div>
        <div><dt>Electron</dt><dd>{appInfo?.electronVersion ?? "…"}</dd></div>
        <div><dt>Node</dt><dd>{appInfo?.nodeVersion ?? "…"}</dd></div>
        <div><dt>数据库 schema</dt><dd>{appInfo?.databaseSchemaVersion ?? "…"}</dd></div>
        <div>
          <dt>索引数据库</dt>
          <dd title={appInfo?.libraryPath ?? undefined}>{appInfo?.libraryPath ?? "未打开"}</dd>
        </div>
        <div><dt>平台</dt><dd>{appInfo?.platform ?? "…"}</dd></div>
      </dl>
      <div className="about-actions">
        <button className="secondary-button" onClick={() => void window.refCanvas.system.writeClipboard(versionInfo)}>
          <Clipboard size={15} />复制版本信息
        </button>
        <button className="secondary-button" onClick={() => void window.refCanvas.system.openDataFolder()}>
          <FolderOpen size={15} />打开数据目录
        </button>
        <button
          className="secondary-button danger"
          disabled={!appInfo?.uninstallAvailable}
          title={appInfo?.uninstallAvailable ? undefined : translate("settings.uninstallHint")}
          onClick={onRequestUninstall}
        >
          <Trash2 size={15} />{translate("settings.uninstall")}
        </button>
      </div>
      {uninstallError && <p className="about-uninstall-error" role="alert">{uninstallError}</p>}
    </div>
  );
}
