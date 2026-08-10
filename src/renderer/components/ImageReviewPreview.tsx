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
import type { PaletteColor } from "../../shared/color-palette";
import { alphaBackgroundStyle, useFoundSettings } from "../app/found-settings";
import { translate } from "../app/i18n";
import { PreviewColorBar } from "./PreviewColorBar";

/** 分层格式（可解析时显示图层面板）。 */
const LAYERED_FORMATS = new Set(["psd", "tif", "tiff", "svg"]);

interface ImageReviewPreviewProps {
  asset: Pick<AssetRecord, "id" | "title" | "path" | "previewUrl" | "extension" | "kind">;
  onOpenColor?: (color: PaletteColor) => void;
}

interface ColorSample {
  rgb: [number, number, number];
  hex: string;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function ImageReviewPreview({ asset, onOpenColor }: ImageReviewPreviewProps) {
  const foundSettings = useFoundSettings();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [showChecker, setShowChecker] = useState(true);
  const [eyedropActive, setEyedropActive] = useState(false);
  const [sample, setSample] = useState<ColorSample | null>(null);
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
    onOpenColor?.({ ...next, count: 1 });
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
          <p className="image-review-error">{translate("imageReview.error")}</p>
        )}
        <canvas ref={canvasRef} hidden />
      </div>

      <div className="image-review-toolbar">
        <button
          className="mini-icon-button"
          title={translate("imageReview.zoomOut")}
          aria-label={translate("imageReview.zoomOut")}
          onClick={() => zoomBy(-0.25)}
        >
          <Minus size={14} />
        </button>
        <button
          className="mini-icon-button"
          title={translate("imageReview.zoomIn")}
          aria-label={translate("imageReview.zoomIn")}
          onClick={() => zoomBy(0.25)}
        >
          <Plus size={14} />
        </button>
        <button
          className="mini-icon-button"
          title={translate("imageReview.fit")}
          aria-label={translate("imageReview.fit")}
          onClick={fitView}
        >
          <Maximize2 size={14} />
        </button>
        <button
          className="mini-icon-button"
          title={translate("imageReview.original")}
          aria-label={translate("imageReview.original")}
          onClick={naturalSize}
        >
          <Crop size={14} />
        </button>
        <button
          className="mini-icon-button"
          title={translate("imageReview.rotate")}
          aria-label={translate("imageReview.rotate")}
          onClick={rotate}
        >
          <RotateCw size={14} />
        </button>
        <button
          className={`mini-icon-button ${showChecker ? "active" : ""}`}
          title={translate("imageReview.checker")}
          aria-label={translate("imageReview.checker")}
          onClick={() => setShowChecker((value) => !value)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className={`mini-icon-button ${eyedropActive ? "active" : ""}`}
          title={translate("imageReview.eyedrop")}
          aria-label={translate("imageReview.eyedrop")}
          onClick={() => setEyedropActive((value) => !value)}
        >
          <Droplet size={14} />
        </button>
        <PreviewColorBar
          compact
          live={Boolean(onOpenColor)}
          autoRefresh={Boolean(onOpenColor)}
          assetPath={asset.path}
          source={() => imageRef.current}
          revision={asset.previewUrl}
          label={translate("imageReview.palette")}
          onSelect={onOpenColor}
        />
        {isLayered && (
          <button
            className={`mini-icon-button ${layersOpen ? "active" : ""}`}
            title={translate("imageReview.layers")}
            aria-label={translate("imageReview.layers")}
            onClick={() => setLayersOpen((value) => !value)}
          >
            <Layers size={14} />
          </button>
        )}
        <span className="image-review-zoom-level">
          {fit ? translate("imageReview.fitShort") : `${Math.round(zoom * 100)}%`}
        </span>
      </div>

      {sample && !onOpenColor && (
        <div className="image-review-sample">
          <span className="image-review-sample-swatch" style={{ background: sample.hex }} />
          <span className="image-review-sample-hex">{sample.hex}</span>
          <span className="image-review-sample-rgb">
            RGB {sample.rgb[0]} {sample.rgb[1]} {sample.rgb[2]}
          </span>
          <span className="image-review-sample-note">{translate("imageReview.displayColorNote")}</span>
          <button className="secondary-button" onClick={() => void copySample()}>
            <Copy size={13} />
            {copied ? translate("imageReview.copied") : translate("imageReview.copy")}
          </button>
        </div>
      )}

      {layersOpen && (
        <div className="image-review-layers">
          <p>
            {isLayered
              ? translate("imageReview.layerNote")
              : translate("imageReview.noLayers")}
          </p>
        </div>
      )}
    </div>
  );
}
