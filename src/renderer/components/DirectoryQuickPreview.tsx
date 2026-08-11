import {
  ChevronLeft,
  ChevronRight,
  Shapes,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DirectoryEntry } from "../../shared/contracts";
import {
  assetKindForExtension,
  browserImageExtensions,
} from "../../shared/asset-kind";
import { formatBytes } from "../app/format-bytes";
import { translate } from "../app/i18n";
import { HighlightedText } from "./HighlightedText";
import { MediaInfoSection } from "./MediaInfoSection";
import { ModelPreview } from "./ModelPreview";
import { HdrPreview } from "./HdrPreview";
import { VideoPreview } from "./VideoPreview";
import { AudioPreview } from "./AudioPreview";
import { ImageReviewPreview } from "./ImageReviewPreview";
import {
  PreviewSessionModeButtons,
  usePreviewSessionMode,
} from "./PreviewSessionMode";
import {
  PreviewSessionShell,
  PreviewSessionTitle,
  PreviewSurface,
  type PreviewRendererKind,
} from "./PreviewSessionShell";

interface DirectoryQuickPreviewProps {
  entry: DirectoryEntry;
  /** 同层文件条目（用于 ←/→ 循环浏览），含当前条目。 */
  files: DirectoryEntry[];
  query: string;
  onNavigate(delta: number): void;
  onOpen(entry: DirectoryEntry): void;
  onReveal(entry: DirectoryEntry): void;
  onCopyPath(entry: DirectoryEntry): void;
  onTag(entry: DirectoryEntry): void;
  onTrash(entry: DirectoryEntry): void;
  onClose(): void;
}

/** 目录模式即时预览浮层：分层格式预览 + 常用操作，←/→ 循环浏览。 */
export function DirectoryQuickPreview({
  entry,
  files,
  query,
  onNavigate,
  onClose,
}: DirectoryQuickPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [fullImageReady, setFullImageReady] = useState(false);
  const index = files.findIndex((item) => item.path === entry.path);
  const previewSession = usePreviewSessionMode(entry.path, onClose);

  useEffect(() => {
    setPreviewUrl(null);
    setFailed(false);
    setFullImageReady(false);
    let cancelled = false;
    void window.refCanvas.filesystem
      .previewToken(entry.path)
      .then((token) => {
        if (!cancelled) setPreviewUrl(token);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.extension]);

  const kind = assetKindForExtension(entry.extension);
  const rendererKind: PreviewRendererKind =
    entry.extension === "exr" || entry.extension === "hdr"
      ? "hdr"
      : kind === "image" || kind === "video" || kind === "audio" ||
          kind === "pdf" || kind === "model3d" || kind === "font"
        ? kind
        : "generic";
  const rawUrl = previewUrl ? `refbrowse://preview/${previewUrl}` : null;
  const thumbnailUrl = previewUrl
    ? `refbrowse://thumbnail/${previewUrl}?priority=preview`
    : null;

  useEffect(() => {
    if (
      !previewUrl ||
      assetKindForExtension(entry.extension) !== "image" ||
      !browserImageExtensions.has(entry.extension)
    ) return;
    const image = new Image();
    image.src = `refbrowse://preview/${previewUrl}`;
    let cancelled = false;
    const loaded = image.decode ? image.decode() : Promise.resolve();
    void loaded.then(() => {
      if (!cancelled) setFullImageReady(true);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      image.src = "";
    };
  }, [entry.extension, previewUrl]);

  useEffect(() => {
    if (!window.refCanvas.filesystem.previewTokens || index < 0) return;
    const neighbors = [-2, -1, 1, 2]
      .map((delta) => files[index + delta])
      .filter((item): item is DirectoryEntry => Boolean(item));
    if (!neighbors.length) return;
    const controller = new AbortController();
    void window.refCanvas.filesystem
      .previewTokens(neighbors.map((item) => item.path))
      .then((tokens) => {
        for (const item of tokens) {
          void fetch(`refbrowse://thumbnail/${item.token}?priority=preview`, {
            signal: controller.signal,
          }).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [files, index]);

  const previewContent = () => {
    if (!previewUrl || failed) {
      return (
        <span className="asset-placeholder">
          <Shapes size={34} strokeWidth={1.25} />
          <span>{entry.extension.toUpperCase() || "FILE"}</span>
        </span>
      );
    }
    if (entry.extension === "exr" || entry.extension === "hdr") {
      return (
        <HdrPreview
          source={thumbnailUrl!}
          extension={entry.extension}
          path={entry.path}
        />
      );
    }
    if (kind === "image") {
      return (
        browserImageExtensions.has(entry.extension) ? (
          <ImageReviewPreview
            asset={{
              id: entry.path,
              title: entry.name,
              path: entry.path,
              extension: entry.extension,
              kind: "image",
              previewUrl: fullImageReady ? rawUrl! : thumbnailUrl!,
            }}
          />
        ) : (
          <img src={thumbnailUrl!} alt="" draggable={false} onError={() => setFailed(true)} />
        )
      );
    }
    if (kind === "video") {
      return (
        <VideoPreview
          asset={{
            id: entry.path,
            path: entry.path,
            previewUrl: rawUrl!,
          }}
          persistNotes={false}
        />
      );
    }
    if (kind === "audio") {
      return (
        <AudioPreview
          asset={{
            id: entry.path,
            path: entry.path,
            extension: entry.extension,
            previewUrl: rawUrl!,
          }}
        />
      );
    }
    if (kind === "pdf") {
      return (
        <iframe
          className="pdf-preview"
          src={`${rawUrl!}#toolbar=0&navpanes=0`}
          title={entry.name}
        />
      );
    }
    if (kind === "model3d") {
      return (
        <ModelPreview
          allowCustomThumbnail={false}
          asset={{
            id: previewUrl,
            linkState: "online",
            extension: entry.extension,
            previewUrl: `${rawUrl!}/${encodeURIComponent(entry.name)}`,
          }}
        />
      );
    }
    return (
      <img
        src={thumbnailUrl!}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  };

  return (
    <div className="directory-preview-overlay" onPointerDown={onClose}>
      <PreviewSessionShell
        as="div"
        elementRef={previewSession.rootRef}
        focused={previewSession.focused}
        fullscreen={previewSession.fullscreen}
        className="directory-preview"
        role="dialog"
        aria-label={translate("preview.previewNamed").replace("{name}", entry.name)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="directory-preview-session-actions">
          <PreviewSessionModeButtons
            focused={previewSession.focused}
            fullscreen={previewSession.fullscreen}
            onToggleFocus={previewSession.toggleFocus}
            onToggleFullscreen={() => void previewSession.toggleFullscreen()}
          />
          <button
            className="icon-button preview-close"
            aria-label={translate("preview.close")}
            title={translate("preview.close")}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <PreviewSurface renderer={rendererKind} className="directory-preview-stage">
          {previewContent()}
        </PreviewSurface>
        <div className="directory-preview-info">
          <PreviewSessionTitle
            title={(
              <h3 title={entry.name}>
                <HighlightedText text={entry.name} query={query} />
              </h3>
            )}
          />
          <p className="directory-preview-path" title={entry.path}>
            <HighlightedText text={entry.path} query={query} />
          </p>
          <p className="directory-preview-meta">
            {index >= 0 ? `${index + 1} / ${files.length} · ` : ""}
            {entry.sequence
              ? translate("preview.sequenceMeta")
                  .replace("{frame}", String(entry.sequence.frame))
                  .replace("{count}", String(entry.sequence.count))
              : ""}
            {formatBytes(entry.size, "")}
          </p>
          <MediaInfoSection
            asset={{
              id: entry.path,
              path: entry.path,
              kind,
              extension: entry.extension,
            }}
          />
        </div>
        <button
          className="preview-nav preview-prev"
          aria-label={translate("preview.previousFile")}
          disabled={files.length < 2}
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(-1);
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="preview-nav preview-next"
          aria-label={translate("preview.nextFile")}
          disabled={files.length < 2}
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(1);
          }}
        >
          <ChevronRight size={20} />
        </button>
      </PreviewSessionShell>
    </div>
  );
}
