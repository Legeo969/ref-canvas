/**
 * 目录右键菜单「GIF / 导出 MP4」的格式判定。
 *
 * - 视频：与 GIF 工作台 / media:exportFrames 现有支持集一致。
 * - 图片：ffmpeg 可直接解码并参与序列导出（sequences:exportGif /
 *   sequences:exportMp4 的 concat demuxer）的位图格式，与 main 侧
 *   sequence-detector 的 SEQUENCE_EXTENSIONS 对齐，另加 gif（ffmpeg
 *   可解码，导 MP4 有意义）。svg/psd/heic 等浏览器可显示但 ffmpeg 无法
 *   可靠参与序列导出的格式不列入。
 */

export const EXPORT_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  "m4v",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
]);

export const EXPORT_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "tif",
  "tiff",
  "bmp",
  "exr",
  "hdr",
  "tga",
  "dpx",
  "iff",
  "j2c",
  "j2k",
  "jp2",
  "jxl",
]);

export function isExportableVideoExtension(extension: string): boolean {
  return EXPORT_VIDEO_EXTENSIONS.has(extension.replace(/^\./, "").toLowerCase());
}

export function isExportableImageExtension(extension: string): boolean {
  return EXPORT_IMAGE_EXTENSIONS.has(extension.replace(/^\./, "").toLowerCase());
}

/** 路径尾部文件名。 */
export function pathNameOf(filename: string): string {
  return filename.split(/[\\/]/).pop() || filename;
}

/** 去掉目录与扩展名的 stem（导出 baseName 用）。 */
export function pathStemOf(filename: string): string {
  return pathNameOf(filename).replace(/\.[^.]*$/, "") || "animation";
}
