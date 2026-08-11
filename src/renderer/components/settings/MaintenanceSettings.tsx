import { ArchiveRestore, DatabaseBackup, FileWarning, ScanLine } from "lucide-react";
import type { BackupRecord, MediaMetadataSnapshot } from "../../../shared/contracts";
import { translate } from "../../app/i18n";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  return (
    <div className="settings-group">
      <h3>{translate("settings.maintenance")}</h3>
      <div className="maintenance-action-list">
        <button className="maintenance-action" onClick={onCreateBackup}>
          <DatabaseBackup size={17} />
          <span><strong>立即备份</strong><small>保存当前本地索引和偏好，可用于回滚。</small></span>
        </button>
        <button className="maintenance-action" onClick={() => void window.refCanvas.system.rebuildThumbnailCache()}>
          <ArchiveRestore size={17} />
          <span><strong>重建缩略图缓存</strong><small>清理并重新生成预览图，不改动磁盘源文件。</small></span>
        </button>
        <button className="maintenance-action" onClick={() => void window.refCanvas.system.exportDiagnostics()}>
          <FileWarning size={17} />
          <span><strong>导出诊断</strong><small>收集版本、索引和媒体状态，写入诊断文件。</small></span>
        </button>
        <button
          className="maintenance-action"
          disabled={mediaMetadata.state === "running"}
          onClick={() => void window.refCanvas.library.startMediaMetadataRebuild()}
        >
          <ScanLine size={17} />
          <span>
            <strong>{mediaMetadata.state === "running" ? "正在解析媒体" : "重建媒体元数据"}</strong>
            <small>重新提取视频、音频和图片序列的媒体信息。</small>
          </span>
        </button>
      </div>
      {mediaMetadata.state !== "idle" && mediaMetadata.total > 0 && (
        <div className="maintenance-progress">
          <div>
            <span>{mediaMetadata.state === "running" ? "正在离线解析视频与音频" : mediaMetadata.state === "cancelled" ? "媒体元数据重建已取消" : "媒体元数据重建完成"}</span>
            <strong>{mediaMetadata.processed} / {mediaMetadata.total}</strong>
          </div>
          <progress max={Math.max(1, mediaMetadata.total)} value={mediaMetadata.processed} />
          <small>已更新 {mediaMetadata.updated}，失败 {mediaMetadata.failed}</small>
          {mediaMetadata.state === "running" && (
            <button type="button" onClick={() => void window.refCanvas.library.cancelMediaMetadataRebuild()}>取消</button>
          )}
        </div>
      )}
      <h3>本地备份</h3>
      <div className="backup-list">
        {backups.map((backup) => (
          <div className="backup-row" key={backup.path}>
            <div>
              <strong>{backup.automatic ? "自动备份" : "手动备份"}</strong>
              <span>{new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.size)}</span>
            </div>
            <button className="secondary-button" onClick={() => onRestoreBackup(backup)}>恢复</button>
          </div>
        ))}
      </div>
    </div>
  );
}
