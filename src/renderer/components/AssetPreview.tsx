import { Box, Shapes } from "lucide-react";
import { useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import type { PaletteColor } from "../../shared/color-palette";
import { browserImageExtensions } from "../../shared/asset-kind";
import { AudioPreview } from "./AudioPreview";
import { FontPreview } from "./FontPreview";
import { GIFPreview } from "./GIFPreview";
import { HdrPreview } from "./HdrPreview";
import { ImageReviewPreview } from "./ImageReviewPreview";
import { MediaNotesOverlay } from "./MediaNotesOverlay";
import { ModelPreview } from "./ModelPreview";
import { TextPreview } from "./TextPreview";
import { UnsupportedNotice } from "./UnsupportedNotice";
import { VideoPreview } from "./VideoPreview";

interface AssetPreviewProps {
  asset: AssetRecord;
  lightweight?: boolean;
  onOpenTool?: (tool: "gif" | "frames" | "color" | "fps", timeSeconds: number, color?: PaletteColor) => void;
  onTimeChange?: (timeSeconds: number) => void;
  playbackFps?: number | null;
  onPaletteChange?: (colors: string[]) => void;
  managed?: boolean;
  controlsTarget?: HTMLElement | null;
  multichannelOpen?: boolean;
  multichannelAnchor?: HTMLElement | null;
  sharedColorControls?: boolean;
  eyedropActive?: boolean;
  onEyedropActiveChange?: (active: boolean) => void;
  onColorSample?: (color: string) => void;
}

function SystemThumbnail({ asset }: { asset: AssetRecord }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="preview-message preview-file">
        <Shapes size={34} strokeWidth={1.25} />
        {asset.extension.toUpperCase()} 文件
      </span>
    );
  }
  return (
    <img
      src={`${asset.thumbnailUrl}?priority=preview`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export function AssetPreview({ asset, lightweight = false, onOpenTool, onTimeChange, playbackFps, onPaletteChange, managed = false, controlsTarget, multichannelOpen = false, multichannelAnchor, sharedColorControls = false, eyedropActive, onEyedropActiveChange, onColorSample }: AssetPreviewProps) {
  const runtimeApi = (window as unknown as {
    refCanvas?: { media?: { probe?: unknown } };
  }).refCanvas;
  if (asset.linkState !== "online") {
    return <span className="preview-message">原文件当前不可访问</span>;
  }
  if (lightweight) return <SystemThumbnail asset={asset} />;

  // 阶段 4：无本地解码器的格式（JXL/RAW/PDF/Office/DCC）显示降级提示。
  const needsUnsupportedCheck =
    asset.extension === "jxl" ||
    asset.extension === "jxr" ||
    asset.extension === "cr2" ||
    asset.extension === "cr3" ||
    asset.extension === "nef" ||
    asset.extension === "arw" ||
    asset.extension === "rw2" ||
    asset.extension === "orf" ||
    asset.extension === "pef" ||
    asset.extension === "raf" ||
    asset.extension === "srw" ||
    asset.extension === "dng" ||
    asset.extension === "raw" ||
    asset.kind === "pdf" ||
    asset.extension === "doc" ||
    asset.extension === "docx" ||
    asset.extension === "xls" ||
    asset.extension === "xlsx" ||
    asset.extension === "ppt" ||
    asset.extension === "pptx" ||
    asset.extension === "odt" ||
    asset.extension === "ods" ||
    asset.extension === "odp" ||
    asset.extension === "epub" ||
    asset.extension === "abc" ||
    asset.extension === "blend" ||
    asset.extension === "ma" ||
    asset.extension === "mb" ||
    asset.extension === "max" ||
    asset.extension === "c4d";

  switch (asset.kind) {
    case "image":
      if (asset.extension === "gif") {
        return (
          <div className="found-managed-media-surface">
            <GIFPreview asset={asset} managed={Boolean(onOpenTool)} onPaletteChange={onPaletteChange} />
          </div>
        );
      }
      if (
        (asset.extension === "exr" || asset.extension === "hdr") &&
        typeof runtimeApi?.media?.probe === "function"
      ) {
        return (
          <MediaNotesOverlay asset={asset}>
            <HdrPreview
              source={`${asset.thumbnailUrl}?priority=preview`}
              extension={asset.extension}
              path={asset.path}
              managed={managed}
              controlsTarget={controlsTarget}
              multichannelOpen={multichannelOpen}
              multichannelAnchor={multichannelAnchor}
              eyedropActive={eyedropActive}
              onEyedropActiveChange={onEyedropActiveChange}
              onColorSample={onColorSample}
            />
          </MediaNotesOverlay>
        );
      }
      if (needsUnsupportedCheck) {
        return (
          <MediaNotesOverlay asset={asset}>
            <div className="preview-unavailable">
              <SystemThumbnail asset={asset} />
              <UnsupportedNotice asset={asset} />
            </div>
          </MediaNotesOverlay>
        );
      }
      return browserImageExtensions.has(asset.extension.toLowerCase())
        ? (
            <ImageReviewPreview
              asset={asset}
              onPaletteChange={onPaletteChange}
              managed={managed}
              controlsTarget={controlsTarget}
              sharedColorControls={sharedColorControls}
              eyedropActive={eyedropActive}
              onEyedropActiveChange={onEyedropActiveChange}
              onColorSample={onColorSample}
            />
          )
        : <SystemThumbnail asset={asset} />;
    case "video":
      return <VideoPreview asset={asset} onOpenTool={onOpenTool} onTimeChange={onTimeChange} playbackFps={playbackFps} onPaletteChange={onPaletteChange} eyedropActive={eyedropActive} onEyedropActiveChange={onEyedropActiveChange} onColorSample={onColorSample} />;
    case "audio":
      return <AudioPreview asset={asset} />;
    case "pdf":
      return (
        <MediaNotesOverlay asset={asset}>
          <div className="preview-unavailable">
            <iframe
              className="pdf-preview"
              src={`${asset.previewUrl}#toolbar=0&navpanes=0`}
              title={asset.title}
            />
            <UnsupportedNotice asset={asset} />
          </div>
        </MediaNotesOverlay>
      );
    case "model3d":
      return <ModelPreview asset={asset} managed={managed} controlsTarget={controlsTarget} />;
    case "font":
      return <FontPreview asset={asset} />;
    case "dcc":
      return (
        <MediaNotesOverlay asset={asset}>
          <div className="preview-unavailable">
            <SystemThumbnail asset={asset} />
            <UnsupportedNotice asset={asset} />
          </div>
        </MediaNotesOverlay>
      );
    case "generic": {
      const textExtensions = ["txt", "md", "markdown", "rtf", "srt", "vtt", "json", "yaml", "yml", "xml", "csv", "log", "ini", "toml", "conf", "html", "htm", "css", "js", "ts", "py", "sh", "bat", "ps1"];
      const readableOfficeExtensions = ["docx", "xlsx", "pptx"];
      if (textExtensions.includes(asset.extension.toLowerCase())) {
        return <TextPreview asset={asset} />;
      }
      if (readableOfficeExtensions.includes(asset.extension.toLowerCase())) {
        return <TextPreview asset={asset} />;
      }
      if (needsUnsupportedCheck) {
        return (
          <MediaNotesOverlay asset={asset}>
            <div className="preview-unavailable">
              <SystemThumbnail asset={asset} />
              <UnsupportedNotice asset={asset} />
            </div>
          </MediaNotesOverlay>
        );
      }
      return <SystemThumbnail asset={asset} />;
    }
    default: {
      const Icon = Box;
      return <Icon size={34} />;
    }
  }
}
