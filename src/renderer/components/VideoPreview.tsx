import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { useFoundSettings } from "../app/found-settings";
import { MediaNotesOverlay } from "./MediaNotesOverlay";

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

export function VideoPreview({ asset }: { asset: AssetRecord }) {
  const foundSettings = useFoundSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  // 阶段 5：autoplay 偏好（默认播放）；首次挂载按设置决定是否自动播放。
  const [playing, setPlaying] = useState(foundSettings.autoplayVideo);
  const autoPlayedRef = useRef(false);
  const [timecode, setTimecode] = useState(0);
  const [duration, setDuration] = useState(0);
  const [frameSource, setFrameSource] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastFrameTimeRef = useRef(0);

  // 挂载后按偏好触发播放（浏览器 autoplay 策略下静音不可行时忽略）。
  useEffect(() => {
    if (!foundSettings.autoplayVideo || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    const video = videoRef.current;
    if (video) void video.play().catch(() => undefined);
  }, [foundSettings.autoplayVideo]);

  // 单帧步进：暂停视频，用 ffmpeg 精确提取目标时间帧。
  const step = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video || stepping) return;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const next = Math.min(
      Math.max(0, current + deltaSeconds),
      Number.isFinite(video.duration) ? video.duration : current,
    );
    if (next === current && deltaSeconds > 0) return;
    video.pause();
    lastFrameTimeRef.current = next;
    setPlaying(false);
    setStepping(true);
    setFailed(false);
    void window.refCanvas.media
      .frame(asset.path, { timeMs: next * 1000, width: 1920, height: 1080 })
      .then((result) => {
        setFrameSource(result.source);
        setTimecode(next);
      })
      .catch(() => setFailed(true))
      .finally(() => setStepping(false));
  };

  return (
    <MediaNotesOverlay asset={asset}>
      <div className="video-preview">
        <video
          ref={videoRef}
          src={asset.previewUrl}
          controls
          preload="metadata"
          onPlay={() => {
            setPlaying(true);
            setFrameSource(null);
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) =>
            setTimecode(event.currentTarget.currentTime)
          }
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration);
            setTimecode(event.currentTarget.currentTime);
          }}
        >
          <track kind="captions" />
        </video>
        {frameSource && !playing && (
          <img
            className="video-frame-step"
            src={frameSource}
            alt={`精确帧 ${formatTimecode(timecode)}`}
            draggable={false}
          />
        )}
        {failed && (
          <span className="video-frame-error">无法提取该帧</span>
        )}
        <div className="video-step-controls">
          <button
            aria-label="上一帧（-1/30s）"
            disabled={stepping}
            onClick={() => step(-1 / 30)}
          >
            <SkipBack size={15} />
          </button>
          <button
            aria-label={playing ? "暂停" : "播放"}
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
            aria-label="下一帧（+1/30s）"
            disabled={stepping}
            onClick={() => step(1 / 30)}
          >
            <SkipForward size={15} />
          </button>
          <span className="video-timecode">
            {formatTimecode(timecode)}
            {duration > 0 ? ` / ${formatTimecode(duration)}` : ""}
          </span>
        </div>
      </div>
    </MediaNotesOverlay>
  );
}
