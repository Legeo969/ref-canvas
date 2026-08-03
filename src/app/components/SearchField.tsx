import { FolderOpen, Hash, Layers3, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import {
  computeSearchSuggestions,
  suggestionCount,
} from "../search-suggestions";
import { useAppStore } from "../store";
import { HighlightedText } from "./HighlightedText";

/** 素材库搜索框 + 即时建议下拉（文件夹/标签/素材，命中高亮）。 */
export function SearchField() {
  const store = useAppStore();
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [assetMatches, setAssetMatches] = useState<AssetRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = store.query.trim();
  const tagQuery = query.startsWith("#");
  const listRef = useRef<HTMLDivElement>(null);

  // 素材建议：防抖小查询（只查标题命中，最多 5 条即时预览）。
  useEffect(() => {
    if (!query || tagQuery) {
      setAssetMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.refCanvas.library
        .search({ query, pageSize: 5 })
        .then((page) => setAssetMatches(page.items))
        .catch(() => undefined);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [query, tagQuery]);

  const suggestions = useMemo(
    () => computeSearchSuggestions(store.collections, store.tags, assetMatches, query),
    [store.collections, store.tags, assetMatches, query],
  );
  const total = suggestionCount(suggestions);
  const open = focused && Boolean(query) && !tagQuery && total > 0;

  const applyFolder = (id: string) => {
    store.setCollectionFilter(id);
    store.setQuery("");
    setFocused(false);
  };
  const applyTag = (name: string) => {
    store.setTagFilter(name);
    setFocused(false);
  };
  const applyAsset = (asset: AssetRecord) => {
    store.selectAssetInGrid(asset.id, "replace");
    setFocused(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === "Escape") inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % total);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? total - 1 : current - 1));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0) {
        event.preventDefault();
        const flat = [
          ...suggestions.folders.map((item) => ({ kind: "folder" as const, item })),
          ...suggestions.tags.map((item) => ({ kind: "tag" as const, item })),
          ...suggestions.assets.map((item) => ({ kind: "asset" as const, item })),
        ];
        const pick = flat[activeIndex];
        if (pick?.kind === "folder") applyFolder(pick.item.id);
        else if (pick?.kind === "tag") applyTag(pick.item.name);
        else if (pick?.kind === "asset") applyAsset(pick.item);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFocused(false);
    }
  };

  useEffect(() => {
    if (!open) setActiveIndex(-1);
  }, [open, total]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const row = listRef.current.querySelector<HTMLElement>(
        `[data-suggestion-index="${activeIndex}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div className="search-field">
      <Search size={15} />
      <input
        ref={inputRef}
        value={store.query}
        onChange={(event) => store.setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
        placeholder="搜索名称、备注、路径或 #标签"
        aria-label="搜索素材"
        aria-expanded={open}
        aria-controls="search-suggestions"
      />
      <kbd>Ctrl K</kbd>
      {open && (
        <>
          <div className="suggestions-dismiss" onClick={() => setFocused(false)} />
          <div
            className="search-suggestions"
            id="search-suggestions"
            role="listbox"
            ref={listRef}
          >
            {suggestions.folders.length > 0 && (
              <div className="suggestion-group">
                <span className="suggestion-group-label">文件夹</span>
                {suggestions.folders.map((folder) => (
                  <button
                    key={folder.id}
                    role="option"
                    data-suggestion-index={
                      suggestions.folders.indexOf(folder)
                    }
                    className={activeIndex === suggestions.folders.indexOf(folder) ? "active" : ""}
                    onClick={() => applyFolder(folder.id)}
                  >
                    <FolderOpen size={14} />
                    <HighlightedText text={folder.title} query={query} />
                  </button>
                ))}
              </div>
            )}
            {suggestions.tags.length > 0 && (
              <div className="suggestion-group">
                <span className="suggestion-group-label">标签</span>
                {suggestions.tags.map((tagItem) => (
                  <button
                    key={tagItem.id}
                    role="option"
                    data-suggestion-index={
                      suggestions.folders.length + suggestions.tags.indexOf(tagItem)
                    }
                    className={
                      activeIndex ===
                      suggestions.folders.length + suggestions.tags.indexOf(tagItem)
                        ? "active"
                        : ""
                    }
                    onClick={() => applyTag(tagItem.name)}
                  >
                    <Hash size={14} />
                    <HighlightedText text={tagItem.name} query={query} />
                    <span className="suggestion-count">{tagItem.assetCount}</span>
                  </button>
                ))}
              </div>
            )}
            {suggestions.assets.length > 0 && (
              <div className="suggestion-group">
                <span className="suggestion-group-label">素材</span>
                {suggestions.assets.map((assetItem) => (
                  <button
                    key={assetItem.id}
                    role="option"
                    data-suggestion-index={
                      suggestions.folders.length +
                      suggestions.tags.length +
                      suggestions.assets.indexOf(assetItem)
                    }
                    className={
                      activeIndex ===
                      suggestions.folders.length +
                        suggestions.tags.length +
                        suggestions.assets.indexOf(assetItem)
                        ? "active"
                        : ""
                    }
                    onClick={() => applyAsset(assetItem)}
                  >
                    <span className="suggestion-thumb">
                      {assetItem.thumbnailUrl ? (
                        <img src={assetItem.thumbnailUrl} alt="" draggable={false} />
                      ) : (
                        <Layers3 size={13} />
                      )}
                    </span>
                    <HighlightedText text={assetItem.title} query={query} />
                  </button>
                ))}
              </div>
            )}
            <span className="suggestion-hint">↑↓ 选择 · Enter 应用 · Esc 关闭</span>
          </div>
        </>
      )}
      {query && (
        <button
          className="search-cancel"
          aria-label="清除搜索"
          onClick={() => store.setQuery("")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
