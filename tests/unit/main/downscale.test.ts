import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  downscaleImage,
  planDownscale,
} from "../../../src/main/services/media/downscale";
import { packagedFfmpegPath } from "../../../src/main/services/media/ffmpeg-tools";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function withTemp(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "refcanvas-downscale-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function makeImage(directory: string, name: string): Promise<string> {
  const output = path.join(directory, name);
  await execFileAsync(
    packagedFfmpegPath(),
    [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=size=640x360:rate=1",
      "-frames:v", "1",
      output,
    ],
    { windowsHide: true },
  );
  return output;
}

describe("planDownscale（阶段 5 §10.4 Downscale naming）", () => {
  it("suffix 模式：文件名追加分辨率后缀", () => {
    const item = planDownscale("C:\\refs\\image.png", {
      maxDimension: 2048,
      mode: "suffix",
      suffix: "2k",
    });
    expect(item.outputPath).toBe("C:\\refs\\image_2k.png");
    expect(item.backupPath).toBeNull();
  });

  it("subdirectory 模式：输出到分辨率子目录", () => {
    const item = planDownscale("C:\\refs\\image.png", {
      maxDimension: 1024,
      mode: "subdirectory",
      subdirectory: "downscaled",
    });
    expect(item.outputPath).toBe("C:\\refs\\downscaled\\image.png");
  });

  it("backup 模式：备份原文件，输出覆盖原路径", () => {
    const item = planDownscale("C:\\refs\\image.png", {
      maxDimension: 1024,
      mode: "backup",
    });
    expect(item.outputPath).toBe("C:\\refs\\image.png");
    expect(item.backupPath).toBe("C:\\refs\\image.bak.png");
  });
});

describe("downscaleImage（阶段 5 §10.4）", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("suffix 模式实际缩小图片", async () => {
    const directory = await withTemp();
    const source = await makeImage(directory, "shot.png");
    const item = planDownscale(source, {
      maxDimension: 320,
      mode: "suffix",
      suffix: "2k",
    });
    const result = await downscaleImage(item, 320);
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    const entries = await readdir(directory);
    expect(entries).toContain("shot_2k.png");
  });

  it("backup 模式备份原文件并覆盖输出", async () => {
    const directory = await withTemp();
    const source = await makeImage(directory, "shot.png");
    const item = planDownscale(source, {
      maxDimension: 160,
      mode: "backup",
    });
    const result = await downscaleImage(item, 160);
    expect(result.width).toBe(160);
    expect(result.height).toBe(90);
    const entries = await readdir(directory);
    expect(entries).toContain("shot.bak.png");
  });

  it("subdirectory 模式自动创建子目录", async () => {
    const directory = await withTemp();
    const source = await makeImage(directory, "shot.jpg");
    const item = planDownscale(source, {
      maxDimension: 128,
      mode: "subdirectory",
      subdirectory: "lowres",
    });
    const result = await downscaleImage(item, 128);
    expect(result.width).toBe(128);
    expect(await readdir(path.join(directory, "lowres"))).toContain("shot.jpg");
  });
});
