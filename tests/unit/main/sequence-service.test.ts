import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectSequencesInDirectory } from "../../../src/main/services/media/sequence-service";

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

async function writeFiles(
  directory: string,
  names: string[],
  mtimeMs: number[] = [],
): Promise<void> {
  const root = path.resolve(directory);
  for (let index = 0; index < names.length; index += 1) {
    // 测试 fixture 文件名是固定常量列表；仍做根目录边界校验（纵深防御），
    // 任何越出临时目录的条目直接拒绝，避免写入仓库外位置。
    const filename = path.resolve(root, names[index]);
    if (filename !== root && !filename.startsWith(root + path.sep)) {
      throw new Error("FIXTURE_OUT_OF_DIRECTORY");
    }
    await writeFile(filename, Buffer.alloc(16, index));
    if (mtimeMs[index] != null) {
      await utimes(filename, mtimeMs[index] / 1000, mtimeMs[index] / 1000);
    }
  }
}

describe("sequence directory service", () => {
  it("detects a standard sequence in a real directory", async () => {
    const directory = await tempDirectory("refcanvas-seq-dir-");
    await writeFiles(directory, [
      "render.0001.png",
      "render.0002.png",
      "render.0003.png",
      "notes.txt",
      "single.0001.png",
    ]);
    const sequences = await detectSequencesInDirectory(directory);
    expect(sequences).toHaveLength(1);
    expect(sequences[0].baseName).toBe("render");
    expect(sequences[0].start).toBe(1);
    expect(sequences[0].end).toBe(3);
    expect(sequences[0].fps).toBe(24);
  });

  it("infers fps from mtime gaps when files are evenly spaced", async () => {
    const directory = await tempDirectory("refcanvas-seq-fps-");
    const start = Date.now() - 10_000;
    await writeFiles(
      directory,
      ["anim.0001.png", "anim.0002.png", "anim.0003.png", "anim.0004.png"],
      [start, start + 33.3, start + 66.6, start + 100],
    );
    const sequences = await detectSequencesInDirectory(directory);
    expect(sequences[0].fps).toBe(30);
  });

  it("reports missing frames from a real directory", async () => {
    const directory = await tempDirectory("refcanvas-seq-missing-");
    await writeFiles(directory, [
      "shot.0001.png",
      "shot.0002.png",
      "shot.0004.png",
    ]);
    const sequences = await detectSequencesInDirectory(directory);
    expect(sequences[0].missingFrames).toEqual([3]);
  });

  it("supports custom patterns for unconventional naming", async () => {
    const directory = await tempDirectory("refcanvas-seq-custom-");
    await writeFiles(directory, [
      "plate_A0001.dpx",
      "plate_A0002.dpx",
      "plate_A0003.dpx",
    ]);
    const sequences = await detectSequencesInDirectory(directory, {
      customPatterns: ["^plate_([A-Z])(\\d{4})\\.dpx$"],
    });
    expect(sequences).toHaveLength(1);
    expect(sequences[0].pattern).toBe("custom");
    expect(sequences[0].start).toBe(1);
    expect(sequences[0].end).toBe(3);
  });
});
