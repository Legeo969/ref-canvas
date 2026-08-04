import { useEffect, useState } from "react";
import type { AssetRecord, MediaProbeResult } from "../../shared/contracts";
import { formatDuration } from "../app/format-duration";

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

interface FieldDef {
  label: string;
  value: unknown;
  format?: (value: unknown) => string;
}

function fieldsFor(asset: AssetRecord, probe: MediaProbeResult): FieldDef[] {
  const extra = probe.extra ?? {};
  switch (asset.kind) {
    case "video": {
      const audioTracks = extra.audioTracks as number | undefined;
      const fields: FieldDef[] = [
        { label: "编码", value: extra.codec ?? "—" },
        { label: "配置", value: extra.profile ?? "—" },
        {
          label: "分辨率",
          value:
            probe.width && probe.height
              ? `${probe.width} × ${probe.height}`
              : "—",
        },
        {
          label: "帧率",
          value: extra.frameRate != null ? `${formatNumber(extra.frameRate)} fps` : "—",
        },
        { label: "像素格式", value: extra.pixelFormat ?? "—" },
        { label: "位深", value: extra.bitDepth != null ? `${formatNumber(extra.bitDepth)} bit` : "—" },
        { label: "时长", value: probe.duration != null ? formatDuration(probe.duration) : "—" },
        { label: "码率", value: extra.bitRate != null ? formatSize(extra.bitRate) : "—" },
        { label: "色彩空间", value: extra.colorSpace ?? "—" },
        { label: "色深范围", value: extra.colorRange ?? "—" },
        { label: "色彩传输", value: extra.colorTransfer ?? "—" },
        {
          label: "音轨",
          value:
            audioTracks != null
              ? `${audioTracks} 轨${extra.audioCodec ? ` · ${extra.audioCodec}` : ""}`
              : "—",
        },
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
        { label: "顶点数", value: extra.vertexCount ?? "—" },
        { label: "三角面", value: extra.triangleCount ?? "—" },
        { label: "网格", value: extra.meshCount ?? "—" },
        { label: "材质", value: extra.materialCount ?? "—" },
        { label: "纹理", value: extra.textureCount ?? "—" },
        { label: "动画", value: extra.animationCount ?? "—" },
        { label: "尺寸", value: sizeText },
        {
          label: "顶点色",
          value: extra.hasVertexColors ? "有" : "无",
        },
        {
          label: "UV",
          value: extra.hasUvs ? "有" : "无",
        },
        {
          label: "法线",
          value: extra.hasNormals ? "有" : "无",
        },
      ];
    }
    default: {
      if (asset.extension === "exr" || asset.extension === "hdr") {
        const channels = extra.channels as string[] | undefined;
        return [
          {
            label: "通道",
            value: Array.isArray(channels) ? channels.join(", ") : "—",
          },
          { label: "位深", value: extra.bitDepth != null ? `${formatNumber(extra.bitDepth)} bit` : "—" },
          { label: "压缩", value: extra.compression ?? "—" },
          { label: "色彩空间", value: extra.colorSpace ?? "—" },
          {
            label: "分辨率",
            value:
              probe.width && probe.height
                ? `${probe.width} × ${probe.height}`
                : "—",
          },
        ];
      }
      return [];
    }
  }
}

export function MediaInfoSection({ asset }: { asset: AssetRecord }) {
  const [probe, setProbe] = useState<MediaProbeResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProbe(null);
    setFailed(false);
    if (!window.refCanvas.media?.probe) return;
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
      <span className="field-label">媒体信息</span>
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
