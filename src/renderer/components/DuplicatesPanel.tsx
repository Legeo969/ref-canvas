import { CopyCheck, FolderSearch, Merge, X } from "lucide-react";
import type { DuplicateGroup } from "../../shared/contracts";

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
              <h2>精确重复项</h2>
              <p>已使用完整 SHA-256 校验，合并前不会自动删除。</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
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
                    <strong>{group.assets.length} 个相同文件</strong>
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
                        <span className="keep-badge">保留</span>
                      ) : (
                        <button
                          className="icon-button"
                          onClick={() =>
                            window.refCanvas.system.revealInFolder(asset.path)
                          }
                          aria-label="在资源管理器中显示"
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
                          `保留“${keep.title}”，并将其余 ${remove.length} 个源文件移入应用回收站？`,
                        )
                      ) {
                        void onMerge(keep.id, remove.map((asset) => asset.id));
                      }
                    }}
                  >
                    <Merge size={15} />
                    合并到第一项
                  </button>
                </article>
              );
            })
          ) : (
            <div className="empty-state compact-empty">
              <CopyCheck size={28} />
              <h3>没有精确重复项</h3>
              <p>快速指纹相同的候选已完成完整文件校验。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
