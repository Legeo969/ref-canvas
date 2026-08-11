import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAbsoluteLocalPath,
  canonicalizeLocalPath,
  driveForLocalPath,
} from "../../../src/main/platform/local-path-security";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("local path security", () => {
  it("rejects URLs, UNC/device paths and relative paths", () => {
    for (const candidate of [
      "https://example.com/file.png",
      "relative/file.png",
      "\\\\server\\share\\file.png",
      "\\\\?\\C:\\secret.txt",
      "\\\\.\\C:\\secret.txt",
      "C:\\safe.txt:payload",
      "C:\\NUL.txt",
    ]) {
      expect(() => assertAbsoluteLocalPath(candidate)).toThrow("INVALID_LOCAL_PATH");
    }
  });

  it("normalizes local drive paths and drive identity case-insensitively", () => {
    expect(assertAbsoluteLocalPath("c:\\Folder\\..\\File.txt")).toBe("c:\\File.txt");
    expect(driveForLocalPath("c:\\File.txt")).toBe("C:");
  });

  it("canonicalizes a missing destination through its nearest existing parent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-path-"));
    temporaryDirectories.push(root);
    const expected = path.join(root, "missing", "nested", "result.zip");
    await expect(canonicalizeLocalPath(expected, "destination")).resolves.toBe(expected);
  });

  it("resolves an existing symlink before authorization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-link-"));
    temporaryDirectories.push(root);
    const realDirectory = path.join(root, "real");
    const linkDirectory = path.join(root, "link");
    await mkdir(realDirectory);
    const target = path.join(realDirectory, "target.txt");
    await writeFile(target, "ok");
    await symlink(realDirectory, linkDirectory, process.platform === "win32" ? "junction" : "dir");
    await expect(canonicalizeLocalPath(path.join(linkDirectory, "target.txt"), "existing"))
      .resolves.toBe(target);
  });
});
