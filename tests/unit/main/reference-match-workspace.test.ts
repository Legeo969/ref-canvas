/**
 * Workspace, settings and library behaviour of the reference-match service.
 *
 * The matching maths is covered elsewhere; this file guards the parts that
 * decide *what the exported LUT means* (input domain, Resolve output
 * compensation) and the file management around it (settings, LUT library
 * import, cache clearing).
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  createReferenceMatchService,
  type ReferenceMatchDependencies,
} from "../../../src/main/services/media/reference-match";
import { DEFAULT_LOOK_CONTROLS } from "../../../src/shared/match/look-controls";

const temporaryDirectories: string[] = [];

afterEach(async () => {
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
      const t = (x / Math.max(1, width - 1)) * 0.7 + (y / Math.max(1, height - 1)) * 0.3;
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(start[channel] + (end[channel] - start[channel]) * t);
      }
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(filePath);
}

async function setup(): Promise<{
  cacheDirectory: string;
  service: ReturnType<typeof createReferenceMatchService>;
  source: string;
  reference: string;
}> {
  const cacheDirectory = await tempDirectory("refcanvas-match-workspace-");
  const dependencies: ReferenceMatchDependencies = {
    cacheDirectory,
    settingsPath: path.join(cacheDirectory, "reference-match-settings.json"),
    defaultExportDirectory: path.join(cacheDirectory, "exports"),
    previewUrlFor: (filePath) => pathToFileURL(filePath).href,
  };
  const source = path.join(cacheDirectory, "source.png");
  const reference = path.join(cacheDirectory, "reference.png");
  await writeGradient(source, 96, 64, [200, 140, 90], [60, 80, 120]);
  await writeGradient(reference, 64, 64, [70, 110, 170], [30, 60, 120]);
  return { cacheDirectory, service: createReferenceMatchService(dependencies), source, reference };
}

describe("reference-match workspaces", () => {
  it("Rec.709 LUT 的 cube 头写明输入域", async () => {
    const { service, source, reference } = await setup();
    const result = await service.create({
      sourcePath: source,
      referencePath: reference,
      controls: DEFAULT_LOOK_CONTROLS,
      dimension: 33,
      previewSize: 256,
      workspace: "rec709",
    });
    expect(result.workspace).toBe("rec709");
    expect(result.baseline).toBe("none");
    const cube = await readFile(result.lutPath, "utf8");
    expect(cube).toContain("Input domain: Rec.709 Gamma 2.4");
    expect(cube).toContain("TITLE \"RefCanvas reference match · rec709\"");
  });

  it("DWG 工作空间用非 DPX 源时先做显示域拟合再烘进 DI 域", async () => {
    const { service, source, reference } = await setup();
    const result = await service.create({
      sourcePath: source,
      referencePath: reference,
      controls: DEFAULT_LOOK_CONTROLS,
      dimension: 33,
      previewSize: 256,
      workspace: "dwg",
      resolveOutputCompensation: true,
    });
    expect(result.workspace).toBe("dwg");
    expect(result.resolveOutputCompensation).toBe(true);
    const cube = await readFile(result.lutPath, "utf8");
    expect(cube).toContain("Input domain: DaVinci Wide Gamut + Intermediate");
    expect(cube).toContain("output-response compensation: enabled");
    // DI cube 不夹 0..1：高光要保留工作空间余量。
    expect(cube).not.toMatch(/^1\.0000000 1\.0000000 1\.0000000$/m);
  });

  it("DPX 源不能配 Rec.709 工作空间", async () => {
    const { service, cacheDirectory, reference } = await setup();
    const dpx = path.join(cacheDirectory, "still.dpx");
    await writeFile(dpx, Buffer.alloc(64));
    await expect(
      service.create({
        sourcePath: dpx,
        referencePath: reference,
        controls: DEFAULT_LOOK_CONTROLS,
        previewSize: 256,
        workspace: "rec709",
      }),
    ).rejects.toThrow("REFERENCE_MATCH_DPX_REQUIRES_WORKSPACE");
  });

  it("S-Log3 工作空间只接受 DPX 源", async () => {
    const { service, source, reference } = await setup();
    await expect(
      service.create({
        sourcePath: source,
        referencePath: reference,
        controls: DEFAULT_LOOK_CONTROLS,
        previewSize: 256,
        workspace: "slog3",
      }),
    ).rejects.toThrow("REFERENCE_MATCH_SLOG3_REQUIRES_DPX");
  });

  it("参考图不能是 DPX", async () => {
    const { service, cacheDirectory, source } = await setup();
    const dpx = path.join(cacheDirectory, "reference.dpx");
    await writeFile(dpx, Buffer.alloc(64));
    await expect(service.analyse(dpx)).rejects.toThrow();
    await expect(
      service.create({
        sourcePath: source,
        referencePath: dpx,
        controls: DEFAULT_LOOK_CONTROLS,
        previewSize: 256,
      }),
    ).rejects.toThrow("REFERENCE_MATCH_REFERENCE_DPX_UNSUPPORTED");
  });
});

describe("reference-match settings and files", () => {
  it("设置写入后可读回，恢复默认路径生效", async () => {
    const { service, cacheDirectory } = await setup();
    const initial = await service.getSettings();
    expect(initial.isDefault).toBe(true);
    const custom = path.join(cacheDirectory, "custom-out");
    const updated = await service.updateSettings({ outputDirectory: custom });
    expect(updated.outputDirectory).toBe(path.resolve(custom));
    expect(updated.isDefault).toBe(false);
    const restored = await service.updateSettings({ useDefault: true });
    expect(restored.outputDirectory).toBe(path.resolve(path.join(cacheDirectory, "exports")));
    expect(restored.isDefault).toBe(true);
  });

  it("导入 Resolve LUT 库写进 Reference LUT 子目录并拒绝重名", async () => {
    const { service, cacheDirectory, source, reference } = await setup();
    const libraryRoot = path.join(cacheDirectory, "resolve-lut");
    await service.updateSettings({ resolveLutDirectory: libraryRoot });
    const result = await service.create({
      sourcePath: source,
      referencePath: reference,
      controls: DEFAULT_LOOK_CONTROLS,
      previewSize: 256,
    });
    const imported = await service.importToLibrary({ lutPath: result.lutPath, name: "look-a" });
    expect(imported.path).toBe(path.join(path.resolve(libraryRoot), "Reference LUT", "look-a.cube"));
    await expect(
      service.importToLibrary({ lutPath: result.lutPath, name: "look-a" }),
    ).rejects.toThrow("REFERENCE_MATCH_LIBRARY_EXISTS");
  });

  it("清理缓存会删掉生成的 cube 与预览图", async () => {
    const { service, cacheDirectory, source, reference } = await setup();
    const result = await service.create({
      sourcePath: source,
      referencePath: reference,
      controls: DEFAULT_LOOK_CONTROLS,
      previewSize: 256,
    });
    expect(await stat(result.lutPath).then((info) => info.isFile(), () => false)).toBe(true);
    const cleared = await service.clearCache();
    expect(cleared.removed).toBeGreaterThan(0);
    expect(await stat(result.lutPath).then((info) => info.isFile(), () => false)).toBe(false);
    const remaining = await readdir(cacheDirectory);
    expect(remaining.some((entry) => entry.startsWith("match-") && entry.endsWith(".cube"))).toBe(false);
  });

  it("导出 PNG 会复制预览图", async () => {
    const { service, cacheDirectory, source, reference } = await setup();
    const result = await service.create({
      sourcePath: source,
      referencePath: reference,
      controls: DEFAULT_LOOK_CONTROLS,
      previewSize: 256,
    });
    const target = path.join(cacheDirectory, "png-out");
    await mkdir(target, { recursive: true });
    const saved = await service.exportPng({
      previewPath: result.previewPath,
      targetDirectory: target,
      baseName: "preview",
    });
    expect(saved.path).toBe(path.join(target, "preview.png"));
    expect(await stat(saved.path).then((info) => info.size, () => 0)).toBeGreaterThan(0);
  });
});
