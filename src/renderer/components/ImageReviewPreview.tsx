/**
 * 图片审阅（FND-005，§5 图片会话）。
 *
 * - 缩放/平移/适配/100%/旋转 + 棋盘透明背景（复用 alphaBackgroundStyle）。
 * - 像素取色：屏幕点反算为源图坐标，由主进程解码源文件单像素（真值）。
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
import { alphaBackgroundStyle, usePreviewSettings } from "../app/preview-settings";
import {
  containBox,
  screenPointToUv,
  uvInsideContain,
  type ViewportTransform,
} from "../app/preview-sample";
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
  sharedColorControls?: boolean;
  eyedropActive?: boolean;
  onEyedropActiveChange?: (active: boolean) => void;
  onColorSample?: (color: string) => void;
}

interface ColorSample {
  rgb: [number, number, number];
  hex: string;
}

export function ImageReviewPreview({ asset, onPaletteChange, managed = false, controlsTarget, sharedColorControls = false, eyedropActive: controlledEyedropActive, onEyedropActiveChange, onColorSample }: ImageReviewPreviewProps) {
  const previewSettings = usePreviewSettings();
  const imageRef = useRef<HTMLImageElement | null>(null);
  // 当前显示变换：取色点需要按它反算（旋转/缩放/平移都会改变命中位置）。
  const transformRef = useRef<ViewportTransform>({
    rotateDeg: 0,
    scale: 1,
  });
  const [localEyedropActive, setLocalEyedropActive] = useState(false);
  const [sample, setSample] = useState<ColorSample | null>(null);
  const [copied, setCopied] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // 适配状态下图片的屏幕宽度：算 1:1 对应多少倍缩放要用它。
  const [fittedWidth, setFittedWidth] = useState(0);

  const isLayered = LAYERED_FORMATS.has(asset.extension.toLowerCase());
  const eyedropActive = controlledEyedropActive ?? localEyedropActive;
  const setEyedropActive = (active: boolean) => {
    if (controlledEyedropActive === undefined) setLocalEyedropActive(active);
    onEyedropActiveChange?.(active);
  };

  // 切换资产时重置会话状态（缩放/旋转/取色/色板）。
  useEffect(() => {
    setLocalEyedropActive(false);
    setSample(null);
    setImageFailed(false);
  }, [asset.id, asset.previewUrl]);

  /**
   * 量出「适配尺寸」下的显示宽度，用于把 zoom 换算成真实像素比例。
   * offsetWidth 不受 transform 影响，所以即使在放大状态也拿得到适配宽度。
   */
  const measureFittedWidth = () => {
    const image = imageRef.current;
    if (!image) return;
    const width = image.offsetWidth;
    if (width > 0 && width !== fittedWidth) setFittedWidth(width);
  };

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    measureFittedWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureFittedWidth());
    observer.observe(image);
    return () => observer.disconnect();
  }, [asset.id, asset.previewUrl]);

  const nativeZoom =
    fittedWidth > 0 && imageRef.current && imageRef.current.naturalWidth > 0
      ? imageRef.current.naturalWidth / fittedWidth
      : 1;

  /**
   * 取色：屏幕点 → 源图归一化坐标 → 主进程 sharp 解码源文件单像素。
   * 不再从 DOM 画布取样：源是缩略图、坐标乘错尺寸、HDR 滤镜都会偏值。
   */
  const samplePixel = async (event: MouseEvent<HTMLImageElement>) => {
    if (!eyedropActive) return;
    const image = event.currentTarget;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // rect 是**变换后**的外框（随缩放变大、随旋转成为外包矩形），
    // 只能用它的中心（transform-origin: center，平移后中心跟着走）；
    // 布局宽高必须取 offsetWidth/offsetHeight。
    const layout = {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      width: image.offsetWidth,
      height: image.offsetHeight,
    };
    const box = containBox(
      image.naturalWidth,
      image.naturalHeight,
      layout.width,
      layout.height,
    );
    const raw = screenPointToUv(event.clientX, event.clientY, layout, transformRef.current);
    if (!raw) return;
    const uv = uvInsideContain(raw.u, raw.v, box);
    if (!uv) return;
    setEyedropActive(false);
    try {
      const sampled = await window.refCanvas.color.sampleImage({
        assetId: asset.id,
        u: uv.u,
        v: uv.v,
      });
      const next = {
        rgb: [
          Number.parseInt(sampled.hex.slice(1, 3), 16),
          Number.parseInt(sampled.hex.slice(3, 5), 16),
          Number.parseInt(sampled.hex.slice(5, 7), 16),
        ] as [number, number, number],
        hex: sampled.hex,
      };
      setSample(next);
      setCopied(false);
      onColorSample?.(next.hex);
    } catch {
      // 主进程取不到（源文件缺失/格式不支持）时不伪造颜色。
      setEyedropActive(false);
    }
  };

  const copySample = async () => {
    if (!sample) return;
    await window.refCanvas.system.writeClipboard(sample.hex);
    setCopied(true);
  };

  return (
    <div className={`image-review${managed ? " preview-managed-preview" : ""}`}>
      <ImagePreviewViewport
        assetKey={`${asset.id}:${asset.previewUrl}`}
        checkerBackground={alphaBackgroundStyle(previewSettings)}
        interactionDisabled={eyedropActive}
        canvasBackground={managed ? "var(--surface-1, #1d201f)" : undefined}
        controlsTarget={controlsTarget}
        nativeZoom={nativeZoom}
        toolbarEnd={
          <>
            {!sharedColorControls && <button
              type="button"
              className={`mini-icon-button ${eyedropActive ? "active" : ""}`}
              aria-label={translate("imageReview.eyedrop")}
              aria-pressed={eyedropActive}
              onClick={() => setEyedropActive(!eyedropActive)}
            >
              <Droplet size={15} />
            </button>}
            {!sharedColorControls && <PreviewColorBar
              compact
              live
              autoRefresh
              assetPath={asset.path}
              source={() => imageRef.current}
              revision={asset.previewUrl}
              onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
            />}
            {!sharedColorControls && sample && (
              <button
                type="button"
                className="image-review-inline-sample"
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
        {({ style, transform }) => {
          // 渲染期写入 ref：取色回调可直接读最新变换，不依赖闭包快照。
          transformRef.current = transform;
          return (
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
              onLoad={measureFittedWidth}
            />
            {imageFailed && (
              <p className="image-review-error">{translate("imageReview.error")}</p>
            )}
          </>
          );
        }}
      </ImagePreviewViewport>

      {sharedColorControls && <PreviewColorBar
        headless
        autoRefresh
        assetPath={asset.path}
        source={() => imageRef.current}
        revision={asset.previewUrl}
        onPaletteChange={(palette) => onPaletteChange?.(palette.map((color) => color.hex))}
      />}

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
