import {
  Eye,
  Film,
  FolderOpen,
  Images,
  LoaderCircle,
  Palette,
  Sparkles,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  X,
  Plus,
  Trash2,
  Gauge,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord, DirectoryEntry } from "../../shared/contracts";
import type { PaletteColor } from "../../shared/color-palette";
import { useFoundSettings } from "../app/found-settings";
import { AssetPreview } from "./AssetPreview";
import { AiDesignSupervisorPanel } from "./AiDesignSupervisor";
import { GifExportStudio } from "./GifExportStudio";
import { PreviewColorBar } from "./PreviewColorBar";
import { VideoFramesExportDialog } from "./VideoFramesExportDialog";

type WorkbenchTool = "preview" | "gif" | "frames" | "color" | "fps";
type WorkbenchMode = "preview" | "ai";

const videoPattern = /^(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpg|mpeg)$/i;

function hslFor([red, green, blue]: PaletteColor["rgb"]): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(lightness * 100)];
  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  const hue = max === r
    ? (g - b) / delta + (g < b ? 6 : 0)
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4;
  return [Math.round(hue * 60), Math.round(saturation * 100), Math.round(lightness * 100)];
}

export function DirectoryDetailsPanel({ entry }: { entry: DirectoryEntry | null }) {
  const foundSettings = useFoundSettings();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [mode, setMode] = useState<WorkbenchMode>("preview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tool, setTool] = useState<WorkbenchTool>("preview");
  const [duration, setDuration] = useState(0);
  const [frameRate, setFrameRate] = useState<number | null>(null);
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [gifPaths, setGifPaths] = useState<string[]>([]);
  const [currentPalette, setCurrentPalette] = useState<PaletteColor[]>([]);
  const [savedColors, setSavedColors] = useState<PaletteColor[]>([]);
  const [selectedColor, setSelectedColor] = useState<PaletteColor | null>(null);
  const [playbackFps, setPlaybackFps] = useState<number | null>(null);

  useEffect(() => {
    setAsset(null);
    setError(false);
    setTool("preview");
    setDuration(0);
    setFrameRate(null);
    setTimeSeconds(0);
    setGifPaths(entry && !entry.isDirectory ? [entry.path] : []);
    setCurrentPalette([]);
    setSavedColors([]);
    setSelectedColor(null);
    setPlaybackFps(null);
    if (!entry || entry.isDirectory) return;
    let cancelled = false;
    setLoading(true);
    void window.refCanvas.metadata.ensure(entry.path)
      .then(({ asset: next }) => {
        if (!cancelled) setAsset(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  useEffect(() => {
    if (!asset || asset.kind !== "video") return;
    let cancelled = false;
    void window.refCanvas.media.probe(asset.path)
      .then((probe) => {
        if (cancelled) return;
        setDuration(probe.duration ?? asset.duration ?? 0);
        const fps = probe.extra?.frameRate;
        setFrameRate(typeof fps === "number" && fps > 0 ? fps : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [asset]);

  useEffect(() => {
    const openTool = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; paths?: string[]; tool: WorkbenchTool }>).detail;
      if (detail?.path === entry?.path) {
        if (detail.paths?.length) setGifPaths(detail.paths);
        setTool(detail.tool);
      }
    };
    window.addEventListener("refcanvas:directory-workbench", openTool);
    return () => window.removeEventListener("refcanvas:directory-workbench", openTool);
  }, [entry?.path]);

  useEffect(() => {
    const openAi = () => setMode("ai");
    window.addEventListener("refcanvas:open-ai-workbench", openAi);
    return () => window.removeEventListener("refcanvas:open-ai-workbench", openAi);
  }, []);

  if (!entry || entry.isDirectory) {
    return (
      <aside className={`details-panel directory-details-panel directory-workbench-panel mode-${mode}`}>
        <header className="panel-header workbench-header">
          <div className="workbench-mode-tabs" role="tablist" aria-label="右侧工作区">
            <button className={mode === "preview" ? "active" : ""} role="tab" aria-selected={mode === "preview"} onClick={() => setMode("preview")}><Eye size={14} />预览</button>
            <button className={mode === "ai" ? "active" : ""} role="tab" aria-selected={mode === "ai"} onClick={() => setMode("ai")}><Sparkles size={14} />AI 设计监督</button>
          </div>
        </header>
        {mode === "ai" ? (
          <AiDesignSupervisorPanel variant="embedded" initialSourcePath={null} />
        ) : (
          <div className="details-empty workbench-empty-state">
            <SlidersHorizontal size={20} />
            <strong>素材工作台</strong>
            <span>{entry?.isDirectory ? "请选择一个素材" : "选择素材后可在这里预览、取色和导出"}</span>
          </div>
        )}
      </aside>
    );
  }

  const isVideo = videoPattern.test(entry.extension);
  const canExtractColor = isVideo || asset?.kind === "image";
  const selectTool = (next: WorkbenchTool) => setTool(next);

  return (
    <aside className={`details-panel directory-details-panel directory-workbench-panel ${mode === "preview" && tool !== "preview" ? "tool-open" : ""} mode-${mode}`}>
      <header className="panel-header workbench-header">
        <div className="workbench-mode-tabs" role="tablist" aria-label="右侧工作区">
          <button className={mode === "preview" ? "active" : ""} role="tab" aria-selected={mode === "preview"} onClick={() => { setMode("preview"); setTool("preview"); }}><Eye size={14} />预览</button>
          <button className={mode === "ai" ? "active" : ""} role="tab" aria-selected={mode === "ai"} onClick={() => setMode("ai")}><Sparkles size={14} />AI 设计监督</button>
        </div>
        <div className="workbench-file-actions">
          <button type="button" aria-label="打开素材" title="打开素材" onClick={() => void window.refCanvas.filesystem.open(entry.path)}>
            <SquareArrowOutUpRight size={15} />
          </button>
          <button type="button" aria-label="在资源管理器中显示" title="在资源管理器中显示" onClick={() => void window.refCanvas.filesystem.reveal(entry.path)}>
            <FolderOpen size={15} />
          </button>
        </div>
      </header>

      {mode === "preview" && loading && <div className="workbench-status"><LoaderCircle className="spin" size={18} />正在准备预览…</div>}
      {mode === "preview" && error && <div className="workbench-status error">无法读取这个素材。</div>}
      {mode === "ai" && (
        <AiDesignSupervisorPanel
          variant="embedded"
          initialSourcePath={entry.path}
        />
      )}
      {mode === "preview" && asset && (
        <>
          <div className="workbench-preview-shell">
            <div className="workbench-asset-label directory-inspector-title" title={entry.path}>{entry.name}</div>
            <AssetPreview
              asset={asset}
              onTimeChange={setTimeSeconds}
              playbackFps={playbackFps}
              onOpenTool={(next, time, color) => {
                setTimeSeconds(time);
                if (color) setSelectedColor(color);
                setTool(next);
              }}
            />
          </div>
          {tool !== "preview" && <div className="workbench-tool-content">
            <div className="workbench-tool-drawer-header">
              <div className="workbench-tool-switcher">
                {isVideo && <button className={tool === "gif" ? "active" : ""} onClick={() => selectTool("gif")}><Film size={14} />GIF</button>}
                {isVideo && <button className={tool === "frames" ? "active" : ""} onClick={() => selectTool("frames")}><Images size={14} />序列帧</button>}
                {canExtractColor && <button className={tool === "color" ? "active" : ""} onClick={() => selectTool("color")}><Palette size={14} />色彩</button>}
                {isVideo && <button className={tool === "fps" ? "active" : ""} onClick={() => selectTool("fps")}><Gauge size={14} />FPS</button>}
              </div>
              <button className="workbench-drawer-close" aria-label="关闭工具" title="关闭工具" onClick={() => setTool("preview")}><X size={15} /></button>
            </div>
            {tool === "gif" && isVideo && (
              <GifExportStudio
                key={gifPaths.join("|")}
                initialPaths={gifPaths.length ? gifPaths : [asset.path]}
                initialTimeMs={gifPaths.length <= 1 ? timeSeconds * 1000 : 0}
                variant="panel"
                onClose={() => setTool("preview")}
              />
            )}
            {tool === "frames" && isVideo && (
              <VideoFramesExportDialog
                inputPath={asset.path}
                durationSeconds={duration}
                sourceFps={frameRate}
                initialTimeSeconds={timeSeconds}
                variant="panel"
                onClose={() => setTool("preview")}
              />
            )}
            {tool === "color" && canExtractColor && (
              <section className="workbench-color-tool" aria-label="色彩提取">
                <div className="workbench-color-heading">
                  <Palette size={17} />
                  <div><strong>色彩栏</strong><p>{isVideo ? `实时画面 · ${timeSeconds.toFixed(2)}s` : "从原始图片提取"}</p></div>
                </div>
                <div className="workbench-live-palette">
                  <button
                    className="workbench-color-add"
                    aria-label="添加颜色到色板"
                    title="添加当前颜色到色板"
                    disabled={!selectedColor && currentPalette.length === 0}
                    onClick={() => {
                      const color = selectedColor ?? currentPalette[0];
                      if (!color) return;
                      setSelectedColor(color);
                      setSavedColors((items) => items.some((item) => item.hex === color.hex) ? items : [...items, color]);
                    }}
                  ><Plus size={15} /></button>
                  <PreviewColorBar
                    assetPath={asset.path}
                    timeMs={timeSeconds * 1000}
                    revision={Math.round(timeSeconds * 4)}
                    autoRefresh
                    live
                    source={() => null}
                    label="实时主色"
                    onPaletteChange={(colors) => {
                      setCurrentPalette(colors);
                      setSelectedColor((current) => current ?? colors[0] ?? null);
                    }}
                    onSelect={setSelectedColor}
                  />
                </div>
                {selectedColor && (() => {
                  const hsl = hslFor(selectedColor.rgb);
                  return <div className="workbench-color-inspector">
                    <div className="workbench-color-matrix" style={{ backgroundColor: selectedColor.hex }} aria-label={`当前颜色 ${selectedColor.hex}`} />
                    <dl>
                      <div><dt>RGB</dt><dd>{selectedColor.rgb.join(", ")}</dd></div>
                      <div><dt>HEX</dt><dd>{selectedColor.hex}</dd></div>
                      <div><dt>HSL</dt><dd>{hsl.join(", ")}</dd></div>
                    </dl>
                    <button
                      className="workbench-color-delete"
                      aria-label="删除色板颜色"
                      title="删除色板颜色"
                      onClick={() => {
                        setSavedColors((items) => items.filter((item) => item.hex !== selectedColor.hex));
                        setSelectedColor(null);
                      }}
                    ><Trash2 size={14} /></button>
                    <span className="workbench-color-chip" style={{ backgroundColor: selectedColor.hex }} />
                  </div>;
                })()}
                <div className="workbench-saved-colors" aria-label="已保存色板">
                  {savedColors.length === 0 ? <span>点击 + 保存颜色</span> : savedColors.map((color) => (
                    <button key={color.hex} aria-label={`查看颜色 ${color.hex}`} title={color.hex} style={{ backgroundColor: color.hex }} onClick={() => setSelectedColor(color)} />
                  ))}
                </div>
              </section>
            )}
            {tool === "fps" && isVideo && (
              <section className="workbench-fps-tool" aria-label="FPS 预设抽屉">
                <div className="workbench-color-heading">
                  <Gauge size={17} />
                  <div><strong>帧率基准</strong><p>控制逐帧步进与时间线刻度；视频播放速度不变</p></div>
                </div>
                <div className="workbench-fps-grid">
                  <button className={playbackFps === null ? "active" : ""} onClick={() => setPlaybackFps(null)}>
                    <span>自动</span>
                    <strong>{frameRate ? frameRate.toFixed(frameRate % 1 ? 2 : 0) : "—"} FPS</strong>
                  </button>
                  {Array.from(new Set(foundSettings.sequenceFpsPresets)).map((fps) => (
                    <button key={fps} className={playbackFps === fps ? "active" : ""} onClick={() => setPlaybackFps(fps)}>
                      <span>预设</span>
                      <strong>{fps} FPS</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>}
        </>
      )}
    </aside>
  );
}
