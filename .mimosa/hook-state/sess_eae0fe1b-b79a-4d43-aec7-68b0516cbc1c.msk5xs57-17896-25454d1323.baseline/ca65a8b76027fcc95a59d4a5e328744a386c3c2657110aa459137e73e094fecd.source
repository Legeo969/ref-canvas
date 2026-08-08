import { stat } from "node:fs/promises";
import type {
  ProviderHealth,
  ProviderMetadataInput,
  ProviderMetadataResult,
  ProviderPreviewInput,
  ProviderPreviewResult,
  ProviderProbeInput,
  ProviderProbeResult,
  ProviderThumbnailInput,
  ProviderThumbnailResult,
  ProviderWaveformInput,
  ProviderWaveformResult,
  ProviderConvertInput,
  ProviderConvertResult,
  ResourceProvider,
  ResourceProviderManifest,
} from "../../shared/worker-protocol";
import {
  statsFromGlb,
  statsFromGltf,
  statsFromObj,
  statsFromStl,
  type GeometryStats,
} from "../services/media/geometry-stats";

/**
 * Geometry provider（计划 §6.2 / §9.1）：GLTF/GLB/OBJ/STL 几何统计。
 *
 * FBX（proprietary binary）不做深度解析，probe 只提供 stat 基础信息；
 * 不伪装支持（capabilities 不声明 thumbnail/preview，预览由 renderer
 * 的 Three.js ModelPreview 完成，via refbrowse 原始文件）。
 */

export const GEOMETRY_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "geometry-provider",
  version: "1.0.0",
  kinds: ["model3d"],
  extensions: ["glb", "gltf", "obj", "stl", "fbx"],
  mimeTypes: ["model/gltf-binary", "model/gltf+json"],
  capabilities: ["probe", "metadata"],
  priority: 20,
  runtime: "node",
};

function statsToExtra(stats: GeometryStats): Record<string, unknown> {
  return {
    valid: stats.valid,
    error: stats.error,
    vertexCount: stats.vertexCount,
    triangleCount: stats.triangleCount,
    nodeCount: stats.nodeCount,
    meshCount: stats.meshCount,
    materialCount: stats.materialCount,
    textureCount: stats.textureCount,
    animationCount: stats.animationCount,
    cameraCount: stats.cameraCount,
    lightCount: stats.lightCount,
    hasNormals: stats.hasNormals,
    hasUvs: stats.hasUvs,
    hasVertexColors: stats.hasVertexColors,
    hasTangents: stats.hasTangents,
    boundingBox: stats.boundingBox,
  };
}

export class GeometryProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = GEOMETRY_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "geometry parsers available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const stats = await this.readStats(input.path, input.extension);
    if (!stats.valid) {
      // FBX 等未深度解析的格式仍返回 stat 基础信息，不视为失败。
      const info = await stat(input.path);
      return {
        width: null,
        height: null,
        duration: null,
        extra: {
          ...statsToExtra(stats),
          size: info.size,
          mtimeMs: info.mtimeMs,
        },
      };
    }
    const [minX, minY, minZ] = stats.boundingBox?.min ?? [null, null, null];
    const [maxX, maxY, maxZ] = stats.boundingBox?.max ?? [null, null, null];
    return {
      width: null,
      height: null,
      duration: null,
      extra: {
        ...statsToExtra(stats),
        sizeX: maxX !== null && minX !== null ? maxX - minX : null,
        sizeY: maxY !== null && minY !== null ? maxY - minY : null,
        sizeZ: maxZ !== null && minZ !== null ? maxZ - minZ : null,
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const stats = await this.readStats(input.path, input.extension);
    const [minX, minY, minZ] = stats.boundingBox?.min ?? [null, null, null];
    const [maxX, maxY, maxZ] = stats.boundingBox?.max ?? [null, null, null];
    return {
      fields: {
        ...statsToExtra(stats),
        sizeX: maxX !== null && minX !== null ? maxX - minX : null,
        sizeY: maxY !== null && minY !== null ? maxY - minY : null,
        sizeZ: maxZ !== null && minZ !== null ? maxZ - minZ : null,
        boundingMin: stats.boundingBox?.min,
        boundingMax: stats.boundingBox?.max,
      },
    };
  }

  thumbnail(_input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  waveform(_input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  preview(_input: ProviderPreviewInput): Promise<ProviderPreviewResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  convert(_input: ProviderConvertInput): Promise<ProviderConvertResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  async dispose(): Promise<void> {
    // 无自有资源。
  }

  private async readStats(
    filename: string,
    extension: string,
  ): Promise<GeometryStats> {
    switch (extension.toLowerCase()) {
      case "glb":
        return statsFromGlb(filename);
      case "gltf":
        return statsFromGltf(filename);
      case "obj":
        return statsFromObj(filename);
      case "stl":
        return statsFromStl(filename);
      case "fbx":
        // FBX 是 proprietary 二进制；不解析，仅标记 valid=false 由调用方兜底。
        return {
          valid: false,
          error: "FBX_NOT_PARSED",
          vertexCount: null,
          triangleCount: null,
          nodeCount: null,
          meshCount: null,
          materialCount: null,
          textureCount: null,
          animationCount: null,
          cameraCount: null,
          lightCount: null,
          hasNormals: false,
          hasUvs: false,
          hasVertexColors: false,
          hasTangents: false,
          boundingBox: null,
        };
      default:
        return {
          valid: false,
          error: "GEOMETRY_EXTENSION_UNSUPPORTED",
          vertexCount: null,
          triangleCount: null,
          nodeCount: null,
          meshCount: null,
          materialCount: null,
          textureCount: null,
          animationCount: null,
          cameraCount: null,
          lightCount: null,
          hasNormals: false,
          hasUvs: false,
          hasVertexColors: false,
          hasTangents: false,
          boundingBox: null,
        };
    }
  }
}
