/**
 * AI Design Supervisor 面板（FND-008，found-clone.md §9）。
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

interface AiPanelProps {
  onClose(): void;
}

const MAX_REFERENCES = 6;

const stateLabels: Record<AiJobSnapshot["state"], string> = {
  queued: "排队中",
  uploading: "上传中",
  generating: "生成中",
  downloading: "下载中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
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
        aria-label={`移除 ${label}`}
        onClick={onRemove}
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function AiDesignSupervisorPanel({ onClose }: AiPanelProps) {
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
    const cleaned = paths.filter((item) => item && item.trim());
    if (!cleaned.length) return;
    if (!sourcePath) {
      setSourcePath(cleaned[0]);
      setReferencePaths((current) =>
        [...current, ...cleaned.slice(1)].slice(0, MAX_REFERENCES),
      );
    } else {
      setReferencePaths((current) =>
        [...current, ...cleaned].slice(0, MAX_REFERENCES),
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
    if (files.length) addFiles(files);
  };

  const pickInput = async () => {
    const picked = await window.refCanvas.system.pickFile({
      title: sourcePath ? "选择参考图" : "选择源图",
      multiSelections: true,
      filters: [
        { name: "图像", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "avif", "tif", "tiff"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (picked.length) addPaths(picked);
  };

  const pickOutputDirectory = async () => {
    const selected = await window.refCanvas.system.pickDirectory({
      title: "选择输出目录",
      defaultPath: outputDirectory || undefined,
    });
    if (selected) setOutputDirectory(selected);
  };

  const run = async () => {
    setFieldError("");
    const trimmedPrompt = prompt.trim();
    if (!sourcePath) {
      setFieldError("请选择源图");
      return;
    }
    if (!trimmedPrompt) {
      setFieldError("提示词不能为空");
      return;
    }
    if (!outputDirectory.trim()) {
      setFieldError("请选择输出目录");
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
          {stateLabels.completed}
        </span>
      );
    }
    if (job.state === "failed") {
      return (
        <span className="ai-job-badge failed">
          <AlertTriangle size={12} />
          {stateLabels.failed}
        </span>
      );
    }
    if (job.state === "cancelled") {
      return <span className="ai-job-badge cancelled">{stateLabels.cancelled}</span>;
    }
    return (
      <span className="ai-job-badge running">
        <Loader2 size={12} className="spin" />
        {stateLabels[job.state]}
      </span>
    );
  };

  return (
    <div className="ai-panel-backdrop" onMouseDown={onClose}>
      <aside
        className="ai-panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI 设计"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="ai-panel-title">
            <Sparkles size={17} />
            <div>
              <h2>AI 设计</h2>
              <p>源图 + 参考图 + 提示词生成方案（Mock 本地确定性）。</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>

        <div className="ai-panel-body">
          <section className="ai-form-section">
            <div className="ai-section-label">
              <span>输入</span>
              <button
                className="mini-icon-button"
                aria-label="选择输入图片"
                title="选择图片"
                onClick={() => void pickInput()}
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <div
              className={`ai-drop-zone ${dragActive ? "active" : ""}`}
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
                      label="源图"
                      onRemove={() => setSourcePath(null)}
                    />
                    {referencePaths.map((reference, index) => (
                      <InputThumb
                        key={reference}
                        path={reference}
                        label={`参考 ${index + 1}`}
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
                        aria-label="添加参考图"
                        onClick={() => void pickInput()}
                      >
                        <PlusIcon />
                      </button>
                    )}
                  </div>
                  <p className="ai-drop-hint">
                    拖放图片可替换/追加；参考图最多 {MAX_REFERENCES} 张
                  </p>
                </>
              ) : (
                <div className="ai-drop-empty">
                  <Upload size={22} />
                  <p>拖放图片到此处，或点击右侧选择</p>
                </div>
              )}
            </div>
          </section>

          <section className="ai-form-section">
            <label className="ai-field-label" htmlFor="ai-prompt">
              提示词
            </label>
            <textarea
              id="ai-prompt"
              className="ai-prompt-input"
              rows={3}
              maxLength={20000}
              placeholder="描述希望生成的方案，例如：cinematic volumetric lighting…"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </section>

          <section className="ai-form-section ai-options-row">
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={majorChange}
                onChange={(event) => setMajorChange(event.target.checked)}
              />
              <span>重大改动</span>
            </label>
            <label className="ai-field-label ai-inline">
              输出数量
              <select
                value={outputCount}
                onChange={(event) => setOutputCount(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="ai-form-section ai-output-row">
            <label className="ai-field-label" htmlFor="ai-output">
              输出目录
            </label>
            <div className="ai-output-picker">
              <input
                id="ai-output"
                value={outputDirectory}
                placeholder="选择输出目录"
                onChange={(event) => setOutputDirectory(event.target.value)}
              />
              <button
                className="secondary-button"
                onClick={() => void pickOutputDirectory()}
              >
                <FolderOpen size={14} />
                浏览
              </button>
            </div>
          </section>

          {availableProviders.length > 0 && (
            <section className="ai-form-section ai-provider-row">
              <label className="ai-field-label" htmlFor="ai-provider">
                Provider
              </label>
              <select
                id="ai-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                {availableProviders.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                    {item.available ? "" : "（不可用）"}
                  </option>
                ))}
              </select>
            </section>
          )}

          {fieldError && <p className="ai-field-error">{fieldError}</p>}

          <footer className="ai-panel-footer">
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
              {submitting ? "启动中…" : "生成方案"}
            </button>
          </footer>
        </div>

        <div className="ai-history">
          <div className="ai-section-label">
            <span>任务历史</span>
            <button
              className="mini-icon-button"
              aria-label="刷新任务列表"
              onClick={() => void refreshJobs()}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {jobs.length === 0 ? (
            <p className="ai-history-empty">还没有任务。</p>
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
                        {job.outputs.length} 个输出
                      </span>
                    )}
                  </div>
                  {outputThumbs(job)}
                  {job.state === "failed" && (
                    <div className="ai-job-actions">
                      <span className="ai-job-error">
                        {job.errorCode ?? "AI_JOB_FAILED"}
                        {job.errorMessage ? `：${job.errorMessage}` : ""}
                      </span>
                      <button
                        className="secondary-button"
                        onClick={() => void retryJob(job.id)}
                      >
                        <RotateCcw size={13} />
                        重试
                      </button>
                    </div>
                  )}
                  {isRunning(job.state) && (
                    <button
                      className="mini-icon-button ai-job-cancel"
                      aria-label={`取消任务 ${job.id}`}
                      title="取消"
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
