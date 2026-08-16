import { FolderOpen, Images, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExportVideoFramesResult } from "../../shared/contracts";
import { translate } from "../app/i18n";

function stem(filename: string): string {
  return filename.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "") || "frames";
}

export function VideoFramesExportDialog({
  inputPath,
  durationSeconds,
  sourceFps,
  onClose,
  variant = "dialog",
  initialTimeSeconds = 0,
}: {
  inputPath: string;
  durationSeconds: number;
  sourceFps: number | null;
  onClose(): void;
  variant?: "dialog" | "panel";
  initialTimeSeconds?: number;
}) {
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [fps, setFps] = useState<number | null>(sourceFps);
  const [startSeconds, setStartSeconds] = useState(Math.max(0, initialTimeSeconds));
  const [endSeconds, setEndSeconds] = useState(
    durationSeconds > 0 ? Math.min(durationSeconds, Math.max(0, initialTimeSeconds) + 5) : 0,
  );
  const [quality, setQuality] = useState(92);
  const [outputDirectory, setOutputDirectory] = useState(inputPath.replace(/[\\/][^\\/]*$/, ""));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExportVideoFramesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (durationSeconds <= 0) return;
    setStartSeconds((current) => Math.min(current, Math.max(0, durationSeconds)));
    setEndSeconds((current) => current > 0
      ? Math.min(current, durationSeconds)
      : Math.min(durationSeconds, Math.max(0, initialTimeSeconds) + 5));
  }, [durationSeconds, initialTimeSeconds]);

  const run = async () => {
    if (running || endSeconds <= startSeconds || !outputDirectory) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await window.refCanvas.media.exportFrames({
        inputPath,
        outputDirectory,
        baseName: stem(inputPath),
        format,
        fps,
        startMs: Math.round(startSeconds * 1000),
        endMs: Math.round(endSeconds * 1000),
        quality,
      }));
    } catch (value) {
      setError(value instanceof Error ? value.message : translate("video.framesExportFailed"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={variant === "panel" ? "workbench-embedded" : "quick-preview-backdrop"} onMouseDown={() => variant === "dialog" && !running && onClose()}>
      <section className={`video-frames-dialog ${variant === "panel" ? "embedded" : ""}`} role={variant === "dialog" ? "dialog" : "region"} aria-modal={variant === "dialog" ? "true" : undefined} aria-label={translate("video.framesExportDialog")} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><Images size={18} /><div><h2>{translate("video.framesExport")}</h2><p>{translate("video.framesExportHint")}</p></div></div>{variant === "dialog" && <button className="mini-icon-button" aria-label={translate("video.closeFramesExport")} disabled={running} onClick={onClose}><X size={16} /></button>}</header>
        <div className="video-frames-form">
          <label>{translate("video.format")}<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="png">{translate("video.pngLossless")}</option><option value="jpeg">{translate("video.jpgSmaller")}</option></select></label>
          <label>{translate("preview.rateFps")}<select value={fps ?? "source"} onChange={(event) => setFps(event.target.value === "source" ? null : Number(event.target.value))}><option value="source">{translate("video.keepSourceFps")}</option>{[6, 8, 10, 12, 15, 24, 25, 30, 60].map((value) => <option key={value} value={value}>{value} FPS</option>)}</select></label>
          <label>{translate("video.inPoint")}<input type="number" min={0} max={endSeconds} step={0.01} value={startSeconds} onChange={(event) => setStartSeconds(Math.max(0, Math.min(endSeconds, Number(event.target.value))))} /></label>
          <label>{translate("video.outPoint")}<input type="number" min={startSeconds} max={durationSeconds} step={0.01} value={endSeconds} onChange={(event) => setEndSeconds(Math.max(startSeconds, Math.min(durationSeconds, Number(event.target.value))))} /></label>
          {format === "jpeg" && <label>{translate("video.jpgQuality")}<input type="range" min={40} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} /><output>{quality}</output></label>}
          <label className="video-frames-output">{translate("preview.outputDirectory")}<div><input value={outputDirectory} readOnly /><button onClick={async () => { const selected = await window.refCanvas.system.pickDirectory({ title: translate("video.pickFramesOutputDir"), defaultPath: outputDirectory }); if (selected) setOutputDirectory(selected); }}><FolderOpen size={14} /></button></div></label>
        </div>
        {result && <div className="gif-export-result"><strong>{translate("video.framesExported").replace("{count}", String(result.frameCount))}</strong><span title={result.outputDirectory}>{result.outputDirectory}</span><button onClick={() => void window.refCanvas.filesystem.reveal(result.outputDirectory)}><FolderOpen size={14} />{translate("video.openDirectory")}</button></div>}
        {error && <div className="gif-export-error">{error}</div>}
        <footer>{variant === "dialog" && <button className="secondary-button" disabled={running} onClick={onClose}>{translate("preview.close")}</button>}<button className="primary-button" disabled={running || endSeconds <= startSeconds} onClick={() => void run()}>{running ? translate("sequence.exporting") : translate("video.startExport")}</button></footer>
      </section>
    </div>
  );
}
