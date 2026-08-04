import { open } from "node:fs/promises";
import { createReadStream } from "node:fs";

/**
 * 3D 几何统计（阶段 3 §9.1）。
 *
 * 不加载网格数据到内存：GLB/glTF 解析 JSON chunk，OBJ/STL 流式统计。
 * FBX（二进制）不做深度解析，probe 只提供 stat 基础信息。
 */

export interface GeometryStats {
  valid: boolean;
  error: string | null;
  /** 顶点数（glTF 按 accessor count 求和，OBJ 按 v 行数，STL 按三角*3）。 */
  vertexCount: number | null;
  /** 三角面数。 */
  triangleCount: number | null;
  nodeCount: number | null;
  meshCount: number | null;
  materialCount: number | null;
  textureCount: number | null;
  animationCount: number | null;
  cameraCount: number | null;
  lightCount: number | null;
  hasNormals: boolean;
  hasUvs: boolean;
  hasVertexColors: boolean;
  hasTangents: boolean;
  boundingBox: { min: [number, number, number]; max: [number, number, number] } | null;
}

const EMPTY: GeometryStats = {
  valid: false,
  error: null,
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

function boxFromAccessor(
  accessor: { min?: number[]; max?: number[] } | undefined,
): GeometryStats["boundingBox"] {
  if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) {
    return null;
  }
  if (accessor.min.length < 3 || accessor.max.length < 3) return null;
  return {
    min: [accessor.min[0], accessor.min[1], accessor.min[2]],
    max: [accessor.max[0], accessor.max[1], accessor.max[2]],
  };
}

/** glTF JSON 场景统计（.gltf 文件与 GLB 的 JSON chunk 共用）。 */
export function statsFromGltfJson(
  document: {
    scenes?: unknown[];
    nodes?: unknown[];
    meshes?: unknown[];
    materials?: unknown[];
    textures?: unknown[];
    images?: unknown[];
    animations?: unknown[];
    cameras?: unknown[];
    accessors?: Array<{
      count?: number;
      type?: string;
      min?: number[];
      max?: number[];
    }>;
  },
): GeometryStats {
  const accessors = document.accessors ?? [];
  const attributes = new Set<string>();
  for (const mesh of document.meshes ?? []) {
    const primitives = (mesh as { primitives?: Array<{ attributes?: Record<string, number> }> })
      .primitives ?? [];
    for (const primitive of primitives) {
      for (const semantic of Object.keys(primitive.attributes ?? {})) {
        attributes.add(semantic);
      }
    }
  }
  let vertexCount = 0;
  let boundingBox: GeometryStats["boundingBox"] = null;
  for (const accessor of accessors) {
    if (accessor.type !== "SCALAR" && accessor.count != null) {
      vertexCount += accessor.count;
    }
    if (accessor.type === "VEC3") {
      const candidate = boxFromAccessor(accessor);
      if (candidate && boundingBox) {
        boundingBox = {
          min: [
            Math.min(boundingBox.min[0], candidate.min[0]),
            Math.min(boundingBox.min[1], candidate.min[1]),
            Math.min(boundingBox.min[2], candidate.min[2]),
          ],
          max: [
            Math.max(boundingBox.max[0], candidate.max[0]),
            Math.max(boundingBox.max[1], candidate.max[1]),
            Math.max(boundingBox.max[2], candidate.max[2]),
          ],
        };
      } else if (candidate) {
        boundingBox = candidate;
      }
    }
  }
  // 索引网格的顶点数应参考 POSITION accessor；顶点统计按 count 求和即可，
  // 面数无法从 glTF 直接得到（取决于索引/图元类型），估算为 -1 表示未知。
  return {
    ...EMPTY,
    valid: true,
    vertexCount,
    triangleCount: null,
    nodeCount: (document.nodes ?? []).length,
    meshCount: (document.meshes ?? []).length,
    materialCount: (document.materials ?? []).length,
    textureCount: (document.textures ?? []).length,
    animationCount: (document.animations ?? []).length,
    cameraCount: (document.cameras ?? []).length,
    lightCount: (document.nodes ?? []).filter((node) =>
      (node as { light?: unknown; extensions?: Record<string, unknown> }).light !== undefined ||
      (node as { extensions?: Record<string, unknown> }).extensions?.KHR_lights_punctual !== undefined,
    ).length,
    hasNormals: attributes.has("NORMAL"),
    hasUvs: [...attributes].some((name) => name.startsWith("TEXCOORD_")),
    hasVertexColors: [...attributes].some((name) => name.startsWith("COLOR_")),
    hasTangents: attributes.has("TANGENT"),
    boundingBox,
  };
}

/** GLB 二进制容器：解析 12 字节头 + JSON chunk。 */
export async function statsFromGlb(filename: string): Promise<GeometryStats> {
  const handle = await open(filename, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    if (bytesRead < 12) return { ...EMPTY, error: "GLB_TOO_SHORT" };
    if (header.readUInt32LE(0) !== 0x46546c67) {
      return { ...EMPTY, error: "GLB_MAGIC_MISMATCH" };
    }
    if (header.readUInt32LE(4) !== 2) {
      return { ...EMPTY, error: "GLB_UNSUPPORTED_VERSION" };
    }
    const totalLength = header.readUInt32LE(8);
    if (totalLength < 12) return { ...EMPTY, error: "GLB_LENGTH_INVALID" };
    // chunk 0 = JSON（type 0x4E4F534A "JSON"）。
    const chunkHeader = Buffer.alloc(8);
    const readChunk = await handle.read(chunkHeader, 0, 8, 12);
    if (readChunk.bytesRead < 8) return { ...EMPTY, error: "GLB_CHUNK_MISSING" };
    const chunkLength = chunkHeader.readUInt32LE(0);
    const chunkType = chunkHeader.readUInt32LE(4);
    if (chunkType !== 0x4e4f534a) return { ...EMPTY, error: "GLB_JSON_CHUNK_MISSING" };
    if (chunkLength < 1 || chunkLength > 64 * 1024 * 1024) {
      return { ...EMPTY, error: "GLB_CHUNK_LENGTH_INVALID" };
    }
    const json = Buffer.alloc(chunkLength);
    const readJson = await handle.read(json, 0, chunkLength, 20);
    if (readJson.bytesRead < chunkLength) return { ...EMPTY, error: "GLB_CHUNK_TRUNCATED" };
    let document: Parameters<typeof statsFromGltfJson>[0];
    try {
      document = JSON.parse(json.toString("utf8"));
    } catch (error) {
      return {
        ...EMPTY,
        error: error instanceof Error ? `GLB_JSON_INVALID:${error.message}` : "GLB_JSON_INVALID",
      };
    }
    return statsFromGltfJson(document);
  } finally {
    await handle.close();
  }
}

/** OBJ 流式统计（v / vt / vn / f 计数）。 */
export async function statsFromObj(filename: string): Promise<GeometryStats> {
  const stats: GeometryStats = { ...EMPTY };
  let vertices = 0;
  let faces = 0;
  let normals = 0;
  let uvs = 0;
  let vertexColors = false;
  let bounding: GeometryStats["boundingBox"] = null;
  let firstError: string | null = null;
  await new Promise<void>((resolve) => {
    const stream = createReadStream(filename, { encoding: "utf8" });
    let remainder = "";
    const LINE_LIMIT = 2_000_000;
    stream.on("data", (chunk: string | Buffer) => {
      const text = remainder + String(chunk);
      const lines = text.split("\n");
      remainder = lines.pop() ?? "";
      for (const rawLine of lines) {
        if (stats.vertexCount != null && vertices > LINE_LIMIT) break;
        const line = rawLine.trim();
        if (line.startsWith("v ")) {
          const parts = line.split(/\s+/);
          vertices += 1;
          if (parts.length >= 5) vertexColors = true;
          if (parts.length >= 4) {
            const x = Number(parts[1]);
            const y = Number(parts[2]);
            const z = Number(parts[3]);
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
              if (!bounding) {
                bounding = { min: [x, y, z], max: [x, y, z] };
              } else {
                bounding.min[0] = Math.min(bounding.min[0], x);
                bounding.min[1] = Math.min(bounding.min[1], y);
                bounding.min[2] = Math.min(bounding.min[2], z);
                bounding.max[0] = Math.max(bounding.max[0], x);
                bounding.max[1] = Math.max(bounding.max[1], y);
                bounding.max[2] = Math.max(bounding.max[2], z);
              }
            }
          }
        } else if (line.startsWith("vt ")) {
          uvs += 1;
        } else if (line.startsWith("vn ")) {
          normals += 1;
        } else if (line.startsWith("f ")) {
          faces += 1;
        }
      }
    });
    stream.on("end", () => {
      // 行数上限保护后剩余行已丢弃；把计数写回。
      stats.vertexCount = vertices;
      stats.triangleCount = faces;
      stats.hasNormals = normals > 0;
      stats.hasUvs = uvs > 0;
      stats.hasVertexColors = vertexColors;
      stats.boundingBox = bounding;
      stats.valid = true;
      resolve();
    });
    stream.on("error", (error: Error) => {
      firstError = error.message;
      resolve();
    });
  });
  if (firstError) {
    return { ...EMPTY, error: `OBJ_READ_FAILED:${firstError}` };
  }
  return stats;
}

/** STL：二进制或 ASCII 流式统计（三角数 + bbox）。 */
export async function statsFromStl(filename: string): Promise<GeometryStats> {
  const handle = await open(filename, "r");
  try {
    const head = Buffer.alloc(84);
    const { bytesRead } = await handle.read(head, 0, 84, 0);
    if (bytesRead < 84) return { ...EMPTY, error: "STL_TOO_SHORT" };
    const binary = head.toString("ascii", 0, 5) !== "solid";
    if (!binary) {
      // ASCII STL：统计 "facet normal" 行数。
      const stats: GeometryStats = { ...EMPTY };
      let facets = 0;
      let bounding: GeometryStats["boundingBox"] = null;
      let firstError: string | null = null;
      await new Promise<void>((resolve) => {
        const stream = createReadStream(filename, { encoding: "utf8" });
        let remainder = "";
        stream.on("data", (chunk: string | Buffer) => {
          const text = remainder + String(chunk);
          const lines = text.split("\n");
          remainder = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim().startsWith("facet normal")) facets += 1;
            const vertexMatch = line.trim().match(/^vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/);
            if (vertexMatch) {
              const x = Number(vertexMatch[1]);
              const y = Number(vertexMatch[2]);
              const z = Number(vertexMatch[3]);
              if (!bounding) {
                bounding = { min: [x, y, z], max: [x, y, z] };
              } else {
                bounding.min[0] = Math.min(bounding.min[0], x);
                bounding.min[1] = Math.min(bounding.min[1], y);
                bounding.min[2] = Math.min(bounding.min[2], z);
                bounding.max[0] = Math.max(bounding.max[0], x);
                bounding.max[1] = Math.max(bounding.max[1], y);
                bounding.max[2] = Math.max(bounding.max[2], z);
              }
            }
          }
        });
        stream.on("end", () => {
          stats.triangleCount = facets;
          stats.vertexCount = facets * 3;
          stats.boundingBox = bounding;
          stats.valid = true;
          resolve();
        });
        stream.on("error", (error: Error) => {
          firstError = error.message;
          resolve();
        });
      });
      if (firstError) return { ...EMPTY, error: `STL_READ_FAILED:${firstError}` };
      return stats;
    }
    const triangleCount = head.readUInt32LE(80);
    if (triangleCount > 100_000_000) return { ...EMPTY, error: "STL_TRIANGLES_UNREASONABLE" };
    const stats: GeometryStats = { ...EMPTY };
    let bounding: GeometryStats["boundingBox"] = null;
    // 每三角 50 字节：normal(12) + 3 vertex(36) + attribute(2)。
    const block = Buffer.alloc(50);
    for (let index = 0; index < triangleCount; index += 1) {
      const { bytesRead } = await handle.read(block, 0, 50, 84 + index * 50);
      if (bytesRead < 50) {
        return { ...EMPTY, error: "STL_TRUNCATED" };
      }
      for (let corner = 0; corner < 3; corner += 1) {
        const base = 12 + corner * 12;
        const x = block.readFloatLE(base);
        const y = block.readFloatLE(base + 4);
        const z = block.readFloatLE(base + 8);
        if (!bounding) {
          bounding = { min: [x, y, z], max: [x, y, z] };
        } else {
          bounding.min[0] = Math.min(bounding.min[0], x);
          bounding.min[1] = Math.min(bounding.min[1], y);
          bounding.min[2] = Math.min(bounding.min[2], z);
          bounding.max[0] = Math.max(bounding.max[0], x);
          bounding.max[1] = Math.max(bounding.max[1], y);
          bounding.max[2] = Math.max(bounding.max[2], z);
        }
      }
    }
    stats.triangleCount = triangleCount;
    stats.vertexCount = triangleCount * 3;
    stats.boundingBox = bounding;
    stats.valid = true;
    return stats;
  } finally {
    await handle.close();
  }
}

/** glTF 2.0 文本文件统计。 */
export async function statsFromGltf(filename: string): Promise<GeometryStats> {
  const handle = await open(filename, "r");
  try {
    const { size } = await handle.stat();
    if (size < 1 || size > 64 * 1024 * 1024) {
      return { ...EMPTY, error: "GLTF_SIZE_INVALID" };
    }
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    if (bytesRead < size) return { ...EMPTY, error: "GLTF_TRUNCATED" };
    let document: Parameters<typeof statsFromGltfJson>[0];
    try {
      document = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      return {
        ...EMPTY,
        error: error instanceof Error ? `GLTF_JSON_INVALID:${error.message}` : "GLTF_JSON_INVALID",
      };
    }
    return statsFromGltfJson(document);
  } finally {
    await handle.close();
  }
}
