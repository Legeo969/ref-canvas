import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  writeExrFixture,
  writeGlbFixture,
  writeGltfFixture,
  writeHdrFixture,
  writeObjFixture,
  writeStlAsciiFixture,
  writeStlBinaryFixture,
  writeVideoFixture,
} from "../../fixtures/media-fixtures";
import { HdrProvider } from "../../../src/main/providers/hdr-provider";
import { GeometryProvider } from "../../../src/main/providers/geometry-provider";
import { VideoProvider } from "../../../src/main/providers/video-provider";
import { parseExrHeader } from "../../../src/main/services/media/exr-header";
import { parseHdrHeader } from "../../../src/main/services/media/hdr-header";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** 读取 PNG 中心像素的 RGB（验证 tone map 输出）。 */
async function centerPixelRgb(pngPath: string): Promise<[number, number, number]> {
  const { data, info } = await sharp(pngPath)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width / 2);
  const y = Math.floor(info.height / 2);
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

describe("stage 3 media providers", () => {
  it("parses an EXR header (size, channels, compression, bit depth)", async () => {
    const directory = await tempDirectory("refcanvas-exr-");
    const filename = await writeExrFixture(directory);
    const header = await parseExrHeader(filename);
    expect(header.valid).toBe(true);
    expect(header.width).toBe(2);
    expect(header.height).toBe(2);
    expect(header.channels.map((channel) => channel.name)).toEqual(["R", "G", "B"]);
    expect(header.channels[0].pixelType).toBe(1); // half
    expect(header.compression).toBe("none");
    expect(header.bitDepth).toBe(16);
    expect(header.dataWindow).toEqual({ xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
    expect(header.chromaticities).not.toBeNull();
    expect(header.tiles).toBe(false);
  });

  it("rejects non-EXR files with a clear error", async () => {
    const directory = await tempDirectory("refcanvas-exr-bad-");
    const filename = path.join(directory, "not.exr");
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(filename, "PNG not exr"),
    );
    const header = await parseExrHeader(filename);
    expect(header.valid).toBe(false);
    expect(header.error).toMatch(/EXR_MAGIC_MISMATCH/);
  });

  it("parses a Radiance HDR header", async () => {
    const directory = await tempDirectory("refcanvas-hdr-");
    const filename = await writeHdrFixture(directory);
    const header = await parseHdrHeader(filename);
    expect(header.valid).toBe(true);
    expect(header.width).toBe(2);
    expect(header.height).toBe(2);
    expect(header.format).toBe("32-bit_rle_rgbe");
  });

  it("produces a known tone-mapped EXR thumbnail (linear 0.5 -> ~188 sRGB)", async () => {
    const directory = await tempDirectory("refcanvas-exr-thumb-");
    const source = await writeExrFixture(directory);
    const outputPath = path.join(directory, "thumb.png");
    const provider = new HdrProvider();
    const result = await provider.thumbnail({
      path: source,
      kind: "image",
      extension: "exr",
      width: 64,
      height: 64,
      outputPath,
    });
    expect(result.path).toBe(outputPath);
    const [red, green, blue] = await centerPixelRgb(outputPath);
    // 线性 0.5 经 sRGB EOTF ≈ 188；允许实现误差 ±20。
    expect(red).toBeGreaterThanOrEqual(168);
    expect(red).toBeLessThanOrEqual(208);
    expect(Math.abs(red - green)).toBeLessThanOrEqual(8);
    expect(Math.abs(green - blue)).toBeLessThanOrEqual(8);
  });

  it("produces a known tone-mapped HDR thumbnail", async () => {
    const directory = await tempDirectory("refcanvas-hdr-thumb-");
    const source = await writeHdrFixture(directory);
    const outputPath = path.join(directory, "thumb.png");
    const provider = new HdrProvider();
    const result = await provider.thumbnail({
      path: source,
      kind: "image",
      extension: "hdr",
      width: 64,
      height: 64,
      outputPath,
    });
    expect(result.path).toBe(outputPath);
    const [red, green, blue] = await centerPixelRgb(outputPath);
    expect(red).toBeGreaterThanOrEqual(168);
    expect(red).toBeLessThanOrEqual(208);
    expect(Math.abs(red - green)).toBeLessThanOrEqual(8);
    expect(Math.abs(green - blue)).toBeLessThanOrEqual(8);
  });

  it("exposes EXR metadata fields for the inspector", async () => {
    const directory = await tempDirectory("refcanvas-exr-meta-");
    const filename = await writeExrFixture(directory);
    const provider = new HdrProvider();
    const probe = await provider.probe({
      path: filename,
      kind: "image",
      extension: "exr",
      size: 0,
    });
    expect(probe.width).toBe(2);
    expect(probe.height).toBe(2);
    const meta = await provider.metadata({
      path: filename,
      kind: "image",
      extension: "exr",
    });
    expect(meta.fields.channelCount).toBe(3);
    expect(meta.fields.compression).toBe("none");
    expect(meta.fields.bitDepth).toBe(16);
  });

  it("probes GLB, glTF, OBJ and STL geometry stats", async () => {
    const directory = await tempDirectory("refcanvas-geo-");
    const provider = new GeometryProvider();

    const glb = await writeGlbFixture(directory);
    const glbStats = await provider.probe({
      path: glb,
      kind: "model3d",
      extension: "glb",
      size: 0,
    });
    expect(glbStats.extra.nodeCount).toBe(0);
    expect(glbStats.extra.meshCount).toBe(0);
    expect(glbStats.extra.valid).toBe(true);

    const gltf = await writeGltfFixture(directory);
    const gltfStats = await provider.probe({
      path: gltf,
      kind: "model3d",
      extension: "gltf",
      size: 0,
    });
    expect(gltfStats.extra.vertexCount).toBe(3);
    expect(gltfStats.extra.nodeCount).toBe(1);
    expect(gltfStats.extra.meshCount).toBe(1);
    expect(gltfStats.extra.boundingBox).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0],
    });
    expect(gltfStats.extra.hasNormals).toBe(false);

    const obj = await writeObjFixture(directory);
    const objStats = await provider.probe({
      path: obj,
      kind: "model3d",
      extension: "obj",
      size: 0,
    });
    expect(objStats.extra.vertexCount).toBe(3);
    expect(objStats.extra.triangleCount).toBe(1);
    expect(objStats.extra.hasUvs).toBe(true);
    expect(objStats.extra.hasNormals).toBe(true);
    expect(objStats.extra.boundingBox).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0],
    });
  });

  it("probes ASCII and binary STL files", async () => {
    const directory = await tempDirectory("refcanvas-stl-");
    const provider = new GeometryProvider();

    const ascii = await writeStlAsciiFixture(directory);
    const asciiStats = await provider.probe({
      path: ascii,
      kind: "model3d",
      extension: "stl",
      size: 0,
    });
    expect(asciiStats.extra.triangleCount).toBe(2);
    expect(asciiStats.extra.vertexCount).toBe(6);
    expect(asciiStats.extra.boundingBox).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0],
    });

    const binary = await writeStlBinaryFixture(directory);
    const binaryStats = await provider.probe({
      path: binary,
      kind: "model3d",
      extension: "stl",
      size: 0,
    });
    expect(binaryStats.extra.triangleCount).toBe(2);
    expect(binaryStats.extra.boundingBox).toEqual({
      min: [0, 0, 0],
      max: [2, 2, 0],
    });
  });

  it("reports fbx as unparsed (no fake support)", async () => {
    const directory = await tempDirectory("refcanvas-fbx-");
    const filename = path.join(directory, "scene.fbx");
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(filename, "Kaydara FBX Binary  "),
    );
    const provider = new GeometryProvider();
    const probe = await provider.probe({
      path: filename,
      kind: "model3d",
      extension: "fbx",
      size: 0,
    });
    expect(probe.extra.valid).toBe(false);
    expect(probe.extra.error).toMatch(/FBX_NOT_PARSED/);
    expect(probe.extra.size).toBeGreaterThan(0);
  });

  it("reads full video metadata via ffprobe", async () => {
    const directory = await tempDirectory("refcanvas-video-");
    const filename = await writeVideoFixture(directory);
    const provider = new VideoProvider();
    const probe = await provider.probe({
      path: filename,
      kind: "video",
      extension: "mp4",
      size: 0,
    });
    expect(probe.width).toBe(64);
    expect(probe.height).toBe(48);
    expect(probe.duration).not.toBeNull();
    expect(probe.duration!).toBeGreaterThanOrEqual(0.9);
    expect(probe.duration!).toBeLessThanOrEqual(1.5);
    expect(probe.extra.codec).toBe("h264");
    expect(probe.extra.frameRate).toBeCloseTo(30, 0);
    expect(probe.extra.pixelFormat).toBe("yuv420p");
    expect(probe.extra.audioCodec).toBe("aac");
    expect(probe.extra.audioChannels).toBeGreaterThanOrEqual(1);
  });

  it("extracts a video poster thumbnail with ffmpeg", async () => {
    const directory = await tempDirectory("refcanvas-video-thumb-");
    const filename = await writeVideoFixture(directory);
    const outputPath = path.join(directory, "poster.png");
    const provider = new VideoProvider();
    const result = await provider.thumbnail({
      path: filename,
      kind: "video",
      extension: "mp4",
      width: 160,
      height: 120,
      outputPath,
    });
    expect(result.path).toBe(outputPath);
    const png = await readFile(outputPath);
    // PNG magic。
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("extracts an exact frame by timestamp (frame step)", async () => {
    const directory = await tempDirectory("refcanvas-video-frame-");
    const filename = await writeVideoFixture(directory);
    const { extractVideoFrame } = await import(
      "../../../src/main/services/media/ffmpeg-tools"
    );
    const outputPath = path.join(directory, "frame.png");
    await extractVideoFrame(filename, 500, outputPath, {
      width: 64,
      height: 48,
    });
    const png = await readFile(outputPath);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
