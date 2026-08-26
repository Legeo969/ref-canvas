import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  extractDominantPalette,
  type PaletteColor,
} from "../app/color-palette";
import { translate } from "../app/i18n";

export type PreviewColorSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function dimensions(source: PreviewColorSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.width, height: source.height };
}

export function PreviewColorBar({
  source,
  assetPath,
  timeMs = 0,
  revision,
  autoRefresh = false,
  compact = false,
  live = false,
  headless = false,
  onSelect,
  onPaletteChange,
}: {
  source?: () => PreviewColorSource | null;
  assetPath?: string;
  timeMs?: number;
  revision?: string | number;
  autoRefresh?: boolean;
  compact?: boolean;
  live?: boolean;
  headless?: boolean;
  onSelect?: (color: PaletteColor) => void;
  onPaletteChange?: (palette: PaletteColor[]) => void;
}) {
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [palette, setPalette] = useState<PaletteColor[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const requestRef = useRef(0);

  const refresh = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(false);
    if (assetPath && window.refCanvas?.media?.palette) {
      try {
        const extracted = await window.refCanvas.media.palette(assetPath, {
          timeMs,
          limit: 6,
        });
        if (requestId !== requestRef.current) return;
        setPalette(extracted);
        onPaletteChange?.(extracted);
        setError(extracted.length === 0);
        setLoading(false);
        return;
      } catch {
        // Old runtimes and unsupported formats fall back to the visible source.
      }
    }
    const media = sourceRef.current?.();
    const canvas = canvasRef.current;
    if (!media || !canvas) {
      if (requestId === requestRef.current) {
        setError(true);
        setLoading(false);
      }
      return;
    }
    const size = dimensions(media);
    if (!size.width || !size.height) {
      setError(true);
      setLoading(false);
      return;
    }
    const max = 128;
    const scale = Math.min(1, max / Math.max(size.width, size.height));
    canvas.width = Math.max(1, Math.round(size.width * scale));
    canvas.height = Math.max(1, Math.round(size.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      setError(true);
      setLoading(false);
      return;
    }
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(media, 0, 0, canvas.width, canvas.height);
      const extracted = extractDominantPalette(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
          6,
        );
      setPalette(extracted);
      onPaletteChange?.(extracted);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRefresh) void refresh();
    // revision deliberately controls sampling; source is read from a ref.
  }, [autoRefresh, revision]);

  const copy = async (color: PaletteColor) => {
    await window.refCanvas?.system?.writeClipboard(color.hex);
    setCopied(color.hex);
  };

  if (headless) return <canvas ref={canvasRef} hidden />;

  return (
    <div className={`preview-color-bar ${compact ? "compact" : ""} ${live ? "live" : ""}`}>
      <canvas ref={canvasRef} hidden />
      {!live && <button
        type="button"
        className="mini-icon-button preview-color-refresh"
        aria-label={translate("preview.extractColors")}
        disabled={loading}
        onClick={() => void refresh()}
      >
        <Plus className={loading ? "spin" : undefined} size={14} />
      </button>}
      {palette.length > 0 && !live && <button
        type="button"
        className="mini-icon-button"
        aria-label={translate("preview.clearColors")}
        onClick={() => { setPalette([]); onPaletteChange?.([]); }}
      ><Trash2 size={14} /></button>}
      {palette.length > 0 && !live && <button
        type="button"
        className="mini-icon-button"
        aria-label={expanded ? translate("preview.collapseColors") : translate("preview.expandColors")}
        onClick={() => setExpanded((value) => !value)}
      >{expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>}
      {palette.length > 0 && expanded && (
        <div className="preview-color-swatches" aria-label={translate("preview.colorBar")}>
          {palette.map((color) => (
            <button
              type="button"
              key={color.hex}
              className="preview-color-swatch"
              aria-label={`${onSelect ? translate("preview.viewColor").replace("{color}", color.hex) : translate("preview.copyColor").replace("{color}", color.hex)}`}
              onClick={() => onSelect ? onSelect(color) : void copy(color)}
            >
              <span className="preview-color-swatch-chip" style={{ backgroundColor: color.hex }} />
              {copied === color.hex && <Copy className="preview-color-copied" size={9} />}
            </button>
          ))}
        </div>
      )}
      {error && !live && <span className="preview-color-error">{translate("preview.colorExtractFailed")}</span>}
    </div>
  );
}
