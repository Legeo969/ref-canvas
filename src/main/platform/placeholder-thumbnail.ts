import sharp from "sharp";
import { app } from "electron";

/**
 * 没有系统外壳缩略图的文件（如 After Effects 的 .aep、压缩包、未知格式）
 * 无法用 nativeImage.createThumbnailFromPath 提取预览。给它们生成一张
 * 与文本卡片同语言的占位卡片 PNG 并写入缓存，而不是让协议层反复
 * 404 重试、把「Failed to load resource: 404」刷满控制台。
 *
 * DCC 专有格式（.blend/.max/.ma/.c4d/.hip 等）优先用 Windows 文件关联
 * 图标（app.getFileIcon：装了 Blender/3ds Max/Maya/C4D 就显示对应软件
 * 的图标），图标 + 格式名合成卡片；取不到图标时回退纯文字占位。
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
  blend: "Blender 场景",
  // .blend1 不在其列：它走 systemFileIconThumbnail 分支直接显示系统
  // 文件图标（Windows 上无注册关联，即白底空白文档），不需要合成卡片。
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
    .webp({ quality: 85 })
    .toBuffer();
}

/**
 * 软件关联图标卡片：Windows 上 app.getFileIcon 返回文件类型图标
 * （装了 Blender/Max/Maya 就有对应软件图标）。图标放大居中 + 深色底 +
 * 格式名，观感接近系统文件图标。取图标失败回退纯文字占位。
 */
export async function fileIconPlaceholderThumbnail(
  filename: string,
  extension: string,
  size: { width: number; height: number },
): Promise<Buffer> {
  const width = Math.max(64, Math.min(640, Math.round(size.width)));
  const height = Math.max(48, Math.min(480, Math.round(size.height)));
  try {
    const icon = await app.getFileIcon(filename, { size: "large" });
    if (icon.isEmpty()) return genericPlaceholderThumbnail(extension, size);
    const iconSize = Math.round(Math.min(width, height) * 0.45);
    const iconPng = icon
      .resize({ width: iconSize, height: iconSize, quality: "best" })
      .toPNG();
    const raw = extension.replace(/^\./, "").toLowerCase();
    const label = escapeXml(raw.toUpperCase().slice(0, 8) || "FILE");
    const iconX = Math.round((width - iconSize) / 2);
    const iconY = Math.round((height - iconSize) / 2 - height * 0.04);
    const labelY = Math.round(height * 0.86);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#151a18"/>
  <image href="data:image/png;base64,${iconPng.toString("base64")}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}"/>
  <text x="${Math.round(width / 2)}" y="${labelY}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="13" font-weight="600" fill="#a7b0ab">${label}</text>
</svg>`;
    return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
  } catch {
    return genericPlaceholderThumbnail(extension, size);
  }
}

/** 是否使用软件关联图标作为占位（DCC 专有格式优先）。 */
export function shouldUseFileIcon(extension: string): boolean {
  return extension.replace(/^\./, "").toLowerCase() in DCC_FORMAT_HINTS;
}

/**
 * 系统文件图标原样展示：.blend1（Blender 自动备份）无系统缩略图也无
 * 注册关联，app.getFileIcon 返回的就是 Windows 通用空白文档图标
 * （白底 + 纸张轮廓）——直接把它以 contain 方式铺到白底画布上展示，
 * 不做深色合成卡片。图标为空或取图标失败时回退纯文字占位。
 */
export async function systemFileIconThumbnail(
  filename: string,
  extension: string,
  size: { width: number; height: number },
): Promise<Buffer> {
  const width = Math.max(64, Math.min(640, Math.round(size.width)));
  const height = Math.max(48, Math.min(480, Math.round(size.height)));
  try {
    const icon = await app.getFileIcon(filename, { size: "large" });
    if (icon.isEmpty()) return genericPlaceholderThumbnail(extension, size);
    return sharp(icon.toPNG())
      .resize(width, height, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return genericPlaceholderThumbnail(extension, size);
  }
}
