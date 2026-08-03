import { useMemo } from "react";
import { highlightQuery } from "../app/search-highlight";

interface HighlightedTextProps {
  text: string;
  query: string;
}

/**
 * 搜索命中高亮文本：查询词命中处用 `<mark class="search-hit">` 包裹。
 * 无查询或未命中时渲染纯文本（不产生额外 DOM 开销）。
 */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  const segments = useMemo(() => highlightQuery(text, query), [text, query]);
  const hasHit = segments.some((segment) => segment.match);
  if (!hasHit) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark className="search-hit" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
