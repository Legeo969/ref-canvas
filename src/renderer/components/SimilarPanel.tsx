import { RefreshCw, SearchX, X } from "lucide-react";
import type {
  AssetRecord,
  SimilarAsset,
  SimilarityIndexSnapshot,
} from "../../shared/contracts";
import { translate } from "../app/i18n";

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
        aria-label={translate("similar.findFor").replace("{title}", source.title)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="similar-heading">
            <img src={source.thumbnailUrl} alt="" />
            <div>
              <h2>{translate("similar.title")}</h2>
              <p>{source.title}</p>
            </div>
          </div>
          <button className="icon-button" aria-label={translate("dialogs.close")} onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        {index.state === "running" && (
          <div className="similar-index-progress">
            <div>
              <span>{translate("similar.indexing")}</span>
              <span>
                {index.processed} / {index.total}
              </span>
            </div>
            <progress
              max={Math.max(1, index.total)}
              value={index.processed}
            />
            <button onClick={onCancelIndex}>{translate("similar.cancelIndex")}</button>
          </div>
        )}

        <div className="similar-toolbar">
          <span>
            {loading ? translate("similar.comparing") : translate("similar.results").replace("{count}", String(results.length))}
          </span>
          <label>
            {translate("similar.similarity")}
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
            {translate("similar.refresh")}
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
            <h3>{loading ? translate("similar.analyzing") : translate("similar.noResults")}</h3>
            <p>
              {index.state === "running"
                ? translate("similar.indexingHint")
                : translate("similar.lowerThresholdHint")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
