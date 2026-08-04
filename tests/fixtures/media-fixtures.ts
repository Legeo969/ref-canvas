import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

/**
 * 阶段 3 媒体 fixture 生成器。
 *
 * 全部本地生成（无网络）：最小 EXR（half float）、HDR（RGBE）、
 * GLB/glTF/OBJ/STL 与 ffmpeg 生成的测试视频。
 */

const execFileAsync = promisify(execFile);

const HALF_HALF = 0x3800; // half 0.5

/** 写 half float（LE）。 */
function writeHalf(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value, offset);
}

/**
 * 生成 2×2 的最小 EXR（NONE 压缩，RGB half）。
 * 像素：全图 0.5 灰（线性中灰，用于验证 tone map 输出）。
 */
export async function writeExrFixture(
  directory: string,
  filename = "midgray.exr",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);

  const channelList = (name: string): Buffer => {
    const nameBytes = Buffer.from(`${name}\0`, "utf8");
    const block = Buffer.alloc(nameBytes.length + 16);
    nameBytes.copy(block, 0);
    block.writeInt32LE(1, nameBytes.length); // half
    block[nameBytes.length + 4] = 0; // pLinear
    // reserved 3 bytes 默认 0
    block.writeInt32LE(1, nameBytes.length + 8); // xSampling
    block.writeInt32LE(1, nameBytes.length + 12); // ySampling
    return block;
  };
  const channelBlock = Buffer.concat([
    channelList("R"),
    channelList("G"),
    channelList("B"),
    Buffer.from([0]), // channels 结束
  ]);

  const attribute = (
    name: string,
    type: string,
    value: Buffer,
  ): Buffer =>
    Buffer.concat([
      Buffer.from(`${name}\0`, "utf8"),
      Buffer.from(`${type}\0`, "utf8"),
      (() => {
        const size = Buffer.alloc(4);
        size.writeInt32LE(value.length, 0);
        return size;
      })(),
      value,
    ]);

  const box2i = (xMin: number, yMin: number, xMax: number, yMax: number): Buffer => {
    const box = Buffer.alloc(16);
    box.writeInt32LE(xMin, 0);
    box.writeInt32LE(yMin, 4);
    box.writeInt32LE(xMax, 8);
    box.writeInt32LE(yMax, 12);
    return box;
  };
  const float32 = (value: number): Buffer => {
    const block = Buffer.alloc(4);
    block.writeFloatLE(value, 0);
    return block;
  };
  const v2f = (x: number, y: number): Buffer =>
    Buffer.concat([float32(x), float32(y)]);

  const header = Buffer.concat([
    Buffer.from([0x76, 0x2f, 0x31, 0x01]), // magic
    Buffer.from([0x02, 0x00, 0x00, 0x00]), // version 2
    attribute("channels", "chlist", channelBlock),
    attribute("compression", "compression", Buffer.from([0])), // NONE
    attribute("dataWindow", "box2i", box2i(0, 0, 1, 1)),
    attribute("displayWindow", "box2i", box2i(0, 0, 1, 1)),
    attribute("lineOrder", "lineOrder", Buffer.from([0])), // increasing y
    attribute("pixelAspectRatio", "float", float32(1.0)),
    attribute(
      "chromaticities",
      "chromaticities",
      (() => {
        const chromaticities = Buffer.alloc(32);
        chromaticities.writeFloatLE(0.64, 0); // redX
        chromaticities.writeFloatLE(0.33, 4); // redY
        chromaticities.writeFloatLE(0.3, 8); // greenX
        chromaticities.writeFloatLE(0.6, 12); // greenY
        chromaticities.writeFloatLE(0.15, 16); // blueX
        chromaticities.writeFloatLE(0.06, 20); // blueY
        chromaticities.writeFloatLE(0.3127, 24); // whiteX
        chromaticities.writeFloatLE(0.329, 28); // whiteY
        return chromaticities;
      })(),
    ),
    attribute("screenWindowCenter", "v2f", v2f(0, 0)),
    attribute("screenWindowWidth", "float", float32(1.0)),
    Buffer.from([0]), // 空 attribute = header 结束
  ]);

  // 每行数据：y(4) + 数据大小(4) + 交织像素（R,G,B half × 2 像素）。
  // OpenEXR scanline block：y 坐标 + 块大小 + 按通道顺序交织的采样。
  const rowBytes = 4 + 4 + 2 * 3 * 2;
  const offsetTable = Buffer.alloc(2 * 8);
  const firstRow = header.length + offsetTable.length;
  offsetTable.writeBigInt64LE(BigInt(firstRow), 0);
  offsetTable.writeBigInt64LE(BigInt(firstRow + rowBytes), 8);

  const rows: Buffer[] = [];
  for (let y = 0; y < 2; y += 1) {
    const row = Buffer.alloc(rowBytes);
    row.writeInt32LE(y, 0); // y 坐标
    row.writeInt32LE(2 * 3 * 2, 4); // 像素数据大小（交织 half）
    for (let pixel = 0; pixel < 2; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        writeHalf(row, 8 + (pixel * 3 + channel) * 2, HALF_HALF);
      }
    }
    rows.push(row);
  }

  await writeFile(target, Buffer.concat([header, offsetTable, ...rows]));
  return target;
}

/** 生成 2×2 Radiance HDR（flat 编码，全图 RGBE(0.5, 0.5, 0.5, 129)）。 */
export async function writeHdrFixture(
  directory: string,
  filename = "midgray.hdr",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const head = Buffer.from(
    "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n",
    "latin1",
  );
  const pixel = Buffer.from([255, 255, 255, 127]); // 线性 0.5（mantissa=1.0, E=127）
  const data = Buffer.alloc(4 * 4);
  for (let index = 0; index < 4; index += 1) pixel.copy(data, index * 4);
  await writeFile(target, Buffer.concat([head, data]));
  return target;
}

/** 最小 GLB（无网格，仅 asset 信息；统计应为 0 节点/0 网格）。 */
export async function writeGlbFixture(
  directory: string,
  filename = "empty.glb",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0", generator: "refcanvas-fixture" },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
    }),
    "utf8",
  );
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4);
  json.copy(padded);
  for (let index = json.length; index < padded.length; index += 1) {
    padded[index] = 0x20; // JSON chunk 以空格对齐
  }
  const total = 12 + 8 + padded.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); // "glTF"
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(padded.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  await writeFile(target, Buffer.concat([head, chunk, padded]));
  return target;
}

/** 含一个三角网格的 glTF JSON（POSITION 3 顶点，无索引）。 */
export async function writeGltfFixture(
  directory: string,
  filename = "triangle.gltf",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 } }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  await writeFile(target, JSON.stringify(document, null, 2), "utf8");
  return target;
}

/** 带 3 顶点 1 面的 OBJ。 */
export async function writeObjFixture(
  directory: string,
  filename = "triangle.obj",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  await writeFile(
    target,
    "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\nf 1/1/1 2/1/1 3/1/1\n",
    "utf8",
  );
  return target;
}

/** ASCII STL：2 个三角。 */
export async function writeStlAsciiFixture(
  directory: string,
  filename = "twins.stl",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const facet = (normal: string, vertices: Array<[number, number, number]>): string =>
    [
      `facet normal ${normal}`,
      "  outer loop",
      ...vertices.map(
        (vertex) =>
          `    vertex ${vertex[0]} ${vertex[1]} ${vertex[2]}`,
      ),
      "  endloop",
      "endfacet",
    ].join("\n");
  await writeFile(
    target,
    [
      "solid twins",
      facet("0 0 1", [[0, 0, 0], [1, 0, 0], [0, 1, 0]]),
      facet("0 0 1", [[1, 0, 0], [1, 1, 0], [0, 1, 0]]),
      "endsolid twins",
      "",
    ].join("\n"),
    "utf8",
  );
  return target;
}

/** 二进制 STL：2 个三角，包围盒 [0,0,0]-[2,2,0]。 */
export async function writeStlBinaryFixture(
  directory: string,
  filename = "twins-binary.stl",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const triangles: Array<Array<[number, number, number]>> = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [2, 2, 0], [0, 1, 0]],
  ];
  const head = Buffer.alloc(84);
  head.writeUInt32LE(triangles.length, 80);
  const body = Buffer.alloc(triangles.length * 50);
  triangles.forEach((triangle, triangleIndex) => {
    const base = triangleIndex * 50;
    triangle.forEach((vertex, corner) => {
      const offset = base + 12 + corner * 12;
      body.writeFloatLE(vertex[0], offset);
      body.writeFloatLE(vertex[1], offset + 4);
      body.writeFloatLE(vertex[2], offset + 8);
    });
  });
  await writeFile(target, Buffer.concat([head, body]));
  return target;
}

/** 用打包 ffmpeg 生成 1 秒 30fps 测试视频（testsrc2，含音轨）。 */
export async function writeVideoFixture(
  directory: string,
  filename = "sample.mp4",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const executable = process.env.REFCANVAS_FFMPEG || ffmpegStatic;
  await execFileAsync(
    executable,
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x48:rate=30:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      target,
    ],
    { timeout: 60_000, windowsHide: true },
  );
  return target;
}
