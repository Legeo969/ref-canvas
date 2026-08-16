import { CopyCheck, FolderSearch, Merge, X } from "lucide-react";
import type { DuplicateGroup } from "../../shared/contracts";
import { translate } from "../app/i18n";

interface DuplicatesPanelProps {
  groups: DuplicateGroup[];
  onClose(): void;
  onMerge(keepId: string, removeIds: string[]): Promise<void>;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DuplicatesPanel({
  groups,
  onClose,
  onMerge,
}: DuplicatesPanelProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-panel duplicates-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <CopyCheck size={18} />
            <div>
              <h2>{translate("duplicates.title")}</h2>
              <p>{translate("duplicates.subtitle")}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={translate("dialogs.close")}>
            <X size={17} />
          </button>
        </header>
        <div className="duplicates-list">
          {groups.length ? (
            groups.map((group) => {
              const keep = group.assets[0];
              const remove = group.assets.slice(1);
              return (
                <article className="duplicate-group" key={group.contentHash}>
                  <div className="duplicate-summary">
                    <strong>{translate("duplicates.count").replace("{count}", String(group.assets.length))}</strong>
                    <span>{formatBytes(group.size)} · {group.contentHash.slice(0, 12)}…</span>
                  </div>
                  {group.assets.map((asset, index) => (
                    <div className="duplicate-item" key={asset.id}>
                      <img src={asset.thumbnailUrl} alt="" />
                      <div>
                        <strong>{asset.title}</strong>
                        <span title={asset.path}>{asset.path}</span>
                      </div>
                      {index === 0 ? (
                        <span className="keep-badge">{translate("duplicates.keep")}</span>
                      ) : (
                        <button
                          className="icon-button"
                          onClick={() =>
                            window.refCanvas.system.revealInFolder(asset.path)
                          }
                          aria-label={translate("preview.revealInExplorer")}
                        >
                          <FolderSearch size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="primary-button merge-button"
                    onClick={() => {
                      if (
                        window.confirm(
                          translate("duplicates.mergeConfirm")
                            .replace("{title}", keep.title)
                            .replace("{count}", String(remove.length)),
                        )
                      ) {
                        void onMerge(keep.id, remove.map((asset) => asset.id));
                      }
                    }}
                  >
                    <Merge size={15} />
                    {translate("duplicates.merge")}
                  </button>
                </article>
              );
            })
          ) : (
            <div className="empty-state compact-empty">
              <CopyCheck size={28} />
              <h3>{translate("duplicates.empty")}</h3>
              <p>{translate("duplicates.emptyHint")}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
