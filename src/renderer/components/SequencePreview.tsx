import {
  Download,
  Expand,
  Film,
  FolderOpen,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ExportGifResult,
  ExportMp4Result,
  SequenceGroupInfo,
} from "../../shared/contracts";
import { usePreviewSettings } from "../app/preview-settings";
import { translate } from "../app/i18n";
import { PreviewColorBar } from "./PreviewColorBar";
import { PreviewSlider } from "./PreviewSlider";
import { HdrPreview } from "./HdrPreview";
import { useRetryingPreviewUrl } from "./useRetryingPreviewUrl";
import { usePreviewTransportRegistration } from "./PreviewTransport";

/**
 * 图片序列预览（阶段 3 §9.4）：播放、逐帧、FPS 调节、帧范围/缺帧显示。
 *
 * 帧图通过 refbrowse token 按需加载；播放时预取相邻帧保证流畅。
 */

/** 长按 ←/→ 加速步进：重复按键按按住时长升档（每 400ms 一档，每键
 * 1→2→4→…→32 帧），与 VideoPreview 的扫览手感一致；短按 = 单帧。 */
const SEQUENCE_SCRUB_SKIPS = [1, 2, 4, 8, 16, 32] as const;
const SEQUENCE_SCRUB_TIER_MS = 400;

function useFrameTokens(files: string[]) {
  const [tokens, setTokens] = useState<Map<string, string>>(() => new Map());
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  useEffect(() => {
    let cancelled = false;
    const pending = new Map<string, Promise<void>>();
    const ensure = (filename: string) => {
      if (tokensRef.current.has(filename) || pending.has(filename)) return;
      const promise = window.refCanvas.filesystem
        .previewToken?.(filename)
        .then((token) => {
          if (cancelled || !token) return;
          setTokens((current) => new Map(current).set(filename, token));
        })
        .catch(() => undefined)
        .finally(() => pending.delete(filename));
      if (promise) pending.set(filename, promise);
    };
    // 预取全部 token（本地 token 注册开销小；帧图按需 fetch）。
    for (const file of files) ensure(file);
    return () => {
      cancelled = true;
    };
  }, [files]);
  return tokens;
}

export function sequenceFrameSourceUrl(
  extension: string,
  token: string,
  size = 1920,
  priority: "preview" | "prefetch" = "preview",
): string {
  const normalized = extension.toLowerCase();
  return normalized === "exr" || normalized === "hdr"
    ? `refbrowse://thumbnail/${token}?priority=${priority}&size=${size}`
    : `refbrowse://preview/${token}`;
}

export function sequenceGifFrameSlice(
  files: string[],
  range: { start: number; end: number },
): string[] {
  if (files.length <= 1) return files;
  const lastIndex = files.length - 1;
  const startIndex = Math.round(Math.max(0, Math.min(1, range.start)) * lastIndex);
  const endIndex = Math.round(Math.max(0, Math.min(1, range.end)) * lastIndex);
  return files.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
}

export function SequencePreviewDialog({
  sequence,
  onClose,
  embedded = false,
  fullscreen = false,
  onPaletteChange,
  eyedropActive = false,
  onEyedropActiveChange,
  onColorSample,
  controlsTarget,
  multichannelOpen = false,
  multichannelAnchor,
  gifRange,
  gifRangeActive,
  onGifRangeChange,
  onGifRangeActiveChange,
  onGifExportToggle,
}: {
  sequence: SequenceGroupInfo;
  onClose(): void;
  embedded?: boolean;
  /** 预览面板是否处于全屏；全屏时帧解码尺寸升回 1920。 */
  fullscreen?: boolean;
  onPaletteChange?: (colors: string[]) => void;
  eyedropActive?: boolean;
  onEyedropActiveChange?: (active: boolean) => void;
  onColorSample?: (color: string) => void;
  controlsTarget?: HTMLElement | null;
  multichannelOpen?: boolean;
  multichannelAnchor?: HTMLElement | null;
  gifRange?: { start: number; end: number };
  gifRangeActive?: boolean;
  onGifRangeChange?: (start: number, end: number) => void;
  onGifRangeActiveChange?: (active: boolean) => void;
  onGifExportToggle?: () => void;
}) {
  const frames = useMemo(() => sequence.files, [sequence.files]);
  // 960px 对内嵌播放面足够，避免每帧解码完整 1920px EXR；全屏时呈现表面
  // 变大（4K 上 960 上采样会糊），尺寸随预览面板全屏状态升回 1920。
  const framePreviewSize = frames.length > 1 ? (fullscreen ? 1920 : 960) : 1920;
  const previewSettings = usePreviewSettings();
  // 阶段 5：autoplaySequence 决定打开时是否自动播放；defaultSequenceFps
  // 作为 FPS presets 默认速度（检测器推断值保留给无设置时）。
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(previewSettings.autoplaySequence);
  const [looping, setLooping] = useState(true);
  const [fps, setFps] = useState(
    previewSettings.defaultSequenceFps > 0
      ? previewSettings.defaultSequenceFps
      : (sequence.fps || 24),
  );
  const [optionsDrawer, setOptionsDrawer] = useState<"fps" | "mp4" | "gif" | null>(null);
  /** 对话框模式的 HDR 工具行：HdrPreview 的控件（Fit/旋转/网格、OCIO/
   * 曝光/导出通道）portal 到这里，与右侧预览面板的工具栏一致——避免
   * 控件堆在图片下方、对话框「乱的要死」。 */
  const [dialogToolbar, setDialogToolbar] = useState<HTMLDivElement | null>(null);
  const [localGifRange, setLocalGifRange] = useState({ start: 0, end: 1 });
  const [localGifRangeActive, setLocalGifRangeActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const tokens = useFrameTokens(frames);
  const activeToken = frames[frameIndex] ? tokens.get(frames[frameIndex]) : undefined;
  const source = activeToken
    ? sequenceFrameSourceUrl(sequence.extension, activeToken, framePreviewSize)
    : null;
  const isHdrSequence = /^(exr|hdr)$/i.test(sequence.extension);
  const fpsPresets = previewSettings.sequenceFpsPresets.length
    ? previewSettings.sequenceFpsPresets
    : [24];
  const availableMp4Presets = useMemo(
    () => {
      const enabled = previewSettings.mp4Presets.filter((preset) => preset.enabled);
      return enabled.length ? enabled : previewSettings.mp4Presets.slice(0, 1);
    },
    [previewSettings.mp4Presets],
  );
  // 阶段 5：MP4 导出（预设来自 PreviewSettings.mp4Presets）。
  const [exportPresetId, setExportPresetId] = useState(
    previewSettings.defaultMp4PresetId,
  );
  const [exportState, setExportState] = useState<
    "idle" | "running" | "done"
  >("idle");
  const [exportResult, setExportResult] = useState<ExportMp4Result | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [gifState, setGifState] = useState<"idle" | "running" | "done">("idle");
  const [gifResult, setGifResult] = useState<ExportGifResult | null>(null);
  const [gifError, setGifError] = useState<string | null>(null);
  const frameIndexRef = useRef(0);
  const playingRef = useRef(true);
  const fpsRef = useRef(fps);
  const timerRef = useRef<number | null>(null);
  const displayedSourceRef = useRef<string | null>(null);
  const requestedSourceRef = useRef<string | null>(null);
  const loadedSourcesRef = useRef(new Set<string>());
  const loadingSourcesRef = useRef(new Set<string>());
  const failedSourcesRef = useRef(new Set<string>());
  /** 当前帧的可见画面已就绪/已定局（HdrPreview 上报的帧路径）。 */
  const displayReadyPathRef = useRef<string | null>(null);
  const displayedImageRef = useRef<HTMLImageElement | null>(null);
  const [displayedSource, setDisplayedSource] = useState<string | null>(null);
  const [displayedFrameIndex, setDisplayedFrameIndex] = useState(0);
  const fpsButtonRef = useRef<HTMLButtonElement>(null);
  const mp4ButtonRef = useRef<HTMLButtonElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const [presetMenuPosition, setPresetMenuPosition] = useState({ left: 0, bottom: 0 });
  const positionPresetMenu = useCallback(() => {
    const trigger = optionsDrawer === "gif"
      ? gifButtonRef
      : optionsDrawer === "fps"
        ? fpsButtonRef
        : mp4ButtonRef;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPresetMenuPosition({
      left: Math.max(6, Math.min(rect.left, window.innerWidth - 286)),
      bottom: Math.max(6, window.innerHeight - rect.top + 6),
    });
  }, [optionsDrawer]);
  const resolvedGifRange = gifRange ?? localGifRange;
  const resolvedGifRangeActive = gifRangeActive ?? localGifRangeActive;
  const setGifRange = useCallback((start: number, end: number) => {
    onGifRangeChange?.(start, end);
    if (!onGifRangeChange) setLocalGifRange({ start, end });
  }, [onGifRangeChange]);
  const setGifRangeActive = useCallback((active: boolean) => {
    onGifRangeActiveChange?.(active);
    if (!onGifRangeActiveChange) setLocalGifRangeActive(active);
  }, [onGifRangeActiveChange]);
  const closeExportPopover = useCallback(() => {
    setOptionsDrawer(null);
    setGifRangeActive(false);
  }, [setGifRangeActive]);
  useLayoutEffect(() => {
    if (optionsDrawer) positionPresetMenu();
  }, [optionsDrawer, positionPresetMenu]);
  useEffect(() => {
    const closeMenu = () => closeExportPopover();
    window.addEventListener("refcanvas:close-preview-popovers", closeMenu);
    return () => window.removeEventListener("refcanvas:close-preview-popovers", closeMenu);
  }, [closeExportPopover]);
  useEffect(() => {
    if (!optionsDrawer) return;
    window.addEventListener("resize", positionPresetMenu);
    window.addEventListener("scroll", positionPresetMenu, true);
    return () => {
      window.removeEventListener("resize", positionPresetMenu);
      window.removeEventListener("scroll", positionPresetMenu, true);
    };
  }, [optionsDrawer, positionPresetMenu]);
  useEffect(() => {
    if (!optionsDrawer) return;
    const closeOnPointerAway = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".sequence-export-popover, .sequence-fps-popover")) return;
      if (target && (
        fpsButtonRef.current?.contains(target) ||
        mp4ButtonRef.current?.contains(target) ||
        gifButtonRef.current?.contains(target)
      )) return;
      closeExportPopover();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExportPopover();
    };
    document.addEventListener("pointerdown", closeOnPointerAway);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerAway);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeExportPopover, optionsDrawer]);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);
  useEffect(() => {
    setPlaying(previewSettings.autoplaySequence);
  }, [previewSettings.autoplaySequence]);
  useEffect(() => {
    setFps(previewSettings.defaultSequenceFps > 0 ? previewSettings.defaultSequenceFps : 24);
  }, [previewSettings.defaultSequenceFps]);

  const handleDisplayReady = useCallback((framePath: string | undefined) => {
    displayReadyPathRef.current = framePath ?? null;
  }, []);

  // 播放循环：按 FPS 推进帧。
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const tick = () => {
      if (!playingRef.current) return;
      // A large EXR can take longer than one frame interval to decode. Keep
      // the current display frame until its preview is ready so playback does
      // not enqueue the entire sequence and then appear frozen.
      if (isHdrSequence) {
        // 显示门控：基础变体先行展示（渐进增强），但必须等到色彩管理
        // 变体（切换 OCIO/ACES/Raw 后）真正显示、或该帧明确失败后，才
        // 推进下一帧。否则播放推进远超变体解码速度，覆盖层永远来不及
        // 显示——切换 OCIO 在序列里看起来完全不生效。
        const gateImageFailed = source ? failedSourcesRef.current.has(source) : false;
        const handedOver = displayedSourceRef.current === source;
        const displayReady =
          gateImageFailed ||
          (handedOver && displayReadyPathRef.current === frames[frameIndex]);
        if (!source || !displayReady) {
          timerRef.current = window.setTimeout(tick, 50);
          return;
        }
      }
      const next = frameIndexRef.current + 1;
      if (next >= frames.length && !looping) {
        setPlaying(false);
        return;
      }
      displayReadyPathRef.current = null;
      frameIndexRef.current = next % frames.length;
      setFrameIndex(frameIndexRef.current);
      timerRef.current = window.setTimeout(tick, 1000 / Math.max(0.01, fpsRef.current));
    };
    timerRef.current = window.setTimeout(tick, 1000 / Math.max(0.01, fpsRef.current));
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [frames, isHdrSequence, looping, playing, source]);

  // 预取相邻帧图。
  useEffect(() => {
    // EXR/HDR 每帧解码约 1s（PIZ 全通道解压），纯按需加载会导致逐帧卡顿。
    // 只前瞻 2 帧、以 prefetch 优先级入队（显示请求始终插队），当前帧
    // 显示时下一帧已在解码——受限流水线，避免再次喂饱解码器。
    const lookahead = isHdrSequence ? [1, 2] : [-2, -1, 1, 2];
    for (const delta of lookahead) {
      const neighbor = frames[frameIndex + delta];
      const token = neighbor ? tokens.get(neighbor) : undefined;
      if (!token) continue;
      const image = new Image();
      image.src = isHdrSequence
        ? sequenceFrameSourceUrl(sequence.extension, token, framePreviewSize, "prefetch")
        : sequenceFrameSourceUrl(sequence.extension, token, framePreviewSize);
    }
  }, [frameIndex, framePreviewSize, frames, isHdrSequence, sequence.extension, tokens]);

  useEffect(() => {
    if (!source) {
      displayedSourceRef.current = null;
      requestedSourceRef.current = null;
      setDisplayedSource(null);
      return;
    }
    requestedSourceRef.current = source;
    if (source === displayedSourceRef.current || loadedSourcesRef.current.has(source)) {
      if (source !== displayedSourceRef.current) {
        displayedSourceRef.current = source;
        setDisplayedSource(source);
        setDisplayedFrameIndex(frameIndex);
      }
      return;
    }
    if (loadingSourcesRef.current.has(source)) return;
    loadingSourcesRef.current.add(source);
    const image = new Image();
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        // A completed load is still usable when decode() is unsupported.
      }
      loadingSourcesRef.current.delete(source);
      loadedSourcesRef.current.add(source);
      failedSourcesRef.current.delete(source);
      // Do not discard a completed decode just because playback advanced while
      // it was loading. Show it only when it is still the requested frame.
      if (requestedSourceRef.current === source) {
        displayedSourceRef.current = source;
        setDisplayedSource(source);
        setDisplayedFrameIndex(frameIndex);
        setFailed(false);
      }
    };
    image.onerror = () => {
      loadingSourcesRef.current.delete(source);
      failedSourcesRef.current.add(source);
      if (requestedSourceRef.current === source && !displayedSourceRef.current) setFailed(true);
    };
    image.src = source;
  }, [frameIndex, source]);
  useEffect(() => {
    if (!availableMp4Presets.some((preset) => preset.id === exportPresetId)) {
      setExportPresetId(
        availableMp4Presets[0]?.id ?? "",
      );
    }
  }, [availableMp4Presets, exportPresetId]);
  const missing = sequence.missingFrames;
  const frameLabel = (index: number) =>
    String(sequence.start + index).padStart(sequence.width, "0");
  // HDR 变体预取：主进程缓存预热，ACES/OCIO 播放提速。内嵌播放预取
  // 2 帧维持流水线；全屏时解码尺寸升到 1920（像素量 4 倍，每帧 2-4s），
  // 预取加深到 8 帧作为提前量（≈20s 解码缓冲），播放推进时窗口滚动补
  // 尾部——解码负载与播放节奏绑定，暂停/退出即停止（不做整条序列的全量
  // 预热，避免后台满载解码、CPU 长时间占用）。
  const hdrPrefetchPaths = useMemo(() => {
    const depth = fullscreen ? 8 : 2;
    const paths: string[] = [];
    for (let delta = 1; delta <= depth; delta += 1) {
      const frame = frames[displayedFrameIndex + delta];
      if (frame) paths.push(frame);
    }
    return paths;
  }, [displayedFrameIndex, frames, fullscreen]);
  const activePresetLabel = availableMp4Presets.find((preset) => preset.id === exportPresetId)?.label ?? "MP4";

  // 阶段 5：MP4 导出（预设来自 PreviewSettings.mp4Presets）。
  const exportMp4 = async () => {
    setExportError(null);
    const outputDirectory = await window.refCanvas.system.pickDirectory({
      title: translate("sequence.pickMp4Dir"),
      defaultPath: sequence.directory,
    });
    if (!outputDirectory) return;
    setExportState("running");
    try {
      const result = await window.refCanvas.sequences.exportMp4({
        files: frames,
        fps,
        presetId: exportPresetId,
        outputDirectory,
        baseName: sequence.baseName,
      });
      setExportResult(result);
      setExportState("done");
      closeExportPopover();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : translate("sequence.exportFailed"));
      setExportState("idle");
    }
  };

  const exportGif = async () => {
    setGifError(null);
    const outputDirectory = await window.refCanvas.system.pickDirectory({
      title: translate("sequence.pickGifDir"),
      defaultPath: sequence.directory,
    });
    if (!outputDirectory) return;
    setGifState("running");
    try {
      const result = await window.refCanvas.sequences.exportGif({
        files: sequenceGifFrameSlice(frames, resolvedGifRange),
        fps,
        outputDirectory,
        baseName: sequence.baseName,
        maxWidth: 960,
      });
      setGifResult(result);
      setGifState("done");
      closeExportPopover();
    } catch (error) {
      setGifError(error instanceof Error ? error.message : translate("sequence.exportFailed"));
      setGifState("idle");
    }
  };

  const toggleExportPopover = (next: "mp4" | "gif") => {
    const opening = optionsDrawer !== next;
    window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    setOptionsDrawer(opening ? next : null);
    setGifRangeActive(opening && next === "gif");
  };

  const exportPopover = (optionsDrawer === "mp4" || optionsDrawer === "gif") && typeof document !== "undefined" ? createPortal(
    <section
      className="sequence-inline-menu sequence-export-popover anchored"
      data-placement="top-start"
      style={{ left: presetMenuPosition.left, bottom: presetMenuPosition.bottom }}
      aria-label={optionsDrawer === "mp4" ? translate("sequence.mp4ExportSettings") : translate("sequence.gifExportSettings")}
    >
      {optionsDrawer === "mp4" ? <>
        <header className="sequence-export-popover-header">
          <div><strong>{translate("sequence.exportMp4")}</strong><span>{translate("sequence.chooseConvertPreset")}</span></div>
          <button type="button" aria-label={translate("sequence.closeMp4Export")} onClick={closeExportPopover}><X size={14} /></button>
        </header>
        <div className="sequence-export-preset-list" role="radiogroup" aria-label={translate("sequence.mp4PresetGroup")}>
          {availableMp4Presets.map((preset) => (
            <button key={preset.id} role="radio" aria-checked={preset.id === exportPresetId} className={preset.id === exportPresetId ? "active" : ""} onClick={() => setExportPresetId(preset.id)}>
              <span><strong>{preset.label}</strong><small>{preset.codec === "h265" ? "H.265" : "H.264"} · {preset.resolution === "original" ? translate("sequence.resolutionOriginal") : preset.resolution === "half" ? "1/2" : "1/4"}</small></span>
              {preset.id === exportPresetId && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
        <button type="button" className="sequence-export-confirm" aria-label={translate("sequence.confirmExportMp4")} disabled={exportState === "running" || availableMp4Presets.length === 0} onClick={() => void exportMp4()}>
          <Download size={14} /> {exportState === "running" ? translate("sequence.exporting") : translate("sequence.exportWithPreset").replace("{preset}", activePresetLabel)}
        </button>
      </> : <>
        <header className="sequence-export-popover-header">
          <div><strong>{translate("sequence.exportGif")}</strong><span>{translate("sequence.dragRangeHint")}</span></div>
          <button type="button" aria-label={translate("sequence.closeGifExport")} onClick={closeExportPopover}><X size={14} /></button>
        </header>
        <div className="sequence-gif-range-summary">
          <span>{translate("sequence.gifStartFrame")}<strong>{frameLabel(Math.round(resolvedGifRange.start * Math.max(0, frames.length - 1)))}</strong></span>
          <span>{translate("sequence.gifEndFrame")}<strong>{frameLabel(Math.round(resolvedGifRange.end * Math.max(0, frames.length - 1)))}</strong></span>
          <small>{translate("sequence.gifFramesSummary").replace("{count}", String(sequenceGifFrameSlice(frames, resolvedGifRange).length)).replace("{fps}", String(fps))}</small>
        </div>
        <button type="button" className="sequence-export-confirm" aria-label={translate("sequence.confirmExportGif")} disabled={gifState === "running" || frames.length === 0} onClick={() => void exportGif()}>
          <Film size={14} /> {gifState === "running" ? translate("sequence.exporting") : translate("sequence.exportSelectedFrames")}
        </button>
      </>}
    </section>,
    document.body,
  ) : null;
  const fpsPopover = optionsDrawer === "fps" && typeof document !== "undefined" ? createPortal(
    <section
      className="sequence-inline-menu anchored sequence-fps-popover"
      data-placement="top-start"
      style={{ left: presetMenuPosition.left, bottom: presetMenuPosition.bottom }}
      aria-label={translate("sequence.fpsPresetMenu")}
    >
      {fpsPresets.map((candidate) => (
        <button
          type="button"
          key={candidate}
          className={candidate === fps ? "active" : ""}
          onClick={() => {
            setFps(candidate);
            setOptionsDrawer(null);
          }}
        >{candidate} fps</button>
      ))}
    </section>,
    document.body,
  ) : null;

  usePreviewTransportRegistration({
    kind: "sequence",
    playing,
    position: frames.length > 1 ? frameIndex / (frames.length - 1) : 0,
    durationSeconds: frames.length / Math.max(0.01, fps),
    frameIndex,
    frameCount: frames.length,
    fps,
    playbackRate: 1,
    looping,
    muted: true,
    volume: 0,
  }, {
    togglePlaying: () => setPlaying((value) => !value),
    seek: (position) => setFrameIndex(Math.min(frames.length - 1, Math.max(0, Math.round(position * (frames.length - 1))))),
    stepFrames: (delta) => setFrameIndex((current) => {
      if (!frames.length) return 0;
      return (current + delta + frames.length) % frames.length;
    }),
    setLooping,
    // 序列的 transport 播放速率语义为绝对帧率（视频为倍率），与页脚
    // FPS 弹窗同源写本地 fps 状态。
    setPlaybackRate: (value) => setFps(Math.min(240, Math.max(1, Math.round(value)))),
    setMuted: () => undefined,
    setVolume: () => undefined,
    startScrub: undefined,
    stopScrub: undefined,
    exportGif: () => void exportGif(),
  });

  /** 长按 ←/→ 加速的按住状态（方向 + 起始时刻）；keyup/blur/卸载清除。 */
  const scrubHoldRef = useRef<{ direction: 1 | -1; startedAt: number } | null>(null);
  /** 序列预览根：可聚焦，方向键按焦点归属路由（点击预览后接管 ←/→）。 */
  const shellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (!typing && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === " ")) {
        // 按键按焦点归属路由：事件目标须在本预览根内（点击画面后），
        // 或位于预览面板（点击工具栏后方向键仍归预览）；滑杆等
        // 自带方向键处理的控件除外。目录网格等全局处理在目标进入预览
        // 区域后让位。空格 = 播放/暂停（只在预览根内生效，按钮保留
        // 原生 Space 激活语义）。
        const root = shellRef.current;
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
          if (!event.repeat && insideRoot) setPlaying((value) => !value);
          return;
        }
        // ↑/↓ 序列没有音量概念，统一保留为无操作（与 GIF 一致），
        // 避免方向键被目录网格抢走。
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          return;
        }
        // ←/→ 逐帧：播放中先暂停再步进；长按加速（按住越久每键跳帧
        // 越多，最多 32 帧/键），与视频预览的扫览手感一致。
        setPlaying(false);
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const hold = scrubHoldRef.current;
        if (!event.repeat || hold?.direction !== direction) {
          scrubHoldRef.current = { direction, startedAt: performance.now() };
        }
        const holdMs = performance.now() - (scrubHoldRef.current?.startedAt ?? performance.now());
        const tier = Math.min(
          SEQUENCE_SCRUB_SKIPS.length - 1,
          Math.floor(holdMs / SEQUENCE_SCRUB_TIER_MS),
        );
        const skip = SEQUENCE_SCRUB_SKIPS[tier] * direction;
        setFrameIndex((current) => {
          if (!frames.length) return 0;
          return (current + skip + frames.length) % frames.length;
        });
        return;
      }
      if (!embedded && event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        scrubHoldRef.current = null;
      }
    };
    const onBlur = () => {
      scrubHoldRef.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      scrubHoldRef.current = null;
    };
  }, [embedded, frames.length, onClose]);

  const embeddedExportControls = embedded && controlsTarget ? createPortal(
    <div className="sequence-inline-export-controls">
      <button ref={mp4ButtonRef} type="button" className={`preview-tool-label${optionsDrawer === "mp4" ? " active" : ""}`} aria-label={translate("sequence.exportMp4")} aria-expanded={optionsDrawer === "mp4"} disabled={exportState === "running" || availableMp4Presets.length === 0} onClick={() => toggleExportPopover("mp4")} title={translate("sequence.exportMp4Title")}>
        <Download size={13} /> {exportState === "running" ? translate("sequence.exporting") : "MP4"}
      </button>
      <button ref={gifButtonRef} type="button" className={`preview-tool-label${resolvedGifRangeActive ? " active" : ""}`} aria-label={translate("sequence.selectGifRange")} aria-expanded={onGifExportToggle ? resolvedGifRangeActive : optionsDrawer === "gif"} aria-pressed={resolvedGifRangeActive} disabled={gifState === "running" || frames.length === 0} onClick={() => onGifExportToggle ? onGifExportToggle() : toggleExportPopover("gif")} title={translate("sequence.selectGifRangeTitle")}>
        <Film size={13} /> {gifState === "running" ? translate("sequence.exporting") : "GIF"}
      </button>
      {exportPopover}
    </div>,
    controlsTarget,
  ) : null;

  return (
    <div
      className={embedded ? "sequence-inline-preview" : "quick-preview-backdrop"}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={translate("sequence.previewNamed").replace("{name}", sequence.baseName)}
      onMouseDown={embedded ? undefined : onClose}
    >
      <section
        ref={shellRef}
        className={`quick-preview-shell sequence-preview-shell${embedded ? " embedded" : ""}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          // 点击预览内容把键盘焦点收进预览根：此后 ←/→ 由预览接管，
          // 目录网格等全局方向键处理让位。交互控件保持原生焦点。
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest("button, input, textarea, select, a, [tabindex]")
          ) {
            return;
          }
          shellRef.current?.focus({ preventScroll: true });
        }}
      >
        {embeddedExportControls}
        {!embedded && <header className="quick-preview-header">
          <div className="quick-preview-title">
            <h2>
              <Film size={16} />
              {sequence.baseName}
              <span className="sequence-label">
                {translate("sequence.framesMeta")
                  .replace("{start}", String(sequence.start))
                  .replace("{end}", String(sequence.end))
                  .replace("{count}", String(sequence.frames.length))}
                {missing.length > 0
                  ? translate("sequence.missingSuffix").replace("{count}", String(missing.length))
                  : ""}
              </span>
            </h2>
            <span>
              {translate("sequence.playbackMeta")
                .replace("{ext}", sequence.extension.toUpperCase())
                .replace("{fps}", String(fps))}
              {sequence.pattern !== "standard" ? ` · ${sequence.pattern}` : ""}
            </span>
          </div>
          <div className="quick-preview-actions">
            <button aria-label={translate("sequence.closeNamed")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>}
        {!embedded && isHdrSequence && (
          <div
            ref={setDialogToolbar}
            className="sequence-dialog-toolbar"
            role="toolbar"
            aria-label={translate("hdr.toolbar")}
          />
        )}
        {exportState === "running" && (
          <div className="sequence-export-banner">{translate("sequence.exportingMp4")}</div>
        )}
        {exportState === "done" && exportResult && (
          <div className="sequence-export-banner sequence-export-done">
            {translate("sequence.exportedMp4")
              .replace("{width}", String(exportResult.width))
              .replace("{height}", String(exportResult.height))
              .replace("{duration}", String(Math.round(exportResult.durationSeconds * 10) / 10))}{" "}·{" "}
            <code title={exportResult.outputPath}>
              {exportResult.outputPath}
            </code>
          </div>
        )}
        {exportError && (
          <div className="sequence-export-banner sequence-export-error">
            {exportError}
          </div>
        )}
        {gifState === "running" && (
          <div className="sequence-export-banner">{translate("sequence.exportingGif")}</div>
        )}
        {gifState === "done" && gifResult && (
          <div className="sequence-export-banner sequence-export-done">
            {translate("sequence.exportedGif")
              .replace("{width}", String(gifResult.width))
              .replace("{height}", String(gifResult.height))
              .replace("{duration}", String(Math.round(gifResult.durationSeconds * 10) / 10))}{" "}·{" "}
            <code title={gifResult.outputPath}>{gifResult.outputPath}</code>
            <button
              type="button"
              className="sequence-reveal-button"
              aria-label={translate("sequence.revealGif")}
              title={translate("preview.reveal")}
              onClick={() => void window.refCanvas.filesystem.reveal(gifResult.outputPath)}
            >
              <FolderOpen size={14} />
            </button>
          </div>
        )}
        {gifError && (
          <div className="sequence-export-banner sequence-export-error">{gifError}</div>
        )}

        <div className="quick-preview-stage sequence-preview-stage">
          {displayedSource && !failed ? (
            /^(exr|hdr)$/i.test(sequence.extension) ? <HdrPreview
              source={displayedSource}
              extension={sequence.extension}
              path={frames[displayedFrameIndex]}
              managed={embedded}
              displaySize={framePreviewSize}
              controlsTarget={controlsTarget ?? dialogToolbar}
              multichannelOpen={multichannelOpen}
              multichannelAnchor={multichannelAnchor}
              eyedropActive={eyedropActive}
              onEyedropActiveChange={onEyedropActiveChange}
              onColorSample={onColorSample}
              onDisplayReady={handleDisplayReady}
              prefetchPaths={hdrPrefetchPaths}
            /> : <img
              ref={displayedImageRef}
              src={displayedSource}
              alt={translate("sequence.frameAlt")
                .replace("{name}", sequence.baseName)
                .replace("{frame}", frameLabel(displayedFrameIndex))}
              draggable={false}
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="preview-message">
              {failed ? translate("sequence.frameLoadFailed") : translate("directory.loading")}
            </span>
          )}
        </div>

        {embedded && frames[frameIndex] && <PreviewColorBar
          headless
          autoRefresh
          assetPath={frames[frameIndex]}
          revision={`${frames[frameIndex]}:${frameIndex}`}
          onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
        />}

        {!embedded && <footer className="sequence-controls">
          <div className="sequence-transport-row">
            <button
              aria-label={playing ? translate("sequence.pause") : translate("sequence.play")}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              aria-label={translate("sequence.previousFrame")}
              onClick={() =>
                setFrameIndex(
                  (frameIndex - 1 + frames.length) % Math.max(1, frames.length),
                )
              }
            >
              <SkipBack size={15} />
            </button>
            <button
              aria-label={translate("sequence.nextFrame")}
              onClick={() =>
                setFrameIndex((frameIndex + 1) % Math.max(1, frames.length))
              }
            >
              <SkipForward size={15} />
            </button>
            <button
              className={`sequence-option-trigger ${optionsDrawer === "fps" ? "active" : ""}`}
              ref={fpsButtonRef}
              aria-label={translate("sequence.fps")}
              aria-expanded={optionsDrawer === "fps"}
              onClick={() => {
                const opening = optionsDrawer !== "fps";
                window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
                setOptionsDrawer(opening ? "fps" : null);
              }}
            >
              <Gauge size={14} />
              {fps} FPS
            </button>
            <div className="sequence-timeline">
              <PreviewSlider
                value={frames.length > 1 ? frameIndex / (frames.length - 1) : 0}
                onChange={(position) => setFrameIndex(Math.round(position * Math.max(0, frames.length - 1)))}
                range={resolvedGifRangeActive ? { ...resolvedGifRange, onChange: setGifRange } : undefined}
              />
            </div>
            <span className="sequence-frame-count">
              {frameLabel(frameIndex)} / {frameLabel(frames.length - 1)}
            </span>
          </div>
          <div className="sequence-export-row">
            <PreviewColorBar
              compact
              source={() => displayedImageRef.current}
              revision={displayedSource ?? frameIndex}
              onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
            />
            <button
              ref={mp4ButtonRef}
              className={`secondary-button sequence-export-button${optionsDrawer === "mp4" ? " active" : ""}`}
              aria-label={translate("sequence.exportMp4")}
              aria-expanded={optionsDrawer === "mp4"}
              disabled={exportState === "running" || availableMp4Presets.length === 0}
              onClick={() => toggleExportPopover("mp4")}
              title={translate("sequence.exportMp4Title")}
            >
              <Download size={14} />
              {exportState === "running" ? translate("sequence.exporting") : translate("sequence.exportMp4")}
            </button>
            <button
              ref={gifButtonRef}
              className={`secondary-button sequence-export-button sequence-gif-button${resolvedGifRangeActive ? " active" : ""}`}
              aria-label={translate("sequence.selectGifRange")}
              aria-expanded={optionsDrawer === "gif"}
              aria-pressed={resolvedGifRangeActive}
              disabled={gifState === "running" || frames.length === 0}
              onClick={() => onGifExportToggle ? onGifExportToggle() : toggleExportPopover("gif")}
              title={translate("sequence.selectGifRangeTitle")}
            >
              <Film size={14} />
              {gifState === "running" ? translate("sequence.exporting") : translate("sequence.exportGif")}
            </button>
          </div>
          {exportPopover}
          {fpsPopover}
        </footer>}

        {missing.length > 0 && (
          <div className="sequence-missing">
            {translate("sequence.missingFrames")}
            {missing.slice(0, 12).map((frame) => (
              <code key={frame}>
                {String(frame).padStart(sequence.width, "0")}
              </code>
            ))}
            {missing.length > 12 ? translate("sequence.missingMore").replace("{count}", String(missing.length)) : ""}
          </div>
        )}
      </section>
    </div>
  );
}

/** 网格中的序列卡片（替换同序列的其他帧条目）。 */
export function SequenceCard({
  sequence,
  tags,
  selected,
  onSelect,
  onPreview,
}: {
  sequence: SequenceGroupInfo;
  tags?: string[];
  selected: boolean;
  onSelect(event: React.MouseEvent): void;
  onPreview(): void;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    setThumbnailUrl(null);
    let cancelled = false;
    void window.refCanvas.filesystem
      .previewToken?.(sequence.files[0])
      .then((token) => {
        if (!cancelled && token) {
          setThumbnailUrl(`refbrowse://thumbnail/${token}?priority=visible`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sequence.files]);

  const preview = useRetryingPreviewUrl(thumbnailUrl);

  const missing = sequence.missingFrames.length;
  return (
    <button
      className={`asset-card directory-card sequence-card ${selected ? "selected" : ""}`}
      aria-busy={preview.status === "loading" || preview.status === "waiting"}
      onClick={(event) => {
        if (preview.status === "failed") preview.retry();
        onSelect(event);
      }}
      onDoubleClick={onPreview}
    >
      <span className="asset-preview">
        {preview.url && preview.status !== "failed" ? (
          <img
            className={preview.status === "ready" ? "" : "preview-image-pending"}
            src={preview.url}
            alt=""
            draggable={false}
            onLoad={preview.markReady}
            onError={preview.markError}
          />
        ) : (
          <span className="asset-placeholder">
            {preview.status === "failed"
              ? <RefreshCw size={24} />
              : <Film size={26} strokeWidth={1.35} />}
            <span>
              {preview.status === "failed"
                ? translate("sequence.retryPreview")
                : translate("sequence.cardLabel")}
            </span>
          </span>
        )}
        {(preview.status === "loading" || preview.status === "waiting") && (
          <span className="preview-cache-loading" role="status">
            <RefreshCw size={15} />
            {preview.status === "waiting" ? translate("preview.waiting") : translate("preview.generating")}
          </span>
        )}
        <span className="sequence-badge">
          {translate("sequence.framesShort").replace("{count}", String(sequence.frames.length))}
        </span>
        {tags && tags.length > 0 && (
          <span className="directory-tag-badge" title={tags.join(", ")}>
            #{tags[0]}{tags.length > 1 ? ` +${tags.length - 1}` : ""}
          </span>
        )}
      </span>
      <span className="asset-title" title={sequence.baseName}>
        {sequence.baseName}
      </span>
      <span className="asset-meta">
        {sequence.start}-{sequence.end}
        {missing > 0 ? translate("sequence.missingSuffix").replace("{count}", String(missing)) : ""}
      </span>
    </button>
  );
}

/** 序列条目上的展开箭头（供未合并时展开查看帧）。 */
export function SequenceExpandIcon() {
  return <Expand size={13} />;
}
