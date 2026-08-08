/**
 * 图片审阅（FND-005，found-clone.md §5 图片会话）。
 *
 * - 缩放/平移/适配/100%/旋转 + 棋盘透明背景（复用 alphaBackgroundStyle）。
 * - 像素取色：从显示变换后的可见像素取色（显示色值），支持复制 RGB/HEX。
 * - 确定性五色主色板提取：同一源指纹与设置产生稳定顺序；透明像素不参与。
 * - 图层：仅对可解析分层格式显示面板；普通/不可解析格式显示原因并保留合成预览。
 * 所有处理只作用于内存/缓存预览，绝不写回源文件。
 */
import {
  Copy,
  Crop,
  Droplet,
  Layers,
  Maximize2,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import {
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AssetRecord } from "../../shared/contracts";
import { alphaBackgroundStyle, useFoundSettings } from "../app/found-settings";

/** 分层格式（可解析时显示图层面板）。 */
const LAYERED_FORMATS = new Set(["psd", "tif", "tiff", "svg"]);

interface ImageReviewPreviewProps {
  asset: Pick<AssetRecord, "id" | "title" | "previewUrl" | "extension" | "kind">;
}

interface ColorSample {
  rgb: [number, number, number];
  hex: string;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/** 确定性主色板提取：固定 16 档量化的颜色桶 + 按 (count, hue) 排序。 */
function extractPalette(data: Uint8ClampedArray): ColorSample[] {
  const buckets = new Map<string, { count: number; rgb: [number, number, number] }>();
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    if (a < 128) continue; // 透明像素不参与主色统计。
    const qr = (r >> 4) << 4;
    const qg = (g >> 4) << 4;
    const qb = (b >> 4) << 4;
    const key = `${qr},${qg},${qb}`;
    const current = buckets.get(key);
    if (current) {
      current.count += 1;
      // 桶内累计平均色（顺序稳定，不依赖输入遍历外的随机性）。
      current.rgb = [
        (current.rgb[0] * (current.count - 1) + r) / current.count,
        (current.rgb[1] * (current.count - 1) + g) / current.count,
        (current.rgb[2] * (current.count - 1) + b) / current.count,
      ];
    } else {
      buckets.set(key, { count: 1, rgb: [r, g, b] });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || hueOf(a.rgb) - hueOf(b.rgb))
    .slice(0, 5)
    .map(({ rgb }) => ({
      rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])] as [
        number,
        number,
        number,
      ],
      hex: `#${toHex(Math.round(rgb[0]))}${toHex(Math.round(rgb[1]))}${toHex(
        Math.round(rgb[2]),
      )}`,
    }));
}

/** 简单确定性色相（用于并列色桶的稳定次序）。 */
function hueOf(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return ((hue * 60 + 360) % 360) / 360;
}

export function ImageReviewPreview({ asset }: ImageReviewPreviewProps) {
  const foundSettings = useFoundSettings();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [showChecker, setShowChecker] = useState(true);
  const [eyedropActive, setEyedropActive] = useState(false);
  const [sample, setSample] = useState<ColorSample | null>(null);
  const [palette, setPalette] = useState<ColorSample[]>([]);
  const [copied, setCopied] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const isLayered = LAYERED_FORMATS.has(asset.extension.toLowerCase());

  // 切换资产时重置会话状态（缩放/旋转/取色/色板）。
  useEffect(() => {
    setZoom(1);
    setFit(true);
    setRotation(0);
    setEyedropActive(false);
    setSample(null);
    setPalette([]);
    setImageFailed(false);
  }, [asset.id, asset.previewUrl]);

  /** 取色：canvas 绘制当前可见（含旋转/棋盘合成）像素。 */
  const samplePixel = (event: MouseEvent<HTMLImageElement>) => {
    if (!eyedropActive) return;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const rect = image.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * image.naturalWidth);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * image.naturalHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (showChecker) {
      // 棋盘底色（与 alphaBackgroundStyle 视觉一致）。
      context.fillStyle = "#3a3f3d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#232725";
      const size = 12;
      for (let cy = 0; cy < canvas.height; cy += size) {
        for (let cx = 0; cx < canvas.width; cx += size) {
          if (((cx / size + cy / size) % 2) === 0) continue;
          context.fillRect(cx, cy, size, size);
        }
      }
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const [sr, sg, sb] = [
      context.getImageData(x, y, 1, 1).data[0],
      context.getImageData(x, y, 1, 1).data[1],
      context.getImageData(x, y, 1, 1).data[2],
    ];
    const next = {
      rgb: [sr, sg, sb] as [number, number, number],
      hex: `#${toHex(sr)}${toHex(sg)}${toHex(sb)}`,
    };
    setSample(next);
    setCopied(false);
  };

  /** 主色板提取：对整幅可见像素做确定性五色量化。 */
  const extractPaletteNow = () => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.naturalWidth) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    setPalette(extractPalette(data));
  };

  const copySample = async () => {
    if (!sample) return;
    await window.refCanvas.system.writeClipboard(sample.hex);
    setCopied(true);
  };

  const zoomBy = (delta: number) => {
    setFit(false);
    setZoom((value) => Math.min(8, Math.max(0.1, value + delta)));
  };

  const fitView = () => {
    setFit(true);
    setZoom(1);
  };

  const naturalSize = () => {
    setFit(false);
    setZoom(1);
  };

  const rotate = () => setRotation((value) => (value + 90) % 360);

  const containerStyle = showChecker ? alphaBackgroundStyle(foundSettings) : "#1a1f20";

  const previewTransform = useMemo(() => {
    if (fit) return "scale(1)";
    return `scale(${zoom})`;
  }, [fit, zoom]);

  const rotations: Record<number, string> = {
    0: "none",
    90: "rotate(90deg)",
    180: "rotate(180deg)",
    270: "rotate(270deg)",
  };

  return (
    <div className="image-review">
      <div
        className="image-review-canvas"
        style={{ background: containerStyle }}
        onDoubleClick={fitView}
      >
        <img
          ref={imageRef}
          className={`image-review-img ${imageFailed ? "failed" : ""} ${eyedropActive ? "eyedrop" : ""}`}
          src={asset.previewUrl}
          alt=""
          draggable={false}
          style={{
            transform: `${rotations[rotation]} ${previewTransform}`,
          }}
          onClick={(event) => samplePixel(event)}
          onError={() => setImageFailed(true)}
        />
        {imageFailed && (
          <p className="image-review-error">图片解码失败或格式不受支持。</p>
        )}
        <canvas ref={canvasRef} hidden />
      </div>

      <div className="image-review-toolbar">
        <button
          className="mini-icon-button"
          title="缩小"
          aria-label="缩小"
          onClick={() => zoomBy(-0.25)}
        >
          <Minus size={14} />
        </button>
        <button
          className="mini-icon-button"
          title="放大"
          aria-label="放大"
          onClick={() => zoomBy(0.25)}
        >
          <Plus size={14} />
        </button>
        <button
          className="mini-icon-button"
          title="适配窗口"
          aria-label="适配窗口"
          onClick={fitView}
        >
          <Maximize2 size={14} />
        </button>
        <button
          className="mini-icon-button"
          title="100% 原始大小"
          aria-label="100% 原始大小"
          onClick={naturalSize}
        >
          <Crop size={14} />
        </button>
        <button
          className="mini-icon-button"
          title="旋转 90°"
          aria-label="旋转 90 度"
          onClick={rotate}
        >
          <RotateCw size={14} />
        </button>
        <button
          className={`mini-icon-button ${showChecker ? "active" : ""}`}
          title="棋盘透明背景"
          aria-label="棋盘透明背景"
          onClick={() => setShowChecker((value) => !value)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className={`mini-icon-button ${eyedropActive ? "active" : ""}`}
          title="像素取色"
          aria-label="像素取色"
          onClick={() => setEyedropActive((value) => !value)}
        >
          <Droplet size={14} />
        </button>
        <button
          className="mini-icon-button"
          title="提取主色板"
          aria-label="提取主色板"
          onClick={extractPaletteNow}
        >
          <Palette size={14} />
        </button>
        {isLayered && (
          <button
            className={`mini-icon-button ${layersOpen ? "active" : ""}`}
            title="图层"
            aria-label="图层"
            onClick={() => setLayersOpen((value) => !value)}
          >
            <Layers size={14} />
          </button>
        )}
        <span className="image-review-zoom-level">
          {fit ? "适配" : `${Math.round(zoom * 100)}%`}
        </span>
      </div>

      {sample && (
        <div className="image-review-sample">
          <span className="image-review-sample-swatch" style={{ background: sample.hex }} />
          <span className="image-review-sample-hex">{sample.hex}</span>
          <span className="image-review-sample-rgb">
            RGB {sample.rgb[0]} {sample.rgb[1]} {sample.rgb[2]}
          </span>
          <span className="image-review-sample-note">显示色值</span>
          <button className="secondary-button" onClick={() => void copySample()}>
            <Copy size={13} />
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      )}

      {palette.length > 0 && (
        <div className="image-review-palette">
          <span className="image-review-palette-label">主色</span>
          {palette.map((color) => (
            <span
              key={color.hex}
              className="image-review-palette-swatch"
              style={{ background: color.hex }}
              title={`${color.hex} RGB ${color.rgb.join(" ")}`}
            />
          ))}
        </div>
      )}

      {layersOpen && (
        <div className="image-review-layers">
          <p>
            {isLayered
              ? "该格式支持分层，但当前无图层解析 Provider，保留合成图预览。"
              : "当前格式无可解析图层。"}
          </p>
        </div>
      )}
    </div>
  );
}
