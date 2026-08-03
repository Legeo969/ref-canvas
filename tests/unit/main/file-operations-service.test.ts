import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileOperationsService } from "../../../src/main/services/file-operations-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-fop-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createService(root: string, trash = vi.fn(async () => undefined)) {
  return new FileOperationsService({
    allowedRoots: () => [root],
    trash,
  });
}

describe("createFolder", () => {
  it("creates a folder inside the allowed root", async () => {
    const root = await createTempDir();
    const service = createService(root);
    const created = await service.createFolder(root, "New Folder");
    expect(path.basename(created)).toBe("New Folder");
    expect((await stat(created)).isDirectory()).toBe(true);
  });

  it("appends a number on name conflict", async () => {
    const root = await createTempDir();
    await mkdir(path.join(root, "New Folder"));
    const service = createService(root);
    const created = await service.createFolder(root, "New Folder");
    expect(path.basename(created)).toBe("New Folder 2");
  });

  it("rejects invalid names", async () => {
    const root = await createTempDir();
    const service = createService(root);
    await expect(service.createFolder(root, "a/b")).rejects.toThrow(
      "INVALID_FOLDER_NAME",
    );
    await expect(service.createFolder(root, " ")).rejects.toThrow(
      "INVALID_FOLDER_NAME",
    );
  });

  it("rejects a target outside the allowed scope", async () => {
    const root = await createTempDir();
    const outside = await createTempDir();
    const service = createService(root);
    await expect(service.createFolder(outside, "x")).rejects.toThrow(
      "PATH_OUTSIDE_SCOPE",
    );
  });
});

describe("copy", () => {
  it("copies a file into the target directory", async () => {
    const root = await createTempDir();
    const source = path.join(root, "a.png");
    const target = path.join(root, "dest");
    await mkdir(target);
    await writeFile(source, "data");
    const service = createService(root);
    const report = await service.copy([source], target);
    expect(report.copied).toBe(1);
    expect((await stat(path.join(target, "a.png"))).isFile()).toBe(true);
  });

  it("copies a directory recursively", async () => {
    const root = await createTempDir();
    const source = path.join(root, "folder");
    const target = path.join(root, "dest");
    await mkdir(path.join(source, "sub"), { recursive: true });
    await writeFile(path.join(source, "sub", "x.txt"), "x");
    await mkdir(target);
    const service = createService(root);
    const report = await service.copy([source], target);
    expect(report.copied).toBe(1);
    expect((await stat(path.join(target, "folder", "sub", "x.txt"))).isFile()).toBe(
      true,
    );
  });

  it("skips existing targets under skip strategy", async () => {
    const root = await createTempDir();
    const source = path.join(root, "a.png");
    const target = path.join(root, "dest");
    await mkdir(target);
    await writeFile(source, "data");
    await writeFile(path.join(target, "a.png"), "existing");
    const service = createService(root);
    const report = await service.copy([source], target, {
      conflictAction: "skip",
    });
    expect(report.skipped).toBe(1);
  });

  it("renames existing targets under rename strategy", async () => {
    const root = await createTempDir();
    const source = path.join(root, "a.png");
    const target = path.join(root, "dest");
    await mkdir(target);
    await writeFile(source, "data");
    await writeFile(path.join(target, "a.png"), "existing");
    const service = createService(root);
    const report = await service.copy([source], target, {
      conflictAction: "rename",
    });
    // rename 策略创建带序号的新目标（仍计入 copied）。
    expect(report.copied).toBe(1);
    expect(report.targets[0]).toBe(path.join(target, "a (2).png"));
    expect((await stat(path.join(target, "a (2).png"))).isFile()).toBe(true);
    expect((await stat(path.join(target, "a.png"))).isFile()).toBe(true);
  });

  it("rejects copying a folder into its own descendant", async () => {
    const root = await createTempDir();
    const source = path.join(root, "folder");
    const inside = path.join(source, "inside");
    await mkdir(inside, { recursive: true });
    const service = createService(root);
    const report = await service.copy([source], inside);
    expect(report.failed[0].reason).toBe("TARGET_INSIDE_SOURCE");
  });
});

describe("move", () => {
  it("moves a file within the same volume by rename", async () => {
    const root = await createTempDir();
    const source = path.join(root, "a.png");
    const target = path.join(root, "dest");
    await mkdir(target);
    await writeFile(source, "data");
    const service = createService(root);
    const report = await service.move([source], target);
    expect(report.moved).toBe(1);
    expect((await stat(path.join(target, "a.png"))).isFile()).toBe(true);
    await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("trashes the source after a cross-volume move", async () => {
    const trash = vi.fn(async () => undefined);
    const rootA = await createTempDir();
    const rootB = await createTempDir();
    // 两个允许根（模拟两个卷）；rename 注入 EXDEV 强制走跨卷路径。
    const service = new FileOperationsService({
      allowedRoots: () => [rootA, rootB],
      trash,
      renameForTest: async () => {
        const error = new Error("EXDEV") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      },
    });
    const source = path.join(rootA, "a.png");
    await writeFile(source, "data");
    const report = await service.move([source], rootB);
    expect(report.moved).toBe(1);
    // 跨卷：copy + 校验 + trash 原文件。
    expect((await stat(path.join(rootB, "a.png"))).isFile()).toBe(true);
    expect(trash).toHaveBeenCalledWith(source);
  });

  it("rejects a source outside the allowed scope", async () => {
    const root = await createTempDir();
    const outside = await createTempDir();
    const outsideFile = path.join(outside, "x.txt");
    await writeFile(outsideFile, "x");
    const service = createService(root);
    const report = await service.move([outsideFile], root);
    expect(report.failed[0].reason).toBe("PATH_OUTSIDE_SCOPE");
  });
});
