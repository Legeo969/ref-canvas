import {
  Expand,
  Film,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SequenceGroupInfo } from "../../shared/contracts";
import { useFoundSettings } from "../app/found-settings";

/**
 * 图片序列预览（阶段 3 §9.4）：播放、逐帧、FPS 调节、帧范围/缺帧显示。
 *
 * 帧图通过 refbrowse token 按需加载；播放时预取相邻帧保证流畅。
 */

const FPS_PRESETS = [12, 24, 25, 30, 48, 50, 60, 120, 240];

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
  const [failed, setFailed] = useState(false);
  const tokens = useFrameTokens(frames);
  const frameIndexRef = useRef(0);
  const playingRef = useRef(true);
  const fpsRef = useRef(fps);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

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
      image.src = `refbrowse://preview/${token}`;
    }
  }, [frameIndex, frames, tokens]);

  const token = frames[frameIndex] ? tokens.get(frames[frameIndex]) : undefined;
  const source = token ? `refbrowse://preview/${token}` : null;
  const missing = sequence.missingFrames;
  const frameLabel = (index: number) =>
    String(sequence.start + index).padStart(sequence.width, "0");

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
      aria-label={`序列 ${sequence.baseName}`}
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
                {sequence.start}-{sequence.end} · {sequence.frames.length} 帧
                {missing.length > 0 ? ` · 缺 ${missing.length}` : ""}
              </span>
            </h2>
            <span>
              {sequence.extension.toUpperCase()} · {sequence.fps} FPS
              {sequence.pattern !== "standard" ? ` · ${sequence.pattern}` : ""}
            </span>
          </div>
          <div className="quick-preview-actions">
            <button aria-label="关闭序列预览 Esc" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="quick-preview-stage sequence-preview-stage">
          {source && !failed ? (
            <img
              key={source}
              src={source}
              alt={`${sequence.baseName} 第 ${frameLabel(frameIndex)} 帧`}
              draggable={false}
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="preview-message">
              {failed ? "无法加载序列帧" : "正在加载…"}
            </span>
          )}
        </div>

        <footer className="sequence-controls">
          <button
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            aria-label="上一帧"
            onClick={() =>
              setFrameIndex(
                (frameIndex - 1 + frames.length) % Math.max(1, frames.length),
              )
            }
          >
            <SkipBack size={15} />
          </button>
          <button
            aria-label="下一帧"
            onClick={() =>
              setFrameIndex((frameIndex + 1) % Math.max(1, frames.length))
            }
          >
            <SkipForward size={15} />
          </button>
          <select
            className="fps-select"
            value={fps}
            aria-label="帧率"
            onChange={(event) => {
              const value = Number(event.target.value);
              setFps(Number.isFinite(value) ? value : 24);
            }}
          >
            {FPS_PRESETS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate} FPS
              </option>
            ))}
          </select>
          <input
            className="sequence-timeline"
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={frameIndex}
            aria-label="序列时间轴"
            onChange={(event) => setFrameIndex(Number(event.target.value))}
          />
          <span className="sequence-frame-count">
            {frameLabel(frameIndex)} / {frameLabel(frames.length - 1)}
          </span>
        </footer>

        {missing.length > 0 && (
          <div className="sequence-missing">
            缺帧：
            {missing.slice(0, 12).map((frame) => (
              <code key={frame}>
                {String(frame).padStart(sequence.width, "0")}
              </code>
            ))}
            {missing.length > 12 ? `… 共 ${missing.length} 帧` : ""}
          </div>
        )}
      </section>
    </div>
  );
}

/** 网格中的序列卡片（替换同序列的其他帧条目）。 */
export function SequenceCard({
  sequence,
  selected,
  onSelect,
  onPreview,
}: {
  sequence: SequenceGroupInfo;
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
            <span>序列</span>
          </span>
        )}
        <span className="sequence-badge">
          {sequence.frames.length} 帧
        </span>
      </span>
      <span className="asset-title" title={sequence.baseName}>
        {sequence.baseName}
      </span>
      <span className="asset-meta">
        {sequence.start}-{sequence.end}
        {missing > 0 ? ` · 缺 ${missing}` : ""}
      </span>
    </button>
  );
}

/** 序列条目上的展开箭头（供未合并时展开查看帧）。 */
export function SequenceExpandIcon() {
  return <Expand size={13} />;
}
