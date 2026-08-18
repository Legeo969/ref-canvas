import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fsyncFile, writeFileDurable } from "../../../src/main/platform/fsync";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

describe("SPEC-6 fsync utilities", () => {
  it("fsyncFile writes and syncs an existing file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fsync-file-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "data.bin");
    await writeFile(filename, Buffer.from("hello"));
    // 不应抛错（文件已存在）。
    await expect(fsyncFile(filename)).resolves.toBeUndefined();
  });

  it("writeFileDurable atomically writes, syncs, renames and creates parent dirs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fsync-durable-"));
    temporaryDirectories.push(directory);
    const nested = path.join(directory, "sub", "nested");
    const filename = path.join(nested, "manifest.json");
    await writeFileDurable(filename, JSON.stringify({ ok: true }), {
      encoding: "utf8",
    });
    const { readFile } = await import("node:fs/promises");
    const content = JSON.parse(await readFile(filename, "utf8")) as {
      ok: boolean;
    };
    expect(content.ok).toBe(true);
    // 无残留 tmp 文件。
    const { readdir } = await import("node:fs/promises");
    const leftovers = (await readdir(nested)).filter((name) =>
      name.endsWith(".tmp"),
    );
    expect(leftovers).toHaveLength(0);
  });
});
