/**
 * 搜索命中高亮的纯函数：把查询词拆成词元，在文本上找不重叠的命中区间。
 * 供素材卡标题、目录条目名称、路径与搜索建议共用。
 */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** 查询词元：跳过 #标签 前缀词、按空白切分、去重、最多 8 个。 */
export function searchTerms(query: string): string[] {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const terms = cleaned
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && !term.startsWith("#"))
    .slice(0, 8);
  return [...new Set(terms)];
}

/**
 * 在文本上找出所有词元的命中区间（大小写不敏感、子串匹配，支持中文），
 * 合并重叠区间后输出有序片段；无命中时返回整段未命中。
 */
export function highlightSegments(
  text: string,
  terms: string[],
): HighlightSegment[] {
  if (!text || !terms.length) return text ? [{ text, match: false }] : [];
  const lower = text.toLocaleLowerCase("en-US");
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    const needle = term.toLocaleLowerCase("en-US");
    if (!needle) continue;
    let from = 0;
    while (ranges.length < 64) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      ranges.push([at, at + needle.length]);
      from = at + needle.length;
    }
  }
  if (!ranges.length) return [{ text, match: false }];
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
}

/** 便捷入口：直接从搜索框文本生成命中片段。 */
export function highlightQuery(
  text: string,
  query: string,
): HighlightSegment[] {
  return highlightSegments(text, searchTerms(query));
}
