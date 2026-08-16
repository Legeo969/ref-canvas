import type { AssetKind, DirectoryEntry } from "../../shared/contracts";

export type FoundPreviewKind =
  | "image"
  | "svg"
  | "gif"
  | "video"
  | "sequence"
  | "audio"
  | "pdf"
  | "model3d";

export type FoundToolbarVariant = Extract<
  FoundPreviewKind,
  "image" | "svg" | "gif" | "video" | "sequence"
>;

export interface FoundToolbarCapabilities {
  upper: boolean;
  lower: boolean;
  timeline: boolean;
  volume: boolean;
  trim: boolean;
  gifExport: boolean;
  layers: boolean;
  /** 至臻画质（仅视频）：4K 上采样 + 60fps 补帧代理开关。 */
  supreme: boolean;
}

export function classifyFoundPreview(
  entry: Pick<DirectoryEntry, "extension" | "sequence" | "sequenceGroup">,
  asset: { kind: AssetKind; extension: string },
): FoundPreviewKind {
  if (entry.sequenceGroup || entry.sequence) return "sequence";
  const extension = (asset.extension || entry.extension).toLowerCase();
  if (extension === "svg") return "svg";
  if (extension === "gif" || extension === "apng") return "gif";
  // PSD/PSB 由 image-provider 生成扁平化 PNG 预览（thumbnailUrl），
  // 按图片审阅展示：Fit/取色/色板/图层工具栏，而不是 DCC 降级壳。
  if (extension === "psd" || extension === "psb") return "image";
  switch (asset.kind) {
    case "video": return "video";
    case "audio": return "audio";
    case "pdf": return "pdf";
    case "model3d": return "model3d";
    default: return "image";
  }
}

export function foundToolbarCapabilities(
  variant: FoundToolbarVariant,
): FoundToolbarCapabilities {
  return {
    upper: true,
    lower: true,
    timeline: variant === "gif" || variant === "video" || variant === "sequence",
    volume: variant === "video",
    trim: variant === "video",
    gifExport: variant === "video" || variant === "sequence",
    layers: variant === "svg",
    supreme: variant === "video",
  };
}

export function foundToolbarProgressColor(variant: FoundToolbarVariant): string {
  return variant === "sequence" ? "var(--found-sequence)" : "var(--found-accent)";
}

export interface EnvironmentPreviewCapabilities {
  /** equirectangular 全景（2:1）模式可用。 */
  panorama: boolean;
  /** 反射球模式可用：PMREM 反射不需要 2:1，任意 HDR 环境图都行。 */
  reflection: boolean;
}

/**
 * EXR/HDR 环境预览能力判定。全景要求标准 2:1 equirectangular 宽高比
 * （1.8~2.2 容差）；反射球对任意宽高比可用。probe 未给出有效尺寸时
 * 返回 null（不显示虚假支持）。
 */
export function environmentPreviewCapabilities(
  width: number | null | undefined,
  height: number | null | undefined,
): EnvironmentPreviewCapabilities | null {
  if (!width || !height) return null;
  const ratio = width / height;
  return {
    panorama: ratio >= 1.8 && ratio <= 2.2,
    reflection: true,
  };
}

export function formatFoundTimecode(seconds: number, fps?: number | null): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const total = Math.floor(safeSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const wholeSeconds = total % 60;
  const base = [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  if (!fps || fps <= 0) return base;
  const frame = Math.min(
    Math.max(0, Math.floor((safeSeconds - total) * fps)),
    Math.max(0, Math.ceil(fps) - 1),
  );
  return `${base}:${String(frame).padStart(2, "0")}`;
}
