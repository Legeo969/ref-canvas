import { FileSearch, FolderOpen, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { DirectoryEntry } from "../../shared/contracts";
import {
  assetKindForExtension,
  browserImageExtensions,
} from "../../shared/asset-kind";
import { formatBytes } from "../app/format-bytes";
import { MediaInfoSection } from "./MediaInfoSection";

export function DirectoryDetailsPanel({
  entry,
}: {
  entry: DirectoryEntry | null;
}) {
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    setPreviewToken(null);
    setPreviewFailed(false);
    if (!entry || entry.isDirectory) return;
    let cancelled = false;
    void window.refCanvas.filesystem
      .previewToken(entry.path)
      .then((token) => {
        if (!cancelled) setPreviewToken(token);
      })
      .catch(() => setPreviewFailed(true));
    return () => {
      cancelled = true;
    };
  }, [entry]);

  useEffect(() => {
    setTags(entry?.tags ?? []);
    if (!entry || entry.isDirectory || !window.refCanvas.library?.getByPath) {
      return;
    }
    let cancelled = false;
    void window.refCanvas.library.getByPath(entry.path)
      .then((asset) => {
        if (!cancelled) setTags(asset?.tags ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!entry) {
    return (
      <aside className="details-panel details-empty">
        <FileSearch size={20} />
        <span>选择磁盘文件查看格式详情</span>
      </aside>
    );
  }

  const kind = assetKindForExtension(entry.extension);
  const previewSource = previewToken
    ? browserImageExtensions.has(entry.extension)
      ? `refbrowse://preview/${previewToken}`
      : `refbrowse://thumbnail/${previewToken}?priority=preview`
    : null;

  return (
    <aside className="details-panel directory-details-panel">
      <header className="panel-header">
        <div className="detail-heading">
          <FileSearch size={16} />
          <h2>格式检查器</h2>
        </div>
      </header>
      {!entry.isDirectory && previewSource && !previewFailed && (
        <div className="detail-preview">
          <img
            src={previewSource}
            alt=""
            onError={() => setPreviewFailed(true)}
          />
        </div>
      )}
      <div className="directory-inspector-title" title={entry.name}>
        {entry.name}
      </div>
      <div className="meta-list">
        <div>
          <span>类型</span>
          <strong>{entry.isDirectory ? "folder" : kind}</strong>
        </div>
        {!entry.isDirectory && (
          <>
            <div>
              <span>格式</span>
              <strong>{entry.extension.toUpperCase() || "—"}</strong>
            </div>
            <div>
              <span>大小</span>
              <strong>{formatBytes(entry.size, "—")}</strong>
            </div>
          </>
        )}
        {entry.sequence && (
          <div>
            <span>图片序列</span>
            <strong>
              {entry.sequence.startFrame}–{entry.sequence.endFrame} ·{" "}
              {entry.sequence.count} 帧
            </strong>
          </div>
        )}
      </div>
      {!entry.isDirectory && tags.length > 0 && (
        <div className="directory-detail-tags" aria-label="标签">
          {tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}
      {!entry.isDirectory && (
        <MediaInfoSection
          asset={{
            id: entry.path,
            path: entry.path,
            kind,
            extension: entry.extension,
          }}
        />
      )}
      <div className="path-box" title={entry.path}>
        {entry.path}
      </div>
      <div className="detail-actions">
        <button
          className="secondary-button"
          onClick={() => void window.refCanvas.filesystem.open(entry.path)}
        >
          <SquareArrowOutUpRight size={14} />
          打开
        </button>
        <button
          className="secondary-button"
          onClick={() => void window.refCanvas.filesystem.reveal(entry.path)}
        >
          <FolderOpen size={14} />
          定位
        </button>
      </div>
    </aside>
  );
}
