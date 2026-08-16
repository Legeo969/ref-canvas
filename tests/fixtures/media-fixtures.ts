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
 * fixture 生成器把输出文件写入调用方传入的临时目录；文件名要么是固定常量、
 * 要么是纯字母数字扩展名。这里统一限制文件名与目录边界（resolve 后必须位于
 * 根目录内），防止 `..` 越出临时目录（纵深防御）。
 */
function fixtureTarget(directory: string, filename: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(filename) ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    throw new Error("FIXTURE_INVALID_FILENAME");
  }
  const root = path.resolve(directory);
  const target = path.resolve(root, filename);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("FIXTURE_OUT_OF_DIRECTORY");
  }
  return target;
}

/**
 * 生成 2×2 的最小 EXR（NONE 压缩，RGB half）。
 * 像素：全图 0.5 灰（线性中灰，用于验证 tone map 输出）。
 */
export async function writeExrFixture(
  directory: string,
  filename = "midgray.exr",
  extraHeaderBytes = 0,
  channelNames: string[] = ["R", "G", "B"],
  channelValues: Record<string, 0 | 0.5 | 1> = {},
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);

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
    ...channelNames.map(channelList),
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
    ...(extraHeaderBytes > 0
      ? [
          attribute(
            "comment",
            "string",
            Buffer.alloc(extraHeaderBytes, 65),
          ),
        ]
      : []),
    Buffer.from([0]), // 空 attribute = header 结束
  ]);

  // 每行数据：y(4) + 数据大小(4) + 各通道 half × 2 像素。
  // OpenEXR scanline block 按 channel-major 顺序存储一整行采样。
  const scanlineDataBytes = 2 * channelNames.length * 2;
  const rowBytes = 4 + 4 + scanlineDataBytes;
  const offsetTable = Buffer.alloc(2 * 8);
  const firstRow = header.length + offsetTable.length;
  offsetTable.writeBigInt64LE(BigInt(firstRow), 0);
  offsetTable.writeBigInt64LE(BigInt(firstRow + rowBytes), 8);

  const rows: Buffer[] = [];
  for (let y = 0; y < 2; y += 1) {
    const row = Buffer.alloc(rowBytes);
    row.writeInt32LE(y, 0); // y 坐标
    row.writeInt32LE(scanlineDataBytes, 4); // 像素数据大小（交织 half）
    for (let channel = 0; channel < channelNames.length; channel += 1) {
      for (let pixel = 0; pixel < 2; pixel += 1) {
        const value = channelValues[channelNames[channel]] ?? 0.5;
        writeHalf(
          row,
          8 + (channel * 2 + pixel) * 2,
          value === 0 ? 0 : value === 1 ? 0x3c00 : HALF_HALF,
        );
      }
    }
    rows.push(row);
  }

  await writeFile(target, Buffer.concat([header, offsetTable, ...rows]));
  return target;
}

/**
 * 生成只有 EXR 头的文件（无像素数据），dataWindow 指定任意宽高。
 * probe/metadata 只读文件头，因此该 fixture 可用于验证宽图（如 2:1
 * equirectangular）的尺寸探测；不解码像素。
 */
export async function writeExrHeaderOnlyFixture(
  directory: string,
  filename: string,
  width: number,
  height: number,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);

  const channelList = (name: string): Buffer => {
    const nameBytes = Buffer.from(`${name}\0`, "utf8");
    const block = Buffer.alloc(nameBytes.length + 16);
    nameBytes.copy(block, 0);
    block.writeInt32LE(1, nameBytes.length); // half
    block[nameBytes.length + 4] = 0; // pLinear
    block.writeInt32LE(1, nameBytes.length + 8); // xSampling
    block.writeInt32LE(1, nameBytes.length + 12); // ySampling
    return block;
  };
  const channelBlock = Buffer.concat([
    ...["R", "G", "B"].map(channelList),
    Buffer.from([0]), // channels 结束
  ]);

  const attribute = (name: string, type: string, value: Buffer): Buffer =>
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

  const header = Buffer.concat([
    Buffer.from([0x76, 0x2f, 0x31, 0x01]), // magic
    Buffer.from([0x02, 0x00, 0x00, 0x00]), // version 2
    attribute("channels", "chlist", channelBlock),
    attribute("compression", "compression", Buffer.from([0])), // NONE
    attribute("dataWindow", "box2i", box2i(0, 0, width - 1, height - 1)),
    attribute("displayWindow", "box2i", box2i(0, 0, width - 1, height - 1)),
    Buffer.from([0]), // 空 attribute = header 结束
  ]);

  await writeFile(target, header);
  return target;
}

/** 生成 2×2 Radiance HDR（flat 编码，全图 RGBE(0.5, 0.5, 0.5, 129)）。 */
export async function writeHdrFixture(
  directory: string,
  filename = "midgray.hdr",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);
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
  const target = fixtureTarget(directory, filename);
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
  const target = fixtureTarget(directory, filename);
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
  const target = fixtureTarget(directory, filename);
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
  const target = fixtureTarget(directory, filename);
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
  const target = fixtureTarget(directory, filename);
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
  const target = fixtureTarget(directory, filename);
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


/**
 * 生成最小 PSD 文件（8×6 RGB，raw 压缩，无图层）。
 * 布局：26B header + color mode(0) + resources(0) + layer/mask(0)
 * + 2B compression(0) + R/G/B planes。
 */
export async function writePsdFixture(
  directory: string,
  filename = "minimal.psd",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);
  const header = Buffer.alloc(26);
  header.write("8BPS", 0, "latin1");
  header.writeUInt16BE(1, 4); // version 1 (PSD)
  header.writeUInt16BE(3, 12); // channels
  header.writeUInt32BE(6, 14); // height
  header.writeUInt32BE(8, 18); // width
  header.writeUInt16BE(8, 22); // depth
  header.writeUInt16BE(3, 24); // RGB
  const red = Buffer.alloc(48, 200);
  const green = Buffer.alloc(48, 60);
  const blue = Buffer.alloc(48, 40);
  const compression = Buffer.from([0, 0]);
  await writeFile(
    target,
    Buffer.concat([header, Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4), compression, red, green, blue]),
  );
  return target;
}

/** 写一个 JXL 头（FF 0A container magic）+ 填充字节（probe 只认 magic）。 */
export async function writeJxlFixture(
  directory: string,
  filename = "fake.jxl",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);
  const head = Buffer.from([0xff, 0x0a]);
  const body = Buffer.alloc(64, 0x42);
  await writeFile(target, Buffer.concat([head, body]));
  return target;
}

/** 写一个 TIFF 头伪装的 RAW（II* + IFD 计数 0），用于降级探测。 */
export async function writeRawFixture(
  directory: string,
  filename = "fake.nef",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  await writeFile(target, head);
  return target;
}

/** 用打包 ffmpeg 生成 1 秒 440Hz sine WAV（音频 fixture）。 */
export async function writeAudioFixture(
  directory: string,
  filename = "tone.wav",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = fixtureTarget(directory, filename);
  const executable = process.env.REFCANVAS_FFMPEG || ffmpegStatic;
  await execFileAsync(
    executable,
    [
      "-v", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=1:sample_rate=44100",
      "-c:a", "pcm_s16le",
      "-y",
      target,
    ],
    { timeout: 60_000, windowsHide: true },
  );
  return target;
}

/** 用打包 ffmpeg 生成带内嵌封面的 MP3（封面提取测试）。 */
export async function writeAudioWithCoverFixture(
  directory: string,
  filename = "cover.mp3",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const root = path.resolve(directory);
  const target = path.resolve(root, filename);
  const cover = path.resolve(root, "cover.png");
  // 封面/输出必须留在传入的临时目录内（文件名固定常量，防御性校验）。
  if (
    target !== root &&
    !target.startsWith(root + path.sep)
  ) {
    throw new Error("FIXTURE_OUT_OF_DIRECTORY");
  }
  const executable = process.env.REFCANVAS_FFMPEG || ffmpegStatic;
  const { default: sharp } = await import("sharp");
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 60, b: 40 } },
  }).png().toFile(cover);
  await execFileAsync(
    executable,
    [
      "-v", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=1:sample_rate=44100",
      "-i", cover,
      "-map", "0:a", "-map", "1:v",
      "-c:a", "libmp3lame",
      "-c:v", "png",
      "-id3v2_version", "3",
      "-metadata:s:v", "title=Album cover",
      "-y",
      target,
    ],
    { timeout: 60_000, windowsHide: true },
  );
  return target;
}
