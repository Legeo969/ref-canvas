import {
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Grid3x3,
  Layers3,
  NotebookPen,
  Palette,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefCallback } from "react";
import { createPortal } from "react-dom";
import { PreviewSlider } from "./PreviewSlider";
import { translate } from "../app/i18n";
import {
  previewToolbarCapabilities,
  previewToolbarProgressColor,
  type PreviewToolbarVariant,
} from "./preview-panel-model";

/**
 * Preview-style dual-row toolbar.
 *
 * Upper row: + / loop / timecode / progress slider / volume
 * Lower row: auto / fps / grid / C / LUT / brush / camera / GIF / color swatches
 *
 * Spec §3: all controls rendered as static UI with props wired for future
 * real playback state. No side-effects, purely presentational skeleton.
 */

export interface PreviewToolbarProps {
  variant?: PreviewToolbarVariant;
  /** Playback position [0, 1]. */
  seekPosition?: number;
  /** Seek position change handler. */
  onSeekChange?: (position: number) => void;
  seekRange?: { start: number; end: number; onChange(start: number, end: number): void };
  /** Current timecode string, e.g. "00:01:08". */
  timecode?: string;
  /** Loop active state. */
  loopActive?: boolean;
  /** Loop toggle handler. */
  onLoopToggle?: () => void;
  /** 帧率 / 播放速度标签（序列显示 "25 fps"，视频显示 "1.5×"）。 */
  rateLabel?: string;
  rateActive?: boolean;
  onRateToggle?: () => void;
  /** 帧率或播放速度菜单内容，锚定到速率触发器。 */
  rateMenu?: ReactNode;
  /** Auto-play active. */
  autoActive?: boolean;
  /** Auto-play toggle handler. */
  onAutoToggle?: () => void;
  /** Grid toggle active. */
  gridActive?: boolean;
  /** Grid toggle handler. */
  onGridToggle?: () => void;
  /** LUT active state. */
  lutActive?: boolean;
  /** LUT toggle handler. */
  onLutToggle?: () => void;
  /** Menu content positioned against the LUT trigger, outside clipped toolbar rows. */
  lutMenu?: ReactNode;
  onPaletteToggle?: () => void;
  paletteActive?: boolean;
  multichannel?: boolean;
  onMultichannelToggle?: () => void;
  onNotesToggle?: () => void;
  notesActive?: boolean;
  /** Color swatches for quick palette. */
  colorSwatches?: string[];
  sampledColorSwatches?: string[];
  paletteLoading?: boolean;
  paletteError?: string | null;
  onPaletteRetry?: () => void;
  onSampleColor?: () => void;
  onClearSampledColors?: () => void;
  /** Whether to show the full upper row (video/GIF/sequence). */
  showUpperRow?: boolean;
  /** Whether to show the lower row. */
  showLowerRow?: boolean;
  /** Progress fill color override (default: --preview-accent). */
  progressColor?: string;
  muted?: boolean;
  onMutedToggle?: () => void;
  /** 音量 0–1（视频/GIF 等有声源）。 */
  volume?: number;
  onVolumeChange?: (value: number) => void;
  onTrim?: () => void;
  trimActive?: boolean;
  onGifExport?: () => void;
  gifActive?: boolean;
  playing?: boolean;
  onPlayingToggle?: () => void;
  onStepFrames?: (delta: number) => void;
  /** 长按上一帧/下一帧时开始连续扫览（direction 1=前进，-1=后退）。 */
  onScrubStart?: (direction: 1 | -1) => void;
  /** 长按扫览结束（finalize 定格到最终精确帧）。 */
  onScrubStop?: (finalize: boolean) => void;
  onFit?: () => void;
  /** Renderer-specific controls share this row instead of creating another toolbar. */
  rendererControlsRef?: RefCallback<HTMLDivElement>;
  multichannelButtonRef?: RefCallback<HTMLButtonElement>;
  multichannelActive?: boolean;
  /** Actions pinned to the right edge, outside the horizontally scrolling tools. */
  trailingActions?: ReactNode;
}

export function PreviewToolbar({
  variant = "video",
  seekPosition = 0,
  onSeekChange,
  seekRange,
  timecode = "00:00:00",
  loopActive = false,
  onLoopToggle,
  rateLabel = "25 fps",
  rateActive = false,
  onRateToggle,
  rateMenu,
  autoActive = true,
  onAutoToggle,
  gridActive = false,
  onGridToggle,
  lutActive = false,
  onLutToggle,
  lutMenu,
  onPaletteToggle,
  paletteActive,
  multichannel = false,
  onMultichannelToggle,
  onNotesToggle,
  notesActive = false,
  colorSwatches = [],
  sampledColorSwatches = [],
  paletteLoading = false,
  paletteError,
  onPaletteRetry,
  onSampleColor,
  onClearSampledColors,
  showUpperRow = true,
  showLowerRow = true,
  progressColor,
  muted = false,
  onMutedToggle,
  volume = 1,
  onVolumeChange,
  onTrim,
  trimActive = false,
  onGifExport,
  gifActive = false,
  playing = false,
  onPlayingToggle,
  onStepFrames,
  onScrubStart,
  onScrubStop,
  onFit,
  rendererControlsRef,
  multichannelButtonRef,
  multichannelActive = false,
  trailingActions,
}: PreviewToolbarProps) {
  const capabilities = previewToolbarCapabilities(variant);
  const hasTimeline = capabilities.timeline && showUpperRow;
  const [paletteExpanded, setPaletteExpanded] = useState(true);
  const paletteVisible = paletteActive ?? colorSwatches.length > 0;
  const lutButtonRef = useRef<HTMLButtonElement>(null);
  const rateButtonRef = useRef<HTMLButtonElement>(null);
  const [lutMenuPosition, setLutMenuPosition] = useState({ left: 0, bottom: 0 });
  const [rateMenuPosition, setRateMenuPosition] = useState({ left: 0, bottom: 0 });
  const rateAriaLabel = variant === "sequence" ? translate("preview.rateFps") : translate("preview.rateSpeed");

  // 上一帧/下一帧按住连续扫览：短按（<250ms）= 单击步进一帧；长按 =
  // 启动 transport 的连续扫览，松键定格到最终精确帧。用 suppressStepRef
  // 避免长按松键后 onClick 又补一步（与长按首拍重复）。
  const scrubHoldRef = useRef<{ timer: number | null; direction: 1 | -1; active: boolean } | null>(null);
  const suppressStepRef = useRef(false);
  const stopScrubHold = useCallback((finalize = true, resetSuppress = false) => {
    const hold = scrubHoldRef.current;
    if (!hold) return;
    if (hold.timer !== null) window.clearTimeout(hold.timer);
    if (hold.active) {
      onScrubStop?.(finalize);
      if (resetSuppress) suppressStepRef.current = false;
    }
    scrubHoldRef.current = null;
  }, [onScrubStop]);
  const startScrubHold = useCallback((direction: 1 | -1) => {
    if (scrubHoldRef.current) stopScrubHold();
    const hold: { timer: number | null; direction: 1 | -1; active: boolean } = { timer: null, direction, active: false };
    scrubHoldRef.current = hold;
    hold.timer = window.setTimeout(() => {
      if (scrubHoldRef.current !== hold) return;
      hold.active = true;
      suppressStepRef.current = true;
      onScrubStart?.(direction);
    }, 250);
  }, [onScrubStart, stopScrubHold]);
  const handleStepClick = useCallback((delta: number) => {
    if (suppressStepRef.current) {
      suppressStepRef.current = false;
      return;
    }
    onStepFrames?.(delta);
  }, [onStepFrames]);
  const onStepPointerDown = useCallback((event: React.PointerEvent, direction: 1 | -1) => {
    if (event.button !== 0) return;
    if (!onScrubStart || !onScrubStop) return;
    event.preventDefault();
    startScrubHold(direction);
  }, [onScrubStart, onScrubStop, startScrubHold]);
  const positionLutMenu = useCallback(() => {
    const rect = lutButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLutMenuPosition({
      left: Math.max(6, Math.min(rect.left, window.innerWidth - 226)),
      bottom: Math.max(6, window.innerHeight - rect.top + 6),
    });
  }, []);
  const positionRateMenu = useCallback(() => {
    const rect = rateButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setRateMenuPosition({
      left: Math.max(6, Math.min(rect.left, window.innerWidth - 128)),
      bottom: Math.max(6, window.innerHeight - rect.top + 6),
    });
  }, []);
  useLayoutEffect(() => {
    if (lutActive && lutMenu) positionLutMenu();
  }, [lutActive, lutMenu, positionLutMenu]);
  useEffect(() => {
    if (!lutActive || !lutMenu) return;
    window.addEventListener("resize", positionLutMenu);
    window.addEventListener("scroll", positionLutMenu, true);
    return () => {
      window.removeEventListener("resize", positionLutMenu);
      window.removeEventListener("scroll", positionLutMenu, true);
    };
  }, [lutActive, lutMenu, positionLutMenu]);
  useLayoutEffect(() => {
    if (rateActive && rateMenu) positionRateMenu();
  }, [rateActive, rateMenu, positionRateMenu]);
  useEffect(() => {
    if (!rateActive || !rateMenu) return;
    window.addEventListener("resize", positionRateMenu);
    window.addEventListener("scroll", positionRateMenu, true);
    return () => {
      window.removeEventListener("resize", positionRateMenu);
      window.removeEventListener("scroll", positionRateMenu, true);
    };
  }, [rateActive, rateMenu, positionRateMenu]);
  useEffect(() => () => stopScrubHold(false, true), [stopScrubHold]);
  return (
    <nav className={`preview-toolbar preview-toolbar-${variant}`} aria-label={translate("preview.toolbarLabel")} data-variant={variant}>
      {showUpperRow && (
        <div className="preview-toolbar-row">
          {capabilities.timeline && <button
              className={`preview-tool-btn circle${loopActive ? " active" : ""}`}
              title={translate("preview.loop")}
              aria-label={translate("preview.loop")}
              onClick={onLoopToggle}
              disabled={!onLoopToggle}
            ><Repeat size={13} /></button>}
          {capabilities.timeline && <button className="preview-tool-btn" title={translate("preview.previousFrame")} aria-label={translate("preview.previousFrame")} onClick={() => handleStepClick(-1)} disabled={!onStepFrames} onPointerDown={(event) => onStepPointerDown(event, -1)} onPointerUp={() => stopScrubHold()} onPointerLeave={() => stopScrubHold(false, true)} onPointerCancel={() => stopScrubHold(false, true)} onBlur={() => stopScrubHold(false, true)}><SkipBack size={13} /></button>}
          {capabilities.timeline && <button className="preview-tool-btn" title={playing ? translate("preview.pause") : translate("preview.play")} aria-label={playing ? translate("preview.pause") : translate("preview.play")} onClick={onPlayingToggle} disabled={!onPlayingToggle}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>}
          {capabilities.timeline && <button className="preview-tool-btn" title={translate("preview.nextFrame")} aria-label={translate("preview.nextFrame")} onClick={() => handleStepClick(1)} disabled={!onStepFrames} onPointerDown={(event) => onStepPointerDown(event, 1)} onPointerUp={() => stopScrubHold()} onPointerLeave={() => stopScrubHold(false, true)} onPointerCancel={() => stopScrubHold(false, true)} onBlur={() => stopScrubHold(false, true)}><SkipForward size={13} /></button>}
          {hasTimeline && <span className="preview-timecode">{timecode}</span>}
          {hasTimeline && <PreviewSlider
              value={seekPosition}
              onChange={onSeekChange ?? (() => {})}
              range={seekRange}
              fillColor={progressColor ?? previewToolbarProgressColor(variant)}
              smoothPlayback
            />}
          {capabilities.trim && <button className={`preview-tool-btn${trimActive ? " active" : ""}`} title={translate("preview.trim")} aria-label={translate("preview.trim")} aria-pressed={trimActive} onClick={onTrim} disabled={!onTrim}><Scissors size={13} /></button>}
          {capabilities.volume && (
            <div className="preview-volume-control">
              <button
                className="preview-tool-btn circle"
                title={muted ? translate("preview.mute") : translate("preview.volume")}
                aria-label={translate("preview.volume")}
                aria-pressed={muted}
                onClick={onMutedToggle}
                disabled={!onMutedToggle}
              >{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
              {onVolumeChange && (
                <PreviewSlider
                  value={muted ? 0 : volume}
                  onChange={onVolumeChange}
                  fillColor="var(--preview-accent)"
                />
              )}
            </div>
          )}
        </div>
      )}
      {showLowerRow && paletteVisible && (
        <div className="preview-color-context-toolbar" role="toolbar" aria-label={translate("preview.colorToolbarLabel")}>
          <div className="preview-color-context-start">
            {onSampleColor && (
              <button type="button" className="preview-tool-btn" aria-label={translate("preview.sampleColor")} title={translate("preview.sampleColor")} onClick={onSampleColor}>
                <Plus size={13} />
              </button>
            )}
            {sampledColorSwatches.length > 0 && (
              <span className="preview-color-swatches sampled-colors" aria-label={translate("preview.sampledColors")}>
                {sampledColorSwatches.map((color, i) => (
                  <button
                    type="button"
                    key={`${color}:${i}`}
                    className="preview-color-swatch sampled"
                    style={{ background: color }}
                    title={translate("preview.copyColor").replace("{color}", color)}
                    aria-label={translate("preview.copyColor").replace("{color}", color)}
                    onClick={() => void navigator.clipboard.writeText(color)}
                  />
                ))}
              </span>
            )}
            {sampledColorSwatches.length > 0 && onClearSampledColors && (
              <button type="button" className="preview-tool-btn" aria-label={translate("preview.clearSampled")} title={translate("preview.clearSampled")} onClick={onClearSampledColors}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <span className="preview-toolbar-spacer" />
          {paletteLoading && (
            <span className="preview-color-palette-status" role="status">{translate("preview.paletteLoading")}</span>
          )}
          {paletteError && (
            <button type="button" className="preview-color-palette-status error" onClick={onPaletteRetry} disabled={!onPaletteRetry}>
              {paletteError}
            </button>
          )}
          {(colorSwatches.length > 0 || paletteLoading) && (
            <button
              type="button"
              className="preview-tool-btn preview-palette-collapse"
              aria-label={paletteExpanded ? translate("preview.paletteCollapse") : translate("preview.paletteExpand")}
              title={paletteExpanded ? translate("preview.paletteCollapse") : translate("preview.paletteExpand")}
              onClick={() => setPaletteExpanded((expanded) => !expanded)}
            >
              {paletteExpanded ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            </button>
          )}
          {paletteExpanded && (
            <span className={`preview-color-swatches fixed-colors${paletteLoading ? " loading" : ""}`} aria-label={translate("preview.fixedPaletteLabel")}>
              {(paletteLoading ? Array.from({ length: 5 }, () => "") : colorSwatches.slice(0, 5)).map((color, i) => (
                color ? (
                  <button type="button" key={`${color}:${i}`} className="preview-color-swatch fixed" style={{ background: color }} title={translate("preview.copyColor").replace("{color}", color)} aria-label={translate("preview.copyColor").replace("{color}", color)} onClick={() => void navigator.clipboard.writeText(color)} />
                ) : <span key={i} className="preview-color-swatch fixed skeleton" aria-hidden="true" />
              ))}
            </span>
          )}
        </div>
      )}
      {showLowerRow && (
        <div className="preview-toolbar-row secondary">
          <div className="preview-toolbar-scroll">
          {onFit && <button type="button" className="preview-tool-label preview-fit-button" title={translate("preview.fit")} aria-label={translate("preview.fit")} onClick={onFit}>{translate("imageReview.fitShort")}</button>}
          <div className="preview-toolbar-renderer-controls" ref={rendererControlsRef} />
          {onAutoToggle && <button
            className={`preview-tool-label${autoActive ? " active" : ""}`}
            onClick={onAutoToggle}
            aria-label={translate("preview.auto")}
            title={translate("preview.auto")}
          >
            {translate("preview.auto")}
          </button>}
          {onRateToggle && <button
            ref={rateButtonRef}
            className={`preview-tool-label preview-rate-trigger${rateActive ? " active" : ""}`}
            type="button"
            aria-label={rateAriaLabel}
            aria-pressed={rateActive}
            title={rateAriaLabel}
            onClick={onRateToggle}
          >{rateLabel}</button>}
          {onGridToggle && <button
            className={`preview-tool-btn${gridActive ? " active" : ""}`}
            title={translate("preview.grid")}
            aria-label={translate("preview.grid")}
            onClick={onGridToggle}
          >
            <Grid3x3 size={13} />
          </button>}
          {multichannel && <button
            ref={multichannelButtonRef}
            data-preview-multichannel
            className={`preview-tool-label${multichannelActive ? " active" : ""}`}
            title={translate("preview.multichannel")}
            aria-label={translate("preview.multichannel")}
            aria-pressed={multichannelActive}
            onClick={onMultichannelToggle}
            disabled={!onMultichannelToggle}
          ><Layers3 size={13} /></button>}
          <button
            ref={lutButtonRef}
            className={`preview-tool-label${lutActive ? " active" : ""}`}
            onClick={onLutToggle}
            aria-label={translate("preview.lut")}
            aria-pressed={lutActive}
            title={translate("preview.lut")}
            disabled={!onLutToggle}
          >
            {translate("preview.lut")}
          </button>
          <button className={`preview-tool-btn${paletteVisible ? " active" : ""}`} title={translate("preview.paletteToggleTitle")} aria-label={translate("preview.palette")} aria-pressed={paletteVisible} onClick={onPaletteToggle} disabled={!onPaletteToggle}>
            <Palette size={13} />
          </button>
          <button className={`preview-tool-btn${notesActive ? " active" : ""}`} title={translate("preview.notes")} aria-label={translate("preview.notes")} aria-pressed={notesActive} onClick={onNotesToggle} disabled={!onNotesToggle}>
            <NotebookPen size={13} />
          </button>
          {capabilities.gifExport && onGifExport && <button className={`preview-tool-btn${gifActive ? " active" : ""}`} title={translate("preview.exportGif")} aria-label={translate("preview.exportGif")} aria-pressed={gifActive} onClick={onGifExport}>
            <Film size={13} />
          </button>}
          <span className="preview-toolbar-spacer" />
          </div>
          <div className="preview-toolbar-tail">
            {trailingActions}
          </div>
        </div>
      )}
      {lutActive && lutMenu && typeof document !== "undefined" && createPortal(
        <div
          className="preview-lut-anchor-menu"
          data-placement="top-start"
          role="presentation"
          style={{ left: lutMenuPosition.left, bottom: lutMenuPosition.bottom }}
        >
          {lutMenu}
        </div>,
        document.body,
      )}
      {rateActive && rateMenu && typeof document !== "undefined" && createPortal(
        <div
          className="preview-rate-anchor-menu"
          data-placement="top-start"
          role="presentation"
          style={{ left: rateMenuPosition.left, bottom: rateMenuPosition.bottom }}
        >
          {rateMenu}
        </div>,
        document.body,
      )}
    </nav>
  );
}
