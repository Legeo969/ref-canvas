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
  Droplet,
  Layers,
} from "lucide-react";
import {
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AssetRecord } from "../../shared/contracts";
import { alphaBackgroundStyle, useFoundSettings } from "../app/found-settings";
import { translate } from "../app/i18n";
import { ImagePreviewViewport } from "./ImagePreviewViewport";
import { PreviewColorBar } from "./PreviewColorBar";

/** 分层格式（可解析时显示图层面板）。 */
const LAYERED_FORMATS = new Set(["psd", "tif", "tiff", "svg"]);

interface ImageReviewPreviewProps {
  asset: Pick<AssetRecord, "id" | "title" | "path" | "previewUrl" | "extension" | "kind">;
  onPaletteChange?: (colors: string[]) => void;
  managed?: boolean;
  controlsTarget?: HTMLElement | null;
}

interface ColorSample {
  rgb: [number, number, number];
  hex: string;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function ImageReviewPreview({ asset, onPaletteChange, managed = false, controlsTarget }: ImageReviewPreviewProps) {
  const foundSettings = useFoundSettings();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [eyedropActive, setEyedropActive] = useState(false);
  const [sample, setSample] = useState<ColorSample | null>(null);
  const [copied, setCopied] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const isLayered = LAYERED_FORMATS.has(asset.extension.toLowerCase());

  // 切换资产时重置会话状态（缩放/旋转/取色/色板）。
  useEffect(() => {
    setEyedropActive(false);
    setSample(null);
    setImageFailed(false);
  }, [asset.id, asset.previewUrl]);

  /** 取色：优先读取显示元素；跨协议污染时通过 fetch + ImageBitmap 重绘。 */
  const samplePixel = async (event: MouseEvent<HTMLImageElement>) => {
    if (!eyedropActive) return;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const normalizedX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const normalizedY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    try {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      context.getImageData(0, 0, 1, 1);
    } catch {
      const response = await fetch(asset.previewUrl);
      if (!response.ok) return;
      const bitmap = await createImageBitmap(await response.blob());
      width = bitmap.width;
      height = bitmap.height;
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    const x = Math.min(width - 1, Math.max(0, Math.floor(normalizedX * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(normalizedY * height)));
    const pixel = context.getImageData(x, y, 1, 1).data;
    const [sr, sg, sb] = [pixel[0], pixel[1], pixel[2]];
    const next = {
      rgb: [sr, sg, sb] as [number, number, number],
      hex: `#${toHex(sr)}${toHex(sg)}${toHex(sb)}`,
    };
    setSample(next);
    setCopied(false);
  };

  const copySample = async () => {
    if (!sample) return;
    await window.refCanvas.system.writeClipboard(sample.hex);
    setCopied(true);
  };

  return (
    <div className={`image-review${managed ? " found-managed-preview" : ""}`}>
      <ImagePreviewViewport
        assetKey={`${asset.id}:${asset.previewUrl}`}
        checkerBackground={alphaBackgroundStyle(foundSettings)}
        interactionDisabled={eyedropActive}
        canvasBackground={managed ? "var(--surface-1, #1d201f)" : undefined}
        controlsTarget={controlsTarget}
        toolbarEnd={
          <>
            <button
              type="button"
              className={`mini-icon-button ${eyedropActive ? "active" : ""}`}
              title={translate("imageReview.eyedrop")}
              aria-label={translate("imageReview.eyedrop")}
              aria-pressed={eyedropActive}
              onClick={() => setEyedropActive((value) => !value)}
            >
              <Droplet size={15} />
            </button>
            <PreviewColorBar
              compact
              live
              autoRefresh
              assetPath={asset.path}
              source={() => imageRef.current}
              revision={asset.previewUrl}
              label={translate("imageReview.palette")}
              onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
            />
            {sample && (
              <button
                type="button"
                className="image-review-inline-sample"
                title={`${sample.hex} · ${translate("imageReview.copy")}`}
                aria-label={`${translate("imageReview.copy")} ${sample.hex}`}
                onClick={() => void copySample()}
              >
                <span style={{ backgroundColor: sample.hex }} />
                <strong>{copied ? translate("imageReview.copied") : sample.hex}</strong>
              </button>
            )}
            {isLayered && (
              <button
                type="button"
                className={`mini-icon-button ${layersOpen ? "active" : ""}`}
                title={translate("imageReview.layers")}
                aria-label={translate("imageReview.layers")}
                aria-pressed={layersOpen}
                onClick={() => setLayersOpen((value) => !value)}
              >
                <Layers size={15} />
              </button>
            )}
          </>
        }
      >
        {({ style }) => (
          <>
            <img
              ref={imageRef}
              className={`image-review-img ${imageFailed ? "failed" : ""} ${eyedropActive ? "eyedrop" : ""}`}
              src={asset.previewUrl}
              alt=""
              draggable={false}
              style={style}
              onClick={(event) => void samplePixel(event)}
              onError={() => setImageFailed(true)}
            />
            {imageFailed && (
              <p className="image-review-error">{translate("imageReview.error")}</p>
            )}
            <canvas ref={canvasRef} hidden />
          </>
        )}
      </ImagePreviewViewport>

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
