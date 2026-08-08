import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealInFileManager } from "../../../src/main/platform/reveal-in-file-manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-reveal-"));
  temporaryDirectories.push(root);
  const directory = path.join(root, "frames");
  const file = path.join(directory, "shot.0001.exr");
  await mkdir(directory);
  await writeFile(file, "frame");
  const shell = {
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
  };
  return { directory, file, root, shell };
}

describe("revealInFileManager", () => {
  it("selects an existing file in its folder", async () => {
    const { file, shell } = await createFixture();

    await revealInFileManager(file, shell);

    expect(shell.showItemInFolder).toHaveBeenCalledWith(path.resolve(file));
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("opens an existing directory", async () => {
    const { directory, shell } = await createFixture();

    await revealInFileManager(directory, shell);

    expect(shell.openPath).toHaveBeenCalledWith(path.resolve(directory));
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("opens the parent when the target no longer exists", async () => {
    const { directory, shell } = await createFixture();
    const missingFile = path.join(directory, "missing.exr");

    await revealInFileManager(missingFile, shell);

    expect(shell.openPath).toHaveBeenCalledWith(path.resolve(directory));
  });

  it("rejects a path whose parent also does not exist", async () => {
    const { root, shell } = await createFixture();

    await expect(
      revealInFileManager(path.join(root, "missing", "missing.exr"), shell),
    ).rejects.toThrow("PATH_NOT_FOUND");
    expect(shell.openPath).not.toHaveBeenCalled();
  });
});
