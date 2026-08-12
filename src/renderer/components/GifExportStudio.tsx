import {
  ArrowDown,
  ArrowUp,
  Film,
  FolderOpen,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExportGifResult } from "../../shared/contracts";
import { formatBytes } from "../app/format-bytes";
import { centeredGifRange } from "../app/gif-export-range";

interface GifClipDraft {
  id: string;
  inputPath: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  loading: boolean;
  error: boolean;
}

function nameOf(filename: string): string {
  return filename.split(/[\\/]/).pop() || filename;
}

function stemOf(filename: string): string {
  return nameOf(filename).replace(/\.[^.]*$/, "") || "animation";
}

function clipId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function estimatedGifBytes(
  durationSeconds: number,
  fps: number,
  width: number,
  colors: number,
): number {
  const height = width * 9 / 16;
  const paletteFactor = Math.max(0.22, colors / 256);
  return Math.round(durationSeconds * fps * width * height * 0.055 * paletteFactor);
}

export function GifExportStudio({
  initialPaths,
  onClose,
  variant = "dialog",
  initialTimeMs = 0,
}: {
  initialPaths: string[];
  onClose(): void;
  variant?: "dialog" | "panel";
  initialTimeMs?: number;
}) {
  const [clips, setClips] = useState<GifClipDraft[]>(() =>
    initialPaths.map((inputPath) => ({
      id: clipId(),
      inputPath,
      durationMs: 0,
      startMs: 0,
      endMs: 0,
      loading: true,
      error: false,
    })),
  );
  const [fps, setFps] = useState(12);
  const [maxWidth, setMaxWidth] = useState(640);
  const [colors, setColors] = useState(128);
  const [dither, setDither] = useState<"none" | "bayer" | "floyd_steinberg" | "sierra2_4a">("sierra2_4a");
  const [baseName, setBaseName] = useState(stemOf(initialPaths[0] ?? "animation"));
  const [outputDirectory, setOutputDirectory] = useState(
    initialPaths[0]?.replace(/[\\/][^\\/]*$/, "") ?? "",
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ExportGifResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const probedRef = useRef(new Set<string>());

  useEffect(() => {
    for (const clip of clips) {
      if (probedRef.current.has(clip.id)) continue;
      probedRef.current.add(clip.id);
      void window.refCanvas.media.probe(clip.inputPath).then((probe) => {
        const durationMs = Math.max(0, (probe.duration ?? 0) * 1000);
        const useFocusedRange = clips.length === 1;
        const range = useFocusedRange
          ? centeredGifRange(initialTimeMs, durationMs)
          : { startMs: 0, endMs: durationMs };
        setClips((current) => current.map((item) =>
          item.id === clip.id
            ? { ...item, durationMs, ...range, loading: false, error: durationMs <= 0 }
            : item,
        ));
      }).catch(() => {
        setClips((current) => current.map((item) =>
          item.id === clip.id ? { ...item, loading: false, error: true } : item,
        ));
      });
    }
  }, [clips, initialTimeMs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (variant === "dialog" && event.key === "Escape" && !jobId) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jobId, onClose, variant]);

  const durationSeconds = useMemo(
    () => clips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0) / 1000,
    [clips],
  );
  const estimatedBytes = estimatedGifBytes(durationSeconds, fps, maxWidth, colors);
  const canExport = clips.length > 0 && clips.every((clip) =>
    !clip.loading && !clip.error && clip.endMs > clip.startMs,
  ) && Boolean(outputDirectory.trim()) && Boolean(baseName.trim()) && !jobId;

  const addPaths = (paths: string[]) => {
    const videos = paths.filter((filename) => /\.(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i.test(filename));
    if (!videos.length) return;
    setClips((current) => [
      ...current,
      ...videos.map((inputPath) => ({
        id: clipId(), inputPath, durationMs: 0, startMs: 0, endMs: 0,
        loading: true, error: false,
      })),
    ]);
  };

  const pickVideos = async () => {
    const paths = await window.refCanvas.system.pickFile({
      title: "添加 GIF 视频片段",
      defaultPath: clips[0]?.inputPath.replace(/[\\/][^\\/]*$/, ""),
      multiSelections: true,
      filters: [{ name: "视频", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg"] }],
    });
    addPaths(paths);
  };

  const exportGif = async () => {
    if (!canExport) return;
    const nextJobId = clipId();
    setJobId(nextJobId);
    setError(null);
    setResult(null);
    try {
      const exported = await window.refCanvas.media.exportGif({
        clips: clips.map((clip) => ({
          inputPath: clip.inputPath,
          startMs: Math.round(clip.startMs),
          endMs: Math.round(clip.endMs),
        })),
        outputDirectory,
        baseName,
        fps,
        maxWidth,
        colors,
        dither,
        jobId: nextJobId,
      });
      setResult(exported);
    } catch (value) {
      setError(value instanceof Error ? value.message : "GIF 导出失败");
    } finally {
      setJobId(null);
    }
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= clips.length) return;
    setClips((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div
      className={variant === "panel" ? "workbench-embedded" : "quick-preview-backdrop"}
      role="presentation"
      onMouseDown={() => variant === "dialog" && !jobId && onClose()}
    >
      <section
        className={`gif-export-studio ${variant === "panel" ? "embedded" : ""}`}
        role={variant === "dialog" ? "dialog" : "region"}
        aria-modal={variant === "dialog" ? "true" : undefined}
        aria-label="GIF 导出工作台"
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          addPaths(window.refCanvas.library.pathsForFiles(Array.from(event.dataTransfer.files)));
        }}
      >
        <header>
          <div><Film size={18} /><div><h2>GIF 导出工作台</h2><p>组合多个视频片段，控制尺寸与色彩数量，避免整段大视频直接转 GIF。</p></div></div>
          {variant === "dialog" && <button className="mini-icon-button" aria-label="关闭 GIF 工作台" disabled={Boolean(jobId)} onClick={onClose}><X size={17} /></button>}
        </header>

        <div className="gif-studio-body">
          <div className="gif-clip-list">
            <div className="gif-clip-list-heading">
              <strong>片段 · {clips.length}</strong>
              <button className="secondary-button" onClick={() => void pickVideos()}><Plus size={14} />添加视频</button>
            </div>
            {clips.map((clip, index) => (
              <article className={`gif-clip ${clip.error ? "error" : ""}`} key={clip.id}>
                <div className="gif-clip-title"><strong title={clip.inputPath}>{nameOf(clip.inputPath)}</strong><span>{clip.loading ? "读取中…" : clip.error ? "无法读取视频时长" : `${(clip.durationMs / 1000).toFixed(2)} 秒`}</span></div>
                <div className="gif-clip-actions">
                  <button aria-label="上移片段" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
                  <button aria-label="下移片段" disabled={index === clips.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
                  <button aria-label="移除片段" onClick={() => setClips((current) => current.filter((item) => item.id !== clip.id))}><Trash2 size={13} /></button>
                </div>
                {!clip.loading && !clip.error && (
                  <div className="gif-clip-range">
                    <label>入点 <input type="number" min={0} max={clip.endMs / 1000} step={0.01} value={(clip.startMs / 1000).toFixed(2)} onChange={(event) => {
                      const value = Math.min(clip.endMs - 10, Math.max(0, Number(event.target.value) * 1000));
                      setClips((current) => current.map((item) => item.id === clip.id ? { ...item, startMs: value } : item));
                    }} />s</label>
                    <label>出点 <input type="number" min={clip.startMs / 1000} max={clip.durationMs / 1000} step={0.01} value={(clip.endMs / 1000).toFixed(2)} onChange={(event) => {
                      const value = Math.max(clip.startMs + 10, Math.min(clip.durationMs, Number(event.target.value) * 1000));
                      setClips((current) => current.map((item) => item.id === clip.id ? { ...item, endMs: value } : item));
                    }} />s</label>
                    <input className="gif-range-start" aria-label={`${nameOf(clip.inputPath)} 入点`} type="range" min={0} max={clip.durationMs} value={clip.startMs} onChange={(event) => {
                      const value = Math.min(clip.endMs - 10, Number(event.target.value));
                      setClips((current) => current.map((item) => item.id === clip.id ? { ...item, startMs: value } : item));
                    }} />
                    <input className="gif-range-end" aria-label={`${nameOf(clip.inputPath)} 出点`} type="range" min={0} max={clip.durationMs} value={clip.endMs} onChange={(event) => {
                      const value = Math.max(clip.startMs + 10, Number(event.target.value));
                      setClips((current) => current.map((item) => item.id === clip.id ? { ...item, endMs: value } : item));
                    }} />
                  </div>
                )}
              </article>
            ))}
            <button className="gif-drop-zone" type="button" onClick={() => void pickVideos()}><Plus size={16} />拖放视频到这里，或点击添加</button>
          </div>

          <div className="gif-export-options">
            <label>文件名<input value={baseName} onChange={(event) => setBaseName(event.target.value)} /></label>
            <label>输出目录<div className="gif-output-picker"><input value={outputDirectory} readOnly /><button onClick={async () => {
              const selected = await window.refCanvas.system.pickDirectory({ title: "选择 GIF 输出目录", defaultPath: outputDirectory });
              if (selected) setOutputDirectory(selected);
            }}><FolderOpen size={14} /></button></div></label>
            <div className="gif-option-grid">
              <label>帧率<select value={fps} onChange={(event) => setFps(Number(event.target.value))}>{[6, 8, 10, 12, 15, 20, 24, 30].map((value) => <option key={value} value={value}>{value} FPS</option>)}</select></label>
              <label>最大宽度<select value={maxWidth} onChange={(event) => setMaxWidth(Number(event.target.value))}>{[320, 480, 640, 800, 960, 1280].map((value) => <option key={value} value={value}>{value}px</option>)}</select></label>
              <label>色彩<select value={colors} onChange={(event) => setColors(Number(event.target.value))}>{[32, 64, 128, 256].map((value) => <option key={value} value={value}>{value} 色</option>)}</select></label>
              <label>抖动<select value={dither} onChange={(event) => setDither(event.target.value as typeof dither)}><option value="none">关闭（更小）</option><option value="bayer">Bayer</option><option value="floyd_steinberg">Floyd–Steinberg</option><option value="sierra2_4a">Sierra（推荐）</option></select></label>
            </div>
            <div className="gif-size-estimate"><span>片段时长</span><strong>{durationSeconds.toFixed(2)} 秒</strong><span>预计大小</span><strong>约 {formatBytes(estimatedBytes, "—")}</strong><small>实际大小取决于画面变化；减少时长、宽度、FPS 或色彩数最有效。</small></div>
            {result && <div className="gif-export-result"><strong>已导出 {result.sizeBytes ? formatBytes(result.sizeBytes, "") : ""}</strong><span title={result.outputPath}>{result.outputPath}</span><button onClick={() => void window.refCanvas.filesystem.reveal(result.outputPath)}><FolderOpen size={14} />显示文件</button></div>}
            {error && <div className="gif-export-error">{error}</div>}
            <div className="gif-export-actions">
              {jobId ? <button className="danger-button" onClick={() => void window.refCanvas.media.cancel(jobId)}>取消导出</button> : <button className="primary-button" disabled={!canExport} onClick={() => void exportGif()}>生成 GIF</button>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
