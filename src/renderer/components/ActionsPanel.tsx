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

const actionLabels: Record<AssetActionSnapshot["type"], string> = {
  convert: "格式转换",
  "merge-images": "图片合并",
  webp: "WebP 转换",
  compress: "无损压缩",
  "video-to-gif": "视频转 GIF",
  "change-extension": "扩展名修改",
  "export-csv": "CSV 导出",
  "export-folder": "文件夹导出",
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

  return (
    <div className="actions-panel-root">
      <button
        className="actions-toggle"
        onClick={() => setOpen((value) => !value)}
        title={open ? "收起任务面板" : "打开任务面板"}
      >
        {running ? <Pause size={14} /> : <Play size={14} />}
        任务
        {reviewing > 0 && <span className="actions-badge">{reviewing}</span>}
      </button>
      {open && (
        <section className="actions-panel" aria-label="后台任务">
          {jobs.length === 0 && (
            <p className="actions-empty">还没有后台任务。</p>
          )}
          {jobs.map((job) => (
            <div className="action-job" key={job.id}>
              <div className="action-job-header">
                <strong>{actionLabels[job.type] ?? job.type}</strong>
                <span className={`action-state ${job.state}`}>{job.state}</span>
              </div>
              <div className="action-job-meta">
                {job.processed} / {job.total} · 已生成 {job.created}
                {job.failed > 0 && <span className="action-failed"> 失败 {job.failed}</span>}
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
                    输出文件已存在，选择是否覆盖：
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
                        覆盖
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
                        跳过
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="action-job-controls">
                {["queued", "preparing", "running", "reviewing"].includes(job.state) && (
                  <button
                    onClick={() => void window.refCanvas.actions.cancel(job.id)}
                    title="取消任务"
                  >
                    <X size={13} />
                  </button>
                )}
                {["failed", "cancelled"].includes(job.state) && (
                  <button
                    onClick={() => void window.refCanvas.actions.retry(job.id)}
                    title="重试失败项"
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
                    title="在文件夹中显示"
                  >
                    <FolderOpen size={13} />
                  </button>
                )}
                {job.state === "completed" && <Check size={13} />}
                <button
                  onClick={() =>
                    setJobs((current) => current.filter((item) => item.id !== job.id))
                  }
                  title="从列表移除"
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
