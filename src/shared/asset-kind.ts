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
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
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
  psd: "dcc",
  psb: "dcc",
  abc: "dcc",
  blend: "dcc",
  ma: "dcc",
  mb: "dcc",
  max: "dcc",
  c4d: "dcc",
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

export function specializedKindForExtension(
  extension: string,
): AssetKind | undefined {
  return extensionKinds[extension.replace(/^\./, "").toLowerCase()];
}

export function assetKindForExtension(extension: string): AssetKind {
  return specializedKindForExtension(extension) ?? "generic";
}
