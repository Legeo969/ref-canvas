import type { AssetKind } from "./contracts";

const extensionKinds: Readonly<Record<string, AssetKind>> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  svg: "image",
  avif: "image",
  tga: "image",
  hdr: "image",
  exr: "image",
  mp4: "video",
  mpeg: "video",
  mpg: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  m4v: "video",
  flv: "video",
  wmv: "video",
  mxf: "video",
  ts: "video",
  rmvb: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  pdf: "pdf",
  glb: "model3d",
  gltf: "model3d",
  fbx: "model3d",
  obj: "model3d",
  stl: "model3d",
  // Alembic 是通用 3D 交换格式（与 fbx/obj 同类），归 model3d 而非 DCC
  // 降级类——UI 的 3D 格式分组本就包含 abc，分类器保持一致。
  abc: "model3d",
  psd: "dcc",
  psb: "dcc",
  blend: "dcc",
  // Blender 自动备份（与 .blend 同结构，含 TEST 内嵌预览块）。
  blend1: "dcc",
  ma: "dcc",
  mb: "dcc",
  max: "dcc",
  c4d: "dcc",
  // Houdini 场景（.hip 文本 / .hipnc 二进制）。
  hip: "dcc",
  hipnc: "dcc",
  heic: "image",
  heif: "image",
  jxl: "image",
  jxr: "image",
  cr2: "image",
  cr3: "image",
  nef: "image",
  arw: "image",
  rw2: "image",
  orf: "image",
  pef: "image",
  raf: "image",
  srw: "image",
  dng: "image",
  raw: "image",
  ttc: "font",
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  eot: "font",
};

export const browserImageExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "svg",
  "avif",
]);

/**
 * Downscale（src/main/services/media/downscale.ts 的 ffmpeg scale + image2）
 * 能产出合理缩小结果的位图格式。与 browserImageExtensions 的差异（基于本机
 * 打包 ffmpeg 实测，ffmpeg -encoders/-decoders 与端到端下采样）：
 * - 不含 svg：ffmpeg 无 SVG 解码器（浏览器能显示 ≠ 能处理）；
 * - 不含 avif：libaom 编码过慢（400×300 已约 1.6s，大图达分钟级）且
 *   downscaleImage 无对应质量参数；
 * - 含 tif/tiff：ffmpeg 自带 tiff 编码器，输出有效；
 * - 不含 exr/hdr：本机 ffmpeg 的 exr 编码器仅支持 float32 且默认无压缩
 *   （-compression none），输出可能比 PIZ/ZIP 压缩源还大，不符合「缩小」；
 *   hdr 输出正常，但按用户报告与 exr 一并排除（如需支持，先给 downscaleImage
 *   加 -compression 参数再放开）；
 * - 不含 tga/heic/heif/jxl/jxr/相机 RAW/psd/dds：打包 ffmpeg 无对应解码/编码器。
 */
export const downscalableImageExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "gif",
  "tif",
  "tiff",
]);

/** 是否可在右键菜单提供 Downscale（与 downscaleImage 的 ffmpeg 能力一致）。 */
export function isDownscalableImageExtension(extension: string): boolean {
  return downscalableImageExtensions.has(
    extension.replace(/^\./, "").toLowerCase(),
  );
}

export function specializedKindForExtension(
  extension: string,
): AssetKind | undefined {
  return extensionKinds[extension.replace(/^\./, "").toLowerCase()];
}

export function assetKindForExtension(extension: string): AssetKind {
  return specializedKindForExtension(extension) ?? "generic";
}
