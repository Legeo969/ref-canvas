import {
  ArchiveRestore,
  DatabaseBackup,
  FileWarning,
  FolderOpen,
  FolderSync,
  FolderX,
  Gauge,
  ScanLine,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  BackupRecord,
  MediaMetadataSnapshot,
  WatchRoot,
} from "../../shared/contracts";
import { useAppStore } from "../app/store";
import { useDialog } from "./DialogProvider";

interface MaintenancePanelProps {
  onClose(): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MaintenancePanel({ onClose }: MaintenancePanelProps) {
  const dialog = useDialog();
  const reloadAssets = useAppStore((state) => state.reloadAssets);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [watchRoots, setWatchRoots] = useState<WatchRoot[]>([]);
  const [globalShortcuts, setGlobalShortcuts] = useState(false);
  const [migrationResult, setMigrationResult] = useState("");
  const [mediaMetadata, setMediaMetadata] =
    useState<MediaMetadataSnapshot>({
      state: "idle",
      total: 0,
      processed: 0,
      updated: 0,
      failed: 0,
    });
  const reload = async () => {
    const [nextBackups, nextWatchRoots] = await Promise.all([
      window.refCanvas.backups.list(),
      window.refCanvas.library.listWatchRoots(),
    ]);
    setBackups(nextBackups);
    setWatchRoots(nextWatchRoots);
  };

  useEffect(() => {
    void reload();
    void window.refCanvas.system
      .getPreferences()
      .then((preferences) => setGlobalShortcuts(preferences.globalShortcuts));
  }, []);
  useEffect(() => {
    void window.refCanvas.library
      .getMediaMetadataRebuild()
      .then(setMediaMetadata);
    return window.refCanvas.library.onMediaMetadataProgress((snapshot) => {
      setMediaMetadata(snapshot);
      if (snapshot.state === "completed") void reloadAssets();
    });
  }, [reloadAssets]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-panel maintenance-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <Gauge size={18} />
            <div>
              <h2>维护与数据安全</h2>
              <p>备份只包含数据库、白板和设置，不复制源素材。</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="maintenance-actions">
          <button
            className="secondary-button"
            onClick={async () => {
              await window.refCanvas.backups.create();
              await reload();
            }}
          >
            <DatabaseBackup size={16} />
            立即备份
          </button>
          <button
            className="secondary-button"
            onClick={() => void window.refCanvas.system.rebuildThumbnailCache()}
          >
            <ArchiveRestore size={16} />
            重建缩略图缓存
          </button>
          <button
            className="secondary-button"
            onClick={() => void window.refCanvas.system.exportDiagnostics()}
          >
            <FileWarning size={16} />
            导出诊断
          </button>
          <button
            className="secondary-button"
            disabled={mediaMetadata.state === "running"}
            onClick={() =>
              void window.refCanvas.library.startMediaMetadataRebuild()
            }
          >
            <ScanLine size={16} />
            {mediaMetadata.state === "running"
              ? "正在解析媒体"
              : "重建媒体元数据"}
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              void dialog.requestForm({
                title: "迁移素材路径",
                description:
                  "将原根目录下的素材路径映射到新目录，不移动源文件。",
                confirmLabel: "开始迁移",
                fields: [
                  {
                    name: "fromRoot",
                    label: "原素材根目录",
                    type: "directory",
                    required: true,
                    maxLength: 32_768,
                  },
                  {
                    name: "toRoot",
                    label: "新素材根目录",
                    type: "directory",
                    required: true,
                    maxLength: 32_768,
                  },
                ],
                onSubmit: async ({ fromRoot, toRoot }) => {
                  const report =
                    await window.refCanvas.library.migratePaths(
                      fromRoot,
                      toRoot,
                    );
                  setMigrationResult(
                    `路径迁移完成：已迁移 ${report.updated}，断链 ${report.missing}，冲突 ${report.conflicts}，跳过 ${report.skipped}。`,
                  );
                },
              })
            }
          >
            <FolderSync size={16} />
            迁移素材路径
          </button>
        </div>
        {mediaMetadata.state !== "idle" && mediaMetadata.total > 0 && (
          <div className="maintenance-progress">
            <div>
              <span>
                {mediaMetadata.state === "running"
                  ? "正在离线解析视频与音频"
                  : mediaMetadata.state === "cancelled"
                    ? "媒体元数据重建已取消"
                    : "媒体元数据重建完成"}
              </span>
              <strong>
                {mediaMetadata.processed} / {mediaMetadata.total}
              </strong>
            </div>
            <progress
              max={Math.max(1, mediaMetadata.total)}
              value={mediaMetadata.processed}
            />
            <small>
              已更新 {mediaMetadata.updated}，失败 {mediaMetadata.failed}
            </small>
            {mediaMetadata.state === "running" && (
              <button
                type="button"
                onClick={() =>
                  void window.refCanvas.library.cancelMediaMetadataRebuild()
                }
              >
                取消
              </button>
            )}
          </div>
        )}
        {migrationResult && (
          <p className="maintenance-result">{migrationResult}</p>
        )}
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={globalShortcuts}
            onChange={async (event) => {
              const enabled = await window.refCanvas.system.setGlobalShortcuts(
                event.target.checked,
              );
              setGlobalShortcuts(enabled && event.target.checked);
            }}
          />
          <span>
            启用全局快捷键
            <small>Ctrl+Shift+C 捕获剪贴板，Ctrl+Shift+R 区域截图</small>
          </span>
        </label>
        <h3>监控素材文件夹</h3>
        <div className="watch-root-list">
          {watchRoots.length === 0 && (
            <p className="watch-root-empty">
              当前没有持续监控的素材文件夹。
            </p>
          )}
          {watchRoots.map((root) => (
            <div className="watch-root-row" key={root.id}>
              <div>
                <strong title={root.path}>{root.path}</strong>
                <span>
                  添加于 {new Date(root.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="watch-root-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    void window.refCanvas.system.revealInFolder(root.path)
                  }
                >
                  <FolderOpen size={14} />
                  定位
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `停止监控“${root.path}”？已导入素材和文件夹会保留，源文件不会被修改。`,
                      )
                    ) {
                      void window.refCanvas.library
                        .removeWatchRoot(root.id)
                        .then(() => reload());
                    }
                  }}
                >
                  <FolderX size={14} />
                  停止监控
                </button>
              </div>
            </div>
          ))}
        </div>
        <h3>本地备份</h3>
        <div className="backup-list">
          {backups.map((backup) => (
            <div className="backup-row" key={backup.path}>
              <div>
                <strong>{backup.automatic ? "自动备份" : "手动备份"}</strong>
                <span>
                  {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.size)}
                </span>
              </div>
              <button
                className="secondary-button"
                onClick={() => {
                  if (
                    window.confirm(
                      "恢复会替换当前数据库并重启 RefCanvas。当前数据库会保留回滚副本，继续吗？",
                    )
                  ) {
                    void window.refCanvas.backups.restore(backup.path);
                  }
                }}
              >
                恢复
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
