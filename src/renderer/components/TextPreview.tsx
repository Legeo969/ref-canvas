import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetRecord, TextPreviewResult } from "../../shared/contracts";
import { MediaNotesOverlay } from "./MediaNotesOverlay";

/**
 * 文本预览（阶段 4：文档）。
 *
 * media.readText 读取前 N 字符（UTF-8 探测，二进制拒绝）；
 * Markdown 做轻量行级渲染（标题/引用/代码围栏/列表），其余按等宽文本。
 */

function renderMarkdownLine(line: string, index: number): React.ReactNode {
  if (/^\s*```/.test(line)) {
    return <span key={index} className="text-line text-fence">{line}</span>;
  }
  const heading = line.match(/^(#{1,4})\s+(.*)/);
  if (heading) {
    return (
      <span key={index} className={`text-line text-heading-${heading[1].length}`}>
        {heading[2]}
      </span>
    );
  }
  if (/^\s*[-*]\s+/.test(line)) {
    return (
      <span key={index} className="text-line text-bullet">
        {line.replace(/^\s*[-*]\s+/, "")}
      </span>
    );
  }
  if (/^\s*>/.test(line)) {
    return (
      <span key={index} className="text-line text-quote">
        {line.replace(/^\s*>\s?/, "")}
      </span>
    );
  }
  return <span key={index} className="text-line">{line || "\u00a0"}</span>;
}

export function TextPreview({ asset }: { asset: AssetRecord }) {
  const [result, setResult] = useState<TextPreviewResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    if (!window.refCanvas.media?.readText) return;
    void window.refCanvas.media
      .readText(asset.path, { limit: 200_000 })
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.path]);

  if (failed) {
    return (
      <div className="text-preview text-preview-empty">
        <FileText size={30} strokeWidth={1.25} />
        <span>无法作为文本读取（二进制或读取失败）</span>
      </div>
    );
  }
  if (!result) {
    return <div className="text-preview text-preview-empty">加载中…</div>;
  }
  const markdown = asset.extension === "md" || asset.extension === "markdown";
  const lines = result.text.split(/\r\n|\n|\r/);
  const content = markdown
    ? lines.map(renderMarkdownLine)
    : lines.map((line, index) => (
        <span key={index} className="text-line">{line || "\u00a0"}</span>
      ));

  return (
    <MediaNotesOverlay asset={asset}>
      <div className="text-preview">
        <div className="text-preview-meta">
          <FileText size={14} />
          <span>
            {result.lineCount} 行 · {result.byteLength} 字节 · {result.encoding}
          </span>
          {result.truncated ? <span className="text-truncated">（预览截断）</span> : null}
        </div>
        <pre className="text-preview-body">{content}</pre>
      </div>
    </MediaNotesOverlay>
  );
}
