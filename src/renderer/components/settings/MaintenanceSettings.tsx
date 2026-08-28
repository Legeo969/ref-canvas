import { ArchiveRestore, DatabaseBackup, FileWarning, PackageOpen, ScanLine } from "lucide-react";
import type { BackupRecord, MediaMetadataSnapshot } from "../../../shared/contracts";
import { translate } from "../../app/i18n";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function confirm(message: string): boolean {
  return window.confirm(message);
}

export function MaintenanceSettings({
  backups,
  mediaMetadata,
  onCreateBackup,
  onRestoreBackup,
}: {
  backups: readonly BackupRecord[];
  mediaMetadata: MediaMetadataSnapshot;
  onCreateBackup(): void;
  onRestoreBackup(backup: BackupRecord): void;
}) {
  const exportLibrary = async () => {
    const result = await window.refCanvas.library.exportBundle();
    if (result) {
      window.alert(translate("settings.bundleExported").replace("{path}", result.path));
    }
  };
  const importLibrary = async () => {
    const pick = await window.refCanvas.system.pickFile({
      title: translate("settings.importBundleTitle"),
      filters: [{ name: translate("settings.libraryBundleFilter"), extensions: ["refcanvas-bundle"] }],
    });
    const bundlePath = pick[0];
    if (!bundlePath) return;
    if (!confirm(translate("settings.importBundleConfirm"))) return;
    // 主进程导入成功后自动重启（仿备份恢复）。
    await window.refCanvas.library.importBundle({ bundlePath, rootRules: [] });
  };
  return (
    <div className="settings-group">
      <h3>{translate("settings.maintenance")}</h3>
      <div className="maintenance-action-list">
        <button className="maintenance-action" onClick={onCreateBackup}>
          <DatabaseBackup size={17} />
          <span><strong>{translate("settings.backupNow")}</strong><small>{translate("settings.backupNowHint")}</small></span>
        </button>
        <button className="maintenance-action" onClick={() => void window.refCanvas.system.rebuildThumbnailCache()}>
          <ArchiveRestore size={17} />
          <span><strong>{translate("settings.rebuildThumbnails")}</strong><small>{translate("settings.rebuildThumbnailsHint")}</small></span>
        </button>
        <button className="maintenance-action" onClick={() => void exportLibrary()}>
          <PackageOpen size={17} />
          <span><strong>{translate("settings.exportLibrary")}</strong><small>{translate("settings.exportLibraryHint")}</small></span>
        </button>
        <button className="maintenance-action" onClick={() => void importLibrary()}>
          <PackageOpen size={17} />
          <span><strong>{translate("settings.importLibrary")}</strong><small>{translate("settings.importLibraryHint")}</small></span>
        </button>
        <button className="maintenance-action" onClick={() => void window.refCanvas.system.exportDiagnostics()}>
          <FileWarning size={17} />
          <span><strong>{translate("settings.exportDiagnostics")}</strong><small>{translate("settings.exportDiagnosticsHint")}</small></span>
        </button>
        <button
          className="maintenance-action"
          disabled={mediaMetadata.state === "running"}
          onClick={() => void window.refCanvas.library.startMediaMetadataRebuild()}
        >
          <ScanLine size={17} />
          <span>
            <strong>{mediaMetadata.state === "running" ? translate("settings.parsingMedia") : translate("settings.rebuildMediaMetadata")}</strong>
            <small>{translate("settings.rebuildMediaMetadataHint")}</small>
          </span>
        </button>
      </div>
      {mediaMetadata.state !== "idle" && mediaMetadata.total > 0 && (
        <div className="maintenance-progress">
          <div>
            <span>{mediaMetadata.state === "running" ? translate("settings.parsingMediaOffline") : mediaMetadata.state === "cancelled" ? translate("settings.mediaRebuildCancelled") : translate("settings.mediaRebuildCompleted")}</span>
            <strong>{mediaMetadata.processed} / {mediaMetadata.total}</strong>
          </div>
          <progress max={Math.max(1, mediaMetadata.total)} value={mediaMetadata.processed} />
          <small>{translate("settings.mediaRebuildSummary").replace("{updated}", String(mediaMetadata.updated)).replace("{failed}", String(mediaMetadata.failed))}</small>
          {mediaMetadata.state === "running" && (
            <button type="button" onClick={() => void window.refCanvas.library.cancelMediaMetadataRebuild()}>{translate("dialogs.cancel")}</button>
          )}
        </div>
      )}
      <h3>{translate("settings.localBackups")}</h3>
      <div className="backup-list">
        {backups.map((backup) => (
          <div className="backup-row" key={backup.path}>
            <div>
              <strong>{backup.automatic ? translate("settings.automaticBackup") : translate("settings.manualBackup")}</strong>
              <span>{new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.size)}</span>
            </div>
            <button className="secondary-button" onClick={() => onRestoreBackup(backup)}>{translate("settings.restore")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
