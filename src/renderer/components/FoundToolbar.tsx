import {
  ChevronRight,
  Film,
  Pause,
  Play,
  Plus,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Grid3x3,
  Paintbrush,
  Camera,
} from "lucide-react";
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
  /** Current timecode string, e.g. "00:01:08". */
  timecode?: string;
  /** Loop active state. */
  loopActive?: boolean;
  /** Loop toggle handler. */
  onLoopToggle?: () => void;
  /** FPS / speed label, e.g. "25 fps" or "8.333". */
  fpsLabel?: string;
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
  /** Color swatches for quick palette. */
  colorSwatches?: string[];
  /** Whether to show the full upper row (video/GIF/sequence). */
  showUpperRow?: boolean;
  /** Whether to show the lower row. */
  showLowerRow?: boolean;
  /** Progress fill color override (default: --found-accent). */
  progressColor?: string;
  muted?: boolean;
  onMutedToggle?: () => void;
  onTrim?: () => void;
  onGifExport?: () => void;
  playing?: boolean;
  onPlayingToggle?: () => void;
  onStepFrames?: (delta: number) => void;
}

export function FoundToolbar({
  variant = "video",
  seekPosition = 0,
  onSeekChange,
  timecode = "00:00:00",
  loopActive = false,
  onLoopToggle,
  fpsLabel = "25 fps",
  autoActive = true,
  onAutoToggle,
  gridActive = false,
  onGridToggle,
  lutActive = false,
  onLutToggle,
  colorSwatches = [],
  showUpperRow = true,
  showLowerRow = true,
  progressColor,
  muted = false,
  onMutedToggle,
  onTrim,
  onGifExport,
  playing = false,
  onPlayingToggle,
  onStepFrames,
}: FoundToolbarProps) {
  const capabilities = foundToolbarCapabilities(variant);
  const hasTimeline = capabilities.timeline && showUpperRow;
  return (
    <nav className={`found-toolbar found-toolbar-${variant}`} aria-label="Found 工具条" data-variant={variant}>
      {showUpperRow && (
        <div className="found-toolbar-row">
          <button
            className="found-tool-btn circle"
            title="添加（尚不可用）"
            aria-label="添加"
            disabled
          >
            <Plus size={13} />
          </button>
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
              fillColor={progressColor ?? foundToolbarProgressColor(variant)}
            />}
          {capabilities.trim && <button className="found-tool-btn" title="裁剪或分割" aria-label="裁剪或分割" onClick={onTrim} disabled={!onTrim}><Scissors size={13} /></button>}
          {capabilities.trim && <button className="found-tool-btn" title="更多选项（尚不可用）" aria-label="更多选项" disabled><ChevronRight size={13} /></button>}
          {capabilities.volume && <button
              className="found-tool-btn circle"
              title={muted ? "取消静音" : "音量"}
              aria-label="音量"
              onClick={onMutedToggle}
              disabled={!onMutedToggle}
            >{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}
        </div>
      )}
      {showLowerRow && (
        <div className="found-toolbar-row secondary">
          <button
            className={`found-tool-label${autoActive ? " active" : ""}`}
            onClick={onAutoToggle}
            aria-label="自动"
            title={onAutoToggle ? "自动" : "自动（尚不可用）"}
            disabled={!onAutoToggle}
          >
            自动
          </button>
          <span className="found-timecode" style={{ fontSize: 9 }}>
            {fpsLabel}
          </span>
          <button
            className={`found-tool-btn${gridActive ? " active" : ""}`}
            title="网格"
            aria-label="网格"
            onClick={onGridToggle}
            disabled={!onGridToggle}
          >
            <Grid3x3 size={13} />
          </button>
          <button className="found-tool-label" title="尚未确认 Found 颜色模式语义" aria-label="颜色模式（尚不可用）" disabled>C</button>
          <button
            className={`found-tool-label${lutActive ? " active" : ""}`}
            onClick={onLutToggle}
            aria-label="LUT（尚不可用）"
            title="LUT/ACES 色彩管线将在后续版本提供"
            disabled
          >
            LUT
          </button>
          <button className="found-tool-btn" title="画笔（尚不可用）" aria-label="画笔" disabled>
            <Paintbrush size={13} />
          </button>
          <button className="found-tool-btn" title="截图（尚不可用）" aria-label="截图" disabled>
            <Camera size={13} />
          </button>
          {capabilities.gifExport && <button className="found-tool-btn" title="导出 GIF" aria-label="导出 GIF" onClick={onGifExport} disabled={!onGifExport}>
            <Film size={13} />
          </button>}
          <span className="found-toolbar-spacer" />
          {colorSwatches.length > 0 && (
            <span className="found-color-swatches">
              {colorSwatches.map((color, i) => (
                <span
                  key={i}
                  className="found-color-swatch"
                  style={{ background: color }}
                />
              ))}
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
