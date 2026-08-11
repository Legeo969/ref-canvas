import {
  Eye,
  Film,
  FolderOpen,
  Images,
  LoaderCircle,
  Sparkles,
  SquareArrowOutUpRight,
  X,
  Gauge,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord, DirectoryEntry } from "../../shared/contracts";
import { useFoundSettings } from "../app/found-settings";
import { translate } from "../app/i18n";
import { AssetPreview } from "./AssetPreview";
import { AiDesignSupervisorPanel } from "./AiDesignSupervisor";
import { GifExportStudio } from "./GifExportStudio";
import {
  PreviewSessionModeButtons,
  usePreviewSessionMode,
} from "./PreviewSessionMode";
import { VideoFramesExportDialog } from "./VideoFramesExportDialog";
import { FoundToolbar } from "./FoundToolbar";
import { FoundEmptyState } from "./FoundEmptyState";
import {
  PreviewSessionShell,
  PreviewSessionTitle,
  PreviewSurface,
  previewRendererKind,
} from "./PreviewSessionShell";

type WorkbenchTool = "preview" | "gif" | "frames" | "fps";
type WorkbenchCommand = WorkbenchTool | "color";
type PreviewTab = "preview" | "ai";

const videoPattern = /^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i;

/**
 * Found-style right preview panel — 1:1 spec skeleton (§1 structure).
 *
 * Replaces DirectoryDetailsPanel with Found tab bar + dual-row toolbar.
 * Preserves all existing state management, event wiring, and tool drawers.
 */
export function FoundPreviewPanel({ entry }: { entry: DirectoryEntry | null }) {
  const foundSettings = useFoundSettings();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [mode, setMode] = useState<PreviewTab>("preview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tool, setTool] = useState<WorkbenchTool>("preview");
  const [duration, setDuration] = useState(0);
  const [frameRate, setFrameRate] = useState<number | null>(null);
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [gifPaths, setGifPaths] = useState<string[]>([]);
  const [playbackFps, setPlaybackFps] = useState<number | null>(null);
  const previewSession = usePreviewSessionMode(entry?.path ?? null);

  useEffect(() => {
    setAsset(null);
    setError(false);
    setTool("preview");
    setDuration(0);
    setFrameRate(null);
    setTimeSeconds(0);
    setGifPaths(entry && !entry.isDirectory ? [entry.path] : []);
    setPlaybackFps(null);
    if (!entry || entry.isDirectory) return;
    let cancelled = false;
    setLoading(true);
    void window.refCanvas.metadata.ensure(entry.path)
      .then(({ asset: next }) => {
        if (!cancelled) setAsset(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  useEffect(() => {
    if (!asset || asset.kind !== "video") return;
    let cancelled = false;
    void window.refCanvas.media.probe(asset.path)
      .then((probe) => {
        if (cancelled) return;
        setDuration(probe.duration ?? asset.duration ?? 0);
        const fps = probe.extra?.frameRate;
        setFrameRate(typeof fps === "number" && fps > 0 ? fps : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [asset]);

  useEffect(() => {
    const openTool = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; paths?: string[]; tool: WorkbenchCommand }>).detail;
      if (detail?.path === entry?.path) {
        if (detail.paths?.length) setGifPaths(detail.paths);
        setTool(detail.tool === "color" ? "preview" : detail.tool);
      }
    };
    window.addEventListener("refcanvas:directory-workbench", openTool);
    return () => window.removeEventListener("refcanvas:directory-workbench", openTool);
  }, [entry?.path]);

  useEffect(() => {
    const openAi = () => setMode("ai");
    window.addEventListener("refcanvas:open-ai-workbench", openAi);
    return () => window.removeEventListener("refcanvas:open-ai-workbench", openAi);
  }, []);

  const isVideo = entry ? videoPattern.test(entry.extension) : false;
  const hasContent = !!(entry && asset && !entry.isDirectory);
  const isPreview = mode === "preview";
  const selectTool = (next: WorkbenchTool) => setTool(next);

  // Format timecode from seconds
  const formatTimecode = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const fpsLabel = playbackFps !== null
    ? `${playbackFps} fps`
    : frameRate
      ? `${frameRate % 1 ? frameRate.toFixed(2) : frameRate} fps`
      : "25 fps";

  // ─── Empty / directory state ───
  if (!entry || entry.isDirectory) {
    return (
      <PreviewSessionShell
        as="aside"
        elementRef={previewSession.rootRef}
        focused={previewSession.focused}
        fullscreen={previewSession.fullscreen}
        className={`found-preview-panel details-panel directory-details-panel directory-workbench-panel mode-${mode}`}
      >
        {/* Found tab bar */}
        <header className="found-tab-bar" role="tablist" aria-label="右侧预览区">
          <button
            role="tab"
            aria-selected={isPreview}
            className={isPreview ? "active" : ""}
            onClick={() => setMode("preview")}
          >
            <Eye size={13} />
            {translate("found.tab.preview")}
          </button>
          <button
            role="tab"
            aria-selected={!isPreview}
            className={!isPreview ? "active" : ""}
            onClick={() => setMode("ai")}
          >
            <Sparkles size={13} />
            {translate("found.tab.ai")}
          </button>
          <span className="found-toolbar-spacer" />
          {mode === "preview" && (
            <PreviewSessionModeButtons
              focused={previewSession.focused}
              fullscreen={previewSession.fullscreen}
              onToggleFocus={previewSession.toggleFocus}
              onToggleFullscreen={() => void previewSession.toggleFullscreen()}
            />
          )}
        </header>

        {mode === "ai" ? (
          <AiDesignSupervisorPanel variant="embedded" initialSourcePath={null} />
        ) : (
          <div className="found-preview-content">
            <div className="found-canvas-area">
              <FoundEmptyState />
            </div>
          </div>
        )}
      </PreviewSessionShell>
    );
  }

  // ─── Asset loaded state ───
  return (
    <PreviewSessionShell
      as="aside"
      elementRef={previewSession.rootRef}
      focused={previewSession.focused}
      fullscreen={previewSession.fullscreen}
      className={`found-preview-panel details-panel directory-details-panel directory-workbench-panel ${mode === "preview" && tool !== "preview" ? "tool-open" : ""} mode-${mode}`}
    >
      {/* Found tab bar */}
      <header className="found-tab-bar" role="tablist" aria-label="右侧预览区">
        <button
          role="tab"
          aria-selected={isPreview}
          className={isPreview ? "active" : ""}
          onClick={() => { setMode("preview"); setTool("preview"); }}
        >
          <Eye size={13} />
          {translate("found.tab.preview")}
        </button>
        <button
          role="tab"
          aria-selected={!isPreview}
          className={!isPreview ? "active" : ""}
          onClick={() => setMode("ai")}
        >
          <Sparkles size={13} />
          {translate("found.tab.ai")}
        </button>
        <span className="found-toolbar-spacer" />
        <div className="workbench-file-actions">
          {mode === "preview" && (
            <PreviewSessionModeButtons
              focused={previewSession.focused}
              fullscreen={previewSession.fullscreen}
              onToggleFocus={previewSession.toggleFocus}
              onToggleFullscreen={() => void previewSession.toggleFullscreen()}
            />
          )}
          <button className="workbench-external-action" type="button" aria-label="打开素材" title="打开素材" onClick={() => void window.refCanvas.filesystem.open(entry.path)}>
            <SquareArrowOutUpRight size={15} />
          </button>
          <button className="workbench-external-action" type="button" aria-label="在资源管理器中显示" title="在资源管理器中显示" onClick={() => void window.refCanvas.filesystem.reveal(entry.path)}>
            <FolderOpen size={15} />
          </button>
        </div>
      </header>

      {/* Content area */}
      <div className="found-preview-content">
        {isPreview ? (
          <>
            {/* Loading / error states */}
            {loading && (
              <div className="found-canvas-area">
                <div className="found-empty-state">
                  <LoaderCircle className="spin" size={18} />
                  <span>{translate("found.preview.loading")}</span>
                </div>
              </div>
            )}
            {error && (
              <div className="found-canvas-area">
                <div className="found-empty-state">
                  <span>{translate("found.preview.error")}</span>
                </div>
              </div>
            )}

            {/* Preview canvas + asset label */}
            {!loading && !error && hasContent && asset && (
              <>
                <PreviewSurface
                  renderer={previewRendererKind(asset)}
                  className="workbench-preview-shell"
                >
                  <PreviewSessionTitle
                    className="workbench-asset-label"
                    titleClassName="directory-inspector-title"
                    title={<span title={entry.path}>{entry.name}</span>}
                  />
                  <AssetPreview
                    asset={asset}
                    onTimeChange={setTimeSeconds}
                    playbackFps={playbackFps}
                    onOpenTool={(next, time) => {
                      setTimeSeconds(time);
                      if (next !== "color") setTool(next);
                    }}
                  />
                </PreviewSurface>

                {/* Tool drawer (existing) */}
                {tool !== "preview" && (
                  <div className="workbench-tool-content">
                    <div className="workbench-tool-drawer-header">
                      <div className="workbench-tool-switcher">
                        {isVideo && <button className={tool === "gif" ? "active" : ""} onClick={() => selectTool("gif")}><Film size={14} />GIF</button>}
                        {isVideo && <button className={tool === "frames" ? "active" : ""} onClick={() => selectTool("frames")}><Images size={14} />序列帧</button>}
                        {isVideo && <button className={tool === "fps" ? "active" : ""} onClick={() => selectTool("fps")}><Gauge size={14} />FPS</button>}
                      </div>
                      <button className="workbench-drawer-close" aria-label="关闭工具" title="关闭工具" onClick={() => setTool("preview")}><X size={15} /></button>
                    </div>
                    {tool === "gif" && isVideo && (
                      <GifExportStudio
                        key={gifPaths.join("|")}
                        initialPaths={gifPaths.length ? gifPaths : [asset.path]}
                        initialTimeMs={gifPaths.length <= 1 ? timeSeconds * 1000 : 0}
                        variant="panel"
                        onClose={() => setTool("preview")}
                      />
                    )}
                    {tool === "frames" && isVideo && (
                      <VideoFramesExportDialog
                        inputPath={asset.path}
                        durationSeconds={duration}
                        sourceFps={frameRate}
                        initialTimeSeconds={timeSeconds}
                        variant="panel"
                        onClose={() => setTool("preview")}
                      />
                    )}
                    {tool === "fps" && isVideo && (
                      <section className="workbench-fps-tool" aria-label="FPS 预设抽屉">
                        <div className="workbench-color-heading">
                          <Gauge size={17} />
                          <div><strong>帧率基准</strong><p>控制逐帧步进与时间线刻度；视频播放速度不变</p></div>
                        </div>
                        <div className="workbench-fps-grid">
                          <button className={playbackFps === null ? "active" : ""} onClick={() => setPlaybackFps(null)}>
                            <span>自动</span>
                            <strong>{frameRate ? frameRate.toFixed(frameRate % 1 ? 2 : 0) : "—"} FPS</strong>
                          </button>
                          {Array.from(new Set(foundSettings.sequenceFpsPresets)).map((fps) => (
                            <button key={fps} className={playbackFps === fps ? "active" : ""} onClick={() => setPlaybackFps(fps)}>
                              <span>预设</span>
                              <strong>{fps} FPS</strong>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}

                {/* Found toolbar — shown when no tool drawer is open */}
                {tool === "preview" && (
                  <FoundToolbar
                    seekPosition={duration > 0 ? timeSeconds / duration : 0}
                    onSeekChange={(p) => setTimeSeconds(p * duration)}
                    timecode={formatTimecode(timeSeconds)}
                    loopActive={false}
                    fpsLabel={fpsLabel}
                    showUpperRow
                    showLowerRow={isVideo || !!entry.extension.match(/^(gif|apng)$/i)}
                  />
                )}
              </>
            )}

            {/* Empty state when no asset loaded */}
            {!loading && !error && !hasContent && (
              <div className="found-canvas-area">
                <FoundEmptyState />
              </div>
            )}
          </>
        ) : (
          /* AI Design Supervisor tab */
          <AiDesignSupervisorPanel
            variant="embedded"
            initialSourcePath={entry.path}
          />
        )}
      </div>
    </PreviewSessionShell>
  );
}
