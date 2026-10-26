import { useEffect, useRef, useState } from "react";
import { translate } from "../../app/i18n";
import { colorReadoutFromHex, hexToHsv, hsvToHex, type Hsv } from "../../app/color-readout";
import { ColorPanel } from "../ColorPanel";

export interface ColorSampleSource {
  /** 命中资产的显示名；落在空白画布上为 null。 */
  readonly name: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ColorSample {
  /** 取色序号：每次取色递增，作为「换了一份新样本」的唯一依据。 */
  readonly seq: number;
  /** 取色瞬间的原始值（主进程 sharp 解源文件）。 */
  readonly hex: string;
  readonly alpha: number;
  /**
   * 显示层像素：屏幕上那份 WebP 的值（含有损压缩与缩放）；取不到时为 null。
   * 与 hex 并列展示：hex 是设计规格值，这个是对齐视觉值。
   */
  readonly displayHex: string | null;
  /** 画布场景坐标（与缩放无关）。 */
  readonly canvasPoint: { x: number; y: number };
  /** 源文件像素坐标；解码尺寸与源尺寸不一致时为 null。 */
  readonly sourcePixel: { x: number; y: number } | null;
  readonly source: ColorSampleSource;
}

/**
 * 取色结果（停靠列内容体）：颜色面板 + 各组读数。
 *
 * 标题、关闭、折叠由 BoardSideDock 统一提供——旧版这里自带
 * `position:absolute; top:64px; right:12px` 的外框，会和图层面板重叠。
 * 微调只作用于面板自身的读数，不改画布对象，所以不叫"编辑"。
 */
export function BoardColorSampleBody({ sample }: { sample: ColorSample }) {
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(sample.hex) ?? { h: 0, s: 0, v: 0 },
  );
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  // 再次取色必须重置读数：useState 的初始化器只在挂载时跑一次，
  // 只换 prop 不够。以 seq 为键，同一位置重复取色也会刷新。
  useEffect(() => {
    setHsv(hexToHsv(sample.hex) ?? { h: 0, s: 0, v: 0 });
    setCopiedLabel(null);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = null;
  }, [sample.seq, sample.hex, sample.alpha]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).catch(() => undefined);
    setCopiedLabel(value);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopiedLabel(null), 1400);
  };

  const current = colorReadoutFromHex(hsvToHex(hsv), sample.alpha);
  if (!current) return null;

  const rows: Array<{ id: string; label: string; value: string }> = [
    { id: "hex", label: translate("board.colorFieldHex"), value: current.hex },
    { id: "rgb", label: translate("board.colorFieldRgb"), value: current.rgb },
    { id: "hsl", label: translate("board.colorFieldHsl"), value: current.hsl },
    {
      id: "alpha",
      label: translate("board.colorFieldAlpha"),
      value: `${current.alphaPercent}%`,
    },
  ];
  const sourceSize =
    sample.source.width && sample.source.height
      ? translate("board.colorSourceSize")
          .replace("{width}", String(Math.round(sample.source.width)))
          .replace("{height}", String(Math.round(sample.source.height)))
      : null;
  const canvasPoint = translate("board.colorCanvasPoint")
    .replace("{x}", sample.canvasPoint.x.toFixed(1))
    .replace("{y}", sample.canvasPoint.y.toFixed(1));

  return (
    <div className="board-color-sample-body">
      <ColorPanel hsv={hsv} onChange={setHsv}>
        <button
          type="button"
          className="board-color-sample-swatch"
          style={{ background: current.hex, color: current.contrastHex }}
          aria-label={translate("preview.copyColor").replace("{color}", current.hex)}
          onClick={() => copy(current.hex)}
        >
          {current.hex}
        </button>
      </ColorPanel>

      <p className="board-color-sample-status" role="status">
        {copiedLabel
          ? translate("board.colorSampleCopied").replace("{color}", copiedLabel)
          : translate("board.colorSampleCopyHint")}
      </p>

      <div className="board-color-sample-grid">
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            className="board-color-sample-field"
            aria-label={translate("preview.copyColor").replace("{color}", row.value)}
            onClick={() => copy(row.value)}
          >
            <span>{row.label}</span>
            <code>{row.value}</code>
          </button>
        ))}
      </div>

      <div className="board-color-sample-meta">
        <p
          className="board-color-sample-source"
          title={sample.source.name ?? undefined}
        >
          {sample.source.name ?? translate("board.colorSourceCanvas")}
        </p>
        <p className="board-color-sample-dim">
          {canvasPoint}
          {sourceSize ? ` · ${sourceSize}` : ""}
        </p>
        <p className="board-color-sample-dim">
          {sample.sourcePixel
            ? translate("board.colorSourcePoint")
                .replace("{x}", String(sample.sourcePixel.x))
                .replace("{y}", String(sample.sourcePixel.y))
            : translate("board.colorSourcePointUnavailable")}
        </p>
        {/* 屏幕值默认收起：你取色就要一个值，两个值并列反而让人犹豫。 */}
        {sample.displayHex && sample.displayHex !== current.hex && (
          <details className="board-color-sample-detail">
            <summary>{translate("board.colorDifferenceHint")}</summary>
            <div className="board-color-sample-compare-row">
              <span
                className="board-color-sample-dot"
                style={{ background: sample.displayHex }}
                aria-hidden="true"
              />
              <span className="board-color-sample-compare-label">
                {translate("board.colorDifferenceHint")}
              </span>
              <code>{sample.displayHex}</code>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
