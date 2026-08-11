import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WriteAccessController,
  type WriteGrantPrompt,
} from "../../../src/main/platform/write-access-controller";

const temporaryDirectories: string[] = [];
const window = {} as Electron.BrowserWindow;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-grant-"));
  temporaryDirectories.push(root);
  const filename = path.join(root, "asset.txt");
  await writeFile(filename, "asset");
  return filename;
}

describe("WriteAccessController", () => {
  it("denies before mutation and reuses an approved drive for the session", async () => {
    const filename = await fixture();
    const deny = vi.fn(async () => false);
    const denied = new WriteAccessController(() => [], deny);
    await expect(denied.authorize(window, "trash", [{ path: filename, mode: "existing" }]))
      .rejects.toThrow("WRITE_ACCESS_DENIED");

    const approve = vi.fn(async () => true);
    const controller = new WriteAccessController(() => [], approve);
    await controller.authorize(window, "trash", [{ path: filename, mode: "existing" }]);
    await controller.authorize(window, "rename", [{ path: filename, mode: "existing" }]);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent prompts for the same drive", async () => {
    const filename = await fixture();
    let resolve!: (allowed: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const controller = new WriteAccessController(() => [], prompt);
    const first = controller.authorize(window, "copy", [{ path: filename, mode: "destination" }]);
    const second = controller.authorize(window, "archive", [{ path: filename, mode: "destination" }]);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    resolve(true);
    await Promise.all([first, second]);
  });

  it("implicitly authorizes RefCanvas-owned roots", async () => {
    const filename = await fixture();
    const prompt = vi.fn(async () => false);
    const controller = new WriteAccessController(() => [path.dirname(filename)], prompt);
    await expect(controller.authorize(window, "export", [{ path: filename, mode: "destination" }]))
      .resolves.toEqual([filename]);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("requires both lexical and resolved drives for a cross-drive junction", async () => {
    if (process.platform !== "win32") return;
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-cross-drive-"));
    temporaryDirectories.push(root);
    if (path.parse(root).root.toLowerCase() === path.parse(process.cwd()).root.toLowerCase()) return;
    const junction = path.join(root, "workspace-link");
    try {
      await symlink(process.cwd(), junction, "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const prompt = vi.fn(async (_request: WriteGrantPrompt) => true);
    const controller = new WriteAccessController(() => [], prompt);
    await controller.authorize(window, "trash", [
      { path: path.join(junction, "package.json"), mode: "existing" },
    ]);
    expect(prompt.mock.calls.map(([request]) => request.drive).sort()).toEqual([
      path.parse(root).root.slice(0, 2).toUpperCase(),
      path.parse(process.cwd()).root.slice(0, 2).toUpperCase(),
    ].sort());
  });
});
