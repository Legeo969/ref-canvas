import {
  ExternalLink,
  FolderSearch,
  Heart,
  Info,
  Link2,
  Link2Off,
  MessageSquareText,
  ScanSearch,
  Sparkles,
  Star,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AssetColorLabel,
  AssetRecord,
  CollectionRecord,
} from "../../shared/contracts";
import { formatDuration } from "../app/format-duration";
import { useAppStore } from "../app/store";
import { AssetPreview } from "./AssetPreview";
import { AssetAnnotationDialog } from "./AssetAnnotationDialog";
import { HighlightedText } from "./HighlightedText";

interface DetailsPanelProps {
  onUpdate(
    id: string,
    patch: {
      title?: string;
      notes?: string;
      favorite?: boolean;
      rating?: number;
      colorLabel?: AssetColorLabel;
    },
  ): Promise<void>;
  onRelink(id: string, mode: "pick" | "search"): Promise<void>;
  collections: CollectionRecord[];
  onAddToCollection(assetId: string, collectionId: string): Promise<void>;
  onRemoveFromCollection(assetId: string, collectionId: string): Promise<void>;
  onSetTags(assetId: string, tags: string[]): Promise<void>;
  onFindSimilar(asset: AssetRecord): void;
}

function formatDimensions(asset: AssetRecord): string {
  if (asset.width && asset.height) return `${asset.width} × ${asset.height}`;
  return "—";
}

export function DetailsPanel({
  onUpdate,
  onRelink,
  collections,
  onAddToCollection,
  onRemoveFromCollection,
  onSetTags,
  onFindSimilar,
}: DetailsPanelProps) {
  const asset = useAppStore((state) => state.selectedAsset);
  const searchQuery = useAppStore((state) => state.query);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [references, setReferences] = useState<Array<{
    boardId: string;
    boardTitle: string;
  }>>([]);
  const collectionPaths = useMemo(() => {
    const byId = new Map(collections.map((item) => [item.id, item]));
    const pathFor = (id: string): string => {
      const collection = byId.get(id);
      if (!collection) return "";
      return collection.parentId
        ? `${pathFor(collection.parentId)} / ${collection.title}`
        : collection.title;
    };
    return new Map(
      collections.map((collection) => [
        collection.id,
        pathFor(collection.id),
      ]),
    );
  }, [collections]);

  useEffect(() => {
    setTitle(asset?.title ?? "");
    setNotes(asset?.notes ?? "");
    setTags(asset?.tags.join(", ") ?? "");
  }, [asset?.id, asset?.notes, asset?.tags, asset?.title]);

  useEffect(() => {
    setAnnotationOpen(false);
  }, [asset?.id]);

  if (!asset) {
    return (
      <aside className="details-panel details-empty">
        <Info size={20} />
        <span>选择素材查看详情</span>
      </aside>
    );
  }

  return (
    <>
      {annotationOpen &&
        asset.kind === "image" &&
        asset.linkState === "online" && (
          <AssetAnnotationDialog
            asset={asset}
            onClose={() => setAnnotationOpen(false)}
          />
        )}
      <aside className="details-panel">
      <header className="panel-header">
        <div className="detail-heading">
          <Info size={16} />
          <h2>详情</h2>
        </div>
      </header>

      <div className="detail-preview">
        <AssetPreview asset={asset} lightweight />
      </div>
      {asset.kind === "image" && asset.linkState === "online" && (
        <button
          className="secondary-button annotation-open-button"
          onClick={() => setAnnotationOpen(true)}
        >
          <MessageSquareText size={15} />
          图片标注
        </button>
      )}

      <div className="asset-property-row">
        <button
          className={`favorite-toggle ${asset.favorite ? "active" : ""}`}
          onClick={() => void onUpdate(asset.id, { favorite: !asset.favorite })}
          aria-label={asset.favorite ? "取消收藏" : "收藏"}
        >
          <Heart size={16} fill={asset.favorite ? "currentColor" : "none"} />
        </button>
        <div className="rating-control" aria-label="评分">
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              key={rating}
              onClick={() =>
                void onUpdate(asset.id, {
                  rating: asset.rating === rating ? 0 : rating,
                })
              }
              aria-label={`${rating} 星`}
            >
              <Star
                size={15}
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

      <label className="field-label" htmlFor="asset-title">
        标题
      </label>
      <input
        id="asset-title"
        className="text-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (title.trim() && title !== asset.title) {
            void onUpdate(asset.id, { title: title.trim() });
          }
        }}
      />

      <label className="field-label" htmlFor="asset-notes">
        备注
      </label>
      <textarea
        id="asset-notes"
        className="text-area"
        value={notes}
        placeholder="记录来源、用途或灵感…"
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => {
          if (notes !== asset.notes) void onUpdate(asset.id, { notes });
        }}
      />

      <label className="field-label" htmlFor="asset-tags">
        标签
      </label>
      <div className="tag-input">
        <Tag size={14} />
        <input
          id="asset-tags"
          value={tags}
          placeholder="角色, 光影, 构图"
          onChange={(event) => setTags(event.target.value)}
          onBlur={() => {
            const next = tags
              .split(/[,，]/)
              .map((item) => item.trim())
              .filter(Boolean);
            if (next.join("\0") !== asset.tags.join("\0")) {
              void onSetTags(asset.id, next);
            }
          }}
        />
      </div>

      {collections.length > 0 && (
        <>
          <span className="field-label">集合</span>
          <div className="collection-chips">
            {collections.map((collection) => {
              const included = asset.collectionIds.includes(collection.id);
              return (
                <button
                  className={included ? "active" : ""}
                  key={collection.id}
                  title={collectionPaths.get(collection.id)}
                  onClick={() =>
                    void (included
                      ? onRemoveFromCollection(asset.id, collection.id)
                      : onAddToCollection(asset.id, collection.id))
                  }
                >
                  {collectionPaths.get(collection.id)}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="meta-list">
        <div>
          <span>类型</span>
          <strong>{asset.kind}</strong>
        </div>
        <div>
          <span>尺寸</span>
          <strong>{formatDimensions(asset)}</strong>
        </div>
        {(asset.kind === "video" || asset.kind === "audio") && (
          <div>
            <span>时长</span>
            <strong className="meta-duration">
              {formatDuration(asset.duration)}
            </strong>
          </div>
        )}
        <div>
          <span>状态</span>
          <strong className={asset.linkState === "missing" ? "danger" : ""}>
            {{
              online: "已连接",
              missing: "断链",
              searching: "搜索中",
              ambiguous: "待确认",
              offline: "挂载离线",
            }[asset.linkState]}
          </strong>
        </div>
      </div>

      <div className="path-box" title={asset.path}>
        <HighlightedText text={asset.path} query={searchQuery} />
      </div>

      <div className="detail-actions">
        <button
          className="secondary-button"
          onClick={() => window.refCanvas.system.openExternal(asset.path)}
        >
          <ExternalLink size={15} />
          打开
        </button>
        <button
          className="secondary-button"
          onClick={() => window.refCanvas.system.revealInFolder(asset.path)}
        >
          <FolderSearch size={15} />
          定位
        </button>
      </div>

      {asset.kind === "image" && asset.linkState === "online" && (
        <button
          className="secondary-button references-button"
          onClick={() => onFindSimilar(asset)}
        >
          <Sparkles size={15} />
          查找相似图片
        </button>
      )}

      <div className="detail-actions relink-actions">
        <button
          className="secondary-button"
          onClick={() => void onRelink(asset.id, "pick")}
        >
          <Link2 size={15} />
          重新定位
        </button>
        <button
          className="secondary-button"
          onClick={() => void onRelink(asset.id, "search")}
        >
          <ScanSearch size={15} />
          搜索修复
        </button>
      </div>

      <button
        className="secondary-button references-button"
        onClick={async () => {
          setReferences(await window.refCanvas.library.references(asset.id));
        }}
      >
        查看引用白板
      </button>
      {references.length > 0 && (
        <div className="reference-list">
          {references.map((reference) => (
            <span key={reference.boardId}>{reference.boardTitle}</span>
          ))}
        </div>
      )}

      {asset.linkState === "missing" && (
        <div className="warning-card">
          <Link2Off size={16} />
          <span>原文件已移动或不可访问，可手动定位或按指纹搜索修复。</span>
        </div>
      )}
      </aside>
    </>
  );
}
