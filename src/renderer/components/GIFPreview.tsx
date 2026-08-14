import {
  Download,
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { PreviewColorBar } from "./PreviewColorBar";
import { usePreviewTransportRegistration } from "./PreviewTransport";

interface GifFrame {
  image: VideoFrame;
  durationMs: number;
}

interface DecodedGif {
  frames: GifFrame[];
}

export function gifFrameIndexForPosition(
  frames: ReadonlyArray<Pick<GifFrame, "durationMs">>,
  position: number,
): number {
  if (frames.length === 0) return 0;
  const duration = frames.reduce((total, frame) => total + frame.durationMs, 0);
  if (duration <= 0) return Math.min(frames.length - 1, Math.max(0, Math.round(position * (frames.length - 1))));
  const target = Math.min(1, Math.max(0, position)) * duration;
  let elapsed = 0;
  for (let index = 0; index < frames.length; index += 1) {
    elapsed += frames[index].durationMs;
    if (target < elapsed || index === frames.length - 1) return index;
  }
  return frames.length - 1;
}

type ImageDecoderLike = {
  tracks: {
    ready: Promise<void>;
    selected: { frameCount: number } | null;
  };
  decode(options: { frameIndex: number }): Promise<{
    image: VideoFrame;
    duration?: number | undefined;
  }>;
  close(): void;
};

const ImageDecoderCtor = (
  globalThis as unknown as {
    ImageDecoder?: new (options: {
      data: ArrayBuffer;
      type: string;
    }) => ImageDecoderLike;
  }
).ImageDecoder;

/**
 * GIF preview with playback control using the platform ImageDecoder: pause,
 * speed, frame stepping, a frame timeline and current-frame export. The GIF is
 * decoded locally frame by frame; nothing leaves the machine.
 */
export function GIFPreview({ asset, managed = false, onPaletteChange }: { asset: AssetRecord; managed?: boolean; onPaletteChange?: (colors: string[]) => void }) {
  const [gif, setGif] = useState<DecodedGif | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [looping, setLooping] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIndexRef = useRef(0);
  const gifRef = useRef<DecodedGif | null>(null);
  const playingRef = useRef(true);
  const rateRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setGif(null);
    setError(false);
    setFrameIndex(0);
    frameIndexRef.current = 0;
    if (!ImageDecoderCtor) {
      setError(true);
      return;
    }
    void (async () => {
      let decoder: ImageDecoderLike | null = null;
      let committed = false;
      const frames: GifFrame[] = [];
      try {
        const response = await fetch(asset.previewUrl, {
          referrer: window.location.href,
        });
        if (!response.ok) throw new Error(`GIF_FETCH_${response.status}`);
        const data = await response.arrayBuffer();
        decoder = new ImageDecoderCtor!({ data, type: "image/gif" });
        await decoder.tracks.ready;
        const count = decoder.tracks.selected?.frameCount ?? 1;
        for (let index = 0; index < count; index += 1) {
          const { image, duration } = await decoder.decode({ frameIndex: index });
          frames.push({ image, durationMs: duration ?? 100 });
          if (cancelled) return;
        }
        const decoded = { frames };
        gifRef.current = decoded;
        setGif(decoded);
        committed = true;
      } catch {
        if (!cancelled) setError(true);
      } finally {
        decoder?.close();
        // 取消或失败时，已解码但未挂载到 gifRef 的 VideoFrame 必须关闭，
        // 否则快速切换资源会泄漏 GPU/解码器内存。
        if (!committed) {
          for (const frame of frames) frame.image.close();
        }
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      for (const frame of gifRef.current?.frames ?? []) frame.image.close();
      gifRef.current = null;
    };
  }, [asset.id, asset.previewUrl]);

  useEffect(() => {
    playingRef.current = playing;
    rateRef.current = rate;
  }, [playing, rate]);

  useEffect(() => {
    if (!gif || !playing || !ImageDecoderCtor) return;
    const draw = (timestamp: number) => {
      const current = gifRef.current;
      if (!current || !playingRef.current) return;
      if (lastTickRef.current === 0) lastTickRef.current = timestamp;
      const elapsed = timestamp - lastTickRef.current;
      const frameDuration = current.frames[frameIndexRef.current]?.durationMs ?? 100;
      if (elapsed >= frameDuration / rateRef.current) {
        lastTickRef.current = timestamp;
        const next = frameIndexRef.current + 1;
        if (next >= current.frames.length && !looping) {
          setPlaying(false);
          return;
        }
        frameIndexRef.current = next % current.frames.length;
        setFrameIndex(frameIndexRef.current);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    lastTickRef.current = 0;
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [gif, looping, playing, rate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = gif?.frames[frameIndex];
    if (!canvas || !frame) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = frame.image.displayWidth;
    canvas.height = frame.image.displayHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame.image, 0, 0);
  }, [gif, frameIndex]);

  const step = (delta: number) => {
    if (!gif) return;
    const next =
      (frameIndexRef.current + delta + gif.frames.length) % gif.frames.length;
    frameIndexRef.current = next;
    setFrameIndex(next);
  };

  const exportFrame = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exporting) return;
    setExporting(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      await window.refCanvas.system.saveRegionCapture(dataUrl);
    } finally {
      setExporting(false);
    }
  };

  const durationMs = gif?.frames.reduce((total, frame) => total + frame.durationMs, 0) ?? 0;
  const elapsedMs = gif?.frames.slice(0, frameIndex).reduce((total, frame) => total + frame.durationMs, 0) ?? 0;
  usePreviewTransportRegistration({
    kind: "gif",
    playing,
    position: durationMs > 0 ? elapsedMs / durationMs : 0,
    durationSeconds: durationMs / 1000,
    frameIndex,
    frameCount: gif?.frames.length ?? 0,
    fps: durationMs > 0 && gif ? gif.frames.length / (durationMs / 1000) : null,
    playbackRate: rate,
    looping,
    muted: true,
    volume: 0,
  }, {
    togglePlaying: () => setPlaying((value) => !value),
    seek: (position) => {
      if (!gif?.frames.length) return;
      const next = gifFrameIndexForPosition(gif.frames, position);
      frameIndexRef.current = next;
      setFrameIndex(next);
    },
    stepFrames: step,
    setLooping,
    setPlaybackRate: (value) => setRate(Math.min(8, Math.max(0.25, value))),
    setMuted: () => undefined,
    setVolume: () => undefined,
  });

  if (error) {
    return <span className="preview-message">无法解码 GIF</span>;
  }

  const count = gif?.frames.length ?? 0;

  return (
    <div className="gif-preview">
      <canvas ref={canvasRef} className="gif-preview-canvas" />
      {!managed && count > 1 && (
        <div className="gif-controls">
          <button
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button aria-label="上一帧" onClick={() => step(-1)}>
            <SkipBack size={14} />
          </button>
          <button aria-label="下一帧" onClick={() => step(1)}>
            <SkipForward size={14} />
          </button>
          <button
            aria-label="减速"
            onClick={() => setRate((value) => Math.max(0.25, value / 2))}
          >
            <Rewind size={14} />
          </button>
          <span className="gif-rate">{rate}×</span>
          <button
            aria-label="加速"
            onClick={() => setRate((value) => Math.min(8, value * 2))}
          >
            <FastForward size={14} />
          </button>
          <input
            className="gif-timeline"
            type="range"
            min={0}
            max={count - 1}
            value={frameIndex}
            aria-label="GIF 帧时间轴"
            onChange={(event) => {
              const index = Number(event.target.value);
              frameIndexRef.current = index;
              setFrameIndex(index);
            }}
          />
          <span className="gif-frame-count">
            {frameIndex + 1}/{count}
          </span>
          <button aria-label="导出当前帧" onClick={() => void exportFrame()}>
            <Download size={14} />
          </button>
        </div>
      )}
      <PreviewColorBar
        compact
        source={() => canvasRef.current}
        revision={frameIndex}
        onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
      />
    </div>
  );
}
