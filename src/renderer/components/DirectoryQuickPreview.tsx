import {
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { DirectoryEntry } from "../../shared/contracts";
import { assetKindForExtension } from "../../shared/asset-kind";
import { formatBytes } from "../app/format-bytes";
import { translate } from "../app/i18n";
import { HighlightedText } from "./HighlightedText";
import { MediaInfoSection } from "./MediaInfoSection";
import { PreviewSessionTitle } from "./PreviewSessionShell";

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

/** 目录模式信息浮层：不播放媒体，只展示素材详细信息与媒体信息，←/→ 循环浏览。 */
export function DirectoryQuickPreview({
  entry,
  files,
  query,
  onNavigate,
  onClose,
}: DirectoryQuickPreviewProps) {
  const index = files.findIndex((item) => item.path === entry.path);
  const kind = assetKindForExtension(entry.extension);

  return (
    <div className="directory-preview-overlay" onPointerDown={onClose}>
      <section
        className="directory-preview"
        role="dialog"
        aria-label={translate("preview.previewNamed").replace("{name}", entry.name)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button preview-close"
          aria-label={translate("preview.close")}
          title={translate("preview.close")}
          onClick={onClose}
        >
          <X size={17} />
        </button>
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
      </section>
    </div>
  );
}
