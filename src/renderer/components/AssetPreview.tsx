import { Box, Headphones, Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import { browserImageExtensions } from "../../shared/asset-kind";
import { GIFPreview } from "./GIFPreview";
import { MediaNotesOverlay } from "./MediaNotesOverlay";
import { ModelPreview } from "./ModelPreview";
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
  if (asset.linkState !== "online") {
    return <span className="preview-message">原文件当前不可访问</span>;
  }
  if (lightweight) return <SystemThumbnail asset={asset} />;

  switch (asset.kind) {
    case "image":
      if (asset.extension === "gif") return <GIFPreview asset={asset} />;
      return browserImageExtensions.has(asset.extension.toLowerCase())
        ? <ProgressiveImage asset={asset} />
        : <SystemThumbnail asset={asset} />;
    case "video":
      return <VideoPreview asset={asset} />;
    case "audio":
      return (
        <div className="audio-preview">
          <Headphones size={34} strokeWidth={1.25} />
          <MediaNotesOverlay asset={asset}>
            <audio src={asset.previewUrl} controls preload="metadata" />
          </MediaNotesOverlay>
        </div>
      );
    case "pdf":
      return (
        <iframe
          className="pdf-preview"
          src={`${asset.previewUrl}#toolbar=0&navpanes=0`}
          title={asset.title}
        />
      );
    case "model3d":
      return <ModelPreview asset={asset} />;
    case "dcc":
    case "font":
    case "generic":
      return <SystemThumbnail asset={asset} />;
    default: {
      const Icon = Box;
      return <Icon size={34} />;
    }
  }
}
