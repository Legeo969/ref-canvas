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
}

export function classifyFoundPreview(
  entry: Pick<DirectoryEntry, "extension" | "sequence" | "sequenceGroup">,
  asset: { kind: AssetKind; extension: string },
): FoundPreviewKind {
  if (entry.sequenceGroup || entry.sequence) return "sequence";
  const extension = (asset.extension || entry.extension).toLowerCase();
  if (extension === "svg") return "svg";
  if (extension === "gif" || extension === "apng") return "gif";
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
  };
}

export function foundToolbarProgressColor(variant: FoundToolbarVariant): string {
  return variant === "sequence" ? "var(--found-sequence)" : "var(--found-accent)";
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
