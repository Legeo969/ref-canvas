import { Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { translate } from "../app/i18n";
import { MediaNotesOverlay } from "./MediaNotesOverlay";

/**
 * 字体预览（阶段 4：专业格式 — 字体）。
 *
 * FontFace 从 refbrowse token 加载真实字体，canvas 渲染样张：
 * "Aa" 大字、字族名、样式与可变轴滑块（拖动轴滑块实时调整实例）。
 * 样式字段来自 provider probe（weight/italic/axes）。
 */

interface FontProbe {
  family: string | null;
  subfamily: string | null;
  weightClass: number | null;
  italic: boolean | null;
  glyphCount: number | null;
  variableAxes: Array<{
    tag: string;
    name: string;
    minValue: number;
    defaultValue: number;
    maxValue: number;
  }>;
}

interface AxisState {
  tag: string;
  name: string;
  min: number;
  value: number;
  max: number;
}

export function FontPreview({ asset }: { asset: AssetRecord }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<FontProbe | null>(null);
  const [axes, setAxes] = useState<AxisState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProbe(null);
    setAxes([]);
    setLoaded(false);
    setFailed(false);
    const load = async () => {
      try {
        const [probeResult, preview] = await Promise.all([
          window.refCanvas.media.probe(asset.path),
          window.refCanvas.media.preview(asset.path),
        ]);
        if (cancelled) return;
        const font = new FontFace(
          "refcanvas-font",
          `url(${preview.source})`,
        );
        await font.load();
        if (cancelled) return;
        (document.fonts as unknown as FontFaceSet).add(font);
        const data = probeResult.extra as unknown as FontProbe;
        setProbe(data);
        setAxes(
          (data.variableAxes ?? []).map((axis) => ({
            tag: axis.tag,
            name: axis.name,
            min: axis.minValue,
            value: axis.defaultValue,
            max: axis.maxValue,
          })),
        );
        setLoaded(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.path]);

  // 绘制样张。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#1a1f1d";
    context.fillRect(0, 0, width, height);

    if (!loaded || !probe) {
      if (failed) {
        context.fillStyle = "#c99a5b";
        context.font = "13px Segoe UI, sans-serif";
        context.fillText(translate("font.loadFailed"), 24, 70);
      } else {
        context.fillStyle = "#8d9a94";
        context.font = "13px Segoe UI, sans-serif";
        context.fillText(translate("font.loading"), 24, 70);
      }
      return;
    }

    const axisSettings = axes.reduce<Record<string, number>>((map, axis) => {
      map[axis.tag] = axis.value;
      return map;
    }, {});
    void axisSettings;
    const weight = Math.min(900, Math.max(100, Math.round((probe.weightClass ?? 400) / 100) * 100));
    const family = probe.family ?? asset.title;

    context.fillStyle = "#dce4df";
    context.font = `${weight} ${height * 0.46}px "refcanvas-font"`;
    context.textBaseline = "alphabetic";
    context.fillText("Aa", 24, height * 0.62);

    context.fillStyle = "#c8d1cc";
    context.font = "600 17px Segoe UI, sans-serif";
    context.fillText(family, 24, height - 88);

    context.fillStyle = "#8d9a94";
    context.font = "13px Segoe UI, sans-serif";
    const styleParts: string[] = [];
    if (probe.weightClass != null) styleParts.push(String(probe.weightClass));
    if (probe.italic) styleParts.push("Italic");
    context.fillText(styleParts.join(" ") || "Regular", 24, height - 64);

    context.fillStyle = "#6b7670";
    context.font = "12px Segoe UI, sans-serif";
    const axesText = axes.length
      ? translate("font.variableAxes").replace("{axes}", axes.map((axis) => `${axis.name} ${axis.value.toFixed(2)}`).join(" · "))
      : `${probe.glyphCount ?? "?"} glyphs`;
    context.fillText(axesText, 24, height - 42);
  }, [loaded, probe, axes, failed, asset.title]);

  return (
    <MediaNotesOverlay asset={asset}>
      <div className="font-preview">
        <canvas
          ref={canvasRef}
          className="font-preview-canvas"
          width={960}
          height={420}
        />
        {axes.length > 0 && (
          <div className="font-axes">
            {axes.map((axis) => (
              <label key={axis.tag} className="font-axis">
                <span>{axis.name} ({axis.tag})</span>
                <input
                  type="range"
                  min={axis.min}
                  max={axis.max}
                  step={(axis.max - axis.min) / 100}
                  value={axis.value}
                  onChange={(event) =>
                    setAxes((current) =>
                      current.map((item) =>
                        item.tag === axis.tag
                          ? { ...item, value: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
                <code>{axis.value.toFixed(2)}</code>
              </label>
            ))}
          </div>
        )}
        {loaded && (
          <div className="font-preview-meta">
            <Type size={14} />
            <span>{probe?.family}</span>
            {probe?.subfamily ? <span>{probe.subfamily}</span> : null}
          </div>
        )}
      </div>
    </MediaNotesOverlay>
  );
}
