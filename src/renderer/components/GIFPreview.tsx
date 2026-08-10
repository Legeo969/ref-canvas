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

interface GifFrame {
  image: ImageBitmap;
  durationMs: number;
}

interface DecodedGif {
  frames: GifFrame[];
}

type ImageDecoderLike = {
  tracks: {
    ready: Promise<void>;
    selected: { frameCount: number } | null;
  };
  decode(options: { frameIndex: number }): Promise<{
    image: ImageBitmap;
    duration?: number | undefined;
  }>;
  close(): void;
};

const ImageDecoderCtor = (
  globalThis as unknown as {
    ImageDecoder?: new (options: {
      data: Blob;
      type: string;
    }) => ImageDecoderLike;
  }
).ImageDecoder;

/**
 * GIF preview with playback control using the platform ImageDecoder: pause,
 * speed, frame stepping, a frame timeline and current-frame export. The GIF is
 * decoded locally frame by frame; nothing leaves the machine.
 */
export function GIFPreview({ asset }: { asset: AssetRecord }) {
  const [gif, setGif] = useState<DecodedGif | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
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
      try {
        const response = await fetch(asset.previewUrl);
        const blob = await response.blob();
        const decoder = new ImageDecoderCtor!({ data: blob, type: "image/gif" });
        await decoder.tracks.ready;
        const count = decoder.tracks.selected?.frameCount ?? 1;
        const frames: GifFrame[] = [];
        for (let index = 0; index < count; index += 1) {
          const { image, duration } = await decoder.decode({ frameIndex: index });
          frames.push({ image, durationMs: duration ?? 100 });
          if (cancelled) {
            decoder.close();
            return;
          }
        }
        decoder.close();
        const decoded = { frames };
        gifRef.current = decoded;
        setGif(decoded);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
        frameIndexRef.current = (frameIndexRef.current + 1) % current.frames.length;
        setFrameIndex(frameIndexRef.current);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    lastTickRef.current = 0;
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [gif, playing, rate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = gif?.frames[frameIndex];
    if (!canvas || !frame) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = frame.image.width;
    canvas.height = frame.image.height;
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

  if (error) {
    return <span className="preview-message">无法解码 GIF</span>;
  }

  const count = gif?.frames.length ?? 0;

  return (
    <div className="gif-preview">
      <canvas ref={canvasRef} className="gif-preview-canvas" />
      {count > 1 && (
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
      />
    </div>
  );
}
