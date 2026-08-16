import { useId } from "react";

export interface FolderGlyphProps {
  /** 图标边长（px），默认 18。 */
  size?: number;
  /** 追加到 svg 的 className（便于覆盖颜色/布局）。 */
  className?: string;
  /** 轻拟物外轮廓线宽（默认 1.5），仅控制描边粗细，不改变填充造型。 */
  strokeWidth?: number;
}

/**
 * 暖黄色文件夹图标——全应用「目录/文件夹」的统一视觉。
 *
 * 造型参考两张设计图的折中：
 * - 图1（极简扁平）：暖黄实心圆角方块 + 右上角小标签页、无文字、深炭灰底居中
 * - 图2（经典文件夹）：折角标签页、轻微圆角、轻拟物；深炭灰背景
 *
 * 实现要点：
 * - 右上角折角标签页（比主体略深的暖黄梯形），主体为轻微圆角的文件夹口袋
 * - 主体用克制的垂直渐变（#F9D976 → #EBB42B，顶部亮、底部略沉），
 *   在深色 UI 上既醒目又与炭灰底协调
 * - 纯填充造型，不用 currentColor（应用为深色主题，图标主题色固定为暖黄），
 *   但保留 className 供上层覆盖
 * - 紧凑几何（24 单位 viewBox），15–30px 下标签页与圆角仍清晰可辨
 */
export function FolderGlyph({ size = 18, className, strokeWidth = 1.5 }: FolderGlyphProps) {
  // 每个实例独立渐变 id，避免虚拟网格中大量图标共享同一 defs id。
  const gradientId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      data-folder-glyph
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F9D976" />
          <stop offset="1" stopColor="#EBB42B" />
        </linearGradient>
      </defs>
      {/* 标签页：右上角折角小梯形，颜色比主体略深，形成经典文件夹轮廓 */}
      <path
        d="M20.5 8.8 L20.5 5.4 C20.5 4.9 20.1 4.5 19.6 4.5 L14.8 4.5 C14.3 4.5 13.9 4.8 13.6 5.3 L11 8.8 Z"
        fill="#E0A52B"
      />
      {/* 主体：圆角文件夹口袋，暖黄垂直渐变，轻拟物外轮廓 */}
      <path
        d="M3.5 8.8 L20.5 8.8 L20.5 17.7 Q20.5 20 18.2 20 L5.8 20 Q3.5 20 3.5 17.7 Z"
        fill={`url(#${gradientId})`}
        stroke="#CB931F"
        strokeWidth={strokeWidth * 0.35}
        strokeLinejoin="round"
      />
    </svg>
  );
}
