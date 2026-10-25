import { translate } from "../app/i18n";
import type { MigrationRecoveryInfo } from "../../shared/contracts";

/** 启动健康快照（system.getStartupHealth 的返回形状，App 启动时拉取）。 */
export type StartupHealth = Awaited<
  ReturnType<typeof window.refCanvas.system.getStartupHealth>
>;

interface RecoveryScreenProps {
  startupHealth: StartupHealth | null;
  migrationFailure: MigrationRecoveryInfo | null;
  /** 安全模式恢复动作的临时提示，复用工作区 notice 通道（含自动清除）。 */
  onNotice: (message: string | null) => void;
}

/** 迁移失败/安全模式恢复页（?recovery=1）：只展示恢复信息，不进入主工作区。 */
export function RecoveryScreen({
  startupHealth,
  migrationFailure,
  onNotice,
}: RecoveryScreenProps) {
  const isSafe = startupHealth?.mode === "safe";
  const isTooNew = startupHealth?.mode === "too-new";
  return (
    <div className="recovery-screen">
      <div className="recovery-card">
        <span className="brand-mark">R</span>
        <h1>
          {isTooNew
            ? translate("app.schemaTooNewTitle")
            : isSafe
              ? translate("app.safeModeTitle")
              : translate("app.recoveryTitle")}
        </h1>
        <p>
          {isTooNew
            ? translate("app.schemaTooNewDescription")
            : isSafe
              ? translate("app.safeModeDescription")
              : translate("app.recoveryDescription")}
        </p>
        <dl>
          <div>
            <dt>{translate("app.recoveryDatabaseFile")}</dt>
            <dd>{startupHealth?.databasePath ?? migrationFailure?.databasePath ?? "…"}</dd>
          </div>
          <div>
            <dt>{translate("app.recoveryBackupDirectory")}</dt>
            <dd>{migrationFailure?.backupDirectory ?? "…"}</dd>
          </div>
        </dl>
        {migrationFailure?.entries.map((entry) => (
          <div key={entry.stepId} className="recovery-entry">
            <code>{entry.stepId}</code>
            <span>
              v{entry.fromVersion} → v{entry.toVersion}
            </span>
            <pre>{entry.error}</pre>
          </div>
        ))}
        <div className="recovery-actions">
          {isSafe && (
            <>
              <button
                className="secondary-button"
                onClick={() => {
                  void window.refCanvas.system.recoverNewDatabase();
                }}
              >
                {translate("app.safeModeNewDatabase")}
              </button>
              <button
                className="secondary-button"
                onClick={async () => {
                  const backups = await window.refCanvas.system.recoverListBackups();
                  if (!backups.length) {
                    onNotice(translate("app.safeModeNoBackups"));
                    window.setTimeout(() => onNotice(null), 4200);
                    return;
                  }
                  const backup = backups[0]; // 最近备份
                  void window.refCanvas.system.recoverRestoreBackup(backup.filename);
                }}
              >
                {translate("app.safeModeRestore")}
              </button>
            </>
          )}
          <button
            className="secondary-button"
            onClick={() => {
              if (migrationFailure?.backupDirectory) {
                void window.refCanvas.system.openExternal(
                  migrationFailure.backupDirectory,
                );
              }
            }}
          >
            {translate("app.openBackupDirectory")}
          </button>
          <button className="primary-button" onClick={() => window.close()}>
            {translate("app.quit")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 工作区初始化期间的骨架屏（brand + 侧栏/工作区占位）。 */
export function StartupLoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-titlebar">
        <span className="brand-mark">R</span>
        <span>{translate("app.loadingWorkspace")}</span>
      </div>
      <div className="loading-sidebar" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
      </div>
      <div className="loading-workspace" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}
