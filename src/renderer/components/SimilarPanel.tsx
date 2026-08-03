import { RefreshCw, SearchX, X } from "lucide-react";
import type {
  AssetRecord,
  SimilarAsset,
  SimilarityIndexSnapshot,
} from "../../shared/contracts";

interface SimilarPanelProps {
  source: AssetRecord;
  results: SimilarAsset[];
  index: SimilarityIndexSnapshot;
  loading: boolean;
  minScore: number;
  onMinScoreChange(value: number): void;
  onRefresh(): void;
  onCancelIndex(): void;
  onSelect(asset: AssetRecord): void;
  onClose(): void;
}

export function SimilarPanel({
  source,
  results,
  index,
  loading,
  minScore,
  onMinScoreChange,
  onRefresh,
  onCancelIndex,
  onSelect,
  onClose,
}: SimilarPanelProps) {
  return (
    <div className="modal-backdrop similar-backdrop" onMouseDown={onClose}>
      <section
        className="modal-panel similar-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`查找与 ${source.title} 相似的图片`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="similar-heading">
            <img src={source.thumbnailUrl} alt="" />
            <div>
              <h2>相似图片</h2>
              <p>{source.title}</p>
            </div>
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        {index.state === "running" && (
          <div className="similar-index-progress">
            <div>
              <span>正在后台建立视觉索引</span>
              <span>
                {index.processed} / {index.total}
              </span>
            </div>
            <progress
              max={Math.max(1, index.total)}
              value={index.processed}
            />
            <button onClick={onCancelIndex}>取消索引</button>
          </div>
        )}

        <div className="similar-toolbar">
          <span>
            {loading ? "正在比较…" : `${results.length} 个相似结果`}
          </span>
          <label>
            相似度
            <input
              type="range"
              min="50"
              max="95"
              step="5"
              value={minScore}
              onChange={(event) => onMinScoreChange(Number(event.target.value))}
            />
            <strong>{minScore}%</strong>
          </label>
          <button className="secondary-button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} />
            刷新结果
          </button>
        </div>

        {results.length ? (
          <div className="similar-grid">
            {results.map(({ asset, score }) => (
              <button
                className="similar-card"
                key={asset.id}
                onClick={() => onSelect(asset)}
              >
                <span className="similar-card-image">
                  <img src={asset.thumbnailUrl} alt="" />
                  <strong>{Math.round(score)}%</strong>
                </span>
                <span title={asset.title}>{asset.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="similar-empty">
            <SearchX size={28} />
            <h3>{loading ? "正在分析图片" : "尚未找到相似图片"}</h3>
            <p>
              {index.state === "running"
                ? "视觉索引完成后刷新，结果会逐步增加。"
                : "可以降低相似度要求后再次搜索。"}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
