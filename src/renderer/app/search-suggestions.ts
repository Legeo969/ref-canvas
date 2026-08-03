import type { AssetRecord, CollectionRecord, TagRecord } from "../../shared/contracts";
import { folderLabel } from "./folder-navigation";
import { searchTerms } from "./search-highlight";

/** 搜索建议结果：按组限定数量，供下拉即时预览。 */
export interface SearchSuggestions {
  folders: CollectionRecord[];
  tags: TagRecord[];
  assets: AssetRecord[];
}

const LIMITS = { folders: 5, tags: 5, assets: 5 };

/**
 * 计算搜索建议：文件夹按完整路径（父 / 子）匹配、标签按名称、素材按标题。
 * 纯函数便于单测；素材列表由调用方（组件）用 pageSize 小查询提供。
 */
export function computeSearchSuggestions(
  collections: readonly CollectionRecord[],
  tags: readonly TagRecord[],
  assets: readonly AssetRecord[],
  query: string,
  limits: { folders: number; tags: number; assets: number } = LIMITS,
): SearchSuggestions {
  const terms = searchTerms(query);
  if (!terms.length) {
    return { folders: [], tags: [], assets: [] };
  }
  const lower = (value: string) => value.toLocaleLowerCase("en-US");
  const matchAny = (value: string) => {
    const needle = lower(value);
    return terms.some((term) => needle.includes(lower(term)));
  };
  const folders = collections
    .filter((folder) => matchAny(folderLabel(collections, folder.id)))
    .slice(0, limits.folders);
  const tagMatches = tags
    .filter((tag) => matchAny(tag.name))
    .slice(0, limits.tags);
  const assetMatches = assets
    .filter((asset) => matchAny(asset.title))
    .slice(0, limits.assets);
  return { folders, tags: tagMatches, assets: assetMatches };
}

/** 建议总数（用于键盘导航与“无建议”判定）。 */
export function suggestionCount(suggestions: SearchSuggestions): number {
  return (
    suggestions.folders.length +
    suggestions.tags.length +
    suggestions.assets.length
  );
}
