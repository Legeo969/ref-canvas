import sharp from "sharp";

/**
 * 没有系统外壳缩略图的文件（如 After Effects 的 .aep、压缩包、未知格式）
 * 无法用 nativeImage.createThumbnailFromPath 提取预览。给它们生成一张
 * 与文本卡片同语言的占位卡片 PNG 并写入缓存，而不是让协议层反复
 * 404 重试、把「Failed to load resource: 404」刷满控制台。
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** DCC 专有格式（无外壳缩略图、无本地解码器）的图标化说明文案。 */
const DCC_FORMAT_HINTS: Record<string, string> = {
  ma: "Maya 场景",
  mb: "Maya 场景",
  max: "3ds Max 场景",
  c4d: "Cinema 4D 场景",
  abc: "Alembic 缓存",
  hip: "Houdini 场景",
  hipnc: "Houdini 场景",
};

export function genericPlaceholderSvg(
  extension: string,
  width: number,
  height: number,
): string {
  const raw = extension.replace(/^\./, "").toLowerCase();
  const label = escapeXml(raw.toUpperCase().slice(0, 8) || "FILE");
  const hint = DCC_FORMAT_HINTS[raw] ?? "无可用缩略图";
  const fontSize = Math.max(
    18,
    Math.min(64, Math.round(Math.min(width, height) * 0.16)),
  );
  const centerY = Math.round(height / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#151a18"/>
  <text x="${Math.round(width / 2)}" y="${centerY - Math.round(fontSize * 0.28)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${fontSize}" font-weight="600" fill="#8d9a94">${label}</text>
  <text x="${Math.round(width / 2)}" y="${centerY + Math.round(fontSize * 0.72)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="12" fill="#5d6762">${escapeXml(hint)}</text>
</svg>`;
}

/** 占位卡片保持小尺寸渲染：格子视图不需要高分辨率占位图。 */
export async function genericPlaceholderThumbnail(
  extension: string,
  size: { width: number; height: number },
): Promise<Buffer> {
  const width = Math.max(64, Math.min(640, Math.round(size.width)));
  const height = Math.max(48, Math.min(480, Math.round(size.height)));
  return sharp(Buffer.from(genericPlaceholderSvg(extension, width, height)))
    .png()
    .toBuffer();
}
