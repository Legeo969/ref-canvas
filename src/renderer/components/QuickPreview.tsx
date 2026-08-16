import {
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import type { AssetColorLabel, AssetRecord } from "../../shared/contracts";
import { formatDuration } from "../app/format-duration";
import { AssetPreview } from "./AssetPreview";
import { MediaInfoSection } from "./MediaInfoSection";
import {
  PreviewSessionModeButtons,
  usePreviewSessionMode,
} from "./PreviewSessionMode";
import {
  PreviewSessionShell,
  PreviewSessionTitle,
  PreviewSurface,
  previewRendererKind,
} from "./PreviewSessionShell";

interface QuickPreviewProps {
  assets: AssetRecord[];
  windowOffset: number;
  total: number;
  activeId: string;
  onChange(id: string): void;
  onNavigateIndex(index: number): Promise<void>;
  onUpdate(
    id: string,
    patch: {
      favorite?: boolean;
      rating?: number;
      colorLabel?: AssetColorLabel;
    },
  ): Promise<void>;
  onClose(): void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function QuickPreview({
  assets,
  windowOffset,
  total,
  activeId,
  onChange,
  onNavigateIndex,
  onClose,
}: QuickPreviewProps) {
  const index = Math.max(
    0,
    assets.findIndex((asset) => asset.id === activeId),
  );
  const absoluteIndex = windowOffset + index;
  const asset = assets[index];
  const previewSession = usePreviewSessionMode(asset?.path ?? null, onClose);
  const canGoBack = absoluteIndex > 0;
  const canGoForward = absoluteIndex < total - 1;
  const dimensions = useMemo(
    () =>
      asset?.width && asset.height
        ? `${asset.width} × ${asset.height}`
        : null,
    [asset],
  );

  useEffect(() => {
    const controller = new AbortController();
    for (let delta = -2; delta <= 2; delta += 1) {
      if (!delta) continue;
      const neighbor = assets[index + delta];
      if (!neighbor) continue;
      void fetch(`${neighbor.thumbnailUrl}?priority=preview`, {
        signal: controller.signal,
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [assets, index]);

  const navigateTo = (targetIndex: number) => {
    const localAsset = assets[targetIndex - windowOffset];
    if (localAsset) {
      onChange(localAsset.id);
      return;
    }
    void onNavigateIndex(targetIndex);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = Boolean(
        event.target instanceof HTMLElement &&
          event.target.matches("input, textarea, select, button"),
      );
      // 方向键按焦点归属路由：事件目标位于媒体预览根/预览面板时
      // 让位（视频步进、序列步进接管），快速预览不翻页。
      const inPreviewFocus = Boolean(
        event.target instanceof HTMLElement &&
          event.target.closest(
            ".video-preview, .sequence-preview-shell, .preview-panel",
          ),
      );
      if (event.key === " " && !interactive) {
        event.preventDefault();
        onClose();
      } else if (interactive) {
        return;
      } else if (event.key === "ArrowLeft" && canGoBack && !inPreviewFocus) {
        event.preventDefault();
        navigateTo(absoluteIndex - 1);
      } else if (event.key === "ArrowRight" && canGoForward && !inPreviewFocus) {
        event.preventDefault();
        navigateTo(absoluteIndex + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    assets,
    canGoBack,
    canGoForward,
    absoluteIndex,
    index,
    onChange,
    onClose,
    onNavigateIndex,
    windowOffset,
  ]);

  if (!asset) return null;

  return (
    <div
      className="quick-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`快速预览 ${asset.title}`}
      onMouseDown={onClose}
    >
      <PreviewSessionShell
        elementRef={previewSession.rootRef}
        focused={previewSession.focused}
        fullscreen={previewSession.fullscreen}
        className="quick-preview-shell"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="quick-preview-header">
          <PreviewSessionTitle
            className="quick-preview-title"
            title={<h2 title={asset.path}>{asset.title}</h2>}
            subtitle={(
              <span>
                {asset.extension.toUpperCase()} · {formatSize(asset.size)}
                {dimensions ? ` · ${dimensions}` : ""}
              </span>
            )}
          />
          <div className="quick-preview-actions">
            <PreviewSessionModeButtons
              focused={previewSession.focused}
              fullscreen={previewSession.fullscreen}
              onToggleFocus={previewSession.toggleFocus}
              onToggleFullscreen={() => void previewSession.toggleFullscreen()}
            />
            <button aria-label="关闭快速预览 Esc" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <PreviewSurface
          renderer={previewRendererKind(asset)}
          className={`quick-preview-stage ${
            asset.kind === "image" ? "is-image" : ""
          }`}
        >
          <div className="quick-preview-content">
            <AssetPreview asset={asset} />
          </div>
        </PreviewSurface>

        <section className="quick-preview-details" aria-label="素材详细信息">
          <dl>
            <div><dt>路径</dt><dd title={asset.path}>{asset.path}</dd></div>
            <div><dt>类型</dt><dd>{asset.kind} · {asset.extension.toUpperCase()}</dd></div>
            <div><dt>大小</dt><dd>{formatSize(asset.size)}</dd></div>
            <div><dt>分辨率</dt><dd>{dimensions ?? "—"}</dd></div>
            <div><dt>时长</dt><dd>{asset.duration != null ? formatDuration(asset.duration) : "—"}</dd></div>
          </dl>
          <MediaInfoSection
            asset={{
              id: asset.id,
              path: asset.path,
              kind: asset.kind,
              extension: asset.extension,
            }}
          />
        </section>

        <footer className="quick-preview-footer">
          <button
            aria-label="上一个素材 ←"
            disabled={!canGoBack}
            onClick={() => navigateTo(absoluteIndex - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            {absoluteIndex + 1} / {total}
          </span>
          <button
            aria-label="下一个素材 →"
            disabled={!canGoForward}
            onClick={() => navigateTo(absoluteIndex + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </footer>
      </PreviewSessionShell>
    </div>
  );
}
