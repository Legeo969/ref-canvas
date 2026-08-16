import { useEffect, useState } from "react";
import type { AssetRecord, MediaProbeResult } from "../../shared/contracts";
import { formatDuration } from "../app/format-duration";
import { translate } from "../app/i18n";

type MediaInfoAsset = Pick<
  AssetRecord,
  "id" | "path" | "kind" | "extension"
>;

/**
 * 媒体信息 Inspector（阶段 3 §9.1-9.3）。
 *
 * 按格式展示 provider probe 结果：视频（codec/fps/色彩/音轨）、
 * EXR/HDR（通道/位深/压缩/色彩空间）、3D（几何统计/包围盒）。
 * probe 异步补齐，失败静默隐藏。
 */

function formatNumber(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value ?? "—");
}

function formatSize(value: unknown): string {
  if (typeof value !== "number" || value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatChannels(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "—";
  const names = value
    .map((channel) => {
      if (typeof channel === "string") return channel;
      if (
        channel &&
        typeof channel === "object" &&
        "name" in channel &&
        typeof channel.name === "string"
      ) {
        return channel.name;
      }
      return null;
    })
    .filter((name): name is string => Boolean(name));
  return names.length ? names.join(", ") : "—";
}

function formatWindow(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const bounds = value as Record<string, unknown>;
  const values = ["xMin", "yMin", "xMax", "yMax"].map((key) => bounds[key]);
  return values.every((item) => typeof item === "number")
    ? `${values[0]}, ${values[1]} → ${values[2]}, ${values[3]}`
    : "—";
}

function formatChromaticities(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const chroma = value as Record<string, unknown>;
  const point = (x: string, y: string) =>
    typeof chroma[x] === "number" && typeof chroma[y] === "number"
      ? `${formatNumber(chroma[x])},${formatNumber(chroma[y])}`
      : null;
  const red = point("redX", "redY");
  const green = point("greenX", "greenY");
  const blue = point("blueX", "blueY");
  const white = point("whiteX", "whiteY");
  return red && green && blue && white
    ? `R ${red} · G ${green} · B ${blue} · W ${white}`
    : "—";
}

interface FieldDef {
  label: string;
  value: unknown;
  format?: (value: unknown) => string;
}

function fieldsFor(asset: MediaInfoAsset, probe: MediaProbeResult): FieldDef[] {
  const extra = probe.extra ?? {};
  const unsupportedReason = extra.unsupportedReason;
  // DCC 专有格式（blend/blend1/max/ma/mb/c4d/hip/hipnc）不展示「本地无
  // Blender runtime」类说明：本机可能装着对应软件，只是 RefCanvas 不静默调用；
  // 文案既误导又无操作价值。其余无解码器格式（JXL/RAW/PDF 等）保留。
  const isDcc = asset.kind === "dcc";
  if (typeof unsupportedReason === "string" && !isDcc) {
    return [{ label: translate("mediaInfo.note"), value: unsupportedReason }];
  }
  if (isDcc) return [];
  switch (asset.kind) {
    case "video": {
      const audioTracks = extra.audioTracks as number | undefined;
      const fields: FieldDef[] = [
        { label: translate("mediaInfo.codec"), value: extra.codec ?? "—" },
        { label: translate("mediaInfo.profile"), value: extra.profile ?? "—" },
        { label: translate("mediaInfo.level"), value: extra.level ?? "—" },
        {
          label: translate("mediaInfo.resolution"),
          value:
            probe.width && probe.height
              ? `${probe.width} × ${probe.height}`
              : "—",
        },
        {
          label: translate("mediaInfo.frameRate"),
          value: extra.frameRate != null ? `${formatNumber(extra.frameRate)} fps` : "—",
        },
        { label: translate("mediaInfo.timeBase"), value: extra.timeBase ?? "—" },
        { label: translate("mediaInfo.pixelFormat"), value: extra.pixelFormat ?? "—" },
        { label: translate("mediaInfo.bitDepth"), value: extra.bitDepth != null ? `${formatNumber(extra.bitDepth)} bit` : "—" },
        { label: translate("mediaInfo.duration"), value: probe.duration != null ? formatDuration(probe.duration) : "—" },
        { label: translate("mediaInfo.bitRate"), value: extra.bitRate != null ? formatSize(extra.bitRate) : "—" },
        { label: translate("mediaInfo.colorPrimaries"), value: extra.colorPrimaries ?? "—" },
        { label: translate("mediaInfo.colorSpace"), value: extra.colorSpace ?? "—" },
        { label: translate("mediaInfo.colorRange"), value: extra.colorRange ?? "—" },
        { label: translate("mediaInfo.colorTransfer"), value: extra.colorTransfer ?? "—" },
        {
          label: translate("mediaInfo.audioTracks"),
          value:
            audioTracks != null
              ? `${translate("mediaInfo.audioTracksValue").replace("{count}", String(audioTracks))}${extra.audioCodec ? translate("mediaInfo.audioTracksCodec").replace("{codec}", String(extra.audioCodec)) : ""}`
              : "—",
        },
        { label: translate("mediaInfo.displayAspectRatio"), value: extra.displayAspectRatio ?? "—" },
      ];
      return fields;
    }
    case "model3d": {
      const box = extra.boundingBox as
        | { min: number[]; max: number[] }
        | undefined;
      const sizeText =
        box &&
        Array.isArray(box.min) &&
        Array.isArray(box.max) &&
        box.min.length === 3
          ? `${formatNumber(box.max[0] - box.min[0])} × ${formatNumber(box.max[1] - box.min[1])} × ${formatNumber(box.max[2] - box.min[2])}`
          : "—";
      return [
        { label: translate("mediaInfo.vertexCount"), value: extra.vertexCount ?? "—" },
        { label: translate("mediaInfo.triangleCount"), value: extra.triangleCount ?? "—" },
        { label: translate("mediaInfo.meshCount"), value: extra.meshCount ?? "—" },
        { label: translate("mediaInfo.materialCount"), value: extra.materialCount ?? "—" },
        { label: translate("mediaInfo.textureCount"), value: extra.textureCount ?? "—" },
        { label: translate("mediaInfo.animationCount"), value: extra.animationCount ?? "—" },
        { label: translate("mediaInfo.size"), value: sizeText },
        {
          label: translate("mediaInfo.vertexColors"),
          value: extra.hasVertexColors ? translate("mediaInfo.has") : translate("mediaInfo.none"),
        },
        {
          label: "UV",
          value: extra.hasUvs ? translate("mediaInfo.has") : translate("mediaInfo.none"),
        },
        {
          label: translate("mediaInfo.normals"),
          value: extra.hasNormals ? translate("mediaInfo.has") : translate("mediaInfo.none"),
        },
      ];
    }
    case "audio": {
      const fields: FieldDef[] = [
        { label: translate("mediaInfo.codec"), value: extra.codecLongName ?? extra.codec ?? "—" },
        { label: translate("mediaInfo.sampleRate"), value: extra.sampleRate != null ? `${formatNumber(extra.sampleRate)} Hz` : "—" },
        { label: translate("mediaInfo.channels"), value: extra.channels != null ? `${extra.channels}${extra.channelLayout ? ` (${extra.channelLayout})` : ""}` : "—" },
        { label: translate("mediaInfo.bitDepth"), value: extra.bitDepth != null ? `${formatNumber(extra.bitDepth)} bit` : "—" },
        { label: translate("mediaInfo.bitRate"), value: extra.bitRate != null ? formatSize(extra.bitRate) : "—" },
        { label: translate("mediaInfo.duration"), value: probe.duration != null ? formatDuration(probe.duration) : "—" },
        { label: translate("mediaInfo.coverArt"), value: extra.hasCoverArt ? translate("mediaInfo.has") : translate("mediaInfo.none") },
      ];
      if (typeof extra.formatName === "string" && extra.formatName) {
        fields.unshift({ label: translate("mediaInfo.container"), value: extra.formatName });
      }
      return fields;
    }
    case "font": {
      const axes = extra.variableAxes as Array<{ tag: string; name: string; min: number; default: number; max: number }> | undefined;
      return [
        { label: translate("mediaInfo.family"), value: extra.family ?? "—" },
        { label: translate("mediaInfo.style"), value: extra.subfamily ?? "—" },
        { label: translate("mediaInfo.weight"), value: extra.weightClass != null ? String(extra.weightClass) : "—" },
        { label: translate("mediaInfo.italic"), value: extra.italic ? translate("mediaInfo.yes") : translate("mediaInfo.no") },
        { label: translate("mediaInfo.glyphCount"), value: extra.glyphCount ?? "—" },
        { label: translate("mediaInfo.flavor"), value: extra.flavor ?? "—" },
        {
          label: translate("mediaInfo.variableAxes"),
          value: Array.isArray(axes) && axes.length
            ? axes.map((axis) => `${axis.tag} ${axis.min}-${axis.max}`).join(", ")
            : translate("mediaInfo.none"),
        },
      ];
    }
    default: {
      // EXR/HDR（hdr-provider 字段）。
      if (asset.extension === "exr" || asset.extension === "hdr") {
        return [
          {
            label: translate("mediaInfo.channels"),
            value: formatChannels(extra.channels),
          },
          { label: translate("mediaInfo.bitDepth"), value: extra.bitDepth != null ? `${formatNumber(extra.bitDepth)} bit` : "—" },
          { label: translate("mediaInfo.compression"), value: extra.compression ?? "—" },
          { label: translate("mediaInfo.colorSpace"), value: extra.colorSpace ?? "—" },
          {
            label: translate("mediaInfo.resolution"),
            value:
              probe.width && probe.height
                ? `${probe.width} × ${probe.height}`
                : "—",
          },
          { label: translate("mediaInfo.dataWindow"), value: formatWindow(extra.dataWindow) },
          { label: translate("mediaInfo.displayWindow"), value: formatWindow(extra.displayWindow) },
          {
            label: translate("mediaInfo.chromaticities"),
            value: formatChromaticities(extra.chromaticities),
          },
          {
            label: translate("mediaInfo.pixelAspectRatio"),
            value:
              extra.pixelAspectRatio != null
                ? formatNumber(extra.pixelAspectRatio)
                : "—",
          },
        ];
      }
      const textFormat = extra.format === "text";
      if (textFormat) {
        return [
          { label: translate("video.format"), value: translate("mediaInfo.text") },
          { label: translate("mediaInfo.codec"), value: extra.encoding ?? "—" },
          { label: translate("mediaInfo.lineCount"), value: extra.lineCount ?? "—" },
          { label: translate("mediaInfo.charCount"), value: extra.charCount ?? "—" },
          { label: translate("mediaInfo.firstLine"), value: extra.firstLine ?? "—" },
        ];
      }
      return [];
    }
  }
}

export function MediaInfoSection({ asset }: { asset: MediaInfoAsset }) {
  const [probe, setProbe] = useState<MediaProbeResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProbe(null);
    setFailed(false);
    if (!window.refCanvas?.media?.probe) return;
    void window.refCanvas.media
      .probe(asset.path)
      .then((result) => {
        if (!cancelled) setProbe(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.path]);

  if (!probe || failed) return null;
  const fields = fieldsFor(asset, probe);
  if (!fields.length) return null;

  return (
    <div className="media-info-section">
      <span className="field-label">{translate("mediaInfo.title")}</span>
      {fields.map((field) => (
        <div className="media-info-row" key={field.label}>
          <span>{field.label}</span>
          <strong>
            {field.format
              ? field.format(field.value)
              : formatNumber(field.value)}
          </strong>
        </div>
      ))}
    </div>
  );
}
