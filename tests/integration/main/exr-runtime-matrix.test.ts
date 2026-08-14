import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HdrProvider } from "../../../src/main/providers/hdr-provider";
import { packagedOiiotoolPath } from "../../../src/main/services/media/openimageio-tools";

const execFileAsync = promisify(execFile);
let root = "";
let tool = "";

async function runTool(args: string[]): Promise<void> {
  await execFileAsync(tool, args, {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function deterministicMetadata(): string[] {
  return [
    "--attrib",
    "DateTime",
    "2000:01:01 00:00:00",
    "--no-history",
    "--nosoftwareattrib",
  ];
}

async function makeFlatExr(
  filename: string,
  compression: string,
  tiled: boolean,
  bitDepth: "half" | "float" = "half",
): Promise<void> {
  await runTool([
    "--create", "32x16", "3",
    "--fill:color=0.2,0.4,0.6", "32x16",
    "--chnames", "Beauty.R,Beauty.G,Beauty.B",
    ...deterministicMetadata(),
    ...(tiled ? ["--tile", "16", "16"] : ["--scanline"]),
    "--compression", compression,
    "-d", bitDepth,
    "-o", filename,
  ]);
}

async function makeDeepExr(filename: string): Promise<void> {
  await runTool([
    "--create", "16x8", "4",
    "--fill:color=0.2,0.4,0.6,1.0", "16x8",
    "--chnames", "R,G,B,A",
    "--deepen",
    ...deterministicMetadata(),
    "--scanline",
    "--compression", "zip",
    "-d", "half",
    "-o", filename,
  ]);
}

async function makeMultipartExr(filename: string): Promise<void> {
  await runTool([
    "--create", "16x8", "3",
    "--fill:color=0.05,0.1,0.15", "16x8",
    "--fullsize", "16x8",
    "--chnames", "R,G,B",
    "--attrib", "name", "Utility",
    "--create", "16x8", "3",
    "--fill:color=0.2,0.4,0.6", "16x8",
    "--fullsize", "16x8",
    "--chnames", "R,G,B",
    "--attrib", "name", "Beauty",
    "--create", "16x8", "3",
    "--fill:color=0.7,0.2,0.1", "16x8",
    "--fullsize", "16x8",
    "--chnames", "R,G,B",
    "--attrib", "name", "Normals",
    "--create", "16x8", "1",
    "--fill:color=0.5", "16x8",
    "--fullsize", "16x8",
    "--chnames", "Z-depth.y",
    "--attrib", "name", "Depth",
    "--siappendall",
    ...deterministicMetadata(),
    "--scanline",
    "--compression", "zip",
    "-d", "half",
    "-o:all=1", filename,
  ]);
}

async function centerRgb(filename: string): Promise<[number, number, number]> {
  const { data, info } = await sharp(filename)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (
    Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)
  ) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function expectColor(
  actual: [number, number, number],
  expected: [number, number, number],
  tolerance = 8,
): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeGreaterThanOrEqual(expected[index] - tolerance);
    expect(actual[index]).toBeLessThanOrEqual(expected[index] + tolerance);
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-exr-matrix-"));
  tool = await packagedOiiotoolPath() ?? "";
  if (!tool) throw new Error("OPENIMAGEIO_RUNTIME_MISSING");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("bundled OpenImageIO EXR matrix", () => {
  const variants = [
    { name: "scanline-none", compression: "none", tiled: false, bitDepth: "half" as const },
    { name: "scanline-rle", compression: "rle", tiled: false, bitDepth: "half" as const },
    { name: "scanline-zips", compression: "zips", tiled: false, bitDepth: "half" as const },
    { name: "scanline-zip", compression: "zip", tiled: false, bitDepth: "half" as const },
    { name: "scanline-piz", compression: "piz", tiled: false, bitDepth: "half" as const },
    { name: "scanline-pxr24", compression: "pxr24", tiled: false, bitDepth: "half" as const },
    { name: "scanline-b44", compression: "b44", tiled: false, bitDepth: "half" as const },
    { name: "scanline-b44a", compression: "b44a", tiled: false, bitDepth: "float" as const },
    { name: "scanline-dwaa", compression: "dwaa", tiled: false, bitDepth: "half" as const },
    { name: "scanline-dwab", compression: "dwab", tiled: false, bitDepth: "half" as const },
    { name: "tiled-zips", compression: "zips", tiled: true, bitDepth: "half" as const },
    { name: "tiled-piz", compression: "piz", tiled: true, bitDepth: "half" as const },
    { name: "tiled-dwab", compression: "dwab", tiled: true, bitDepth: "half" as const },
  ] as const;

  for (const variant of variants) {
    it(`decodes ${variant.name}`, async () => {
      const source = path.join(root, `${variant.name}.exr`);
      const output = path.join(root, `${variant.name}.png`);
      await makeFlatExr(source, variant.compression, variant.tiled, variant.bitDepth);
      const provider = new HdrProvider();
      const probe = await provider.probe({
        path: source,
        kind: "image",
        extension: "exr",
        size: 0,
      });
      const parts = probe.extra.subimages as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        compression: variant.compression,
        tiled: variant.tiled,
        deep: false,
      });
      await provider.thumbnail({
        path: source,
        kind: "image",
        extension: "exr",
        width: 64,
        height: 64,
        outputPath: output,
      });
      expectColor(await centerRgb(output), [124, 170, 203]);
    });
  }

  it("flattens a deep scanline EXR", async () => {
    const source = path.join(root, "deep-scanline.exr");
    const output = path.join(root, "deep-scanline.png");
    await makeDeepExr(source);
    const provider = new HdrProvider();
    const probe = await provider.probe({
      path: source,
      kind: "image",
      extension: "exr",
      size: 0,
    });
    expect(probe.extra.subimages).toEqual([
      expect.objectContaining({ deep: true, tiled: false }),
    ]);
    await provider.thumbnail({
      path: source,
      kind: "image",
      extension: "exr",
      width: 64,
      height: 64,
      outputPath: output,
    });
    expectColor(await centerRgb(output), [124, 170, 203]);
  });

  it("probes every multipart part and selects Beauty/AOV channels outside part 0", async () => {
    const source = path.join(root, "multipart.exr");
    await makeMultipartExr(source);
    const provider = new HdrProvider();
    const probe = await provider.probe({
      path: source,
      kind: "image",
      extension: "exr",
      size: 0,
    });
    expect(probe.width).toBe(16);
    expect(probe.height).toBe(8);
    expect(probe.extra.defaultLayer).toBe("Beauty");
    expect(probe.extra.subimages).toEqual([
      expect.objectContaining({ index: 0, name: "Utility", width: 16, height: 8, channels: ["R", "G", "B"] }),
      expect.objectContaining({ index: 1, name: "Beauty", width: 16, height: 8, channels: ["R", "G", "B"] }),
      expect.objectContaining({ index: 2, name: "Normals", width: 16, height: 8, channels: ["R", "G", "B"] }),
      expect.objectContaining({ index: 3, name: "Depth", width: 16, height: 8, channels: ["Z-depth.y"] }),
    ]);

    const beauty = path.join(root, "multipart-beauty.png");
    const normals = path.join(root, "multipart-normals.png");
    const depth = path.join(root, "multipart-depth.png");
    await provider.thumbnail({ path: source, kind: "image", extension: "exr", width: 64, height: 64, outputPath: beauty });
    await provider.thumbnail({ path: source, kind: "image", extension: "exr", channel: "Normals", width: 64, height: 64, outputPath: normals });
    await provider.thumbnail({ path: source, kind: "image", extension: "exr", channel: "Z-depth.y", width: 64, height: 64, outputPath: depth });
    expectColor(await centerRgb(beauty), [124, 170, 203]);
    expectColor(await centerRgb(normals), [218, 124, 89]);
    expectColor(await centerRgb(depth), [188, 188, 188]);
  });
});
