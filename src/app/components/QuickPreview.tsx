import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Heart,
  Minus,
  Plus,
  Star,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AssetColorLabel,
  AssetRecord,
} from "../../shared/contracts";
import { AssetPreview } from "./AssetPreview";

interface QuickPreviewProps {
  assets: AssetRecord[];
  total: number;
  hasMore: boolean;
  activeId: string;
  onChange(id: string): void;
  onLoadMore(): Promise<void>;
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
  total,
  hasMore,
  activeId,
  onChange,
  onLoadMore,
  onUpdate,
  onClose,
}: QuickPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingNextIndex, setPendingNextIndex] = useState<number | null>(null);
  const index = Math.max(
    0,
    assets.findIndex((asset) => asset.id === activeId),
  );
  const asset = assets[index];
  const canGoBack = index > 0;
  const canGoForward = index < assets.length - 1;
  const dimensions = useMemo(
    () =>
      asset?.width && asset.height
        ? `${asset.width} × ${asset.height}`
        : null,
    [asset],
  );

  useEffect(() => setZoom(1), [activeId]);

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

  useEffect(() => {
    if (pendingNextIndex === null || assets.length <= pendingNextIndex) return;
    onChange(assets[pendingNextIndex].id);
    setPendingNextIndex(null);
    setLoadingMore(false);
  }, [assets, onChange, pendingNextIndex]);

  const goForward = () => {
    if (canGoForward) {
      onChange(assets[index + 1].id);
      return;
    }
    if (!hasMore || loadingMore) return;
    setPendingNextIndex(assets.length);
    setLoadingMore(true);
    void onLoadMore().finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = Boolean(
        event.target instanceof HTMLElement &&
          event.target.matches("input, textarea, select, button"),
      );
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === " " && !interactive) {
        event.preventDefault();
        onClose();
      } else if (interactive) {
        return;
      } else if (event.key === "ArrowLeft" && canGoBack) {
        event.preventDefault();
        onChange(assets[index - 1].id);
      } else if (event.key === "ArrowRight" && (canGoForward || hasMore)) {
        event.preventDefault();
        goForward();
      } else if ((event.key === "+" || event.key === "=") && asset?.kind === "image") {
        event.preventDefault();
        setZoom((value) => Math.min(4, value + 0.25));
      } else if (event.key === "-" && asset?.kind === "image") {
        event.preventDefault();
        setZoom((value) => Math.max(0.25, value - 0.25));
      } else if (event.key.toLowerCase() === "f" && asset) {
        event.preventDefault();
        void onUpdate(asset.id, { favorite: !asset.favorite });
      } else if (/^[0-5]$/.test(event.key) && asset) {
        event.preventDefault();
        void onUpdate(asset.id, { rating: Number(event.key) });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    asset?.kind,
    assets,
    canGoBack,
    canGoForward,
    hasMore,
    index,
    loadingMore,
    onChange,
    onClose,
    onLoadMore,
    onUpdate,
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
      <section
        className="quick-preview-shell"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="quick-preview-header">
          <div className="quick-preview-title">
            <h2>{asset.title}</h2>
            <span>
              {asset.extension.toUpperCase()} · {formatSize(asset.size)}
              {dimensions ? ` · ${dimensions}` : ""}
            </span>
          </div>
          <div className="quick-preview-actions">
            <button
              aria-label="在资源管理器中显示"
              onClick={() => void window.refCanvas.system.revealInFolder(asset.path)}
            >
              <FolderOpen size={17} />
            </button>
            <button
              aria-label="使用默认应用打开"
              onClick={() => void window.refCanvas.system.openExternal(asset.path)}
            >
              <ExternalLink size={17} />
            </button>
            <button aria-label="关闭快速预览 Esc" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div
          className={`quick-preview-stage ${
            asset.kind === "image" ? "is-image" : ""
          }`}
          onWheel={(event) => {
            if (asset.kind !== "image" || !event.ctrlKey) return;
            event.preventDefault();
            setZoom((value) =>
              Math.min(4, Math.max(0.25, value + (event.deltaY < 0 ? 0.25 : -0.25))),
            );
          }}
        >
          <div
            className="quick-preview-content"
            style={
              asset.kind === "image"
                ? { transform: `scale(${zoom})` }
                : undefined
            }
          >
            <AssetPreview asset={asset} />
          </div>
        </div>

        <footer className="quick-preview-footer">
          <div className="quick-preview-organize">
            <button
              className={asset.favorite ? "active" : ""}
              aria-label={asset.favorite ? "取消收藏" : "收藏"}
              data-shortcut="F"
              onClick={() =>
                void onUpdate(asset.id, { favorite: !asset.favorite })
              }
            >
              <Heart
                size={16}
                fill={asset.favorite ? "currentColor" : "none"}
              />
            </button>
            <div className="quick-preview-rating" aria-label="评分">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  className={asset.rating >= rating ? "active" : ""}
                  key={rating}
                  aria-label={`${rating} 星`}
                  data-shortcut={String(rating)}
                  onClick={() =>
                    void onUpdate(asset.id, {
                      rating: asset.rating === rating ? 0 : rating,
                    })
                  }
                >
                  <Star
                    size={14}
                    fill={asset.rating >= rating ? "currentColor" : "none"}
                  />
                </button>
              ))}
            </div>
            <select
              value={asset.colorLabel}
              onChange={(event) =>
                void onUpdate(asset.id, {
                  colorLabel: event.target.value as AssetColorLabel,
                })
              }
              aria-label="颜色标签"
            >
              <option value="none">无颜色</option>
              <option value="red">红色</option>
              <option value="orange">橙色</option>
              <option value="yellow">黄色</option>
              <option value="green">绿色</option>
              <option value="blue">蓝色</option>
              <option value="purple">紫色</option>
              <option value="gray">灰色</option>
            </select>
          </div>
          <button
            aria-label="上一个素材 ←"
            disabled={!canGoBack}
            onClick={() => onChange(assets[index - 1].id)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            {index + 1} / {total}
          </span>
          <button
            aria-label={loadingMore ? "正在加载下一批素材" : "下一个素材 →"}
            disabled={!canGoForward && (!hasMore || loadingMore)}
            onClick={goForward}
          >
            <ChevronRight size={18} />
          </button>
          {asset.kind === "image" && (
            <div className="quick-preview-zoom">
              <button
                aria-label="缩小预览 -"
                onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
              >
                <Minus size={16} />
              </button>
              <button
                className="quick-preview-zoom-value"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                aria-label="放大预览 +"
                onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
              >
                <Plus size={16} />
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
