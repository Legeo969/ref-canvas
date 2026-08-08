/**
 * 白板 GIF 动画对象核心：ImageDecoder 帧解码 + 循环播放器。
 * 时间推进与状态解析抽成纯函数（可单测）；GifAnimator 只负责把帧
 * 绘制到共享画布并回调渲染层（BoardCanvas 将画布挂到 fabric.Image._element）。
 */

export interface GifState {
  playing: boolean;
  frame: number;
  rate: number;
}

export const DEFAULT_GIF_STATE: GifState = { playing: true, frame: 0, rate: 1 };
export const MIN_GIF_RATE = 0.25;
export const MAX_GIF_RATE = 8;

/** 按帧时长推进一帧：未到时间返回 null（停留当前帧），到时间返回下一帧索引（循环）。 */
export function nextFrameIndex(
  current: number,
  count: number,
  elapsedMs: number,
  frameDurationMs: number,
  rate: number,
): number | null {
  if (count <= 1 || elapsedMs < frameDurationMs / rate) return null;
  return (current + 1) % count;
}

/** 从对象 data.gif 解析播放状态（未知/非法字段回退默认）。 */
export function gifStateFromData(
  raw: Partial<GifState> | undefined,
  frameCount: number,
): GifState {
  const playing = raw?.playing !== false;
  const frame =
    typeof raw?.frame === "number" && Number.isInteger(raw.frame)
      ? Math.min(Math.max(0, raw.frame), Math.max(0, frameCount - 1))
      : 0;
  const rate =
    typeof raw?.rate === "number" && Number.isFinite(raw.rate)
      ? Math.min(MAX_GIF_RATE, Math.max(MIN_GIF_RATE, raw.rate))
      : 1;
  return { playing, frame, rate };
}

interface GifFrame {
  image: ImageBitmap;
  durationMs: number;
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

export function hasImageDecoder(): boolean {
  return typeof ImageDecoderCtor === "function";
}

/**
 * GIF 循环播放器：解码全部帧后按帧时长 rAF 循环，把当前帧绘制到
 * 复用画布并回调 onFrame(canvas, index)。未解码完成前保持静帧；
 * 解码失败走 onError（渲染层保留 URL 静态首帧）。
 */
export class GifAnimator {
  private frames: GifFrame[] = [];
  private frameIndex = 0;
  private playing = true;
  private rate = 1;
  private rafId: number | null = null;
  private lastTick = 0;
  private disposed = false;
  private ready = false;
  private frameCanvas: HTMLCanvasElement | null = null;

  constructor(
    private readonly url: string,
    private readonly onFrame: (canvas: HTMLCanvasElement, index: number) => void,
    private readonly onError: () => void,
  ) {}

  get frameCount(): number {
    return this.frames.length;
  }

  get currentIndex(): number {
    return this.frameIndex;
  }

  async load(): Promise<void> {
    if (this.disposed) return;
    if (!ImageDecoderCtor) {
      this.onError();
      return;
    }
    try {
      const response = await fetch(this.url);
      const blob = await response.blob();
      if (this.disposed) return;
      const decoder = new ImageDecoderCtor({ data: blob, type: "image/gif" });
      await decoder.tracks.ready;
      const count = decoder.tracks.selected?.frameCount ?? 1;
      const frames: GifFrame[] = [];
      for (let index = 0; index < count; index += 1) {
        const { image, duration } = await decoder.decode({ frameIndex: index });
        frames.push({ image, durationMs: duration ?? 100 });
        if (this.disposed) {
          decoder.close();
          return;
        }
      }
      decoder.close();
      this.frames = frames;
      this.ready = true;
      if (this.disposed) return;
      this.frameIndex = Math.min(this.frameIndex, Math.max(0, count - 1));
      this.drawFrame();
      if (this.playing) this.startLoop();
    } catch {
      if (!this.disposed) this.onError();
    }
  }

  play(): void {
    if (this.disposed || this.playing) return;
    this.playing = true;
    if (this.ready) this.startLoop();
  }

  pause(): void {
    if (this.disposed) return;
    this.playing = false;
    this.stopLoop();
  }

  setRate(rate: number): void {
    this.rate = Math.min(MAX_GIF_RATE, Math.max(MIN_GIF_RATE, rate));
  }

  /** 跳帧（未解码完成时记录目标，解码后生效）。 */
  setFrame(index: number): void {
    const target = Math.max(0, index);
    this.frameIndex = target;
    if (this.ready && this.frames.length > 0) {
      this.frameIndex = Math.min(target, this.frames.length - 1);
      this.drawFrame();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.frames = [];
    this.frameCanvas = null;
  }

  private drawFrame(): void {
    const frame = this.frames[this.frameIndex];
    if (!frame) return;
    const canvas =
      this.frameCanvas ??
      (this.frameCanvas = document.createElement("canvas"));
    if (canvas.width !== frame.image.width || canvas.height !== frame.image.height) {
      canvas.width = frame.image.width;
      canvas.height = frame.image.height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame.image, 0, 0);
    this.onFrame(canvas, this.frameIndex);
  }

  private startLoop(): void {
    if (this.rafId !== null || this.frames.length <= 1) return;
    this.lastTick = 0;
    const tick = (timestamp: number) => {
      if (this.disposed || !this.playing) return;
      if (this.lastTick === 0) this.lastTick = timestamp;
      const frame = this.frames[this.frameIndex];
      const next = nextFrameIndex(
        this.frameIndex,
        this.frames.length,
        timestamp - this.lastTick,
        frame?.durationMs ?? 100,
        this.rate,
      );
      if (next !== null) {
        this.lastTick = timestamp;
        this.frameIndex = next;
        this.drawFrame();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
