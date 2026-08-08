import { Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { translate } from "../app/i18n";
import { MediaNotesOverlay } from "./MediaNotesOverlay";

/**
 * 音频预览（阶段 4）：播放 + canvas 波形。
 *
 * 波形数据来自 media.waveform（provider 流式峰值），等时间间隔，
 * 播放时在波形上绘制当前进度；seek 点击定位。
 */

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function AudioPreview({
  asset,
}: {
  asset: Pick<AssetRecord, "id" | "path" | "extension" | "previewUrl">;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const peaksRef = useRef<number[] | null>(null);
  const progressRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setDuration(null);
    setProgress(0);
    if (!window.refCanvas.media?.waveform) return;
    void window.refCanvas.media
      .waveform(asset.path, { samples: 2400 })
      .then((result) => {
        if (cancelled) return;
        setPeaks(result.peaks);
        setDuration(result.durationSeconds);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.path]);

  // 波形绘制（峰值 + 进度高亮）。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    peaksRef.current = peaks;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const data = peaksRef.current;
    if (!data || !data.length) {
      context.fillStyle = "#3a4a44";
      context.fillRect(0, height / 2 - 1, width, 2);
      context.fillStyle = "#5d6f67";
      context.font = "12px Segoe UI, sans-serif";
      context.fillText(translate("audio.loadingWaveform"), 12, 18);
      return;
    }
    const step = width / data.length;
    const progressX = progressRef.current * width;
    for (let i = 0; i < data.length; i += 1) {
      const x = i * step;
      const barHeight = Math.max(1.5, data[i] * (height - 12));
      const y = (height - barHeight) / 2;
      context.fillStyle = x < progressX ? "#7fb8a0" : "#3d4f47";
      context.fillRect(x + 0.5, y, Math.max(1, step - 1), barHeight);
    }
  }, [peaks, progress]);

  return (
    <MediaNotesOverlay asset={asset}>
      <div className="audio-preview">
        <canvas
          ref={canvasRef}
          className="audio-waveform"
          width={960}
          height={140}
          onClick={(event) => {
            const audio = audioRef.current;
            if (!audio || !Number.isFinite(audio.duration)) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - bounds.left) / bounds.width;
            audio.currentTime = ratio * audio.duration;
            setProgress(ratio);
          }}
        />
        <audio
          ref={audioRef}
          src={asset.previewUrl}
          controls
          preload="metadata"
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            const value =
              Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.currentTime / audio.duration
                : 0;
            progressRef.current = value;
            setProgress(value);
          }}
          onLoadedMetadata={(event) =>
            setDuration(event.currentTarget.duration)
          }
        >
          <track kind="captions" />
        </audio>
        <div className="audio-meta">
          <Headphones size={15} />
          <span>{asset.extension.toUpperCase()}</span>
          <span>{formatDuration(duration)}</span>
          {peaks ? <span>{translate("audio.sampleCount").replace("{count}", String(peaks.length))}</span> : null}
        </div>
      </div>
    </MediaNotesOverlay>
  );
}
