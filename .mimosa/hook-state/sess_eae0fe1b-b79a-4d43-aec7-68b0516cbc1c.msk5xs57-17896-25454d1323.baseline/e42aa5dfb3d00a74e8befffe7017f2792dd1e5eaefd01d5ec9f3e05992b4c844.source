import { Box, Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { browserImageExtensions } from "../../shared/asset-kind";
import { alphaBackgroundStyle, useFoundSettings } from "../app/found-settings";
import { AudioPreview } from "./AudioPreview";
import { FontPreview } from "./FontPreview";
import { GIFPreview } from "./GIFPreview";
import { MediaNotesOverlay } from "./MediaNotesOverlay";
import { ModelPreview } from "./ModelPreview";
import { TextPreview } from "./TextPreview";
import { UnsupportedNotice } from "./UnsupportedNotice";
import { VideoPreview } from "./VideoPreview";

interface AssetPreviewProps {
  asset: AssetRecord;
  lightweight?: boolean;
}

function ProgressiveImage({ asset }: { asset: AssetRecord }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setReady(false);
    setFailed(false);
    const image = new Image();
    image.src = asset.previewUrl;
    let cancelled = false;
    const loaded = image.decode ? image.decode() : new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
    });
    void loaded.then(() => {
      if (!cancelled) setReady(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      image.src = "";
    };
  }, [asset.id, asset.previewUrl]);
  return (
    <img
      className={`progressive-preview ${ready ? "ready" : "proxy"}`}
      src={ready && !failed
        ? asset.previewUrl
        : `${asset.thumbnailUrl}?priority=preview`}
      alt=""
    />
  );
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

export function AssetPreview({ asset, lightweight = false }: AssetPreviewProps) {
  const foundSettings = useFoundSettings();
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
          <div style={{ background: alphaBackgroundStyle(foundSettings) }}>
            <GIFPreview asset={asset} />
          </div>
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
            <div style={{ background: alphaBackgroundStyle(foundSettings) }}>
              <ProgressiveImage asset={asset} />
            </div>
          )
        : <SystemThumbnail asset={asset} />;
    case "video":
      return <VideoPreview asset={asset} />;
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
      return <ModelPreview asset={asset} />;
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
      if (textExtensions.includes(asset.extension.toLowerCase())) {
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
