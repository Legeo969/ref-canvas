import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { writeVideoFixture } from "../../fixtures/media-fixtures";
import {
  createReferenceMatchService,
  type ReferenceMatchDependencies,
} from "../../../src/main/services/media/reference-match";
import { DEFAULT_LOOK_CONTROLS } from "../../../src/shared/match/look-controls";
import type { ReferenceMatchControls } from "../../../src/shared/contracts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  // Windows 上 sharp/libvips 写完 PNG 后句柄延迟释放，rm 会触发 EBUSY。
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          await rm(directory, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 7) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeGradient(
  filePath: string,
  width: number,
  height: number,
  start: [number, number, number],
  end: [number, number, number],
): Promise<void> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / Math.max(1, width - 1)) * 0.75 + (y / Math.max(1, height - 1)) * 0.25;
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          start[channel] + (end[channel] - start[channel]) * t,
        );
      }
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(filePath);
}

function serviceFor(cacheDirectory: string): {
  service: ReturnType<typeof createReferenceMatchService>;
  registered: string[];
} {
  const registered: string[] = [];
  const dependencies: ReferenceMatchDependencies = {
    cacheDirectory,
    previewUrlFor: (filePath) => pathToFileURL(filePath).href,
    registerCacheFile: (key) => registered.push(key),
  };
  return { service: createReferenceMatchService(dependencies), registered };
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then((info) => info.isFile(), () => false);
}

/** 通过 buffer 解码 PNG，避免 sharp 持句柄导致 Windows 清理 EBUSY。 */
async function decodePng(filePath: string): Promise<{
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}> {
  const { data, info } = await sharp(await readFile(filePath))
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function controls(overrides: Partial<ReferenceMatchControls> = {}): ReferenceMatchControls {
  return { ...DEFAULT_LOOK_CONTROLS, ...overrides };
}

async function fixtures(): Promise<{
  directory: string;
  cacheDirectory: string;
  warm: string;
  cool: string;
}> {
  const directory = await tempDirectory("refcanvas-match-");
  const cacheDirectory = await tempDirectory("refcanvas-match-cache-");
  const warm = path.join(directory, "warm.png");
  const cool = path.join(directory, "cool.png");
  await writeGradient(warm, 64, 48, [255, 80, 30], [255, 225, 130]);
  await writeGradient(cool, 48, 48, [20, 60, 160], [120, 215, 255]);
  return { directory, cacheDirectory, warm, cool };
}

describe("reference match service", () => {
  it("writes preview, original and cube files and reuses the cached result", async () => {
    const { cacheDirectory, warm, cool } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const request = {
      sourcePath: warm,
      referencePath: cool,
      controls: controls(),
      previewSize: 320,
    };

    const first = await service.create(request);
    expect(await exists(first.lutPath)).toBe(true);
    const previewPath = fileURLToPath(first.previewUrl);
    const originalPath = fileURLToPath(first.originalUrl);
    expect(await exists(previewPath)).toBe(true);
    expect(await exists(originalPath)).toBe(true);
    expect(first.width).toBe(64);
    expect(first.height).toBe(48);

    const cube = await readFile(first.lutPath, "utf8");
    expect(cube).toContain("LUT_3D_SIZE 33");
    expect(cube).toContain('TITLE "RefCanvas reference match"');

    const second = await service.create(request);
    expect(second.lutPath).toBe(first.lutPath);

    const changed = await service.create({
      ...request,
      controls: controls({ matchStrength: 45 }),
    });
    expect(changed.lutPath).not.toBe(first.lutPath);
  });

  it("analyses the reference into a palette with ordered brightness percentiles", async () => {
    const { cacheDirectory, cool } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const analysis = await service.analyse(cool);

    expect(analysis.url.startsWith("file:")).toBe(true);
    expect(analysis.width).toBe(48);
    expect(analysis.height).toBe(48);
    expect(analysis.palette.length).toBeGreaterThan(0);
    expect(analysis.brightness.p10).toBeLessThanOrEqual(analysis.brightness.median);
    expect(analysis.brightness.median).toBeLessThanOrEqual(analysis.brightness.p90);
    expect(analysis.hue.family).not.toBe("neutral");
  });

  it("keeps identical images unchanged through the identity LUT", async () => {
    const { cacheDirectory, warm } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const result = await service.create({
      sourcePath: warm,
      referencePath: warm,
      controls: controls(),
      previewSize: 320,
    });

    const preview = await decodePng(fileURLToPath(result.previewUrl));
    const original = await decodePng(fileURLToPath(result.originalUrl));
    expect(preview.width).toBe(original.width);
    expect(preview.height).toBe(original.height);
    expect(preview.channels).toBe(original.channels);
    // PNG 往返是 8bit，允许 ±2 的量化误差。
    for (let index = 0; index < original.data.length; index += 1) {
      expect(Math.abs(preview.data[index] - original.data[index])).toBeLessThanOrEqual(2);
    }
  });

  it("bends the frame toward the reference colour direction", async () => {
    const { cacheDirectory, warm, cool } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const result = await service.create({
      sourcePath: warm,
      referencePath: cool,
      controls: controls({ matchStrength: 100 }),
      previewSize: 320,
    });

    const preview = await decodePng(fileURLToPath(result.previewUrl));
    const original = await decodePng(fileURLToPath(result.originalUrl));
    // 暖色源 + 冷色参考：通道差 r-b 必须明显缩小，否则解码 / 色域转换 /
    // 拟合 / 渲染这条链上有一环没生效。
    const warmth = (image: { data: Buffer; channels: number }) => {
      let total = 0;
      let pixels = 0;
      for (let offset = 0; offset < image.data.length; offset += image.channels) {
        total += image.data[offset] - image.data[offset + 2];
        pixels += 1;
      }
      return total / pixels;
    };
    const originalWarmth = warmth(original);
    const previewWarmth = warmth(preview);
    expect(originalWarmth).toBeGreaterThan(40);
    expect(previewWarmth).toBeLessThan(originalWarmth - 12);
  });

  it("writes a 65-point cube when the larger grid is requested", async () => {
    const { cacheDirectory, warm, cool } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const result = await service.create({
      sourcePath: warm,
      referencePath: cool,
      controls: controls(),
      dimension: 65,
      previewSize: 320,
    });
    const cube = await readFile(result.lutPath, "utf8");
    expect(cube).toContain("LUT_3D_SIZE 65");
    const rows = cube
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#") && !/^[A-Z][A-Z0-9_]* /.test(line));
    expect(rows).toHaveLength(65 ** 3);
  });

  it("extracts the requested video frame and keys it by time", async () => {
    const directory = await tempDirectory("refcanvas-match-video-");
    const cacheDirectory = await tempDirectory("refcanvas-match-vcache-");
    const video = await writeVideoFixture(directory);
    const { warm } = await fixtures();
    const { service } = serviceFor(cacheDirectory);

    const first = await service.create({
      sourcePath: video,
      referencePath: warm,
      controls: controls(),
      previewSize: 320,
      timeMs: 200,
    });
    expect(await exists(first.lutPath)).toBe(true);
    const firstFrame = await decodePng(fileURLToPath(first.originalUrl));
    expect(firstFrame.width).toBeGreaterThan(0);

    // 换时间点必须换帧：抽帧缓存若只按文件身份建键，这里会静默拿到同一帧。
    const second = await service.create({
      sourcePath: video,
      referencePath: warm,
      controls: controls(),
      previewSize: 320,
      timeMs: 800,
    });
    expect(second.lutPath).not.toBe(first.lutPath);
    const secondFrame = await decodePng(fileURLToPath(second.originalUrl));
    expect(secondFrame.data.equals(firstFrame.data)).toBe(false);

    const again = await service.create({
      sourcePath: video,
      referencePath: warm,
      controls: controls(),
      previewSize: 320,
      timeMs: 200,
    });
    expect(again.lutPath).toBe(first.lutPath);
  });

  it("copies the LUT into the target directory with conflict suffixes", async () => {
    const { cacheDirectory, warm, cool } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const exportDirectory = await tempDirectory("refcanvas-match-export-");
    const result = await service.create({
      sourcePath: warm,
      referencePath: cool,
      controls: controls(),
      previewSize: 320,
    });

    const first = await service.exportLut({
      lutPath: result.lutPath,
      targetDirectory: exportDirectory,
      baseName: "look one",
    });
    expect(path.basename(first.path)).toBe("look_one.cube");
    expect(await exists(first.path)).toBe(true);

    const second = await service.exportLut({
      lutPath: result.lutPath,
      targetDirectory: exportDirectory,
      baseName: "look one",
    });
    expect(path.basename(second.path)).toBe("look_one-1.cube");
    expect(await exists(second.path)).toBe(true);
  });

  it("rejects missing inputs and invalid controls", async () => {
    const { directory, cacheDirectory, warm, cool } = await fixtures();
    const { service } = serviceFor(cacheDirectory);
    const base = {
      sourcePath: warm,
      referencePath: cool,
      controls: controls(),
      previewSize: 320,
    };

    await expect(
      service.create({ ...base, sourcePath: path.join(directory, "missing.png") }),
    ).rejects.toThrow("REFERENCE_MATCH_SOURCE_UNAVAILABLE");
    await expect(
      service.create({ ...base, referencePath: path.join(directory, "missing.png") }),
    ).rejects.toThrow("REFERENCE_MATCH_REFERENCE_UNAVAILABLE");
    await expect(
      service.create({ ...base, controls: controls({ shadows: 101 }) }),
    ).rejects.toThrow("REFERENCE_MATCH_CONTROLS_INVALID");
    await expect(
      service.create({ ...base, dimension: 32 as unknown as 33 }),
    ).rejects.toThrow("REFERENCE_MATCH_DIMENSION_INVALID");
    await expect(
      service.create({ ...base, previewSize: 128 }),
    ).rejects.toThrow("REFERENCE_MATCH_PREVIEW_SIZE_INVALID");
    await expect(
      service.exportLut({ lutPath: path.join(directory, "nope.cube"), targetDirectory: directory }),
    ).rejects.toThrow("REFERENCE_MATCH_LUT_MISSING");
  });
});
