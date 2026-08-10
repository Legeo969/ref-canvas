import {
  Download,
  Expand,
  Film,
  FolderOpen,
  Gauge,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExportGifResult,
  ExportMp4Result,
  SequenceGroupInfo,
} from "../../shared/contracts";
import { useFoundSettings } from "../app/found-settings";
import { translate } from "../app/i18n";
import { PreviewColorBar } from "./PreviewColorBar";

/**
 * 图片序列预览（阶段 3 §9.4）：播放、逐帧、FPS 调节、帧范围/缺帧显示。
 *
 * 帧图通过 refbrowse token 按需加载；播放时预取相邻帧保证流畅。
 */

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

export function sequenceFrameSourceUrl(extension: string, token: string): string {
  const normalized = extension.toLowerCase();
  return normalized === "exr" || normalized === "hdr"
    ? `refbrowse://thumbnail/${token}?priority=preview&size=1920`
    : `refbrowse://preview/${token}`;
}

export function SequencePreviewDialog({
  sequence,
  onClose,
}: {
  sequence: SequenceGroupInfo;
  onClose(): void;
}) {
  const frames = useMemo(() => sequence.files, [sequence.files]);
  const foundSettings = useFoundSettings();
  // 阶段 5：autoplaySequence 决定打开时是否自动播放；defaultSequenceFps
  // 作为 FPS presets 默认速度（检测器推断值保留给无设置时）。
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(foundSettings.autoplaySequence);
  const [fps, setFps] = useState(
    foundSettings.defaultSequenceFps > 0
      ? foundSettings.defaultSequenceFps
      : (sequence.fps || 24),
  );
  const [optionsDrawer, setOptionsDrawer] = useState<"fps" | "mp4" | null>(null);
  const [failed, setFailed] = useState(false);
  const tokens = useFrameTokens(frames);
  const fpsPresets = foundSettings.sequenceFpsPresets.length
    ? foundSettings.sequenceFpsPresets
    : [24];
  const availableMp4Presets = useMemo(
    () => {
      const enabled = foundSettings.mp4Presets.filter((preset) => preset.enabled);
      return enabled.length ? enabled : foundSettings.mp4Presets.slice(0, 1);
    },
    [foundSettings.mp4Presets],
  );
  // 阶段 5：MP4 导出（预设来自 FoundSettings.mp4Presets）。
  const [exportPresetId, setExportPresetId] = useState(
    foundSettings.defaultMp4PresetId,
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
  const displayedImageRef = useRef<HTMLImageElement | null>(null);
  const [displayedSource, setDisplayedSource] = useState<string | null>(null);

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
    setPlaying(foundSettings.autoplaySequence);
  }, [foundSettings.autoplaySequence]);
  useEffect(() => {
    setFps(foundSettings.defaultSequenceFps > 0 ? foundSettings.defaultSequenceFps : 24);
  }, [foundSettings.defaultSequenceFps]);

  // 播放循环：按 FPS 推进帧。
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const tick = () => {
      if (!playingRef.current) return;
      frameIndexRef.current =
        (frameIndexRef.current + 1) % frames.length;
      setFrameIndex(frameIndexRef.current);
      timerRef.current = window.setTimeout(tick, 1000 / Math.max(0.01, fpsRef.current));
    };
    timerRef.current = window.setTimeout(tick, 1000 / Math.max(0.01, fpsRef.current));
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [playing, frames.length]);

  // 预取相邻帧图。
  useEffect(() => {
    for (let delta = -2; delta <= 2; delta += 1) {
      if (!delta) continue;
      const neighbor = frames[frameIndex + delta];
      const token = neighbor ? tokens.get(neighbor) : undefined;
      if (!token) continue;
      const image = new Image();
      image.src = sequenceFrameSourceUrl(sequence.extension, token);
    }
  }, [frameIndex, frames, tokens]);

  const token = frames[frameIndex] ? tokens.get(frames[frameIndex]) : undefined;
  const source = token ? sequenceFrameSourceUrl(sequence.extension, token) : null;
  useEffect(() => {
    if (!source) {
      displayedSourceRef.current = null;
      setDisplayedSource(null);
      return;
    }
    if (source === displayedSourceRef.current) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      displayedSourceRef.current = source;
      setDisplayedSource(source);
      setFailed(false);
    };
    image.onerror = () => {
      if (!cancelled && !displayedSourceRef.current) setFailed(true);
    };
    image.src = source;
    return () => {
      cancelled = true;
    };
  }, [source]);
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

  // 阶段 5：MP4 导出（预设来自 FoundSettings.mp4Presets）。
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
        files: frames,
        fps,
        outputDirectory,
        baseName: sequence.baseName,
        maxWidth: 960,
      });
      setGifResult(result);
      setGifState("done");
    } catch (error) {
      setGifError(error instanceof Error ? error.message : translate("sequence.exportFailed"));
      setGifState("idle");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="quick-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={translate("sequence.previewNamed").replace("{name}", sequence.baseName)}
      onMouseDown={onClose}
    >
      <section
        className="quick-preview-shell sequence-preview-shell"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="quick-preview-header">
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
        </header>
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
            <img
              ref={displayedImageRef}
              src={displayedSource}
              alt={translate("sequence.frameAlt")
                .replace("{name}", sequence.baseName)
                .replace("{frame}", frameLabel(frameIndex))}
              draggable={false}
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="preview-message">
              {failed ? translate("sequence.frameLoadFailed") : translate("directory.loading")}
            </span>
          )}
        </div>

        <footer className="sequence-controls">
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
              aria-label={translate("sequence.fps")}
              aria-expanded={optionsDrawer === "fps"}
              onClick={() => setOptionsDrawer((current) => current === "fps" ? null : "fps")}
            >
              <Gauge size={14} />
              {fps} FPS
            </button>
            <input
              className="sequence-timeline"
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={frameIndex}
              aria-label={translate("sequence.timeline")}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
            />
            <span className="sequence-frame-count">
              {frameLabel(frameIndex)} / {frameLabel(frames.length - 1)}
            </span>
          </div>
          <div className="sequence-export-row">
            <PreviewColorBar
              compact
              source={() => displayedImageRef.current}
              revision={displayedSource ?? frameIndex}
            />
            <div className="sequence-export-summary">
              <span>{translate("sequence.exportPreset")}</span>
              <button
                className={`sequence-preset-trigger ${optionsDrawer === "mp4" ? "active" : ""}`}
                aria-label={translate("sequence.exportPreset")}
                aria-expanded={optionsDrawer === "mp4"}
                onClick={() => setOptionsDrawer((current) => current === "mp4" ? null : "mp4")}
              >
                <SlidersHorizontal size={14} />
                {availableMp4Presets.find((preset) => preset.id === exportPresetId)?.label ?? "MP4"}
              </button>
            </div>
            <button
              className="secondary-button sequence-export-button"
              disabled={exportState === "running" || availableMp4Presets.length === 0}
              onClick={() => void exportMp4()}
              title={translate("sequence.exportMp4Title")}
            >
              <Download size={14} />
              {exportState === "running" ? translate("sequence.exporting") : translate("sequence.exportMp4")}
            </button>
            <button
              className="secondary-button sequence-export-button sequence-gif-button"
              disabled={gifState === "running" || frames.length === 0}
              onClick={() => void exportGif()}
              title={translate("sequence.exportGifTitle")}
            >
              <Film size={14} />
              {gifState === "running" ? translate("sequence.exporting") : translate("sequence.exportGif")}
            </button>
          </div>
          {optionsDrawer === "fps" && (
            <div className="sequence-options-drawer" aria-label="FPS 预设抽屉">
              <div className="sequence-drawer-title"><Gauge size={15} /><strong>播放 FPS</strong><span>来自设置中的图片序列预设</span></div>
              <div className="sequence-drawer-grid">
                {fpsPresets.map((candidate) => (
                  <button key={candidate} className={candidate === fps ? "active" : ""} onClick={() => setFps(candidate)}>
                    <span>{candidate === foundSettings.defaultSequenceFps ? "默认" : "预设"}</span>
                    <strong>{candidate} FPS</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
          {optionsDrawer === "mp4" && (
            <div className="sequence-options-drawer" aria-label="MP4 转换预设抽屉">
              <div className="sequence-drawer-title"><SlidersHorizontal size={15} /><strong>MP4 转换预设</strong><span>仅显示设置中已启用的预设</span></div>
              <div className="sequence-drawer-grid mp4">
                {availableMp4Presets.map((preset) => (
                  <button key={preset.id} className={preset.id === exportPresetId ? "active" : ""} onClick={() => setExportPresetId(preset.id)}>
                    <span>{preset.label}</span>
                    <strong>{preset.codec === "h265" ? "H.265" : "H.264"} · {preset.quality === "best" ? "最佳" : preset.quality === "high" ? "高" : "中"} · {preset.resolution === "original" ? "原始" : preset.resolution === "half" ? "1/2" : "1/4"}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </footer>

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setThumbnailUrl(null);
    setFailed(false);
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

  const missing = sequence.missingFrames.length;
  return (
    <button
      className={`asset-card directory-card sequence-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onPreview}
    >
      <span className="asset-preview">
        {thumbnailUrl && !failed ? (
          <img
            src={thumbnailUrl}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="asset-placeholder">
            <Film size={26} strokeWidth={1.35} />
            <span>{translate("sequence.cardLabel")}</span>
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
