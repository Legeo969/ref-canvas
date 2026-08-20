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
import { translate } from "../app/i18n";
import { PreviewColorBar } from "./PreviewColorBar";
import { usePreviewTransportRegistration } from "./PreviewTransport";
import { clearPlaybackClock, publishPlaybackClock } from "./playback-clock";

const GIF_KEYBOARD_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]);

/**
 * 播放进度条的位置/帧号刷新间隔（≈30Hz）。
 * 太稀（100ms）会显著影响时长短的 GIF：每个 tick 内进度跳一大格，看起来很
 * 卡。transport 已幂等注册 + 大组件已 memo，30Hz 的同步推送是可负担的。
 */
const GIF_POSITION_TICK_MS = 33;

async function renderImageToDataUrl(image: HTMLImageElement): Promise<string> {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** 加载单个 URL 为已就绪的 <img>（失败返回 null）。 */
function loadGifFrameImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image.naturalWidth > 0 ? image : null);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * 把主进程 ffmpeg 拆出的全部 PNG URL 加载成 ImageBitmap（分块并发，避免
 * 165 个同时解码压垮 GPU）。返回 null 表示任一帧加载失败。
 */
async function loadGifFramesBitmaps(urls: string[]): Promise<ImageBitmap[] | null> {
  const bitmaps: ImageBitmap[] = [];
  const CHUNK = 16;
  for (let offset = 0; offset < urls.length; offset += CHUNK) {
    const chunkUrls = urls.slice(offset, offset + CHUNK);
    const images = await Promise.all(chunkUrls.map(loadGifFrameImage));
    const chunk = await Promise.all(
      images.map((image) =>
        image
          ? createImageBitmap(image).catch(() => null)
          : Promise.resolve(null),
      ),
    );
    for (const bitmap of chunk) {
      if (!bitmap) {
        for (const loaded of bitmaps) loaded.close();
        return null;
      }
      bitmaps.push(bitmap);
    }
  }
  return bitmaps;
}

/** 轻量 GIF 时长解析：不依赖 ImageDecoder/ffprobe，纯字节读取总帧延迟。 */
function parseGifDurationMs(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 13) return 0;
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  if (header !== "GIF87a" && header !== "GIF89a") return 0;
  let offset = 6;
  const packed = bytes[offset + 4] ?? 0;
  offset += 7;
  if (packed & 0x80) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
  }
  let totalMs = 0;
  let frames = 0;
  while (offset < bytes.length) {
    const block = bytes[offset];
    offset += 1;
    if (block === 0x3b) break;
    if (block === 0x2c) {
      frames += 1;
      if (offset + 9 > bytes.length) break;
      const imagePacked = bytes[offset + 8];
      offset += 9;
      if (imagePacked & 0x80) {
        offset += 3 * (1 << ((imagePacked & 0x07) + 1));
      }
      if (offset >= bytes.length) break;
      offset += 1; // LZW 最小码长
      while (offset < bytes.length) {
        const size = bytes[offset];
        offset += 1;
        if (size === 0) break;
        offset += size;
      }
    } else if (block === 0x21) {
      if (offset >= bytes.length) break;
      const label = bytes[offset];
      offset += 1;
      while (offset < bytes.length) {
        const size = bytes[offset];
        offset += 1;
        if (size === 0) break;
        if (label === 0xf9 && size >= 4 && offset + 2 < bytes.length) {
          const delay = bytes[offset + 1] | (bytes[offset + 2] << 8);
          totalMs += (delay || 10) * 10;
        }
        offset += size;
      }
    } else {
      break;
    }
  }
  return totalMs > 0 ? totalMs : frames * 100;
}

interface GifFrame {
  /** 解码出的帧位图（VideoFrame 转 ImageBitmap 后，canvas 可同步绘制）。 */
  bitmap: ImageBitmap;
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
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [looping, setLooping] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [nativePosition, setNativePosition] = useState(0);
  const [probeDuration, setProbeDuration] = useState<number | null>(null);
  const [staticSrc, setStaticSrc] = useState<string | null>(null);
  /** canvas 绘制连续失败时置位，退回原生 <img> 播放（保证画面一定能动）。 */
  const [canvasBroken, setCanvasBroken] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const frameIndexRef = useRef(0);
  const nativePositionRef = useRef(0);
  const playheadRef = useRef(0);
  const timeLastTickRef = useRef(0);
  const gifRef = useRef<DecodedGif | null>(null);
  const playingRef = useRef(true);
  const rateRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const staticFrameSeqRef = useRef(0);
  const togglePlaybackRef = useRef<() => void>(() => undefined);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawFrameRef = useRef<(index: number) => void>(() => undefined);
  const drawnFrameRef = useRef(-1);
  const canvasErrorRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setGif(null);
    setFrameIndex(0);
    frameIndexRef.current = 0;
    setNativePosition(0);
    nativePositionRef.current = 0;
    playheadRef.current = 0;
    timeLastTickRef.current = 0;
    setProbeDuration(asset.duration ?? null);
    setStaticSrc(null);
    setCanvasBroken(false);
    canvasErrorRef.current = 0;
    if (!ImageDecoderCtor) {
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
          // VideoFrame → ImageBitmap：canvas.drawImage 对 ImageBitmap 稳定支持，
          // 避免直接绘制 VideoFrame 在部分 Chromium 版本静默失败（画面不播）。
          const { image, duration } = await decoder.decode({ frameIndex: index });
          const bitmap = await createImageBitmap(image);
          image.close();
          if (cancelled) {
            bitmap.close();
            return;
          }
          // ImageDecoder 的 duration 按毫秒处理；为 0/缺省时按常见 100ms 兜底。
          frames.push({
            bitmap,
            durationMs: duration != null && duration > 0 ? duration : 100,
          });
        }
        // Chromium 的 ImageDecoder 对大型 GIF 只报 1 帧（完整 body 也如此）。
        // 改为主进程 ffmpeg 整包拆帧，把全部 PNG 当位图播放（准确且绕开解码器）。
        if (frames.length <= 1) {
          const api = window.refCanvas?.media?.gifFrames;
          if (api) {
            try {
              const extracted = await api(asset.path);
              if (extracted && extracted.count > 1 && extracted.urls.length > 1) {
                const bitmaps = await loadGifFramesBitmaps(extracted.urls);
                if (bitmaps && bitmaps.length > 1) {
                  for (const frame of frames) frame.bitmap.close();
                  frames.length = 0;
                  for (const bitmap of bitmaps) {
                    if (cancelled) {
                      bitmap.close();
                      return;
                    }
                    // 统一按时长比例驱动播放（总时长仍用 ffprobe 权威值）。
                    frames.push({ bitmap, durationMs: 100 });
                  }
                } else {
                  for (const bitmap of bitmaps ?? []) bitmap.close();
                }
              }
            } catch {
              // 拆帧失败时退回 ImageDecoder 结果（<=1 帧，画面静止但不崩溃）。
            }
          }
        }
        const decoded = { frames };
        gifRef.current = decoded;
        setGif(decoded);
        committed = true;
      } catch {
        // 解码失败时保持 gif=null，回退到原生 <img> 播放。
      } finally {
        decoder?.close();
        // 取消或失败时，未挂载到 gifRef 的帧必须在资源切换前释放，避免泄漏。
        if (!committed) {
          for (const frame of frames) frame.bitmap.close();
        }
      }
    })();
    return () => {
      cancelled = true;
      clearPlaybackClock();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      for (const frame of gifRef.current?.frames ?? []) frame.bitmap.close();
      gifRef.current = null;
    };
  }, [asset.id, asset.previewUrl]);

  useEffect(() => {
    playingRef.current = playing;
    rateRef.current = rate;
  }, [playing, rate]);

  // 无论 ImageDecoder 是否可用，都用 ffprobe / GIF 字节解析补一个权威时长，
  // 避免 ImageDecoder 返回的帧时长单位不一致导致进度条/时间码异常。
  useEffect(() => {
    if (asset.duration != null || probeDuration != null) return;
    let cancelled = false;
    const applySeconds = (seconds: number) => {
      if (!cancelled && seconds > 0) setProbeDuration(seconds);
    };
    if (window.refCanvas?.media?.probe) {
      void window.refCanvas.media.probe(asset.path)
        .then((result) => {
          if (result.duration != null) applySeconds(result.duration);
        })
        .catch(() => undefined);
    }
    // 渲染端直接解析 GIF 字节作为兜底，避免只依赖主进程 IPC/ffprobe。
    void fetch(asset.previewUrl, { referrer: window.location.href })
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => {
        if (!buffer) return;
        const ms = parseGifDurationMs(buffer);
        if (ms > 0) applySeconds(ms / 1000);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [asset.id, asset.path, asset.previewUrl, asset.duration, gif, probeDuration]);

  // 权威总时长（ffprobe/资产元数据，秒）× 1000。播放/进度/时间码都由它驱动；
  // 帧号只用帧时长相对比例（含变长帧延迟），不受 ImageDecoder 单位差异影响。
  const rawFrameTotalMs = gif?.frames.reduce((sum, frame) => sum + frame.durationMs, 0) ?? 0;
  const authoritativeTotalMs = (probeDuration ?? asset.duration ?? 0) * 1000;
  const durationMs = authoritativeTotalMs > 0
    ? authoritativeTotalMs
    : (rawFrameTotalMs > 0 ? rawFrameTotalMs : (gif ? gif.frames.length * 100 : 0));
  const nativeDurationSeconds = probeDuration ?? asset.duration ?? 0;

  // 解码模式：用 canvas 逐帧精确播放（ImageDecoder 帧 + 真实时钟），
  // 与进度/时间码共用同一 playhead；暂停即在 canvas 上定格当前帧，
  // 恢复从该帧继续播放——补上原生 <img> 做不到的「从暂停处续播」。
  useEffect(() => {
    if (!gif || !playing || !ImageDecoderCtor || canvasBroken) return;
    const totalMs = durationMs;
    let lastProgressUpdate = 0;
    let lastFrameStateUpdate = 0;
    const draw = (timestamp: number) => {
      const current = gifRef.current;
      if (!current || current.frames.length === 0 || !playingRef.current) return;
      if (timeLastTickRef.current === 0) timeLastTickRef.current = timestamp;
      const timeElapsed = timestamp - timeLastTickRef.current;
      timeLastTickRef.current = timestamp;
      playheadRef.current += timeElapsed * rateRef.current;
      let ratio = nativePositionRef.current;
      if (totalMs > 0) {
        if (playheadRef.current >= totalMs && !looping) {
          playheadRef.current = totalMs;
          nativePositionRef.current = 1;
          setNativePosition(1);
          drawFrameRef.current(current.frames.length - 1);
          setFrameIndex(current.frames.length - 1);
          setPlaying(false);
          return;
        }
        playheadRef.current = playheadRef.current % totalMs;
        ratio = Math.min(1, Math.max(0, playheadRef.current / totalMs));
        nativePositionRef.current = ratio;
        // 60fps 播放时钟：只让订阅滑块重渲染，面板不随每帧走。
        publishPlaybackClock(ratio, true);
        if (timestamp - lastProgressUpdate >= GIF_POSITION_TICK_MS) {
          lastProgressUpdate = timestamp;
          setNativePosition(ratio);
        }
      }
      // 帧号/画面：按 playhead 相对比例定位（单位无关，天然兼容变长帧延迟）。
      const index = gifFrameIndexForPosition(current.frames, ratio);
      if (index !== frameIndexRef.current) {
        frameIndexRef.current = index;
        drawFrameRef.current(index);
        if (timestamp - lastFrameStateUpdate >= GIF_POSITION_TICK_MS) {
          lastFrameStateUpdate = timestamp;
          setFrameIndex(index);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    timeLastTickRef.current = 0;
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [gif, looping, playing, rate, durationMs, canvasBroken]);

  // canvas 挂载/资源切换：按首帧尺寸初始化画布并绘制当前帧，避免空白/黑屏。
  useEffect(() => {
    const frames = gifRef.current?.frames ?? [];
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    canvas.width = frames[0].bitmap.width;
    canvas.height = frames[0].bitmap.height;
    drawFrameRef.current(frameIndexRef.current);
  }, [gif]);

  // 原生 <img> 回退（ImageDecoder 不可用/解码失败）时没有逐帧数据，
  // 用 asset.duration/probe 时长驱动虚拟进度，保证预览窗口/白板弹窗的进度条仍会移动。
  useEffect(() => {
    const duration = probeDuration ?? asset.duration ?? 0;
    if ((gif && !canvasBroken) || !playing || !duration || duration <= 0) return;
    let rafId = 0;
    let last = 0;
    let lastProgressUpdate = 0;
    const tick = (timestamp: number) => {
      if (last === 0) last = timestamp;
      const elapsed = (timestamp - last) / 1000;
      last = timestamp;
      const next = nativePositionRef.current + (elapsed * rateRef.current) / duration;
      if (next >= 1 && !looping) {
        nativePositionRef.current = 1;
        setNativePosition(1);
        setPlaying(false);
        return;
      }
      nativePositionRef.current = Math.min(1, Math.max(0, next % 1));
      playheadRef.current = nativePositionRef.current * duration * 1000;
      publishPlaybackClock(nativePositionRef.current, true);
      if (timestamp - lastProgressUpdate >= GIF_POSITION_TICK_MS) {
        lastProgressUpdate = timestamp;
        setNativePosition(nativePositionRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gif, playing, looping, asset.duration, probeDuration, canvasBroken]);

  // 解码模式：把指定帧直接绘制到画布（瞬时、无 IPC、无黑屏）。
  // 同帧不重复绘制，避免拖动过程反复重绘造成卡顿。
  const drawFrame = (index: number) => {
    if (index === drawnFrameRef.current || canvasBroken) return;
    const frame = gifRef.current?.frames[index];
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = frame.bitmap.width;
    const height = frame.bitmap.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    drawnFrameRef.current = index;
    try {
      context.clearRect(0, 0, width, height);
      context.drawImage(frame.bitmap, 0, 0, width, height);
      canvasErrorRef.current = 0;
    } catch {
      drawnFrameRef.current = -1;
      canvasErrorRef.current += 1;
      if (canvasErrorRef.current >= 3) {
        // canvas 绘制连续失败：退回原生 <img> 播放，保证画面能动。
        setCanvasBroken(true);
      }
    }
  };
  drawFrameRef.current = drawFrame;

  // 统一锚定表达：进度/时间码/playhead/帧索引用同一个比例同步。
  const applyRatio = (ratio: number) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    nativePositionRef.current = clamped;
    setNativePosition(clamped);
    if (durationMs > 0) playheadRef.current = clamped * durationMs;
    if (gifRef.current?.frames.length) {
      const next = gifFrameIndexForPosition(gifRef.current.frames, clamped);
      frameIndexRef.current = next;
      setFrameIndex(next);
    }
    // 拖动/暂停/步进后把位置同步进播放时钟，滑块立即跟到位（不等到下个 rAF）。
    publishPlaybackClock(clamped, playingRef.current);
  };

  // 回退模式（无解码帧）暂停/定格：捕获 <img> 当前帧为静态图。
  const captureCurrentFrame = () => {
    const image = imgRef.current;
    if (!image || !image.complete || image.naturalWidth === 0) return;
    try {
      void renderImageToDataUrl(image)
        .then((src) => setStaticSrc(src))
        .catch(() => undefined);
    } catch {
      // 捕获失败保持上一帧。
    }
  };

  // 播放/暂停。暂停：进度对齐 playhead，画面同步定格；恢复：
  // 解码模式从暂停帧无缝续播；回退模式原生 <img> 只能从头播，故归零保持一致。
  const togglePlayback = () => {
    if (playingRef.current) {
      const ratio = durationMs > 0
        ? Math.min(1, Math.max(0, playheadRef.current / durationMs))
        : nativePositionRef.current;
      applyRatio(ratio);
      setPlaying(false);
      if (gifRef.current?.frames.length && !canvasBroken) {
        drawFrame(frameIndexRef.current);
      } else {
        captureCurrentFrame();
      }
    } else {
      if (gifRef.current?.frames.length && !canvasBroken) {
        // 解码模式：画布已定格在当前帧，直接续播，不重置进度。
        setPlaying(true);
      } else {
        // 回退/异常模式：原生 <img> 从头播，同步归零。
        playheadRef.current = 0;
        nativePositionRef.current = 0;
        setNativePosition(0);
        frameIndexRef.current = 0;
        setFrameIndex(0);
        setStaticSrc(null);
        setPlaying(true);
      }
    }
  };
  togglePlaybackRef.current = togglePlayback;

  const step = (delta: number) => {
    if (!gif) return;
    const next =
      (frameIndexRef.current + delta + gif.frames.length) % gif.frames.length;
    frameIndexRef.current = next;
    setFrameIndex(next);
    setPlaying(false);
    // 同步进度/时间码到该帧对应的时刻（按相对帧时长的比例）。
    const frameTotal = gif.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    const frameElapsed = gif.frames.slice(0, next).reduce((sum, frame) => sum + frame.durationMs, 0);
    const ratio = frameTotal > 0
      ? frameElapsed / frameTotal
      : (gif.frames.length > 1 ? next / (gif.frames.length - 1) : 0);
    nativePositionRef.current = ratio;
    setNativePosition(ratio);
    if (durationMs > 0) playheadRef.current = ratio * durationMs;
    if (canvasBroken) {
      if (durationMs > 0) void loadStaticFrame(durationMs * ratio);
    } else {
      drawFrame(next);
    }
  };

  // 统一方向键：←/→ 逐帧；↑/↓ 无操作（GIF 无音量）；Space 播放/暂停。
  // 焦点路由与视频/序列一致：点击预览根后接管，交互控件除外。
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 打开预览时自动聚焦：←/→ 逐帧、空格播放/暂停立即可用，无需先点画面。
  // 点击目录网格会把焦点还给网格，方向键随之切回网格。
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (typing || !GIF_KEYBOARD_KEYS.has(event.key)) return;
      const root = rootRef.current;
      if (!root || !(target instanceof Node)) return;
      const insideRoot = root.contains(target);
      // 焦点在预览面板 / 工具栏 / 白板弹窗里都算「预览接管」，
      // 这样点进度条/工具栏后空格与方向键仍然有效。
      const inPreviewChrome =
        target instanceof Element &&
        target.closest(".preview-panel, .preview-toolbar, .model-board-dialog") != null;
      if (!insideRoot && !inPreviewChrome) return;
      // 方案 A：统一 ←/→ 为「逐帧」。时间轴滑块（data-media-timeline）方向键
      // 归媒体（逐帧）、空格播放/暂停；其他滑块（如音量）保持自身语义。
      const isTimelineSlider =
        target instanceof Element && target.closest("[data-media-timeline]") != null;
      const isOtherSlider =
        target instanceof Element &&
        target.closest("[role='slider']") != null &&
        !isTimelineSlider;
      if (
        target instanceof Element &&
        target.closest("button, input, textarea, select, a")
      ) {
        return;
      }
      if (isOtherSlider) return;
      event.preventDefault();
      if (event.key === " ") {
        if (!event.repeat && (insideRoot || isTimelineSlider)) togglePlaybackRef.current();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
      if (event.repeat) return;
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gif]);

  const exportFrame = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const canvas = canvasRef.current;
      const image = imgRef.current;
      if (canvas && !canvasBroken && canvas.width > 0) {
        await window.refCanvas.system.saveRegionCapture(canvas.toDataURL("image/png"));
      } else if (image) {
        const dataUrl = await renderImageToDataUrl(image);
        await window.refCanvas.system.saveRegionCapture(dataUrl);
      }
    } finally {
      setExporting(false);
    }
  };

  const loadStaticFrame = async (timeMs: number) => {
    if (!window.refCanvas?.media?.frame) return;
    const seq = ++staticFrameSeqRef.current;
    try {
      const result = await window.refCanvas.media.frame(asset.path, {
        timeMs: Math.max(0, Math.round(timeMs)),
      });
      if (seq !== staticFrameSeqRef.current) return;
      const frameImage = new Image();
      frameImage.crossOrigin = "anonymous";
      frameImage.onload = () => {
        // 预加载成功后才切换主图 src，避免切到坏地址导致黑屏。
        if (seq === staticFrameSeqRef.current) setStaticSrc(result.source);
      };
      frameImage.onerror = () => {
        // 加载失败保持原 GIF/上一帧。
      };
      frameImage.src = result.source;
    } catch {
      // 提取失败时保持原 GIF/上一帧。
    }
  };

  // 进度条/时间码统一由 playhead（nativePosition）驱动，避免暂停时因帧时长
  // 单位差异跳回错误位置。
  const position = Number.isFinite(nativePosition)
    ? Math.min(1, Math.max(0, nativePosition))
    : 0;
  const safeDurationSeconds = Math.max(
    0.001,
    nativeDurationSeconds > 0 ? nativeDurationSeconds : (gif ? durationMs / 1000 : 0),
  );
  usePreviewTransportRegistration({
    kind: "gif",
    playing,
    position,
    durationSeconds: safeDurationSeconds,
    frameIndex,
    frameCount: gif?.frames.length ?? 0,
    fps: gif && safeDurationSeconds > 0 ? gif.frames.length / safeDurationSeconds : null,
    playbackRate: rate,
    looping,
    muted: true,
    volume: 0,
  }, {
    togglePlaying: togglePlayback,
    seek: (target) => {
      const clamped = Math.min(1, Math.max(0, target));
      // 只有真的在播放时才置暂停（已暂停则跳过，避免拖动时反复 setPlaying
      // 触发重渲染风暴 / Maximum update depth）。
      if (playingRef.current) setPlaying(false);
      const delta = Math.abs(clamped - nativePositionRef.current);
      if (delta < 0.0005) {
        // 位置几乎没变：只保证画面已定格，不再发状态更新。
        return;
      }
      // 拖动进度条：暂停 + 本地解码帧即时画到 canvas，画面与滑块同步；
      // 解码不可用/canvas 异常时回退 ffmpeg 取帧（避免拖动过程 IPC/进程风暴卡住 UI）。
      applyRatio(clamped);
      if (gifRef.current?.frames.length && !canvasBroken) {
        drawFrame(frameIndexRef.current);
      } else if (durationMs > 0) {
        void loadStaticFrame(durationMs * clamped);
      }
    },
    stepFrames: step,
    setLooping,
    setPlaybackRate: (value) => setRate(Math.min(8, Math.max(0.25, value))),
    setMuted: () => undefined,
    setVolume: () => undefined,
    startScrub: undefined,
    stopScrub: undefined,
  });

  const count = gif?.frames.length ?? 0;

  return (
    <div
      ref={rootRef}
      className="gif-preview gif-preview-native-mode"
      tabIndex={-1}
      onPointerDown={(event) => {
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
      <div className="gif-preview-stage">
        {gif && !canvasBroken ? (
          <canvas ref={canvasRef} className="gif-preview-canvas" />
        ) : (
          <img
            ref={imgRef}
            src={playing ? asset.previewUrl : (staticSrc ?? asset.previewUrl)}
            alt={asset.title}
            draggable={false}
            className="gif-preview-native-img"
          />
        )}
      </div>
      {!managed && (
        <div className="gif-controls">
          <button
            aria-label={playing ? translate("preview.pause") : translate("preview.play")}
            onClick={togglePlayback}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            aria-label={translate("preview.previousFrame")}
            disabled={!gif || count <= 1}
            onClick={() => step(-1)}
          >
            <SkipBack size={14} />
          </button>
          <button
            aria-label={translate("preview.nextFrame")}
            disabled={!gif || count <= 1}
            onClick={() => step(1)}
          >
            <SkipForward size={14} />
          </button>
          <button
            aria-label={translate("gif.slower")}
            disabled={!gif || count <= 1}
            onClick={() => setRate((value) => Math.max(0.25, value / 2))}
          >
            <Rewind size={14} />
          </button>
          <span className="gif-rate">{rate}×</span>
          <button
            aria-label={translate("gif.faster")}
            disabled={!gif || count <= 1}
            onClick={() => setRate((value) => Math.min(8, value * 2))}
          >
            <FastForward size={14} />
          </button>
          <input
            className="gif-timeline"
            type="range"
            min={0}
            max={Math.max(0, count - 1)}
            value={frameIndex}
            disabled={!gif || count <= 1}
            aria-label={translate("gif.timeline")}
            onChange={(event) => {
              const index = Number(event.target.value);
              if (!gif) return;
              frameIndexRef.current = index;
              setFrameIndex(index);
              setPlaying(false);
              const frameTotal = gif.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
              const frameElapsed = gif.frames.slice(0, index).reduce((sum, frame) => sum + frame.durationMs, 0);
              const ratio = frameTotal > 0 ? frameElapsed / frameTotal : (index / Math.max(1, count - 1));
              nativePositionRef.current = ratio;
              setNativePosition(ratio);
              if (durationMs > 0) playheadRef.current = ratio * durationMs;
              if (canvasBroken) {
                if (durationMs > 0) void loadStaticFrame(durationMs * ratio);
              } else {
                drawFrame(index);
              }
            }}
          />
          <span className="gif-frame-count">
            {gif ? `${frameIndex + 1}/${count}` : "–"}
          </span>
          <button aria-label={translate("gif.exportFrame")} onClick={() => void exportFrame()}>
            <Download size={14} />
          </button>
        </div>
      )}
      <PreviewColorBar
        compact
        source={() => (gif && !canvasBroken ? canvasRef.current : imgRef.current)}
        revision={frameIndex}
        onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
      />
    </div>
  );
}
