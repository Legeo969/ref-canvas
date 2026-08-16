import {
  Check,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetActionSnapshot } from "../../shared/contracts";
import { translate, type MessageKey } from "../app/i18n";

const actionLabels: Record<AssetActionSnapshot["type"], MessageKey> = {
  convert: "directory.actionConvert",
  "merge-images": "directory.actionMergeImages",
  webp: "directory.actionWebp",
  compress: "directory.actionCompress",
  "video-to-gif": "directory.actionVideoToGif",
  "change-extension": "directory.actionChangeExtension",
  "export-csv": "directory.actionExportCsv",
  "export-folder": "directory.actionExportFolder",
};

const actionStateLabels: Record<string, MessageKey> = {
  queued: "tasks.state.queued",
  preparing: "directory.statePreparing",
  running: "tasks.state.running",
  reviewing: "directory.stateReviewing",
  completed: "tasks.state.completed",
  failed: "tasks.state.failed",
  cancelled: "tasks.state.cancelled",
};

/**
 * Local action-job panel: shows queued/running/reviewing/completed jobs with
 * per-item results, conflict confirmation and cancel/retry/reveal controls.
 */
export function ActionsPanel() {
  const [jobs, setJobs] = useState<AssetActionSnapshot[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = window.refCanvas.actions.onProgress((snapshot) => {
      setJobs((current) => {
        const exists = current.some((job) => job.id === snapshot.id);
        const next = exists
          ? current.map((job) => (job.id === snapshot.id ? snapshot : job))
          : [snapshot, ...current];
        return next.slice(0, 20);
      });
    });
    return unsubscribe;
  }, []);

  const running = jobs.some((job) =>
    ["queued", "preparing", "running"].includes(job.state),
  );
  const reviewing = jobs.filter((job) => job.state === "reviewing").length;

  if (jobs.length === 0) return null;

  return (
    <div className="actions-panel-root">
      <button
        className="actions-toggle"
        onClick={() => setOpen((value) => !value)}
        title={open ? translate("directory.collapseTasksPanel") : translate("directory.openTasksPanel")}
      >
        {running ? <Pause size={14} /> : <Play size={14} />}
        {translate("directory.tasks")}
        {reviewing > 0 && <span className="actions-badge">{reviewing}</span>}
      </button>
      {open && (
        <section className="actions-panel" aria-label={translate("directory.backgroundTasks")}>
          {jobs.length === 0 && (
            <p className="actions-empty">{translate("directory.noBackgroundTasks")}</p>
          )}
          {jobs.map((job) => (
            <div className="action-job" key={job.id}>
              <div className="action-job-header">
                <strong>{translate(actionLabels[job.type])}</strong>
                <span className={`action-state ${job.state}`}>{translate((actionStateLabels[job.state] ?? job.state) as MessageKey)}</span>
              </div>
              <div className="action-job-meta">
                {job.processed} / {job.total} · {translate("directory.generated").replace("{count}", String(job.created))}
                {job.failed > 0 && <span className="action-failed"> {translate("directory.failedCount").replace("{count}", String(job.failed))}</span>}
              </div>
              <div className="action-job-bar">
                <div
                  className="action-job-progress"
                  style={{
                    width: `${job.total ? Math.round((job.processed / job.total) * 100) : 0}%`,
                  }}
                />
              </div>
              {job.error && <p className="action-job-error">{job.error}</p>}
              {job.state === "reviewing" && job.conflicts.length > 0 && (
                <div className="action-conflicts">
                  <p className="action-conflict-title">
                    {translate("directory.conflictOverwritePrompt")}
                  </p>
                  {job.conflicts.map((conflict) => (
                    <div className="action-conflict-row" key={conflict}>
                      <span title={conflict}>
                        {conflict.split(/[\\/]/).pop()}
                      </span>
                      <button
                        onClick={() =>
                          void window.refCanvas.actions.resolveConflict(
                            job.id,
                            conflict,
                            true,
                          )
                        }
                      >
                        {translate("directory.overwrite")}
                      </button>
                      <button
                        onClick={() =>
                          void window.refCanvas.actions.resolveConflict(
                            job.id,
                            conflict,
                            false,
                          )
                        }
                      >
                        {translate("directory.skip")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="action-job-controls">
                {["queued", "preparing", "running", "reviewing"].includes(job.state) && (
                  <button
                    onClick={() => void window.refCanvas.actions.cancel(job.id)}
                    title={translate("directory.cancelTask")}
                  >
                    <X size={13} />
                  </button>
                )}
                {["failed", "cancelled"].includes(job.state) && (
                  <button
                    onClick={() => void window.refCanvas.actions.retry(job.id)}
                    title={translate("directory.retryFailedItems")}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                {job.outputDirectory && (
                  <button
                    onClick={() =>
                      void window.refCanvas.system.revealInFolder(
                        job.outputDirectory!,
                      )
                    }
                    title={translate("directory.revealInFolder")}
                  >
                    <FolderOpen size={13} />
                  </button>
                )}
                {job.state === "completed" && <Check size={13} />}
                <button
                  onClick={() =>
                    setJobs((current) => current.filter((item) => item.id !== job.id))
                  }
                  title={translate("directory.removeFromList")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
