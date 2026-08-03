import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isValidPreviewToken, PreviewTokenRegistry } from "../../../src/main/platform/refbrowse";

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

describe("isValidPreviewToken", () => {
  it("accepts uuid-shaped tokens only", () => {
    expect(isValidPreviewToken("12345678-1234-1234-1234-123456789abc")).toBe(
      true,
    );
    expect(isValidPreviewToken("C:\\Windows\\system32\\cmd.exe")).toBe(false);
    expect(isValidPreviewToken("../../etc/passwd")).toBe(false);
    expect(isValidPreviewToken("")).toBe(false);
    expect(isValidPreviewToken("garbage-token")).toBe(false);
  });
});

describe("PreviewTokenRegistry", () => {
  it("signs and resolves an absolute path, reusing the token", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const file = path.join(root, "shot.png");
    await writeFile(file, Buffer.alloc(32, 1));
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(file);
    expect(token).toBe(registry.tokenFor(file));

    const resolved = await registry.resolve(token, {
      realpath: async (filename) => path.resolve(filename),
      stat: async (filename) =>
        filename === file ? { isFile: true } : null,
    });
    expect(resolved).toBe(path.resolve(file));
  });

  it("rejects expired tokens after clear()", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "x");
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(file);
    expect(await registry.resolve(token, {
      realpath: async (filename) => path.resolve(filename),
      stat: async () => ({ isFile: true }),
    })).toBe(path.resolve(file));
    registry.clear();
    expect(await registry.resolve(token, {
      realpath: async (filename) => path.resolve(filename),
      stat: async () => ({ isFile: true }),
    })).toBeNull();
  });

  it("rejects malformed tokens without a lookup", async () => {
    const registry = new PreviewTokenRegistry();
    expect(
      await registry.resolve("../escape", {
        realpath: async (filename) => path.resolve(filename),
        stat: async () => ({ isFile: true }),
      }),
    ).toBeNull();
  });

  it("rejects directory targets (only regular files are servable)", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(root);
    const resolved = await registry.resolve(token, {
      realpath: async (filename) => path.resolve(filename),
      stat: async () => ({ isFile: false }),
    });
    expect(resolved).toBeNull();
  });

  it("resolves symlink targets that stay inside the allowed directory", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const real = path.join(root, "real.png");
    await writeFile(real, Buffer.alloc(16));
    const link = path.join(root, "alias.png");
    try {
      await symlink(real, link);
    } catch {
      // Windows 无权限创建符号链接时跳过该断言。
      return;
    }
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(link);
    const resolved = await registry.resolve(token, {
      realpath: async (filename) => {
        const realPath = await import("node:fs/promises").then((fs) =>
          fs.realpath(filename).catch(() => null),
        );
        return realPath;
      },
      stat: async (filename) =>
        path.resolve(filename) === path.resolve(real)
          ? { isFile: true }
          : null,
    });
    expect(resolved).toBe(path.resolve(real));
  });

  it("rejects symlink targets that escape the allowed directory", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const outside = await tempDirectory("refcanvas-refbrowse-outside-");
    const link = path.join(root, "escape.png");
    const real = path.join(outside, "real.png");
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(link);

    const resolved = await registry.resolve(token, {
      realpath: async (filename) =>
        path.resolve(filename) === path.resolve(link)
          ? path.resolve(real)
          : path.resolve(filename),
      stat: async () => ({ isFile: true }),
    });

    expect(resolved).toBeNull();
  });

  it("serves model dependencies inside the signed file directory", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const model = path.join(root, "scene.gltf");
    const texture = path.join(root, "textures", "color.png");
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(model);
    const resolved = await registry.resolveRelative(
      token,
      path.join("textures", "color.png"),
      {
        realpath: async (filename) => path.resolve(filename),
        stat: async (filename) =>
          path.resolve(filename) === path.resolve(texture)
            ? { isFile: true }
            : null,
      },
    );
    expect(resolved).toBe(path.resolve(texture));
  });

  it("rejects model dependencies outside the signed directory", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const model = path.join(root, "scene.gltf");
    const registry = new PreviewTokenRegistry();
    const token = registry.tokenFor(model);
    await expect(
      registry.resolveRelative(token, path.join("..", "secret.bin"), {
        realpath: async (filename) => path.resolve(filename),
        stat: async () => ({ isFile: true }),
      }),
    ).resolves.toBeNull();
  });

  it("drops the oldest token when the cap is reached", async () => {
    const root = await tempDirectory("refcanvas-refbrowse-");
    const registry = new PreviewTokenRegistry(2);
    const first = path.join(root, "1.txt");
    const second = path.join(root, "2.txt");
    const third = path.join(root, "3.txt");
    const token1 = registry.tokenFor(first);
    registry.tokenFor(second);
    const token3 = registry.tokenFor(third);
    expect(registry.size()).toBe(2);
    expect(
      await registry.resolve(token1, {
        realpath: async (filename) => path.resolve(filename),
        stat: async () => ({ isFile: true }),
      }),
    ).toBeNull();
    expect(
      await registry.resolve(token3, {
        realpath: async (filename) => path.resolve(filename),
        stat: async () => ({ isFile: true }),
      }),
    ).toBe(path.resolve(third));
  });
});
