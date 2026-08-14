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
import { FoundSlider } from "./FoundSlider";
import {
  foundToolbarCapabilities,
  foundToolbarProgressColor,
  type FoundToolbarVariant,
} from "./found-preview-model";

/**
 * Found-style dual-row toolbar.
 *
 * Upper row: + / loop / timecode / progress slider / volume
 * Lower row: auto / fps / grid / C / LUT / brush / camera / GIF / color swatches
 *
 * Spec §3: all controls rendered as static UI with props wired for future
 * real playback state. No side-effects, purely presentational skeleton.
 */

export interface FoundToolbarProps {
  variant?: FoundToolbarVariant;
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
  /** Progress fill color override (default: --found-accent). */
  progressColor?: string;
  muted?: boolean;
  onMutedToggle?: () => void;
  onTrim?: () => void;
  trimActive?: boolean;
  onGifExport?: () => void;
  gifActive?: boolean;
  playing?: boolean;
  onPlayingToggle?: () => void;
  onStepFrames?: (delta: number) => void;
  onFit?: () => void;
  /** Renderer-specific controls share this row instead of creating another toolbar. */
  rendererControlsRef?: RefCallback<HTMLDivElement>;
  multichannelButtonRef?: RefCallback<HTMLButtonElement>;
  multichannelActive?: boolean;
  /** Actions pinned to the right edge, outside the horizontally scrolling tools. */
  trailingActions?: ReactNode;
}

export function FoundToolbar({
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
  onTrim,
  trimActive = false,
  onGifExport,
  gifActive = false,
  playing = false,
  onPlayingToggle,
  onStepFrames,
  onFit,
  rendererControlsRef,
  multichannelButtonRef,
  multichannelActive = false,
  trailingActions,
}: FoundToolbarProps) {
  const capabilities = foundToolbarCapabilities(variant);
  const hasTimeline = capabilities.timeline && showUpperRow;
  const [paletteExpanded, setPaletteExpanded] = useState(true);
  const paletteVisible = paletteActive ?? colorSwatches.length > 0;
  const lutButtonRef = useRef<HTMLButtonElement>(null);
  const rateButtonRef = useRef<HTMLButtonElement>(null);
  const [lutMenuPosition, setLutMenuPosition] = useState({ left: 0, bottom: 0 });
  const [rateMenuPosition, setRateMenuPosition] = useState({ left: 0, bottom: 0 });
  const rateAriaLabel = variant === "sequence" ? "帧率" : "播放速度";
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
  return (
    <nav className={`found-toolbar found-toolbar-${variant}`} aria-label="Found 工具条" data-variant={variant}>
      {showUpperRow && (
        <div className="found-toolbar-row">
          {capabilities.timeline && <button
              className={`found-tool-btn circle${loopActive ? " active" : ""}`}
              title="循环播放"
              aria-label="循环播放"
              onClick={onLoopToggle}
              disabled={!onLoopToggle}
            ><Repeat size={13} /></button>}
          {capabilities.timeline && <button className="found-tool-btn" title="上一帧" aria-label="上一帧" onClick={() => onStepFrames?.(-1)} disabled={!onStepFrames}><SkipBack size={13} /></button>}
          {capabilities.timeline && <button className="found-tool-btn" title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"} onClick={onPlayingToggle} disabled={!onPlayingToggle}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>}
          {capabilities.timeline && <button className="found-tool-btn" title="下一帧" aria-label="下一帧" onClick={() => onStepFrames?.(1)} disabled={!onStepFrames}><SkipForward size={13} /></button>}
          {hasTimeline && <span className="found-timecode">{timecode}</span>}
          {hasTimeline && <FoundSlider
              value={seekPosition}
              onChange={onSeekChange ?? (() => {})}
              range={seekRange}
              fillColor={progressColor ?? foundToolbarProgressColor(variant)}
            />}
          {capabilities.trim && <button className={`found-tool-btn${trimActive ? " active" : ""}`} title="裁剪或分割" aria-label="裁剪或分割" aria-pressed={trimActive} onClick={onTrim} disabled={!onTrim}><Scissors size={13} /></button>}
          {capabilities.volume && <button
              className="found-tool-btn circle"
              title={muted ? "取消静音" : "音量"}
              aria-label="音量"
              onClick={onMutedToggle}
              disabled={!onMutedToggle}
            >{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}
        </div>
      )}
      {showLowerRow && paletteVisible && (
        <div className="found-color-context-toolbar" role="toolbar" aria-label="色彩栏工具">
          <div className="found-color-context-start">
            {onSampleColor && (
              <button type="button" className="found-tool-btn" aria-label="吸取颜色" title="吸取颜色" onClick={onSampleColor}>
                <Plus size={13} />
              </button>
            )}
            {sampledColorSwatches.length > 0 && (
              <span className="found-color-swatches sampled-colors" aria-label="吸取的颜色">
                {sampledColorSwatches.map((color, i) => (
                  <button
                    type="button"
                    key={`${color}:${i}`}
                    className="found-color-swatch sampled"
                    style={{ background: color }}
                    title={`复制颜色 ${color}`}
                    aria-label={`复制颜色 ${color}`}
                    onClick={() => void navigator.clipboard.writeText(color)}
                  />
                ))}
              </span>
            )}
            {sampledColorSwatches.length > 0 && onClearSampledColors && (
              <button type="button" className="found-tool-btn" aria-label="清除吸取颜色" title="清除吸取颜色" onClick={onClearSampledColors}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <span className="found-toolbar-spacer" />
          {paletteLoading && (
            <span className="found-color-palette-status" role="status">正在提取主色…</span>
          )}
          {paletteError && (
            <button type="button" className="found-color-palette-status error" onClick={onPaletteRetry} disabled={!onPaletteRetry}>
              {paletteError}
            </button>
          )}
          {(colorSwatches.length > 0 || paletteLoading) && (
            <button
              type="button"
              className="found-tool-btn found-palette-collapse"
              aria-label={paletteExpanded ? "收起固定颜色板" : "展开固定颜色板"}
              title={paletteExpanded ? "收起固定颜色板" : "展开固定颜色板"}
              onClick={() => setPaletteExpanded((expanded) => !expanded)}
            >
              {paletteExpanded ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            </button>
          )}
          {paletteExpanded && (
            <span className={`found-color-swatches fixed-colors${paletteLoading ? " loading" : ""}`} aria-label="固定主色板">
              {(paletteLoading ? Array.from({ length: 5 }, () => "") : colorSwatches.slice(0, 5)).map((color, i) => (
                color ? (
                  <button type="button" key={`${color}:${i}`} className="found-color-swatch fixed" style={{ background: color }} title={`复制颜色 ${color}`} aria-label={`复制颜色 ${color}`} onClick={() => void navigator.clipboard.writeText(color)} />
                ) : <span key={i} className="found-color-swatch fixed skeleton" aria-hidden="true" />
              ))}
            </span>
          )}
        </div>
      )}
      {showLowerRow && (
        <div className="found-toolbar-row secondary">
          <div className="found-toolbar-scroll">
          {onFit && <button type="button" className="found-tool-label found-fit-button" title="适配窗口" aria-label="适配窗口" onClick={onFit}>Fit</button>}
          <div className="found-toolbar-renderer-controls" ref={rendererControlsRef} />
          {onAutoToggle && <button
            className={`found-tool-label${autoActive ? " active" : ""}`}
            onClick={onAutoToggle}
            aria-label="自动"
            title="自动"
          >
            自动
          </button>}
          {onRateToggle && <button
            ref={rateButtonRef}
            className={`found-tool-label found-rate-trigger${rateActive ? " active" : ""}`}
            type="button"
            aria-label={rateAriaLabel}
            aria-pressed={rateActive}
            title={rateAriaLabel}
            onClick={onRateToggle}
          >{rateLabel}</button>}
          {onGridToggle && <button
            className={`found-tool-btn${gridActive ? " active" : ""}`}
            title="网格"
            aria-label="网格"
            onClick={onGridToggle}
          >
            <Grid3x3 size={13} />
          </button>}
          {multichannel && <button
            ref={multichannelButtonRef}
            className={`found-tool-label${multichannelActive ? " active" : ""}`}
            title="提取多通道"
            aria-label="提取多通道"
            aria-pressed={multichannelActive}
            onClick={onMultichannelToggle}
            disabled={!onMultichannelToggle}
          ><Layers3 size={13} /></button>}
          <button
            ref={lutButtonRef}
            className={`found-tool-label${lutActive ? " active" : ""}`}
            onClick={onLutToggle}
            aria-label="LUT"
            aria-pressed={lutActive}
            title="LUT"
            disabled={!onLutToggle}
          >
            LUT
          </button>
          <button className={`found-tool-btn${paletteVisible ? " active" : ""}`} title="吸取颜色并显示色彩栏" aria-label="色彩栏" aria-pressed={paletteVisible} onClick={onPaletteToggle} disabled={!onPaletteToggle}>
            <Palette size={13} />
          </button>
          <button className={`found-tool-btn${notesActive ? " active" : ""}`} title="资产备注" aria-label="资产备注" aria-pressed={notesActive} onClick={onNotesToggle} disabled={!onNotesToggle}>
            <NotebookPen size={13} />
          </button>
          {capabilities.gifExport && onGifExport && <button className={`found-tool-btn${gifActive ? " active" : ""}`} title="导出 GIF" aria-label="导出 GIF" aria-pressed={gifActive} onClick={onGifExport}>
            <Film size={13} />
          </button>}
          <span className="found-toolbar-spacer" />
          </div>
          <div className="found-toolbar-tail">
            {trailingActions}
          </div>
        </div>
      )}
      {lutActive && lutMenu && typeof document !== "undefined" && createPortal(
        <div
          className="found-lut-anchor-menu"
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
          className="found-rate-anchor-menu"
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
