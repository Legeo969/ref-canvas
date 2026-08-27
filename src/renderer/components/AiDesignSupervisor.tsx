/**
 * AI Design Supervisor 面板（FND-008，§9）。
 *
 * - 源图 + 最多六张参考图（拖放/粘贴/选择）。
 * - 提示词、重大改动、输出数量 1–4、输出目录与 Provider。
 * - 任务生命周期展示（queued/uploading/generating/downloading/completed/
 *   failed/cancelled）、历史与结果画廊。
 * - Mock Provider 只在开发/测试构建出现（Main 已过滤；此面板直接渲染
 *   服务端返回的 Provider 列表）。
 */
import {
  AlertTriangle,
  Check,
  FolderOpen,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AiDesignRequest,
  AiJobSnapshot,
  AiProviderSummary,
  AiSettings,
} from "../../shared/contracts";
import { SelectMenu } from "./SelectMenu";
import { translate } from "../app/i18n";
import type { MessageKey } from "../app/i18n";
import { useAppStore } from "../app/store";

interface AiPanelProps {
  onClose?(): void;
  variant?: "overlay" | "embedded";
  initialSourcePath?: string | null;
}

const MAX_REFERENCES = 6;
const DIRECTORY_ENTRY_MIME = "application/x-refcanvas-directory-entry";

const stateKeys: Record<AiJobSnapshot["state"], MessageKey> = {
  queued: "ai.state.queued",
  uploading: "ai.state.uploading",
  generating: "ai.state.generating",
  downloading: "ai.state.downloading",
  completed: "ai.state.completed",
  failed: "ai.state.failed",
  cancelled: "ai.state.cancelled",
};

function FileThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    const request = window.refCanvas.filesystem.previewToken?.(path);
    if (!request) return;
    let cancelled = false;
    void request
      .then((token) => {
        if (!cancelled) setUrl(`refbrowse://thumbnail/${token}?priority=visible`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!url || failed) {
    return (
      <span className="ai-input-placeholder">
        <ImagePlus size={18} />
      </span>
    );
  }
  return (
    <img src={url} alt="" draggable={false} onError={() => setFailed(true)} />
  );
}

function InputThumb({
  path,
  label,
  onRemove,
}: {
  path: string;
  label: string;
  onRemove(): void;
}) {
  return (
    <div className="ai-input-thumb" title={path}>
      <FileThumb path={path} />
      <span className="ai-input-thumb-label">{label}</span>
      <button
        className="ai-input-thumb-remove"
        aria-label={translate("ai.removeInput").replace("{label}", label)}
        onClick={onRemove}
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function AiDesignSupervisorPanel({
  onClose,
  variant = "overlay",
  initialSourcePath = null,
}: AiPanelProps) {
  const embedded = variant === "embedded";
  const workspaceMode = useAppStore((state) => state.workspaceMode);
  const selectedAsset = useAppStore((state) => state.selectedAsset);
  const selectedDirectoryEntry = useAppStore(
    (state) => state.selectedDirectoryEntry,
  );
  const [providers, setProviders] = useState<AiProviderSummary[]>([]);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [jobs, setJobs] = useState<AiJobSnapshot[]>([]);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [majorChange, setMajorChange] = useState(false);
  const [outputCount, setOutputCount] = useState(2);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [provider, setProvider] = useState<string>("mock");
  const [fieldError, setFieldError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const selectedMaterialPath =
    initialSourcePath ?? (workspaceMode === "directory"
      ? selectedDirectoryEntry && !selectedDirectoryEntry.isDirectory
        ? selectedDirectoryEntry.path
        : null
      : selectedAsset?.path ?? null);

  useEffect(() => {
    if (!embedded || !initialSourcePath) return;
    setSourcePath(initialSourcePath);
    setReferencePaths((current) =>
      current.filter(
        (item) => item.toLocaleLowerCase() !== initialSourcePath.toLocaleLowerCase(),
      ),
    );
    setFieldError("");
  }, [embedded, initialSourcePath]);

  const refreshJobs = async () => {
    try {
      setJobs(await window.refCanvas.ai.listJobs(50));
    } catch {
      // 面板未就绪时忽略。
    }
  };

  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.ai
      .listProviders()
      .then((items) => {
        if (cancelled) return;
        setProviders(items);
        if (!items.some((item) => item.kind === provider)) {
          setProvider(items[0]?.kind ?? "mock");
        }
      })
      .catch(() => undefined);
    void window.refCanvas.ai
      .getSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setProvider(value.defaultProvider);
        setOutputDirectory(
          value.defaultProvider === "mock" && !value.remoteBaseUrl
            ? ""
            : "",
        );
      })
      .catch(() => undefined);
    void refreshJobs();
    const unsubscribe = window.refCanvas.ai.onChanged(() => {
      void refreshJobs();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (embedded || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [embedded, onClose]);

  const availableProviders = useMemo(
    () =>
      providers.filter((item) =>
        settings?.enabledProviders?.length
          ? settings.enabledProviders.includes(item.kind)
          : true,
      ),
    [providers, settings],
  );

  const addPaths = (paths: string[]) => {
    const cleaned = Array.from(
      new Map(
        paths
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => [item.toLocaleLowerCase(), item]),
      ).values(),
    );
    if (!cleaned.length) return;
    if (!sourcePath) {
      setSourcePath(cleaned[0]);
      setReferencePaths((current) =>
        Array.from(
          new Map(
            [...current, ...cleaned.slice(1)].map((item) => [
              item.toLocaleLowerCase(),
              item,
            ]),
          ).values(),
        ).slice(0, MAX_REFERENCES),
      );
    } else {
      setReferencePaths((current) =>
        Array.from(
          new Map(
            [...current, ...cleaned]
              .filter(
                (item) =>
                  item.toLocaleLowerCase() !== sourcePath.toLocaleLowerCase(),
              )
              .map((item) => [item.toLocaleLowerCase(), item]),
          ).values(),
        ).slice(0, MAX_REFERENCES),
      );
    }
    setFieldError("");
  };

  const addFiles = (files: File[]) => {
    const paths = window.refCanvas.library.pathsForFiles(files).filter(Boolean);
    addPaths(paths);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      addFiles(files);
      return;
    }
    const payload = event.dataTransfer.getData(DIRECTORY_ENTRY_MIME);
    if (!payload) return;
    try {
      const entry = JSON.parse(payload) as {
        path?: string;
        isDirectory?: boolean;
      };
      if (entry.isDirectory) {
        setFieldError(translate("ai.folderUnsupported"));
        return;
      }
      if (entry.path) addPaths([entry.path]);
    } catch {
      // Ignore malformed drag payloads from outside RefCanvas.
    }
  };

  const pickInput = async () => {
    const picked = await window.refCanvas.system.pickFile({
      title: sourcePath ? translate("ai.pickReference") : translate("ai.pickSource"),
      multiSelections: true,
      filters: [
        { name: translate("ai.fileFilterImages"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "avif", "tif", "tiff"] },
        { name: translate("ai.fileFilterAll"), extensions: ["*"] },
      ],
    });
    if (picked.length) addPaths(picked);
  };

  const pickOutputDirectory = async () => {
    const selected = await window.refCanvas.system.pickDirectory({
      title: translate("ai.pickOutput"),
      defaultPath: outputDirectory || undefined,
    });
    if (selected) setOutputDirectory(selected);
  };

  const run = async () => {
    setFieldError("");
    const trimmedPrompt = prompt.trim();
    if (!sourcePath) {
      setFieldError(translate("ai.error.sourceRequired"));
      return;
    }
    if (!trimmedPrompt) {
      setFieldError(translate("ai.error.promptRequired"));
      return;
    }
    if (!outputDirectory.trim()) {
      setFieldError(translate("ai.error.outputRequired"));
      return;
    }
    const request: AiDesignRequest = {
      sourcePath,
      referencePaths: referencePaths.slice(0, MAX_REFERENCES),
      prompt: trimmedPrompt,
      majorChange,
      outputCount,
      outputDirectory,
    };
    setSubmitting(true);
    try {
      await window.refCanvas.ai.start(provider as AiJobSnapshot["provider"], request);
      await refreshJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFieldError(message.replace(/^AI_VALIDATION:/, ""));
    } finally {
      setSubmitting(false);
    }
  };

  const outputThumbs = (job: AiJobSnapshot) => {
    if (job.outputs.length === 0) return null;
    return (
      <div className="ai-result-thumbs">
        {job.outputs.map((output) => (
          <FileThumb key={output} path={output} />
        ))}
      </div>
    );
  };

  const jobStateBadge = (job: AiJobSnapshot): ReactNode => {
    if (job.state === "completed") {
      return (
        <span className="ai-job-badge completed">
          <Check size={12} />
          {translate(stateKeys.completed)}
        </span>
      );
    }
    if (job.state === "failed") {
      return (
        <span className="ai-job-badge failed">
          <AlertTriangle size={12} />
          {translate(stateKeys.failed)}
        </span>
      );
    }
    if (job.state === "cancelled") {
      return <span className="ai-job-badge cancelled">{translate(stateKeys.cancelled)}</span>;
    }
    return (
      <span className="ai-job-badge running">
        <Loader2 size={12} className="spin" />
        {translate(stateKeys[job.state])}
      </span>
    );
  };

  return (
    <div className={`ai-panel-backdrop ${embedded ? "embedded" : ""}`}>
      <aside
        className={`ai-panel ${embedded ? "embedded" : ""}`}
        role="complementary"
        aria-label={translate("ai.title")}
      >
        {!embedded && <header>
          <div className="ai-panel-title">
            <Sparkles size={17} />
            <div>
              <h2>{translate("ai.title")}</h2>
              <p>{translate("ai.subtitle")}</p>
            </div>
          </div>
          <button className="icon-button" onClick={() => onClose?.()} aria-label={translate("preview.close")}>
            <X size={17} />
          </button>
        </header>}

        <div className="ai-panel-body">
          <section className={`ai-form-section${embedded ? " preview-ai-source-region" : ""}`}>
            <div className="ai-section-label">
              <span>{translate("ai.input")}</span>
              <button
                className="mini-icon-button"
                aria-label={translate("ai.pickInput")}
                onClick={() => void pickInput()}
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <div
              className={`ai-drop-zone ${dragActive ? "active" : ""}${sourcePath ? " has-source" : ""}`}
              role={sourcePath ? undefined : "button"}
              tabIndex={sourcePath ? undefined : 0}
              onClick={() => { if (!sourcePath) void pickInput(); }}
              onKeyDown={(event) => {
                if (!sourcePath && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  void pickInput();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                dragDepthRef.current += 1;
                setDragActive(true);
              }}
              onDragLeave={() => {
                dragDepthRef.current -= 1;
                if (dragDepthRef.current <= 0) setDragActive(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event)}
            >
              {sourcePath ? (
                <>
                  <div className="ai-thumb-row">
                    <InputThumb
                      path={sourcePath}
                      label={translate("ai.source")}
                      onRemove={() => setSourcePath(null)}
                    />
                    {referencePaths.map((reference, index) => (
                      <InputThumb
                        key={reference}
                        path={reference}
                        label={translate("ai.referenceIndex").replace("{index}", String(index + 1))}
                        onRemove={() =>
                          setReferencePaths((current) =>
                            current.filter((item) => item !== reference),
                          )
                        }
                      />
                    ))}
                    {referencePaths.length < MAX_REFERENCES && (
                      <button
                        className="ai-input-add"
                        aria-label={translate("ai.addReference")}
                        onClick={() => void pickInput()}
                      >
                        <PlusIcon />
                      </button>
                    )}
                  </div>
                  <p className="ai-drop-hint">
                    {translate("ai.dropHint").replace("{max}", String(MAX_REFERENCES))}
                  </p>
                </>
              ) : (
                <div className="ai-drop-empty">
                  <Upload size={22} />
                  <p>{translate("ai.dropEmpty")}</p>
                </div>
              )}
            </div>
            <button
              type="button"
              className="ai-use-selection"
              disabled={!selectedMaterialPath}
              title={
                selectedMaterialPath
                  ? selectedMaterialPath
                  : translate("ai.selectMaterialFirst")
              }
              onClick={() => {
                if (selectedMaterialPath) addPaths([selectedMaterialPath]);
              }}
            >
              <ImagePlus size={15} />
              {selectedMaterialPath
                ? translate("ai.addSelected")
                : translate("ai.selectMaterialFirst")}
            </button>
          </section>

          <section className={`ai-form-section${embedded ? " preview-ai-feedback-region" : ""}`}>
            <label className="ai-field-label" htmlFor="ai-prompt">
              {translate("ai.prompt")}
            </label>
            <textarea
              id="ai-prompt"
              className="ai-prompt-input"
              rows={3}
              maxLength={20000}
              placeholder={translate("ai.promptPlaceholder")}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </section>

          <section className={`ai-form-section ai-options-row${embedded ? " preview-ai-config-region" : ""}`}>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={majorChange}
                onChange={(event) => setMajorChange(event.target.checked)}
              />
              <span>{translate("ai.majorChange")}</span>
            </label>
            <label className="ai-field-label ai-inline">
              {translate("ai.outputCount")}
              <SelectMenu<number>
                className="ai-count-menu"
                value={outputCount}
                options={[1, 2, 3, 4].map((count) => ({ value: count, label: String(count) }))}
                ariaLabel={translate("ai.outputCount")}
                onValueChange={setOutputCount}
              />
            </label>
          </section>

          <section className="ai-form-section ai-output-row">
            <label className="ai-field-label" htmlFor="ai-output">
              {translate("ai.outputDirectory")}
            </label>
            <div className="ai-output-picker">
              <input
                id="ai-output"
                value={outputDirectory}
                placeholder={translate("ai.pickOutput")}
                onChange={(event) => setOutputDirectory(event.target.value)}
              />
              <button
                className="secondary-button"
                onClick={() => void pickOutputDirectory()}
              >
                <FolderOpen size={14} />
                {translate("ai.outputBrowse")}
              </button>
            </div>
          </section>

          {availableProviders.length > 0 && (
            <section className="ai-form-section ai-provider-row">
              <label className="ai-field-label" htmlFor="ai-provider">
                {translate("ai.provider")}
              </label>
              <SelectMenu<string>
                id="ai-provider"
                value={provider}
                options={availableProviders.map((item) => ({
                  value: item.kind,
                  label: `${item.label}${item.available ? "" : translate("ai.unavailable")}`,
                }))}
                ariaLabel={translate("ai.provider")}
                onValueChange={setProvider}
              />
            </section>
          )}

          {fieldError && <p className="ai-field-error">{fieldError}</p>}

          <footer className={`ai-panel-footer${embedded ? " preview-ai-bottom-bar" : ""}`}>
            <button
              className="primary-button"
              onClick={() => void run()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
              {submitting ? translate("ai.generating") : translate("ai.generate")}
            </button>
          </footer>
        </div>

        <div className={`ai-history${jobs.length === 0 ? " empty" : ""}`}>
          <div className="ai-section-label">
            <span>{translate("ai.history")}</span>
            <button
              className="mini-icon-button"
              aria-label={translate("ai.refresh")}
              onClick={() => void refreshJobs()}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {jobs.length === 0 ? (
            <p className="ai-history-empty">{translate("ai.noJobs")}</p>
          ) : (
            <ul className="ai-job-list">
              {jobs.map((job) => (
                <li className={`ai-job-row ${job.state}`} key={job.id}>
                  <div className="ai-job-main">
                    <span className="ai-job-provider">
                      {providerLabel(job.provider)}
                    </span>
                    {jobStateBadge(job)}
                    {job.progress !== null && (
                      <span className="ai-job-progress">
                        {Math.round(job.progress * 100)}%
                      </span>
                    )}
                    {job.stage && job.state !== "completed" && (
                      <span className="ai-job-stage">{job.stage}</span>
                    )}
                  </div>
                  <div className="ai-job-meta">
                    <span title={job.createdAt}>
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </span>
                    {job.outputs.length > 0 && (
                      <span className="ai-job-outputs">
                        {translate("ai.outputCountResult").replace("{count}", String(job.outputs.length))}
                      </span>
                    )}
                  </div>
                  {outputThumbs(job)}
                  {job.state === "failed" && (
                    <div className="ai-job-actions">
                      <span className="ai-job-error">
                        {job.errorCode ?? "AI_JOB_FAILED"}
                        {job.errorMessage ? ` · ${job.errorMessage}` : ""}
                      </span>
                      <button
                        className="secondary-button"
                        onClick={() => void retryJob(job.id)}
                      >
                        <RotateCcw size={13} />
                        {translate("ai.retry")}
                      </button>
                    </div>
                  )}
                  {isRunning(job.state) && (
                    <button
                      className="mini-icon-button ai-job-cancel"
                      aria-label={translate("tasks.cancelTask").replace("{id}", job.id)}
                      onClick={() => void window.refCanvas.ai.cancel(job.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function PlusIcon() {
  return <span className="ai-input-add-icon">+</span>;
}

function providerLabel(kind: AiJobSnapshot["provider"]): string {
  if (kind === "comfyui") return "ComfyUI";
  if (kind === "remote-rest") return "Remote REST";
  return "Mock";
}

function isRunning(state: AiJobSnapshot["state"]): boolean {
  return (
    state === "queued" ||
    state === "uploading" ||
    state === "generating" ||
    state === "downloading"
  );
}

async function retryJob(id: string): Promise<void> {
  try {
    await window.refCanvas.ai.retry(id);
  } catch {
    // 任务已失败但请求不可用（重启后）：静默。
  }
}
