/**
 * 统一任务中心面板（FND-007 §8.3）。
 *
 * 聚合导入/批处理/AI 任务，展示阶段、进度、输出、失败原因，支持取消
 * 与重试（AI）。关闭面板只是隐藏；取消幂等，终态任务再次取消返回当前快照。
 */
import {
  AlertTriangle,
  Archive,
  Check,
  Clock,
  Database,
  FolderOpen,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TaskKind, TaskSnapshot } from "../../shared/contracts";
import { translate } from "../app/i18n";
import type { MessageKey } from "../app/i18n";

interface TaskCenterProps {
  onClose(): void;
}

const kindKeys: Record<TaskKind, MessageKey> = {
  import: "tasks.kind.import",
  batch: "tasks.kind.batch",
  convert: "tasks.kind.convert",
  export: "tasks.kind.export",
  archive: "tasks.kind.archive",
  ai: "tasks.kind.ai",
};

const kindIcons: Record<TaskKind, typeof Clock> = {
  import: Database,
  batch: FolderOpen,
  convert: FolderOpen,
  export: Archive,
  archive: Archive,
  ai: Sparkles,
};

const stateKeys: Record<TaskSnapshot["state"], MessageKey> = {
  queued: "tasks.state.queued",
  running: "tasks.state.running",
  completed: "tasks.state.completed",
  failed: "tasks.state.failed",
  cancelled: "tasks.state.cancelled",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return "";
  }
}

function TaskRow({
  task,
  onCancel,
  onRetry,
}: {
  task: TaskSnapshot;
  onCancel(id: string): void;
  onRetry(id: string): void;
}) {
  const Icon = kindIcons[task.kind];
  const running = task.state === "running" || task.state === "queued";
  return (
    <li className={`task-row ${task.state}`}>
      <span className="task-kind-icon">
        <Icon size={15} />
      </span>
      <div className="task-main">
        <div className="task-title-row">
          <span className="task-kind">{translate(kindKeys[task.kind])}</span>
          <span className={`task-state task-state-${task.state}`}>
            {running ? (
              <Loader2 size={11} className="spin" />
            ) : task.state === "completed" ? (
              <Check size={11} />
            ) : task.state === "failed" || task.state === "cancelled" ? (
              <AlertTriangle size={11} />
            ) : (
              <Clock size={11} />
            )}
            {translate(stateKeys[task.state])}
          </span>
          {task.progress !== null && task.state === "running" && (
            <span className="task-progress">
              {Math.round(task.progress * 100)}%
            </span>
          )}
        </div>
        <div className="task-stage">{task.stage}</div>
        {task.errorMessage && (
          <div className="task-error" title={task.errorMessage}>
            {task.errorMessage}
          </div>
        )}
        {task.output && (
          <div className="task-output" title={task.output}>
            {task.output}
          </div>
        )}
        <div className="task-meta">
          <span>{formatTime(task.updatedAt)}</span>
          <span className="task-id" title={task.id}>
            {task.id.slice(0, 8)}
          </span>
        </div>
      </div>
      <div className="task-actions">
        {running && (
          <button
            className="mini-icon-button"
            aria-label={translate("tasks.cancelTask").replace("{id}", task.id)}
            title={translate("tasks.cancel")}
            onClick={() => onCancel(task.id)}
          >
            <X size={13} />
          </button>
        )}
        {task.state === "failed" && task.kind === "ai" && (
          <button
            className="mini-icon-button"
            aria-label={translate("tasks.retryTask").replace("{id}", task.id)}
            title={translate("tasks.retry")}
            onClick={() => onRetry(task.id)}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </li>
  );
}

export function TaskCenter({ onClose }: TaskCenterProps) {
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);

  const refresh = async () => {
    try {
      setTasks(await window.refCanvas.tasks.list(100));
    } catch {
      // 任务中心未就绪时保持现有列表。
    }
  };

  useEffect(() => {
    void refresh();
    const unsubscribe = window.refCanvas.tasks.onChanged(() => {
      void refresh();
    });
    return unsubscribe;
  }, []);

  const cancel = (id: string) => {
    void window.refCanvas.tasks.cancel(id).then((snapshot) => {
      if (snapshot) {
        setTasks((current) =>
          current.map((task) => (task.id === snapshot.id ? snapshot : task)),
        );
      }
    });
  };

  const retry = (id: string) => {
    void window.refCanvas.ai.retry(id).then(() => refresh());
  };

  return (
    <div className="task-center-backdrop" onMouseDown={onClose}>
      <aside
        className="task-center-panel"
        role="dialog"
        aria-modal="true"
        aria-label={translate("tasks.title")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="task-center-title">
            <Clock size={16} />
            <div>
              <h2>{translate("tasks.title")}</h2>
              <p>{translate("tasks.subtitle")}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={translate("preview.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="task-center-body">
          {tasks.length === 0 ? (
            <p className="task-center-empty">{translate("tasks.empty")}</p>
          ) : (
            <ul className="task-list">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onCancel={(id) => cancel(id)}
                  onRetry={(id) => retry(id)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
