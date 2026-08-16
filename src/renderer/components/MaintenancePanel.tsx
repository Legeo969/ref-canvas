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
import { translate } from "../app/i18n";
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
              <h2>{translate("settings.maintenanceTitle")}</h2>
              <p>{translate("settings.maintenanceSubtitle")}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={translate("dialogs.close")}>
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
            {translate("settings.backupNow")}
          </button>
          <button
            className="secondary-button"
            onClick={() => void window.refCanvas.system.rebuildThumbnailCache()}
          >
            <ArchiveRestore size={16} />
            {translate("settings.rebuildThumbnails")}
          </button>
          <button
            className="secondary-button"
            onClick={() => void window.refCanvas.system.exportDiagnostics()}
          >
            <FileWarning size={16} />
            {translate("settings.exportDiagnostics")}
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
              ? translate("settings.parsingMedia")
              : translate("settings.rebuildMediaMetadata")}
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              void dialog.requestForm({
                title: translate("settings.migratePaths"),
                description:
                  translate("settings.migratePathsDescription"),
                confirmLabel: translate("settings.startMigration"),
                fields: [
                  {
                    name: "fromRoot",
                    label: translate("settings.migrateFromRoot"),
                    type: "directory",
                    required: true,
                    maxLength: 32_768,
                  },
                  {
                    name: "toRoot",
                    label: translate("settings.migrateToRoot"),
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
                    translate("settings.migrateResult")
                      .replace("{updated}", String(report.updated))
                      .replace("{missing}", String(report.missing))
                      .replace("{conflicts}", String(report.conflicts))
                      .replace("{skipped}", String(report.skipped)),
                  );
                },
              })
            }
          >
            <FolderSync size={16} />
            {translate("settings.migratePaths")}
          </button>
        </div>
        {mediaMetadata.state !== "idle" && mediaMetadata.total > 0 && (
          <div className="maintenance-progress">
            <div>
              <span>
                {mediaMetadata.state === "running"
                  ? translate("settings.parsingMediaOffline")
                  : mediaMetadata.state === "cancelled"
                    ? translate("settings.mediaRebuildCancelled")
                    : translate("settings.mediaRebuildCompleted")}
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
              {translate("settings.mediaRebuildSummary")
                .replace("{updated}", String(mediaMetadata.updated))
                .replace("{failed}", String(mediaMetadata.failed))}
            </small>
            {mediaMetadata.state === "running" && (
              <button
                type="button"
                onClick={() =>
                  void window.refCanvas.library.cancelMediaMetadataRebuild()
                }
              >
                {translate("dialogs.cancel")}
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
            {translate("settings.globalShortcuts")}
            <small>{translate("settings.globalShortcutsHint")}</small>
          </span>
        </label>
        <h3>{translate("settings.watchRoots")}</h3>
        <div className="watch-root-list">
          {watchRoots.length === 0 && (
            <p className="watch-root-empty">
              {translate("settings.noWatchRoots")}
            </p>
          )}
          {watchRoots.map((root) => (
            <div className="watch-root-row" key={root.id}>
              <div>
                <strong title={root.path}>{root.path}</strong>
                <span>
                  {translate("settings.addedAt").replace("{date}", new Date(root.createdAt).toLocaleString())}
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
                  {translate("settings.preview.locate")}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        translate("settings.stopWatchConfirm").replace("{path}", root.path),
                      )
                    ) {
                      void window.refCanvas.library
                        .removeWatchRoot(root.id)
                        .then(() => reload());
                    }
                  }}
                >
                  <FolderX size={14} />
                  {translate("settings.stopWatch")}
                </button>
              </div>
            </div>
          ))}
        </div>
        <h3>{translate("settings.localBackups")}</h3>
        <div className="backup-list">
          {backups.map((backup) => (
            <div className="backup-row" key={backup.path}>
              <div>
                <strong>{backup.automatic ? translate("settings.automaticBackup") : translate("settings.manualBackup")}</strong>
                <span>
                  {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.size)}
                </span>
              </div>
              <button
                className="secondary-button"
                onClick={() => {
                  if (
                    window.confirm(
                      translate("settings.restoreConfirm"),
                    )
                  ) {
                    void window.refCanvas.backups.restore(backup.path);
                  }
                }}
              >
                {translate("settings.restore")}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
