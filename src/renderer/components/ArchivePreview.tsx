import { ChevronLeft, FileArchive, FileText, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ArchiveEntryInfo,
  ArchiveEntryPreviewResult,
  ArchiveListingResult,
  AssetRecord,
} from "../../shared/contracts";
import { translate } from "../app/i18n";
import { MediaNotesOverlay } from "./MediaNotesOverlay";

/**
 * 压缩包浏览（zip/tar/tgz/gz）。
 *
 * 按压缩软件的方式工作：进入目录逐级浏览，点开文件直接看内容。
 * 清单只读表结构；内容只在点开某一条时解压那一条（临时文件 + refbrowse
 * token），不批量解压、不落用户磁盘。
 * rar/7z 无内置解码器，降级为提示。
 */
const FORMAT_LABEL: Record<ArchiveListingResult["format"], string> = {
  zip: "ZIP",
  tar: "TAR",
  gzip: "GZIP",
  rar: "RAR",
  sevenzip: "7Z",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

interface VisibleEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string | null;
}

/** 取某一层的直接子项；中间目录即使没有显式条目也补出来。 */
function childrenOf(entries: ArchiveEntryInfo[], dir: string): VisibleEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const found = new Map<string, VisibleEntry>();
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      found.set(entry.path, {
        path: entry.path,
        name: rest,
        isDirectory: entry.isDirectory,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      });
      continue;
    }
    const name = rest.slice(0, slash);
    const directoryPath = `${prefix}${name}/`;
    if (!found.has(directoryPath)) {
      found.set(directoryPath, {
        path: directoryPath,
        name,
        isDirectory: true,
        size: 0,
        modifiedAt: null,
      });
    }
  }
  return [...found.values()].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true });
  });
}

export function ArchivePreview({ asset }: { asset: AssetRecord }) {
  const [listing, setListing] = useState<ArchiveListingResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [cwd, setCwd] = useState("");
  const [opened, setOpened] = useState<{ path: string; name: string } | null>(null);
  const [preview, setPreview] = useState<ArchiveEntryPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setFailed(false);
    setCwd("");
    setOpened(null);
    if (!window.refCanvas.media?.listArchive) return;
    void window.refCanvas.media
      .listArchive(asset.path)
      .then((value) => {
        if (!cancelled) setListing(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.path]);

  const openEntry = (entry: VisibleEntry) => {
    if (!window.refCanvas.media?.archiveEntry) return;
    setOpened({ path: entry.path, name: entry.name });
    setPreview(null);
    setPreviewFailed(false);
    setPreviewLoading(true);
    void window.refCanvas.media
      .archiveEntry(asset.path, entry.path)
      .then(setPreview)
      .catch(() => setPreviewFailed(true))
      .finally(() => setPreviewLoading(false));
  };

  const visible = useMemo(
    () => (listing ? childrenOf(listing.entries, cwd) : []),
    [listing, cwd],
  );

  if (failed) {
    return (
      <div className="archive-preview archive-preview-empty">
        <FileArchive size={30} strokeWidth={1.25} />
        <span>{translate("archive.unsupported")}</span>
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="archive-preview archive-preview-empty">
        {translate("directory.loading")}
      </div>
    );
  }

  const ratio = listing.totalSize > 0
    ? Math.round((listing.totalCompressedSize / listing.totalSize) * 100)
    : 100;
  const segments = cwd ? cwd.split("/").filter(Boolean) : [];
  const parent = segments.length > 1 ? `${segments.slice(0, -1).join("/")}/` : "";
  const rootName = asset.path.split(/[\\/]/).pop() ?? asset.title;

  if (opened) {
    return (
      <MediaNotesOverlay asset={asset} mediaClassName="is-text-media">
        <div className="archive-preview">
          <div className="archive-preview-path">
            <button
              type="button"
              className="archive-path-back"
              aria-label={translate("archive.backToEntries")}
              onClick={() => {
                setOpened(null);
                setPreview(null);
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="archive-path-current" title={opened.path}>{opened.name}</span>
          </div>
          <div className="archive-entry-preview">
            {previewLoading ? (
              <span className="archive-entry-hint">{translate("archive.entryLoading")}</span>
            ) : previewFailed || !preview ? (
              <span className="archive-entry-hint">{translate("archive.entryUnreadable")}</span>
            ) : preview.kind === "text" ? (
              <pre className="archive-entry-text">{preview.text}</pre>
            ) : preview.kind === "media" ? (
              <EntryMedia preview={preview} />
            ) : (
              <span className="archive-entry-hint">
                {translate("archive.entryUnsupported").replace("{size}", formatBytes(preview.size))}
              </span>
            )}
          </div>
        </div>
      </MediaNotesOverlay>
    );
  }

  return (
    <MediaNotesOverlay asset={asset} mediaClassName="is-text-media">
      <div className="archive-preview">
        <div className="archive-preview-meta">
          <FileArchive size={14} />
          <span>
            {translate("archive.meta")
              .replace("{format}", FORMAT_LABEL[listing.format])
              .replace("{count}", String(listing.entries.length))
              .replace("{raw}", formatBytes(listing.totalSize))
              .replace("{packed}", formatBytes(listing.totalCompressedSize))
              .replace("{ratio}", String(ratio))}
          </span>
          {listing.truncated ? (
            <span className="archive-truncated">{translate("archive.truncated")}</span>
          ) : null}
        </div>
        <div className="archive-preview-path">
          <button
            type="button"
            className="archive-path-back"
            aria-label={translate("archive.upOneLevel")}
            disabled={!cwd}
            onClick={() => setCwd(parent)}
          >
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="archive-path-segment" onClick={() => setCwd("")}>
            {rootName}
          </button>
          {segments.map((segment, index) => (
            <span className="archive-path-group" key={`${segment}-${index}`}>
              <span className="archive-path-separator">/</span>
              <button
                type="button"
                className="archive-path-segment"
                onClick={() => setCwd(`${segments.slice(0, index + 1).join("/")}/`)}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="archive-entry-hint">{translate("archive.emptyDirectory")}</div>
        ) : (
          <ul className="archive-entry-list">
            {visible.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className={entry.isDirectory ? "archive-entry directory" : "archive-entry"}
                  onClick={() => (entry.isDirectory ? setCwd(entry.path) : openEntry(entry))}
                >
                  {entry.isDirectory ? <Folder size={12} /> : <FileText size={12} />}
                  <span className="archive-entry-name">{entry.name}</span>
                  {!entry.isDirectory && (
                    <span className="archive-entry-size">{formatBytes(entry.size)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MediaNotesOverlay>
  );
}

function EntryMedia({
  preview,
}: {
  preview: Extract<ArchiveEntryPreviewResult, { kind: "media" }>;
}) {
  if (preview.mimeType.startsWith("image/")) {
    return <img className="archive-entry-image" src={preview.source} alt="" />;
  }
  if (preview.mimeType.startsWith("video/")) {
    return <video className="archive-entry-video" src={preview.source} controls />;
  }
  if (preview.mimeType.startsWith("audio/")) {
    return <audio className="archive-entry-audio" src={preview.source} controls />;
  }
  return <iframe className="archive-entry-frame" src={preview.source} title="" />;
}
