import { Film, Images, Pause, Play, Repeat2, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import type { PaletteColor } from "../../shared/color-palette";
import { useFoundSettings } from "../app/found-settings";
import { translate } from "../app/i18n";
import { MediaNotesOverlay } from "./MediaNotesOverlay";
import { GifExportStudio } from "./GifExportStudio";
import { PreviewColorBar } from "./PreviewColorBar";
import { VideoFramesExportDialog } from "./VideoFramesExportDialog";
import { usePreviewTransportRegistration } from "./PreviewTransport";

/**
 * 视频预览（阶段 3 §9.3）：原生播放 + 精确逐帧。
 *
 * 播放使用 video 标签；暂停时逐帧步进走 media:frame（ffmpeg
 * -ss + accurate_seek），不依赖不精确的 HTML video seek。
 */

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function VideoPreview({
  asset,
  persistNotes = true,
  onOpenTool,
  onTimeChange,
  playbackFps,
  onPaletteChange,
  eyedropActive = false,
  onEyedropActiveChange,
  onColorSample,
}: {
  asset: Pick<AssetRecord, "id" | "path" | "previewUrl">;
  persistNotes?: boolean;
  onOpenTool?: (tool: "gif" | "frames" | "color" | "fps", timeSeconds: number, color?: PaletteColor) => void;
  onTimeChange?: (timeSeconds: number) => void;
  playbackFps?: number | null;
  onPaletteChange?: (colors: string[]) => void;
  eyedropActive?: boolean;
  onEyedropActiveChange?: (active: boolean) => void;
  onColorSample?: (color: string) => void;
}) {
  const foundSettings = useFoundSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameImageRef = useRef<HTMLImageElement>(null);
  const assetPathRef = useRef(asset.path);
  assetPathRef.current = asset.path;
  // 阶段 5：autoplay 偏好（默认播放）；首次挂载按设置决定是否自动播放。
  const [playing, setPlaying] = useState(foundSettings.autoplayVideo);
  const autoPlayedRef = useRef(false);
  const [timecode, setTimecode] = useState(0);
  const [duration, setDuration] = useState(0);
  const [frameSource, setFrameSource] = useState<string | null>(null);
  const [frameRate, setFrameRate] = useState<number | null>(null);
  const [stepping, setStepping] = useState(false);
  const [failed, setFailed] = useState(false);
  const [gifStudioOpen, setGifStudioOpen] = useState(false);
  const [framesDialogOpen, setFramesDialogOpen] = useState(false);
  const [looping, setLooping] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [paletteTimeMs, setPaletteTimeMs] = useState(0);
  const [samplePoint, setSamplePoint] = useState<{ x: number; y: number; color: string } | null>(null);
  const sampleReticleTimerRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const paletteTimerRef = useRef<number | null>(null);
  const pendingPaletteTimeRef = useRef(0);
  const lastPaletteUpdateRef = useRef(0);
  const effectiveFrameRate = playbackFps ?? frameRate;

  const sampleDisplayedPixel = (event: MouseEvent<HTMLElement>) => {
    if (!eyedropActive) return;
    const source = frameSource && !playing ? frameImageRef.current : videoRef.current;
    // 任何失败路径都显式退出取色，避免吸管光标/准星永远停在画面上。
    if (!source) {
      onEyedropActiveChange?.(false);
      return;
    }
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      onEyedropActiveChange?.(false);
      return;
    }
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) {
      onEyedropActiveChange?.(false);
      return;
    }
    const canvas = document.createElement("canvas");
    const x = Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) * width / rect.width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) * height / rect.height)));
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      onEyedropActiveChange?.(false);
      return;
    }
    let pixel: Uint8ClampedArray;
    try {
      context.imageSmoothingEnabled = false;
      context.drawImage(source, x, y, 1, 1, 0, 0, 1, 1);
      pixel = context.getImageData(0, 0, 1, 1).data;
    } catch {
      onEyedropActiveChange?.(false);
      return;
    }
    const color = `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    setSamplePoint({ x: event.clientX - rect.left, y: event.clientY - rect.top, color });
    // 准星只做极短的「点在了这里」反馈（约 250ms），随即消失。
    if (sampleReticleTimerRef.current !== null) window.clearTimeout(sampleReticleTimerRef.current);
    sampleReticleTimerRef.current = window.setTimeout(() => {
      sampleReticleTimerRef.current = null;
      setSamplePoint(null);
    }, 250);
    onColorSample?.(color);
    onEyedropActiveChange?.(false);
  };

  const schedulePalette = (seconds: number, immediate = false) => {
    pendingPaletteTimeRef.current = Math.max(0, seconds * 1000);
    const elapsed = performance.now() - lastPaletteUpdateRef.current;
    const delay = immediate ? 0 : Math.max(0, 800 - elapsed);
    if (paletteTimerRef.current !== null) {
      if (!immediate) return;
      window.clearTimeout(paletteTimerRef.current);
    }
    paletteTimerRef.current = window.setTimeout(() => {
      paletteTimerRef.current = null;
      lastPaletteUpdateRef.current = performance.now();
      setPaletteTimeMs(Math.round(pendingPaletteTimeRef.current));
    }, delay);
  };

  useEffect(() => () => {
    if (paletteTimerRef.current !== null) window.clearTimeout(paletteTimerRef.current);
    if (sampleReticleTimerRef.current !== null) window.clearTimeout(sampleReticleTimerRef.current);
  }, []);

  // 挂载后按偏好触发播放（浏览器 autoplay 策略下静音不可行时忽略）。
  useEffect(() => {
    if (!foundSettings.autoplayVideo || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    const video = videoRef.current;
    if (video) void video.play().catch(() => undefined);
  }, [foundSettings.autoplayVideo]);

  useEffect(() => {
    let cancelled = false;
    setFrameRate(null);
    setFrameSource(null);
    lastFrameTimeRef.current = 0;
    void window.refCanvas.media
      .probe(asset.path)
      .then((probe) => {
        const value = probe.extra?.frameRate;
        if (!cancelled && typeof value === "number" && value > 0) {
          setFrameRate(value);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [asset.path]);

  // 单帧步进：暂停视频，用 ffmpeg 精确提取目标时间帧。
  const step = (deltaFrames: number) => {
    const video = videoRef.current;
    if (!video || !effectiveFrameRate || stepping) return;
    const current = lastFrameTimeRef.current;
    const deltaSeconds = deltaFrames / effectiveFrameRate;
    const next = Math.min(
      Math.max(0, current + deltaSeconds),
      Number.isFinite(video.duration) ? video.duration : current,
    );
    if (next === current && deltaSeconds > 0) return;
    video.pause();
    video.currentTime = next;
    lastFrameTimeRef.current = next;
    setPlaying(false);
    setStepping(true);
    setFailed(false);
    const requestPath = asset.path;
    void window.refCanvas.media
      .frame(requestPath, { timeMs: next * 1000, width: 1920, height: 1080 })
      .then((result) => {
        if (assetPathRef.current !== requestPath) return;
        setFrameSource(result.source);
        setTimecode(next);
        onTimeChange?.(next);
        if (onOpenTool) schedulePalette(next, true);
      })
      .catch(() => {
        if (assetPathRef.current === requestPath) setFailed(true);
      })
      .finally(() => {
        if (assetPathRef.current === requestPath) setStepping(false);
      });
  };

  usePreviewTransportRegistration({
    kind: "video",
    playing,
    position: duration > 0 ? timecode / duration : 0,
    durationSeconds: duration,
    frameIndex: effectiveFrameRate ? Math.floor(timecode * effectiveFrameRate) : 0,
    frameCount: effectiveFrameRate && duration > 0 ? Math.ceil(duration * effectiveFrameRate) : 0,
    fps: effectiveFrameRate,
    playbackRate,
    looping,
    muted,
    volume,
  }, {
    togglePlaying: () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) void video.play().catch(() => undefined);
      else video.pause();
    },
    seek: (position) => {
      const video = videoRef.current;
      if (!video || duration <= 0) return;
      const next = Math.min(1, Math.max(0, position)) * duration;
      video.currentTime = next;
      lastFrameTimeRef.current = next;
      setTimecode(next);
      setFrameSource(null);
      onTimeChange?.(next);
      schedulePalette(next, true);
    },
    stepFrames: step,
    setLooping,
    setPlaybackRate: (value) => {
      const next = Math.min(8, Math.max(0.25, value));
      if (videoRef.current) videoRef.current.playbackRate = next;
      setPlaybackRate(next);
    },
    setMuted: (value) => {
      if (videoRef.current) videoRef.current.muted = value;
      setMuted(value);
    },
    setVolume: (value) => {
      const next = Math.min(1, Math.max(0, value));
      if (videoRef.current) videoRef.current.volume = next;
      setVolume(next);
      if (next > 0) setMuted(false);
    },
  });

  const content = (
    <div className={`video-preview${eyedropActive ? " is-sampling" : ""}`}>
        {/* crossOrigin：画布取色需要 CORS-clean 源；协议仅在可信 origin
            下回 ACAO，缺失时取色静默失效——与 ImageReviewPreview 的
            fetch+ImageBitmap 兜底不对称，属刻意取舍。 */}
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          src={asset.previewUrl}
          onClick={sampleDisplayedPixel}
          controls={!onOpenTool}
          loop={looping}
          muted={muted}
          preload="metadata"
          onPlay={() => {
            setPlaying(true);
            setFrameSource(null);
          }}
          onVolumeChange={(event) => {
            setMuted(event.currentTarget.muted);
            setVolume(event.currentTarget.volume);
          }}
          onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            lastFrameTimeRef.current = event.currentTarget.currentTime;
            setTimecode(event.currentTarget.currentTime);
            onTimeChange?.(event.currentTarget.currentTime);
            if (onOpenTool) schedulePalette(event.currentTarget.currentTime);
          }}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration);
            lastFrameTimeRef.current = event.currentTarget.currentTime;
            setTimecode(event.currentTarget.currentTime);
            if (onOpenTool) schedulePalette(event.currentTarget.currentTime, true);
          }}
          onSeeked={(event) => {
            if (onOpenTool) schedulePalette(event.currentTarget.currentTime, true);
          }}
        >
          <track kind="captions" />
        </video>
        {frameSource && !playing && (
          <img
            ref={frameImageRef}
            className="video-frame-step"
            crossOrigin="anonymous"
            src={frameSource}
            alt={translate("video.frameAlt").replace("{timecode}", formatTimecode(timecode))}
            draggable={false}
            onClick={sampleDisplayedPixel}
          />
        )}
        {samplePoint && (
          <span
            className="preview-sample-reticle"
            aria-hidden="true"
            style={{ left: samplePoint.x, top: samplePoint.y, "--sample-color": samplePoint.color } as React.CSSProperties}
          />
        )}
        {failed && (
          <span className="video-frame-error">{translate("video.frameError")}</span>
        )}
        {onOpenTool && (
          <input
            className="video-workbench-seek"
            aria-label="视频时间线"
            type="range"
            min={0}
            max={duration || 0}
            step={effectiveFrameRate ? 1 / effectiveFrameRate : 0.01}
            value={Math.min(timecode, duration || 0)}
            onChange={(event) => {
              const video = videoRef.current;
              if (!video) return;
              const next = Number(event.target.value);
              video.currentTime = next;
              lastFrameTimeRef.current = next;
              setTimecode(next);
              setFrameSource(null);
              onTimeChange?.(next);
              schedulePalette(next);
            }}
            onPointerUp={() => schedulePalette(videoRef.current?.currentTime ?? timecode, true)}
          />
        )}
        <div className={`video-step-controls${onOpenTool ? " found-managed" : ""}`}>
          <button
            aria-label={translate("sequence.previousFrame")}
            disabled={stepping || effectiveFrameRate === null}
            onClick={() => step(-1)}
          >
            <SkipBack size={15} />
          </button>
          <button
            aria-label={playing ? translate("sequence.pause") : translate("sequence.play")}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (playing) {
                video.pause();
              } else {
                void video.play().catch(() => undefined);
                setFrameSource(null);
              }
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            aria-label={translate("sequence.nextFrame")}
            disabled={stepping || effectiveFrameRate === null}
            onClick={() => step(1)}
          >
            <SkipForward size={15} />
          </button>
          <span className="video-timecode">
            {formatTimecode(timecode)}
            {duration > 0 ? ` / ${formatTimecode(duration)}` : ""}
          </span>
          {onOpenTool && (
            <button
              className="video-fps-button"
              aria-label="打开 FPS 预设"
              title="选择逐帧与时间线 FPS"
              onClick={() => onOpenTool("fps", timecode)}
            >
              {playbackFps == null ? "自动 " : ""}
              {(effectiveFrameRate ?? 0).toFixed(effectiveFrameRate && effectiveFrameRate % 1 ? 2 : 0)} FPS
            </button>
          )}
          {onOpenTool && <button className={looping ? "active" : ""} aria-label="循环播放" title="循环播放" onClick={() => setLooping((value) => !value)}><Repeat2 size={15} /></button>}
          {onOpenTool && <button aria-label={muted ? "取消静音" : "静音"} title={muted ? "取消静音" : "静音"} onClick={() => setMuted((value) => !value)}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>}
          <button
            type="button"
            className="video-gif-button"
            onClick={() => onOpenTool ? onOpenTool("gif", timecode) : setGifStudioOpen(true)}
            title="打开 GIF 导出工作台"
          >
            <Film size={14} />
            GIF
          </button>
          <button
            type="button"
            className="video-gif-button"
            onClick={() => onOpenTool ? onOpenTool("frames", timecode) : setFramesDialogOpen(true)}
            title="导出 PNG/JPG 序列帧"
          >
            <Images size={14} />
            序列帧
          </button>
          {onOpenTool ? (
            <PreviewColorBar
              compact
              live
              autoRefresh
              assetPath={asset.path}
              timeMs={paletteTimeMs}
              revision={paletteTimeMs}
              source={() => frameSource && !playing ? frameImageRef.current : videoRef.current}
              onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
            />
          ) : (
            <PreviewColorBar
              compact
              assetPath={asset.path}
              timeMs={timecode * 1000}
              source={() => frameSource && !playing ? frameImageRef.current : videoRef.current}
              revision={`${frameSource ?? "video"}:${timecode}:${playing}`}
              onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
            />
          )}
        </div>
        {!onOpenTool && gifStudioOpen && (
          <GifExportStudio
            initialPaths={[asset.path]}
            onClose={() => setGifStudioOpen(false)}
          />
        )}
        {!onOpenTool && framesDialogOpen && (
          <VideoFramesExportDialog
            inputPath={asset.path}
            durationSeconds={duration}
            sourceFps={frameRate}
            onClose={() => setFramesDialogOpen(false)}
          />
        )}
    </div>
  );
  return persistNotes ? (
    <MediaNotesOverlay asset={asset}>{content}</MediaNotesOverlay>
  ) : (
    content
  );
}
