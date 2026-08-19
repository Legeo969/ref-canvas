import { Film, Images, Pause, Play, Repeat2, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import type { PaletteColor } from "../../shared/color-palette";
import { usePreviewSettings } from "../app/preview-settings";
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

/**
 * 长按 ←/→ 加速扫览（jog/shuttle）：按住期间每 50ms 走一拍，档位按
 * 拍数递增（每 400ms 一档，1→2→4→…→64 帧/拍）。播放器原生 seek
 * 赶不上时 Chromium 自动合并（只应用最后一次 currentTime），高端档
 * 表现为跳帧式快速扫览。松键后用一次 ffmpeg 精确抓帧把显示定格在
 * 最终帧。第 0 拍固定 1 帧，保证短按仍是「精确单帧」。
 */
const SCRUB_TICK_MS = 50;
const SCRUB_TIER_MS = 400;
const SCRUB_TICK_FRAMES = [1, 2, 4, 8, 16, 32, 64] as const;

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
  const previewSettings = usePreviewSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameImageRef = useRef<HTMLImageElement>(null);
  /** 预览根：可聚焦，方向键按焦点归属路由（点击预览后接管 ←/→）。 */
  const rootRef = useRef<HTMLDivElement>(null);
  const assetPathRef = useRef(asset.path);
  assetPathRef.current = asset.path;
  /** 精确抓帧的世代号：每次新抓帧递增，旧抓帧的异步结果据此作废。 */
  const grabEpochRef = useRef(0);
  /** 长按扫览状态：方向 + 已走拍数 + 计时器；null = 未在扫览。 */
  const scrubStateRef = useRef<{
    direction: 1 | -1;
    ticks: number;
    timer: number | null;
  } | null>(null);
  // 阶段 5：autoplay 偏好（默认播放）；首次挂载按设置决定是否自动播放。
  const [playing, setPlaying] = useState(previewSettings.autoplayVideo);
  const autoPlayedRef = useRef(false);
  const [timecode, setTimecode] = useState(0);
  const [duration, setDuration] = useState(0);
  const [frameSource, setFrameSource] = useState<string | null>(null);
  const [frameRate, setFrameRate] = useState<number | null>(null);
  const [stepping, setStepping] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 抓帧失败的具体原因（IPC reject 的 error message），悬停可见，便于定位。 */
  const [failureReason, setFailureReason] = useState<string | null>(null);
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
    if (!previewSettings.autoplayVideo || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    const video = videoRef.current;
    if (video) void video.play().catch(() => undefined);
  }, [previewSettings.autoplayVideo]);

  useEffect(() => {
    // 素材切换：重置抓帧相关状态，重新探测帧率。
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

  /** 预加载帧图：图片完全解码后再换到 <img>，避免新帧 src 替换时
   *  黑色背景 overlay 先露出来造成黑屏闪烁。 */
  const loadFrameImage = (source: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(source);
      image.onerror = () => reject(new Error("FRAME_IMAGE_LOAD_FAILED"));
      image.src = source;
    });
  // 单帧步进：暂停视频，用 ffmpeg 精确提取目标时间帧。
  // 抓帧是异步的：epoch 递增使旧抓帧结果作废（连续步进/扫览/切素材时
  // 晚到的旧帧不得覆盖新画面）。
  // frameRetriedRef：一次抓帧流程（用户步进/seek/扫览落位）中，帧图
  // 加载失败只自动重抓一次；重抓后无论成败都不再自动重试，转正式错误。
  const frameRetriedRef = useRef(false);
  /** 帧提取/加载失败时回退到 video 原生当前帧：不中断浏览，也不显示
   *  “无法提取该帧”的致命错误条。精确帧仍优先，失败只是降级显示。 */
  const fallbackToVideoFrame = (next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    lastFrameTimeRef.current = next;
    setFrameSource(null);
    setPlaying(false);
    setFailed(false);
    setFailureReason(null);
    try {
      video.currentTime = next;
    } catch {
      // 某些容器在 metadata 就绪前不允许 seek；静默忽略即可。
    }
    setTimecode(next);
    onTimeChange?.(next);
    if (onOpenTool) schedulePalette(next, true);
  };
  const grabFrameAt = (next: number, { retry = false } = {}) => {
    const video = videoRef.current;
    if (!video) return;
    if (!retry) frameRetriedRef.current = false;
    video.pause();
    lastFrameTimeRef.current = next;
    setPlaying(false);
    setStepping(true);
    setFailed(false);
    setFailureReason(null);
    const requestPath = asset.path;
    const epoch = ++grabEpochRef.current;
    void window.refCanvas.media
      .frame(requestPath, { timeMs: next * 1000, width: 1920, height: 1080 })
      .then(async (result) => {
        if (assetPathRef.current !== requestPath || epoch !== grabEpochRef.current) return;
        try {
          // 先完整解码帧图，再替换画面；旧帧图保持显示直到新图就绪。
          const loaded = await loadFrameImage(result.source);
          if (assetPathRef.current !== requestPath || epoch !== grabEpochRef.current) return;
          if (videoRef.current) videoRef.current.currentTime = next;
          setFrameSource(loaded);
          setTimecode(next);
          onTimeChange?.(next);
          if (onOpenTool) schedulePalette(next, true);
        } catch {
          if (assetPathRef.current === requestPath && epoch === grabEpochRef.current) {
            if (!retry) {
              setFrameSource(null);
              grabFrameAt(next, { retry: true });
            } else {
              // 图片加载失败（如 token 协议瞬时拒绝）不再致命：回退 video 帧。
              fallbackToVideoFrame(next);
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (assetPathRef.current === requestPath && epoch === grabEpochRef.current) {
          // ffmpeg 提取失败不再显示致命错误条：回退 video 原生 seek，
          // 用户可继续浏览；具体原因保留在 console 便于诊断。
          console.warn(`[VideoPreview] frame extraction failed at ${next}s`, error);
          fallbackToVideoFrame(next);
        }
      })
      .finally(() => {
        if (assetPathRef.current === requestPath && epoch === grabEpochRef.current) setStepping(false);
      });
  };

  const step = (deltaFrames: number) => {
    const video = videoRef.current;
    if (!video || !effectiveFrameRate || stepping) return;
    // 步进按钮按下时结束进行中的长按扫览（本次步进自己负责抓帧）。
    if (scrubStateRef.current) stopScrubRef.current(false);
    const current = lastFrameTimeRef.current;
    const deltaSeconds = deltaFrames / effectiveFrameRate;
    const next = Math.min(
      Math.max(0, current + deltaSeconds),
      Number.isFinite(video.duration) ? video.duration : current,
    );
    if (next === current && deltaSeconds > 0) return;
    grabFrameAt(next);
  };

  const stepRef = useRef(step);
  stepRef.current = step;

  // 长按扫览的节拍：按当前档位把 currentTime 推进一步；到边界则停止。
  const scrubTick = () => {
    const state = scrubStateRef.current;
    const video = videoRef.current;
    if (!state || !video || !effectiveFrameRate) return;
    const tier = Math.min(
      SCRUB_TICK_FRAMES.length - 1,
      Math.floor((state.ticks * SCRUB_TICK_MS) / SCRUB_TIER_MS),
    );
    state.ticks += 1;
    const frames = SCRUB_TICK_FRAMES[tier] * state.direction;
    const current = lastFrameTimeRef.current;
    const duration = Number.isFinite(video.duration)
      ? video.duration
      : Number.POSITIVE_INFINITY;
    const next = Math.min(
      Math.max(0, current + frames / effectiveFrameRate),
      duration,
    );
    if (next === current) {
      stopScrubRef.current(false);
      return;
    }
    video.currentTime = next;
    lastFrameTimeRef.current = next;
    setTimecode(next);
    onTimeChange?.(next);
    if (onOpenTool) schedulePalette(next);
  };
  const scrubTickRef = useRef(scrubTick);
  scrubTickRef.current = scrubTick;

  const stopScrub = (finalize: boolean) => {
    const state = scrubStateRef.current;
    if (!state) return;
    scrubStateRef.current = null;
    if (state.timer !== null) window.clearInterval(state.timer);
    // 快速浏览模式：松键时保留播放器当前位置，不做 ffmpeg 精确抓帧，
    // 避免连续 seek 后额外抓帧造成黑屏/卡顿。
    void finalize;
  };
  const stopScrubRef = useRef(stopScrub);
  stopScrubRef.current = stopScrub;

  const startScrub = (direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video || !effectiveFrameRate) return;
    const existing = scrubStateRef.current;
    if (existing) {
      // 已按住：同向保持当前加速；反向翻转时重置档位（计时器保留）。
      if (existing.direction === direction) return;
      scrubStateRef.current = { direction, ticks: 0, timer: existing.timer };
      return;
    }
    setFrameSource(null);
    // 使在途的精确抓帧作废：其结果不得覆盖扫览画面。
    grabEpochRef.current += 1;
    scrubStateRef.current = {
      direction,
      ticks: 0,
      timer: window.setInterval(() => scrubTickRef.current(), SCRUB_TICK_MS),
    };
    // 按下即走一拍（第 0 拍 = 1 帧），避免停顿一个 tick 的延迟感。
    scrubTickRef.current();
  };
  const startScrubRef = useRef(startScrub);
  startScrubRef.current = startScrub;
  // 点击画面 / 空格 = 播放/暂停（取色激活时点击仍走取色）。
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };
  const togglePlaybackRef = useRef(togglePlayback);
  togglePlaybackRef.current = togglePlayback;

  // ←/→ 逐帧：短按 = 精确单帧；长按 = 加速扫览（计时器驱动，忽略
  // 浏览器按键自动重复）。按键按焦点归属路由：事件目标在本预览根内
  // （点击画面后），或位于预览面板（点击工具栏后方向键仍归
  // 预览）才响应；目录网格等全局方向键处理在目标进入预览区域后让位。
  // 空格只在预览根内生效（工具栏按钮保留原生 Space 激活语义）；滑杆
  // 等自带方向键处理的控件除外。扫览中窗口失焦（Alt-Tab 等）立即停止。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (typing) return;
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== " "
      ) {
        return;
      }
      const root = rootRef.current;
      if (!root || !(target instanceof Node)) return;
      const insideRoot = root.contains(target);
      const inPreviewPanel =
        target instanceof Element &&
        target.closest(".preview-panel") != null;
      if (!insideRoot && !inPreviewPanel) return;
      if (
        target instanceof Element &&
        target.closest("button, input, textarea, select, a, [role='slider']")
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === " ") {
        if (!event.repeat && insideRoot) togglePlaybackRef.current();
        return;
      }
      if (event.repeat) return;
      startScrubRef.current(event.key === "ArrowLeft" ? -1 : 1);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      stopScrubRef.current(true);
    };
    const onBlur = () => stopScrubRef.current(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stopScrubRef.current(false);
    };
  }, []);

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
    startScrub: (direction) => startScrubRef.current(direction),
    stopScrub: (finalize) => stopScrubRef.current(finalize),
  });

  const content = (
    <div
      ref={rootRef}
      className={`video-preview${eyedropActive ? " is-sampling" : ""}`}
      tabIndex={-1}
      onPointerDown={(event) => {
        // 点击画面/空白区把键盘焦点收进预览根：此后 ←/→ 由预览接管，
        // 目录网格等全局方向键处理让位（防止「按一下又步进又跳目录」）。
        // 交互控件（按钮/输入框/滑杆等）保持原生焦点，不抢焦点。
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("button, input, textarea, select, a, [tabindex]")
        ) {
          return;
        }
        rootRef.current?.focus({ preventScroll: true });
      }}
    >
        {/* crossOrigin：画布取色需要 CORS-clean 源；协议仅在可信 origin
            下回 ACAO，缺失时取色静默失效——与 ImageReviewPreview 的
            fetch+ImageBitmap 兜底不对称，属刻意取舍。 */}
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          src={asset.previewUrl}
          onClick={(event) => {
            // 取色激活时点击 = 采样像素；否则点击画面 = 播放/暂停。
            if (eyedropActive) {
              sampleDisplayedPixel(event);
              return;
            }
            togglePlayback();
          }}
          controls={!onOpenTool}
          loop={looping}
          muted={muted}
          preload="metadata"
          onPlay={() => {
            setPlaying(true);
            setFrameSource(null);
            // 播放/继续播放时结束进行中的长按扫览，避免 seek 与播放打架。
            stopScrubRef.current(false);
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
            onError={() => {
              // 帧图 URL 加载失败（会话 token 淘汰等瞬态）：本次抓帧
              // 流程自动重抓一次（重新签发 token）；仍失败才转正式错误
              // 提示。绝不外露浏览器破图占位 + alt 文本，也不无限重试。
              if (frameSource && !frameRetriedRef.current) {
                frameRetriedRef.current = true;
                setFrameSource(null);
                grabFrameAt(lastFrameTimeRef.current, { retry: true });
                return;
              }
              setFrameSource(null);
              setFailed(true);
              setFailureReason("FRAME_IMAGE_LOAD_FAILED");
            }}
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
          <span
            className="video-frame-error"
            title={failureReason ?? undefined}
          >
            {translate("video.frameError")}
          </span>
        )}
        {onOpenTool && (
          <input
            className="video-workbench-seek"
            aria-label={translate("video.timeline")}
            type="range"
            min={0}
            max={duration || 0}
            step={effectiveFrameRate ? 1 / effectiveFrameRate : 0.01}
            value={Math.min(timecode, duration || 0)}
            style={{ "--seek-fill": `${duration > 0 ? Math.min(100, (timecode / duration) * 100) : 0}%` } as React.CSSProperties}
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
        <div className={`video-step-controls${onOpenTool ? " preview-managed" : ""}`}>
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
              aria-label={translate("video.fpsPreset")}
              title={translate("video.fpsPresetTitle")}
              onClick={() => onOpenTool("fps", timecode)}
            >
              {playbackFps == null ? `${translate("preview.auto")} ` : ""}
              {(effectiveFrameRate ?? 0).toFixed(effectiveFrameRate && effectiveFrameRate % 1 ? 2 : 0)} FPS
            </button>
          )}
          {onOpenTool && <button className={looping ? "active" : ""} aria-label={translate("preview.loop")} title={translate("preview.loop")} onClick={() => setLooping((value) => !value)}><Repeat2 size={15} /></button>}
          {onOpenTool && <button aria-label={muted ? translate("preview.mute") : translate("video.mute")} title={muted ? translate("preview.mute") : translate("video.mute")} onClick={() => setMuted((value) => !value)}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>}
          <button
            type="button"
            className="video-gif-button"
            onClick={() => onOpenTool ? onOpenTool("gif", timecode) : setGifStudioOpen(true)}
            title={translate("video.gifExport")}
          >
            <Film size={14} />
            GIF
          </button>
          <button
            type="button"
            className="video-gif-button"
            onClick={() => onOpenTool ? onOpenTool("frames", timecode) : setFramesDialogOpen(true)}
            title={translate("video.framesExport")}
          >
            <Images size={14} />
            {translate("video.framesExportShort")}
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
