import {
  Plus,
  Repeat,
  Volume2,
  Grid3x3,
  Paintbrush,
  Camera,
  Clapperboard,
} from "lucide-react";
import { FoundSlider } from "./FoundSlider";

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
}

export function FoundToolbar({
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
}: FoundToolbarProps) {
  return (
    <nav className="found-toolbar" aria-label="Found 工具条">
      {showUpperRow && (
        <div className="found-toolbar-row">
          <button
            className="found-tool-btn circle"
            title="添加"
            aria-label="添加"
          >
            <Plus size={13} />
          </button>
          <button
            className={`found-tool-btn circle${loopActive ? " active" : ""}`}
            title="循环播放"
            aria-label="循环播放"
            onClick={onLoopToggle}
          >
            <Repeat size={13} />
          </button>
          <span className="found-timecode">{timecode}</span>
          <FoundSlider
            value={seekPosition}
            onChange={onSeekChange ?? (() => {})}
            fillColor={progressColor}
          />
          <button
            className="found-tool-btn circle"
            title="音量"
            aria-label="音量"
          >
            <Volume2 size={13} />
          </button>
        </div>
      )}
      {showLowerRow && (
        <div className="found-toolbar-row secondary">
          <button
            className={`found-tool-label${autoActive ? " active" : ""}`}
            onClick={onAutoToggle}
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
          >
            <Grid3x3 size={13} />
          </button>
          <button className="found-tool-label" title="C">C</button>
          <button
            className={`found-tool-label${lutActive ? " active" : ""}`}
            onClick={onLutToggle}
          >
            LUT
          </button>
          <button className="found-tool-btn" title="画笔" aria-label="画笔">
            <Paintbrush size={13} />
          </button>
          <button className="found-tool-btn" title="截图" aria-label="截图">
            <Camera size={13} />
          </button>
          <button className="found-tool-btn" title="GIF" aria-label="GIF">
            <Clapperboard size={13} />
          </button>
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
