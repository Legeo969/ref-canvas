import { useEffect, useRef } from "react";
import type { JSX } from "react";

/** 主进程已经把直方图压成 64 段（7 点平滑 + 4 段合并）；这里只负责画。 */
export interface ReferenceScopesData {
  /** 三个通道的显示序列，各 64 段，已由主进程做过 7 点平滑与 4 段合并；数值为像素计数。 */
  histogram: [number[], number[], number[]];
  /** Cb/Cr 密度图，行优先（y 为 Cr，x 为 Cb），长度 densitySize * densitySize。 */
  density: number[];
  densitySize: number;
}

const GRID = "#343a44";
const VECTORSCOPE_GRID = "#414958";
const SECONDARY_TEXT = "#8b9591";
const DENSITY_RGB = "158,210,137";

interface ChannelStyle {
  readonly channel: "R" | "G" | "B";
  readonly line: string;
  readonly fill: string;
}

/** 颜色是三块直方图的身份，不随主题变化，因此固定在组件里而不是交给 CSS。 */
const CHANNEL_STYLES: readonly ChannelStyle[] = [
  { channel: "R", line: "#e07575", fill: "rgba(144,48,48,.38)" },
  { channel: "G", line: "#84b97f", fill: "rgba(42,113,53,.42)" },
  { channel: "B", line: "#7da8d0", fill: "rgba(35,84,139,.45)" },
];

/** 1px 线落在半像素上才不会被 DPR 缩放糊成两像素。 */
function crisp(value: number): number {
  return Math.round(value) + 0.5;
}

function finiteCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

interface Surface {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/**
 * 尺寸完全由布局决定（CSS 管宽高），这里只把 backing store 对齐到 CSS 像素 ×
 * DPR。每帧都重设 transform，避免画布被重置后坐标漂移。
 * 取不到 2d 上下文（jsdom / 硬件合成失败）时返回 null，调用方静默跳过。
 */
function prepareSurface(canvas: HTMLCanvasElement): Surface | null {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = (() => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  })();
  if (!context) return null;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawHistogram(
  canvas: HTMLCanvasElement,
  channelIndex: number,
  histogram: [number[], number[], number[]] | null,
): void {
  const surface = prepareSurface(canvas);
  if (!surface) return;
  const { context, width, height } = surface;
  const style = CHANNEL_STYLES[channelIndex];
  if (!style) return;

  const top = 1;
  const bottom = Math.max(top + 1, height - 1);
  const plot = bottom - top;

  // 网格先画：未就绪时保留它就是“有坐标的示波器”而不是一块空白。
  context.strokeStyle = GRID;
  context.lineWidth = 1;
  context.beginPath();
  for (let step = 0; step <= 4; step += 1) {
    const y = crisp(top + (plot * step) / 4);
    context.moveTo(0, y);
    context.lineTo(width, y);
    const x = crisp((width * step) / 4);
    context.moveTo(x, top);
    context.lineTo(x, bottom);
  }
  context.stroke();

  if (!histogram) return;
  const counts = histogram[channelIndex] ?? [];
  if (counts.length === 0) return;

  let max = 0;
  for (const count of counts) max = Math.max(max, finiteCount(count));
  const denominator = Math.log1p(max);
  if (denominator <= 0) return;

  const xAt = (index: number) => ((index + 0.5) / counts.length) * width;
  const yAt = (count: number) => bottom - (Math.log1p(finiteCount(count)) / denominator) * plot;

  context.beginPath();
  context.moveTo(0, bottom);
  counts.forEach((count, index) => context.lineTo(xAt(index), yAt(count)));
  context.lineTo(width, bottom);
  context.closePath();
  context.fillStyle = style.fill;
  context.fill();

  context.beginPath();
  counts.forEach((count, index) => {
    const x = xAt(index);
    const y = yAt(count);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = style.line;
  context.lineWidth = 1.4;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
}

function drawVectorscope(
  canvas: HTMLCanvasElement,
  data: ReferenceScopesData | null,
): void {
  const surface = prepareSurface(canvas);
  if (!surface) return;
  const { context, width, height } = surface;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(1, Math.min(width, height) / 2 - 2);

  context.strokeStyle = VECTORSCOPE_GRID;
  context.lineWidth = 1;
  for (const ring of [1 / 3, 2 / 3, 1]) {
    context.beginPath();
    context.arc(centerX, centerY, Math.max(0.5, crisp(radius * ring) - 0.5), 0, Math.PI * 2);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(crisp(centerX - radius), crisp(centerY));
  context.lineTo(crisp(centerX + radius), crisp(centerY));
  context.moveTo(crisp(centerX), crisp(centerY - radius));
  context.lineTo(crisp(centerX), crisp(centerY + radius));
  context.stroke();

  // 中心中性灰：Cb = Cr = 0 的位置，也是判断示波器朝向的锚点。
  context.beginPath();
  context.arc(centerX, centerY, 1.5, 0, Math.PI * 2);
  context.fillStyle = SECONDARY_TEXT;
  context.fill();

  if (!data) return;
  const size = Math.floor(data.densitySize);
  if (!Number.isFinite(size) || size < 2) return;
  if (data.density.length < size * size) return;

  let max = 0;
  for (const count of data.density) max = Math.max(max, finiteCount(count));
  if (max <= 0) return;

  const span = radius * 1.05;
  const cell = Math.max(1, (radius * 2.1) / size);
  const half = cell / 2;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const count = finiteCount(data.density[row * size + column]);
      if (count <= 0) continue;
      const weight = Math.sqrt(count / max);
      const x = centerX + ((column / (size - 1)) * 2 - 1) * span;
      // Cr 向上为正：行号越大越靠下，与显示用的密度图方向一致。
      const y = centerY - ((row / (size - 1)) * 2 - 1) * span;
      context.fillStyle = `rgba(${DENSITY_RGB},${(0.08 + 0.82 * weight).toFixed(3)})`;
      context.fillRect(x - half, y - half, cell, cell);
    }
  }
}

export function ReferenceScopes({
  data,
  labels,
}: {
  data: ReferenceScopesData | null;
  labels: { histogram: string; vectorscope: string; note: string };
}): JSX.Element {
  const redRef = useRef<HTMLCanvasElement | null>(null);
  const greenRef = useRef<HTMLCanvasElement | null>(null);
  const blueRef = useRef<HTMLCanvasElement | null>(null);
  const vectorscopeRef = useRef<HTMLCanvasElement | null>(null);
  const histogramRefs = [redRef, greenRef, blueRef] as const;

  useEffect(() => {
    const histogramCanvases = histogramRefs.map((reference) => reference.current);
    const paint = () => {
      histogramCanvases.forEach((canvas, index) => {
        if (canvas) drawHistogram(canvas, index, data ? data.histogram : null);
      });
      if (vectorscopeRef.current) {
        drawVectorscope(vectorscopeRef.current, data);
      }
    };

    paint();
    const observed = [...histogramCanvases, vectorscopeRef.current].filter(
      (canvas): canvas is HTMLCanvasElement => canvas !== null,
    );
    // jsdom 没有 ResizeObserver：退回窗口 resize，至少不会在挂载时崩掉。
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", paint);
      return () => window.removeEventListener("resize", paint);
    }
    const observer = new ResizeObserver(paint);
    observed.forEach((canvas) => observer.observe(canvas));
    return () => observer.disconnect();
  }, [data]);

  return (
    <section
      className={`reference-scopes${data ? "" : " is-idle"}`}
      role="group"
      aria-label={labels.note}
    >
      <div className="scope-histograms">
        {CHANNEL_STYLES.map((style, index) => (
          <div className="scope-histogram-row" key={style.channel}>
            <span className="scope-channel" aria-hidden="true">
              {style.channel}
            </span>
            <canvas
              ref={histogramRefs[index]}
              className="scope-canvas"
              role="img"
              aria-label={`${labels.histogram} · ${style.channel}`}
            />
          </div>
        ))}
      </div>
      <div className="scope-vectorscope">
        <canvas
          ref={vectorscopeRef}
          className="scope-canvas"
          role="img"
          aria-label={labels.vectorscope}
        />
      </div>
      <p className="scope-note">{labels.note}</p>
    </section>
  );
}
