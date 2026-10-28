import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  applyLut3dImage,
  applyLut3dToPng,
  packagedFfmpegPath,
} from "../../../src/main/services/media/ffmpeg-tools";
import {
  NO_LUT_SIGNATURE,
  lutCacheSignature,
} from "../../../src/main/platform/lut-signature";
import {
  planPreviewLut,
  previewLutVariant,
} from "../../../src/main/platform/preview-lut";
import { thumbnailCacheFilename } from "../../../src/main/platform/thumbnail-cache";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  // Windows 上 sharp/libvips 与 ffmpeg 的句柄释放有延迟，rm 会撞 EBUSY。
  // 与 reference-match.test.ts 保持同一套重试约定。
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

/**
 * 2³ LUT：红色通道整体 +0.2。r=1 的格点写成 1.2（而非 clamp 到 1），
 * 否则三线性插值会把它插成 `0.2 + 0.8r`，偏移量随输入衰减。
 */
async function writeRedBoostCube(filePath: string): Promise<void> {
  const lines = ["LUT_3D_SIZE 2"];
  for (let b = 0; b < 2; b += 1) {
    for (let g = 0; g < 2; g += 1) {
      for (let r = 0; r < 2; r += 1) {
        lines.push(`${(r + 0.2).toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
    }
  }
  await writeFile(filePath, `${lines.join("\n")}\n`);
}

async function writeSolidPng(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toFile(filePath);
}

async function firstPixel(filePath: string): Promise<[number, number, number]> {
  // 用 buffer 解码：sharp 直接从文件解码会在 Windows 上短暂持句柄，
  // 导致 afterEach 的 rm 撞 EBUSY（同 reference-match.test.ts）。
  const bytes = await readFile(filePath);
  const { data } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

async function imageFormat(filePath: string): Promise<string | undefined> {
  return (await sharp(await readFile(filePath)).metadata()).format;
}

function expectNear(actual: number, expected: number, tolerance = 3): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe("applyLut3dImage（真跑 ffmpeg）", () => {
  it.each([
    ["png", "png", [0x89, 0x50, 0x4e, 0x47]],
    ["webp", "webp", [0x52, 0x49, 0x46, 0x46]],
  ] as const)(
    "输出 %s 编码的魔数与像素都按 LUT 变化",
    async (encoder, expectedFormat, magic) => {
      const directory = await tempDirectory("refcanvas-lut-roundtrip-");
      const input = path.join(directory, "input.png");
      const cube = path.join(directory, "boost.cube");
      const output = path.join(directory, `output.${encoder}`);
      await writeSolidPng(input);
      await writeRedBoostCube(cube);

      await applyLut3dImage(input, cube, output, {
        encoder,
        quality: 100,
        executable: packagedFfmpegPath(),
      });

      const bytes = await readFile(output);
      expect([...bytes.subarray(0, 4)]).toEqual(magic);
      expect((await imageFormat(output))).toBe(expectedFormat);
      const [r, g, b] = await firstPixel(output);
      // 输入 r=200：200/255 + 0.2 ≈ 0.984 → 251；g/b 不变。
      expectNear(r, 251);
      expectNear(g, 100);
      expectNear(b, 50);
      // 临时文件必须已 rename 或清理，不能留在缓存目录里。
      const entries = await readdir(directory);
      expect(entries.filter((name) => name.includes(".tmp."))).toEqual([]);
    },
  );

  it("WebP 输入的缓存字节同样可应用 LUT（协议实际路径）", async () => {
    const directory = await tempDirectory("refcanvas-lut-webp-src-");
    const input = path.join(directory, "cached.webp");
    const cube = path.join(directory, "boost.cube");
    const output = path.join(directory, "tinted.webp");
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .webp({ quality: 100 })
      .toFile(input);
    await writeRedBoostCube(cube);

    await applyLut3dImage(input, cube, output, {
      encoder: "webp",
      quality: 90,
      executable: packagedFfmpegPath(),
    });

    const [r, g, b] = await firstPixel(output);
    expectNear(r, 251);
    expectNear(g, 100);
    expectNear(b, 50);
  });

  it("带盘符的绝对路径、空格、逗号与单引号的 LUT 路径可用", async () => {
    const directory = await tempDirectory("refcanvas-lut-path-");
    const input = path.join(directory, "input.png");
    await writeSolidPng(input);

    const commaDirectory = path.join(directory, "with space, comma");
    await mkdir(commaDirectory, { recursive: true });
    const commaCube = path.join(commaDirectory, "boost.cube");
    await writeRedBoostCube(commaCube);
    const commaOutput = path.join(commaDirectory, "output.webp");
    await applyLut3dImage(input, commaCube, commaOutput, {
      encoder: "webp",
      executable: packagedFfmpegPath(),
    });
    expectNear((await firstPixel(commaOutput))[0], 251);

    const awkward = path.join(directory, "with space, o'brien");
    await mkdir(awkward, { recursive: true });
    const cube = path.join(awkward, "boost.cube");
    const output = path.join(awkward, "output.png");
    await writeRedBoostCube(cube);

    // 单引号路径在 ffmpeg 6.1 无法用 filter 转义表达，实现会复制到安全
    // 临时文件；这里证明带引号/空格的真实路径同样能出结果。
    await applyLut3dToPng(input, cube, output, packagedFfmpegPath());
    expect((await firstPixel(output))[0]).toBeGreaterThan(200);
  });

  it("LUT 缺失时抛错且不留下临时产物", async () => {
    const directory = await tempDirectory("refcanvas-lut-missing-");
    const input = path.join(directory, "input.png");
    const output = path.join(directory, "output.png");
    await writeSolidPng(input);

    await expect(
      applyLut3dImage(input, path.join(directory, "missing.cube"), output, {
        encoder: "webp",
        executable: packagedFfmpegPath(),
      }),
    ).rejects.toBeTruthy();
    await expect(stat(output)).rejects.toBeTruthy();
    const entries = await readdir(directory);
    expect(entries.filter((name) => name.includes(".tmp.") || name.includes(".lut-"))).toEqual([]);
  });
});

describe("lutCacheSignature", () => {
  it("无 LUT 或文件不存在时为空签名", async () => {
    expect(await lutCacheSignature(null)).toBe(NO_LUT_SIGNATURE);
    expect(await lutCacheSignature(undefined)).toBe(NO_LUT_SIGNATURE);
    const directory = await tempDirectory("refcanvas-lut-sig-");
    expect(await lutCacheSignature(path.join(directory, "nope.cube"))).toBe("");
  });

  it("同一文件稳定，mtime 或 size 变化则换签名", async () => {
    const directory = await tempDirectory("refcanvas-lut-sig-");
    const cube = path.join(directory, "boost.cube");
    await writeFile(cube, "LUT_3D_SIZE 2\n");
    const first = await lutCacheSignature(cube);
    expect(first).toMatch(/^[0-9a-f]{10}$/);
    expect(await lutCacheSignature(cube)).toBe(first);

    const later = new Date(Date.now() + 5_000);
    await utimes(cube, later, later);
    const touched = await lutCacheSignature(cube);
    expect(touched).not.toBe(first);

    await writeFile(cube, "LUT_3D_SIZE 2\n0 0 0\n");
    expect(await lutCacheSignature(cube)).not.toBe(touched);
  });
});

describe("preview LUT 缓存键", () => {
  const asset = {
    id: "asset-1",
    mtimeMs: 1000,
    size: 2048,
    fingerprint: "a".repeat(64),
  };

  it("LUT 签名进入 variant 后文件名不同", () => {
    const plain = thumbnailCacheFilename(asset, "preview-1920:default");
    const tinted = thumbnailCacheFilename(
      asset,
      "preview-1920:default:lut-a1b2c3d4e5",
    );
    expect(tinted).not.toBe(plain);
    expect(thumbnailCacheFilename(asset)).toBe(
      thumbnailCacheFilename(asset, "composite"),
    );
  });

  it("判定表：无 LUT / LUT 缺失 / board proxy / 普通缩略图", () => {
    expect(
      planPreviewLut({
        activeLut: null,
        lutSignature: "",
        boardProxy: false,
        gradeable: true,
      }),
    ).toEqual({ lutPath: null, variantSuffix: "" });

    // activeLut 有值但 stat 失败 → 签名为空，按无 LUT 处理。
    expect(
      planPreviewLut({
        activeLut: "C:\\luts\\missing.cube",
        lutSignature: "",
        boardProxy: false,
        gradeable: true,
      }),
    ).toEqual({ lutPath: null, variantSuffix: "" });

    expect(
      planPreviewLut({
        activeLut: "C:\\luts\\look.cube",
        lutSignature: "a1b2c3d4e5",
        boardProxy: true,
        gradeable: true,
      }),
    ).toEqual({ lutPath: null, variantSuffix: "" });

    // 图标卡片（音频/字体/文本/3D）不调色。
    expect(
      planPreviewLut({
        activeLut: "C:\\luts\\look.cube",
        lutSignature: "a1b2c3d4e5",
        boardProxy: false,
        gradeable: false,
      }),
    ).toEqual({ lutPath: null, variantSuffix: "" });

    const plan = planPreviewLut({
      activeLut: "C:\\luts\\look.cube",
      lutSignature: "a1b2c3d4e5",
      boardProxy: false,
      gradeable: true,
    });
    expect(plan).toEqual({
      lutPath: "C:\\luts\\look.cube",
      variantSuffix: "lut-a1b2c3d4e5",
    });
    expect(previewLutVariant("preview-1920:default", plan)).toBe(
      "preview-1920:default:lut-a1b2c3d4e5",
    );
    expect(previewLutVariant("", plan)).toBe("lut-a1b2c3d4e5");
    expect(previewLutVariant("", { lutPath: null, variantSuffix: "" })).toBe(
      undefined,
    );
  });
});
