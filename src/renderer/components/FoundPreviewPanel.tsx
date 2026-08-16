import {
  Eye,
  FolderOpen,
  LoaderCircle,
  Sparkles,
  SquareArrowOutUpRight,
  X,
  Globe2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AssetNotesPanel } from "./AssetNotesPanel";
import { PreviewColorTools } from "./PreviewColorTools";
import { FoundEmptyState } from "./FoundEmptyState";
import { FoundLayersPanel } from "./FoundLayersPanel";
import { SequencePreviewDialog } from "./SequencePreview";
import {
  PreviewTransportProvider,
  usePreviewTransport,
} from "./PreviewTransport";
import {
  classifyFoundPreview,
  environmentPreviewCapabilities,
  formatFoundTimecode,
  foundToolbarProgressColor,
  type FoundToolbarVariant,
} from "./found-preview-model";
import {
  PreviewSessionShell,
  PreviewSurface,
  previewRendererKind,
} from "./PreviewSessionShell";

type WorkbenchTool = "preview" | "gif" | "frames" | "fps" | "rate" | "notes" | "lut";
type WorkbenchCommand = WorkbenchTool | "color";
type PreviewTab = "preview" | "ai";

const videoPattern = /^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i;

/** 全屏下指针停在这些控件上时，控制栏不自动隐藏。 */
const FULLSCREEN_CONTROLS_SELECTOR = ".found-preview-workspace, .found-preview-session-footer, .found-layers-panel, .found-lut-anchor-menu, .found-rate-anchor-menu, .hdr-exposure-anchor-menu, .hdr-ocio-anchor-menu, .hdr-channel-anchor-menu, .sequence-inline-menu";

/**
 * Found-style right preview panel — 1:1 spec skeleton (§1 structure).
 *
 * Replaces DirectoryDetailsPanel with Found tab bar + dual-row toolbar.
 * Preserves all existing state management, event wiring, and tool drawers.
 */
function FoundPreviewPanelContent({ entry }: { entry: DirectoryEntry | null }) {
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
  const [colorSwatches, setColorSwatches] = useState<string[]>([]);
  const [sampledColorSwatches, setSampledColorSwatches] = useState<string[]>([]);
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const [multichannelAnchor, setMultichannelAnchor] = useState<HTMLButtonElement | null>(null);
  const [multichannelOpen, setMultichannelOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [eyedropActive, setEyedropActive] = useState(false);
  const [gifRange, setGifRange] = useState({ start: 0, end: 1 });
  const [sequenceGifRangeActive, setSequenceGifRangeActive] = useState(false);
  const [panoramaCapable, setPanoramaCapable] = useState(false);
  const [reflectionCapable, setReflectionCapable] = useState(false);
  const [hdrViewMode, setHdrViewMode] = useState<"flat" | "reflection" | "panorama">("flat");
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(false);
  const fullscreenControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenControlsReadyAtRef = useRef(0);
  const fullscreenLastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const previewSession = usePreviewSessionMode(entry?.path ?? null);
  const transport = usePreviewTransport();

  // 沉浸模式（聚焦/全屏）下把键盘焦点交给媒体预览根：方向键/空格
  // 立即生效，无需先点击画面。
  useEffect(() => {
    if (!previewSession.fullscreen && !previewSession.focused) return;
    const shell = previewSession.rootRef.current;
    const mediaRoot = shell?.querySelector<HTMLElement>(
      ".video-preview, .sequence-preview-shell",
    );
    mediaRoot?.focus({ preventScroll: true });
  }, [previewSession.fullscreen, previewSession.focused]);

  const hideFullscreenControls = useCallback(() => {
    if (fullscreenControlsTimerRef.current !== null) {
      clearTimeout(fullscreenControlsTimerRef.current);
      fullscreenControlsTimerRef.current = null;
    }
    setFullscreenControlsVisible(false);
  }, []);

  useEffect(() => {
    hideFullscreenControls();
    if (!previewSession.fullscreen) return;

    window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    fullscreenControlsReadyAtRef.current = performance.now() + 180;
    fullscreenLastPointerPositionRef.current = null;
    // 进入全屏只关闭浮层、不重置工具状态（GIF 范围、多通道、调色板、
    // 取色、备注等），退出全屏后原样恢复。
    const scheduleHide = () => {
      fullscreenControlsTimerRef.current = setTimeout(() => {
        fullscreenControlsTimerRef.current = null;
        const lastPointer = fullscreenLastPointerPositionRef.current;
        const target = lastPointer ? document.elementFromPoint(lastPointer.x, lastPointer.y) : null;
        if (target?.closest(FULLSCREEN_CONTROLS_SELECTOR)) {
          // 指针停在控件上时保持可见；重新武装计时器，移出后隐藏。
          scheduleHide();
          return;
        }
        setFullscreenControlsVisible(false);
      }, 1800);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (performance.now() < fullscreenControlsReadyAtRef.current) return;
      const previous = fullscreenLastPointerPositionRef.current;
      if (previous && previous.x === event.clientX && previous.y === event.clientY) return;
      fullscreenLastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
      setFullscreenControlsVisible(true);
      if (fullscreenControlsTimerRef.current !== null) clearTimeout(fullscreenControlsTimerRef.current);
      scheduleHide();
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", hideFullscreenControls);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", hideFullscreenControls);
      if (fullscreenControlsTimerRef.current !== null) {
        clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
      fullscreenControlsReadyAtRef.current = 0;
      fullscreenLastPointerPositionRef.current = null;
    };
  }, [hideFullscreenControls, previewSession.fullscreen]);

  useEffect(() => {
    setAsset(null);
    setError(false);
    setTool("preview");
    setDuration(0);
    setFrameRate(null);
    setTimeSeconds(0);
    setGifPaths(entry && !entry.isDirectory ? [entry.path] : []);
    setPlaybackFps(null);
    setColorSwatches([]);
    setSampledColorSwatches([]);
    setMultichannelOpen(false);
    setPaletteOpen(false);
    setPaletteLoading(false);
    setPaletteError(null);
    setEyedropActive(false);
    setGifRange({ start: 0, end: 1 });
    setSequenceGifRangeActive(false);
    setPanoramaCapable(false);
    setReflectionCapable(false);
    setHdrViewMode("flat");
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
    const closePopovers = () => {
      setMultichannelOpen(false);
      setPaletteOpen(false);
      setEyedropActive(false);
      if (tool === "lut") setTool("preview");
    };
    window.addEventListener("refcanvas:close-preview-popovers", closePopovers);
    window.addEventListener("blur", closePopovers);
    return () => {
      window.removeEventListener("refcanvas:close-preview-popovers", closePopovers);
      window.removeEventListener("blur", closePopovers);
    };
  }, [tool]);

  useEffect(() => {
    const closeOnPointerAway = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (eyedropActive && target?.closest(".found-preview-viewport")) return;
      if (target?.closest(".found-toolbar, .found-lut-anchor-menu, .hdr-exposure-anchor-menu, .hdr-ocio-anchor-menu, .hdr-channel-anchor-menu, .sequence-inline-menu")) return;
      window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    };
    document.addEventListener("pointerdown", closeOnPointerAway);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerAway);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [eyedropActive]);

  useEffect(() => {
    window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
  }, [mode]);

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
    if (!asset || !/^(exr|hdr)$/i.test(asset.extension)) return;
    let cancelled = false;
    void window.refCanvas.media.probe(asset.path).then((probe) => {
      if (cancelled) return;
      // 全景要求 2:1 equirectangular；反射球对任意 HDR 宽高比可用
      // （PMREM 反射不需要 2:1，1:1 柔光箱等环境图同样支持）。
      const capabilities = environmentPreviewCapabilities(probe.width, probe.height);
      setPanoramaCapable(capabilities?.panorama ?? false);
      setReflectionCapable(capabilities?.reflection ?? false);
    }).catch(() => undefined);
    return () => { cancelled = true; };
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
  const mediaExtension = (entry?.sequenceGroup?.extension ?? entry?.extension ?? "").toLowerCase();
  const isHdrImage = /^(exr|hdr)$/i.test(mediaExtension);
  const isExrMedia = mediaExtension === "exr";
  const hasContent = !!(entry && asset && !entry.isDirectory);
  const previewKind = entry && asset ? classifyFoundPreview(entry, asset) : null;
  const toolbarVariant = previewKind && ["image", "svg", "gif", "video", "sequence"].includes(previewKind)
    ? previewKind as FoundToolbarVariant
    : null;
  const isPreview = mode === "preview";

  const loadCurrentPalette = async () => {
    if (!asset) return;
    const paletteApi = window.refCanvas.media.palette;
    if (!paletteApi) {
      setPaletteError("无法提取主色，点击重试");
      return;
    }
    const currentPath = entry?.sequenceGroup?.files[transport.snapshot?.frameIndex ?? 0] ?? asset.path;
    setPaletteLoading(true);
    setPaletteError(null);
    try {
      const palette = await paletteApi(currentPath, {
        timeMs: Math.round((transport.snapshot?.position ?? 0) * (transport.snapshot?.durationSeconds ?? 0) * 1000),
        limit: 5,
      });
      setColorSwatches(palette.slice(0, 5).map((color) => color.hex));
    } catch {
      setPaletteError("无法提取主色，点击重试");
    } finally {
      setPaletteLoading(false);
    }
  };

  const beginColorSample = async () => {
    if (isHdrImage || isVideo || toolbarVariant === "image" || toolbarVariant === "svg") {
      setEyedropActive(true);
      return;
    }
    const EyeDropper = (window as unknown as {
      EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
    }).EyeDropper;
    if (!EyeDropper) {
      setPaletteError("当前环境不支持屏幕取色");
      return;
    }
    try {
      const { sRGBHex } = await new EyeDropper().open();
      setSampledColorSwatches((colors) => [sRGBHex, ...colors.filter((color) => color !== sRGBHex)]);
    } catch {
      // Native eyedropper rejection means the user cancelled; keep the toolbar open.
    }
  };
  const toggleTool = (next: WorkbenchTool) => {
    const target = tool === next ? "preview" : next;
    window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    setTool(target);
  };

  const fpsLabel = playbackFps !== null
    ? `${playbackFps} fps`
    : frameRate
      ? `${frameRate % 1 ? frameRate.toFixed(2) : frameRate} fps`
      : "25 fps";
  const sequenceFps = entry?.sequenceGroup?.fps || foundSettings.defaultSequenceFps;
  // 序列菜单设置绝对帧率、视频菜单设置倍率；两者都经 transport 写回对应
  // 渲染器的本地状态（对话框的 setPlaybackRate 对序列按绝对 fps 解释）。
  const playbackMenu = toolbarVariant === "sequence" ? (
    <section className="playback-rate-menu" aria-label="播放帧率">
      {Array.from(new Set(foundSettings.sequenceFpsPresets)).map((fps) => (
        <button
          type="button"
          key={fps}
          className={transport.snapshot?.fps === fps ? "active" : ""}
          onClick={() => {
            transport.actions?.setPlaybackRate(fps);
            setTool("preview");
          }}
        >{fps} fps</button>
      ))}
    </section>
  ) : toolbarVariant === "video" ? (
    <section className="playback-rate-menu" aria-label="播放速度">
      {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
        <button
          type="button"
          key={rate}
          className={Math.abs((transport.snapshot?.playbackRate ?? 1) - rate) < 1e-6 ? "active" : ""}
          onClick={() => {
            transport.actions?.setPlaybackRate(rate);
            setTool("preview");
          }}
        >{rate}×</button>
      ))}
    </section>
  ) : undefined;

  // ─── Empty / directory state ───
  if (!entry || entry.isDirectory) {
    return (
      <PreviewSessionShell
        as="aside"
        elementRef={previewSession.rootRef}
        focused={previewSession.focused}
        fullscreen={previewSession.fullscreen}
        className={`found-preview-panel details-panel directory-details-panel directory-workbench-panel mode-${mode}${fullscreenControlsVisible ? " fullscreen-controls-visible" : ""}`}
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
        {/* 无素材时不提供聚焦/全屏入口：对空面板做沉浸模式没有意义，
            也避免空状态下孤零零两个按钮的奇怪排布。 */}
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
      className={`found-preview-panel details-panel directory-details-panel directory-workbench-panel ${mode === "preview" && tool !== "preview" && tool !== "lut" && tool !== "fps" && tool !== "rate" ? "tool-open" : ""} mode-${mode}${fullscreenControlsVisible ? " fullscreen-controls-visible" : ""}`}
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
                  className="workbench-preview-shell found-preview-viewport"
                >
                  {previewKind === "svg" && <FoundLayersPanel />}
                  {previewKind === "sequence" && entry.sequenceGroup ? (
                    <SequencePreviewDialog
                      key={entry.sequenceGroup.id}
                      sequence={entry.sequenceGroup}
                      embedded
                      fullscreen={previewSession.fullscreen}
                      controlsTarget={controlsTarget}
                      multichannelOpen={multichannelOpen}
                      multichannelAnchor={multichannelAnchor}
                      gifRange={gifRange}
                      gifRangeActive={sequenceGifRangeActive}
                      onGifRangeChange={(start, end) => setGifRange({ start, end })}
                      onGifRangeActiveChange={setSequenceGifRangeActive}
                      onGifExportToggle={() => {
                        const active = tool !== "gif";
                        window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
                        setTool(active ? "gif" : "preview");
                        setSequenceGifRangeActive(active);
                      }}
                      onClose={() => undefined}
                      onPaletteChange={setColorSwatches}
                      eyedropActive={eyedropActive}
                      onEyedropActiveChange={setEyedropActive}
                      onColorSample={(color) => setSampledColorSwatches((colors) => [color, ...colors.filter((candidate) => candidate !== color)])}
                    />
                  ) : (
                    <AssetPreview
                      key={asset.path}
                      asset={asset}
                      onTimeChange={setTimeSeconds}
                      playbackFps={playbackFps}
                      onOpenTool={(next, time) => {
                        setTimeSeconds(time);
                        if (next !== "color") setTool(next);
                      }}
                      onPaletteChange={setColorSwatches}
                      managed
                      controlsTarget={controlsTarget}
                      multichannelOpen={multichannelOpen}
                      multichannelAnchor={multichannelAnchor}
                      sharedColorControls
                      eyedropActive={eyedropActive}
                      onEyedropActiveChange={setEyedropActive}
                      onColorSample={(color) => setSampledColorSwatches((colors) => [color, ...colors.filter((candidate) => candidate !== color)])}
                    />
                  )}
                </PreviewSurface>

                <div className="found-preview-workspace">
                    {tool !== "preview" && tool !== "lut" && tool !== "fps" && tool !== "rate" && (
                      <section className={`found-context-tray found-context-tray-${tool}`} aria-label="上下文工具托盘">
                        <header className="found-context-tray-header">
                          <strong>{tool === "gif" ? "导出 GIF" : tool === "frames" ? "导出序列帧" : tool === "notes" ? "资产备注" : "LUT"}</strong>
                          <button type="button" aria-label="关闭工具" title="关闭工具" onClick={() => { setTool("preview"); setSequenceGifRangeActive(false); }}><X size={15} /></button>
                        </header>
                        {tool === "gif" && isVideo && (
                          <GifExportStudio
                            key={gifPaths.join("|")}
                            initialPaths={gifPaths.length ? gifPaths : [asset.path]}
                            initialTimeMs={gifPaths.length <= 1 ? timeSeconds * 1000 : 0}
                            initialRange={gifPaths.length <= 1 ? gifRange : undefined}
                            variant="panel"
                            onClose={() => setTool("preview")}
                          />
                        )}
                        {tool === "gif" && toolbarVariant === "sequence" && entry.sequenceGroup && (
                          <GifExportStudio
                            key={entry.sequenceGroup.id}
                            initialPaths={[]}
                            sequence={{
                              files: entry.sequenceGroup.files,
                              fps: transport.snapshot?.fps ?? entry.sequenceGroup.fps ?? foundSettings.defaultSequenceFps,
                              baseName: entry.sequenceGroup.baseName,
                              directory: entry.sequenceGroup.directory,
                              range: gifRange,
                            }}
                            variant="panel"
                            onClose={() => { setTool("preview"); setSequenceGifRangeActive(false); }}
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
                        {tool === "notes" && (
                          <AssetNotesPanel
                            assetId={asset.id}
                            position={transport.snapshot
                              ? transport.snapshot.kind === "sequence"
                                ? { kind: "frame", value: (entry.sequenceGroup?.start ?? 0) + transport.snapshot.frameIndex }
                                : { kind: "time", value: Math.round(transport.snapshot.position * transport.snapshot.durationSeconds * 1000) }
                              : null}
                            onSeekTime={(milliseconds) => transport.actions?.seek(transport.snapshot?.durationSeconds ? milliseconds / (transport.snapshot.durationSeconds * 1000) : 0)}
                            onSeekFrame={(frame) => {
                              const start = entry.sequenceGroup?.start ?? 0;
                              const count = transport.snapshot?.frameCount ?? 1;
                              transport.actions?.seek(Math.max(0, Math.min(1, (frame - start) / Math.max(1, count - 1))));
                            }}
                          />
                        )}
                      </section>
                    )}
                    <div className="found-preview-file-row">
                      <span className="found-preview-filename directory-inspector-title" title={entry.path}>
                        {entry.name}
                      </span>
                      {transport.snapshot?.kind === "video" && (
                        <span className="found-preview-frame-label">
                          FRAME {String(transport.snapshot.frameIndex).padStart(3, "0")}
                        </span>
                      )}
                      {transport.snapshot?.kind === "sequence" && entry.sequenceGroup && (
                        <span className="found-preview-frame-label">
                          SEQUENCE {String(entry.sequenceGroup.start + transport.snapshot.frameIndex).padStart(entry.sequenceGroup.width, "0")}
                        </span>
                      )}
                      {!toolbarVariant && (
                        <span className="found-preview-file-actions">
                          <PreviewSessionModeButtons
                            focused={previewSession.focused}
                            fullscreen={previewSession.fullscreen}
                            onToggleFocus={previewSession.toggleFocus}
                            onToggleFullscreen={() => void previewSession.toggleFullscreen()}
                          />
                        </span>
                      )}
                    </div>
                    {toolbarVariant && <FoundToolbar
                    variant={toolbarVariant}
                    seekPosition={transport.snapshot?.position ?? 0}
                    onSeekChange={(position) => transport.actions?.seek(position)}
                    seekRange={(tool === "gif" && isVideo) || (tool === "frames" && isVideo) || (toolbarVariant === "sequence" && sequenceGifRangeActive)
                      ? { ...gifRange, onChange: (start, end) => setGifRange({ start, end }) }
                      : undefined}
                    timecode={transport.snapshot?.kind === "sequence"
                      ? String((entry.sequenceGroup?.start ?? 0) + transport.snapshot.frameIndex)
                      : formatFoundTimecode(
                          (transport.snapshot?.position ?? 0) * (transport.snapshot?.durationSeconds ?? 0),
                          transport.snapshot?.kind === "gif" ? transport.snapshot.fps : null,
                        )}
                    loopActive={transport.snapshot?.looping ?? false}
                    onLoopToggle={() => transport.actions?.setLooping(!(transport.snapshot?.looping ?? false))}
                    playing={transport.snapshot?.playing ?? false}
                    onPlayingToggle={() => transport.actions?.togglePlaying()}
                    onStepFrames={(delta) => transport.actions?.stepFrames(delta)}
                    muted={transport.snapshot?.muted ?? false}
                    onMutedToggle={() => transport.actions?.setMuted(!(transport.snapshot?.muted ?? false))}
                    supremeOn={transport.snapshot?.supremeOn ?? false}
                    supremeGenerating={transport.snapshot?.supremeGenerating ?? false}
                    supremeProgress={transport.snapshot?.supremeProgress ?? null}
                    onSupremeToggle={() => transport.actions?.toggleSupreme?.()}
                    rateLabel={toolbarVariant === "video"
                      ? `${Number((transport.snapshot?.playbackRate ?? 1).toFixed(2))}×`
                      : toolbarVariant === "sequence"
                        ? transport.snapshot?.fps
                          ? `${Number(transport.snapshot.fps.toFixed(2))} fps`
                          : `${sequenceFps} fps`
                        : fpsLabel}
                    rateActive={tool === "fps" || tool === "rate"}
                    onRateToggle={toolbarVariant === "video" || toolbarVariant === "sequence"
                      ? () => toggleTool(toolbarVariant === "video" ? "rate" : "fps")
                      : undefined}
                    rateMenu={tool === "fps" || tool === "rate" ? playbackMenu : undefined}
                    showUpperRow={toolbarVariant === "video" || toolbarVariant === "gif" || toolbarVariant === "sequence"}
                    showLowerRow
                    onFit={toolbarVariant === "image" || toolbarVariant === "svg"
                      ? () => window.dispatchEvent(new Event("refcanvas:preview-fit"))
                      : undefined}
                    progressColor={foundToolbarProgressColor(toolbarVariant)}
                    colorSwatches={colorSwatches}
                    sampledColorSwatches={sampledColorSwatches}
                    paletteLoading={paletteLoading}
                    paletteError={paletteError}
                    onPaletteRetry={() => void loadCurrentPalette()}
                    onSampleColor={() => void beginColorSample()}
                    onClearSampledColors={() => setSampledColorSwatches([])}
                    trimActive={tool === "frames"}
                    onTrim={isVideo ? () => toggleTool("frames") : undefined}
                    gifActive={tool === "gif"}
                    onGifExport={isVideo ? () => toggleTool("gif") : undefined}
                    notesActive={tool === "notes"}
                    onNotesToggle={() => toggleTool("notes")}
                    lutActive={tool === "lut"}
                    onLutToggle={() => toggleTool("lut")}
                    lutMenu={tool === "lut" ? <PreviewColorTools settings={foundSettings} /> : undefined}
                    paletteActive={paletteOpen}
                    onPaletteToggle={() => {
                      const next = !paletteOpen;
                      window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
                      setPaletteOpen(next);
                      if (next) void loadCurrentPalette();
                      setEyedropActive(false);
                    }}
                    multichannel={isExrMedia}
                    multichannelActive={multichannelOpen}
                    onMultichannelToggle={isExrMedia
                      ? () => { const next = !multichannelOpen; window.dispatchEvent(new Event("refcanvas:close-preview-popovers")); setMultichannelOpen(next); }
                      : undefined}
                    multichannelButtonRef={setMultichannelAnchor}
                    rendererControlsRef={setControlsTarget}
                    trailingActions={(
                      <>{reflectionCapable && <button type="button" className={`found-tool-btn${hdrViewMode === "reflection" ? " active" : ""}`} aria-label="反射球" title="反射球" aria-pressed={hdrViewMode === "reflection"} onClick={() => {
                          const next = hdrViewMode === "reflection" ? "flat" : "reflection";
                          const currentPath = entry.sequenceGroup?.files[transport.snapshot?.frameIndex ?? 0] ?? asset.path;
                          setHdrViewMode(next);
                          window.dispatchEvent(new CustomEvent("refcanvas:hdr-view-mode", { detail: { path: currentPath, mode: next } }));
                        }}><span className="found-reflection-ball-glyph" aria-hidden="true" /></button>}
                      {panoramaCapable && <button type="button" className={`found-tool-btn${hdrViewMode === "panorama" ? " active" : ""}`} aria-label="全景模式" title="全景模式" aria-pressed={hdrViewMode === "panorama"} onClick={() => {
                          const next = hdrViewMode === "panorama" ? "flat" : "panorama";
                          const currentPath = entry.sequenceGroup?.files[transport.snapshot?.frameIndex ?? 0] ?? asset.path;
                          setHdrViewMode(next);
                          window.dispatchEvent(new CustomEvent("refcanvas:hdr-view-mode", { detail: { path: currentPath, mode: next } }));
                        }}><Globe2 size={15} /></button>}
                      <PreviewSessionModeButtons
                        focused={previewSession.focused}
                        fullscreen={previewSession.fullscreen}
                        onToggleFocus={previewSession.toggleFocus}
                        onToggleFullscreen={() => void previewSession.toggleFullscreen()}
                      /></>
                    )}
                    />}
                  </div>
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
      {isPreview && !hasContent && (
        <div className="found-preview-session-footer">
          <PreviewSessionModeButtons
            focused={previewSession.focused}
            fullscreen={previewSession.fullscreen}
            onToggleFocus={previewSession.toggleFocus}
            onToggleFullscreen={() => void previewSession.toggleFullscreen()}
          />
        </div>
      )}
    </PreviewSessionShell>
  );
}

export function FoundPreviewPanel({ entry }: { entry: DirectoryEntry | null }) {
  return (
    <PreviewTransportProvider>
      <FoundPreviewPanelContent entry={entry} />
    </PreviewTransportProvider>
  );
}
