import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ZipArchiveService } from "../../../src/main/services/zip-archive-service";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) throw new Error(`cleanup failed: ${directory}`);
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeDirectory));
});

function hasUnzip(): boolean {
  return spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;
}

describe("ZipArchiveService (FND-007 §8.2)", () => {
  it("archives files and nested directories, readable by standard unzip", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-zip-"));
    temporaryDirectories.push(directory);
    const src = path.join(directory, "src");
    await mkdir(path.join(src, "sub"), { recursive: true });
    await writeFile(path.join(src, "a.txt"), Buffer.from("alpha", "utf8"));
    await writeFile(path.join(src, "sub", "b.bin"), Buffer.alloc(128, 7));

    const service = new ZipArchiveService();
    const target = path.join(directory, "out");
    await mkdir(target, { recursive: true });
    const snapshot = await service.archive([src], {
      jobId: "zip-1",
      targetDirectory: target,
      baseName: "archive",
    });
    expect(snapshot.state).toBe("completed");
    expect(snapshot.archivePath).toBe(path.join(target, "archive.zip"));
    expect(snapshot.failed).toHaveLength(0);

    if (hasUnzip()) {
      await execFileAsync("unzip", ["-t", snapshot.archivePath!]);
      const extracted = path.join(directory, "extracted");
      await mkdir(extracted);
      await execFileAsync("unzip", ["-q", snapshot.archivePath!, "-d", extracted]);
      // 条目相对归档源目录存储：src/a.txt → a.txt。
      const extractedA = await readFile(path.join(extracted, "a.txt"), "utf8");
      expect(extractedA).toBe("alpha");
      const extractedB = await readFile(path.join(extracted, "sub", "b.bin"));
      expect(extractedB.equals(Buffer.alloc(128, 7))).toBe(true);
    }
  });

  it("skips symlink directories (loop protection) and records reasons", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-zip2-"));
    temporaryDirectories.push(directory);
    const src = path.join(directory, "src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "keep.txt"), "keep");
    try {
      await symlink(src, path.join(src, "loopdir"), "dir");
      await symlink(path.join(src, "keep.txt"), path.join(src, "link.txt"), "file");
    } catch {
      // 无符号链接权限的环境跳过该断言。
      return;
    }

    const service = new ZipArchiveService();
    const target = path.join(directory, "out");
    await mkdir(target, { recursive: true });
    const snapshot = await service.archive([src], {
      jobId: "zip-2",
      targetDirectory: target,
      baseName: "archive",
    });
    expect(snapshot.state).toBe("completed");
    expect(snapshot.skipped.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.skipped.some((entry) => entry.reason === "symlink-directory")).toBe(true);
    // 保留真实文件。
    if (hasUnzip()) {
      await execFileAsync("unzip", ["-t", snapshot.archivePath!]);
    }
  });

  it("never overwrites an existing target and uses numbered conflicts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-zip3-"));
    temporaryDirectories.push(directory);
    const src = path.join(directory, "src");
    await mkdir(src);
    await writeFile(path.join(src, "x.txt"), "x");
    const target = path.join(directory, "out");
    await mkdir(target);
    const service = new ZipArchiveService();
    await service.archive([src], { jobId: "a", targetDirectory: target, baseName: "archive" });
    const before = await readFile(path.join(target, "archive.zip"));
    const second = await service.archive([src], { jobId: "b", targetDirectory: target, baseName: "archive" });
    expect(second.archivePath).toBe(path.join(target, "archive (2).zip"));
    expect((await stat(second.archivePath!)).size).toBeGreaterThan(0);
    const after = await readFile(path.join(target, "archive.zip"));
    expect(after.equals(before)).toBe(true);
  });

  it("cancels a large archive, cleans temp files and leaves no target", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-zip4-"));
    temporaryDirectories.push(directory);
    const src = path.join(directory, "src");
    await mkdir(src);
    for (let index = 0; index < 24; index += 1) {
      await writeFile(path.join(src, `f${index}.bin`), Buffer.alloc(4 * 1024 * 1024, index));
    }
    const target = path.join(directory, "out");
    await mkdir(target);
    const service = new ZipArchiveService();
    const jobId = "zip-cancel";
    const promise = service.archive([src], { jobId, targetDirectory: target, baseName: "archive" });
    // 轮询直至取消被接受。
    let cancelled = false;
    for (let attempt = 0; attempt < 300 && !cancelled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      cancelled = service.cancel(jobId);
    }
    expect(cancelled).toBe(true);
    const snapshot = await promise;
    expect(snapshot.state).toBe("cancelled");
    expect(snapshot.archivePath).toBeNull();
    // 临时文件不残留。
    const leftovers = await readdir(target);
    expect(leftovers.filter((name) => name.includes(".zip.tmp") || name.endsWith(".zip"))).toHaveLength(0);
  });
});
