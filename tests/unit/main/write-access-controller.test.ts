import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
  it("does not prompt for direct local file-management operations", async () => {
    const filename = await fixture();
    const prompt = vi.fn(async () => false);
    const controller = new WriteAccessController(() => [], prompt);
    for (const operation of ["trash", "rename", "copy", "move"] as const) {
      await expect(controller.authorize(window, operation, [
        { path: filename, mode: "existing" },
      ])).resolves.toEqual([filename]);
    }
    expect(prompt).not.toHaveBeenCalled();
  });

  it("rejects untrusted renderer paths without prompting by default", async () => {
    const filename = await fixture();
    const controller = new WriteAccessController(() => []);

    await expect(controller.authorize(window, "export", [
      { path: filename, mode: "destination" },
    ])).rejects.toThrow("WRITE_ACCESS_DENIED");
  });

  it("reuses a capability created by the native picker", async () => {
    const filename = await fixture();
    const sibling = path.join(path.dirname(filename), "sibling.txt");
    await writeFile(sibling, "sibling");
    const controller = new WriteAccessController(() => []);

    await controller.authorizePickerSelection([
      { path: filename, mode: "destination" },
    ]);
    await expect(controller.authorize(window, "export", [
      { path: sibling, mode: "destination" },
    ])).resolves.toEqual([sibling]);
  });

  it("does not widen one directory approval to the whole drive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "refcanvas-scope-"));
    temporaryDirectories.push(root);
    const firstDirectory = path.join(root, "first");
    const secondDirectory = path.join(root, "second");
    await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
    const first = path.join(firstDirectory, "first.txt");
    const sibling = path.join(firstDirectory, "sibling.txt");
    const second = path.join(secondDirectory, "second.txt");
    await Promise.all([
      writeFile(first, "first"),
      writeFile(sibling, "sibling"),
      writeFile(second, "second"),
    ]);
    const prompt = vi.fn(async (_request: WriteGrantPrompt) => true);
    const controller = new WriteAccessController(() => [], prompt);

    await controller.authorize(window, "export", [{ path: first, mode: "destination" }]);
    await controller.authorize(window, "export", [{ path: sibling, mode: "destination" }]);
    await controller.authorize(window, "export", [{ path: second, mode: "destination" }]);

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls.map(([request]) => request.scopePath)).toEqual([
      firstDirectory,
      secondDirectory,
    ]);
  });

  it("deduplicates concurrent prompts for the same directory", async () => {
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

  it("requires both lexical and resolved scopes for a cross-drive junction", async () => {
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
    await controller.authorize(window, "execute", [
      { path: path.join(junction, "package.json"), mode: "existing" },
    ]);
    expect(prompt.mock.calls.map(([request]) => request.drive).sort()).toEqual([
      path.parse(root).root.slice(0, 2).toUpperCase(),
      path.parse(process.cwd()).root.slice(0, 2).toUpperCase(),
    ].sort());
    expect(prompt.mock.calls.map(([request]) => request.scopePath)).toHaveLength(2);
  });
});
