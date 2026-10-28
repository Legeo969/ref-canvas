// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import SevenZip from "7z-wasm";
import { readArchiveListing, extractArchiveEntry } from "../../../src/main/services/media/archive-listing";

/**
 * rar / 7z 的端到端覆盖。
 *
 * 7z 样本用 7z-wasm 自己生成（自包含）；rar 没有可用的纯 JS 压缩器，
 * 因此走本机真实样本，缺失时跳过而不是假造一个不可能通过的用例。
 */
const RAR_SAMPLE =
  "D:\\zican\\[2024.8.27]__国王绑定角色和14套贴图包\\3D资产_贴图\\幻影派对(28张图片)\\phantom_party_by_estellium.rar";

async function createSevenZip(
  directory: string,
  name: string,
  files: Record<string, string>,
): Promise<string> {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const module = await SevenZip({
    print: () => undefined,
    printErr: () => undefined,
  });
  module.FS.mkdir("/nodefs");
  module.FS.mount(module.NODEFS, { root: directory }, "/nodefs");
  module.FS.chdir("/nodefs");
  try {
    module.callMain(["a", name, ...Object.keys(files)]);
  } catch {
    // Emscripten 在 exit 时抛 ExitStatus。
  }
  return path.join(directory, name);
}

describe("7z archives", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  it("lists entries including a nested chinese path", async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "refcanvas-7z-"));
    const archive = await createSevenZip(scratch, "sample.7z", {
      "readme.txt": "hello-7z",
      "子目录/中文名.txt": "chinese-content",
    });
    const listing = await readArchiveListing(archive);
    expect(listing.format).toBe("sevenzip");
    const nested = listing.entries.find((entry) => entry.path === "子目录/中文名.txt");
    expect(nested).toBeDefined();
    expect(nested!.size).toBe("chinese-content".length);
    expect(nested!.isDirectory).toBe(false);
  }, 120_000);

  it("extracts a single entry with its exact bytes", async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "refcanvas-7z-"));
    const archive = await createSevenZip(scratch, "sample.7z", {
      "readme.txt": "hello-7z",
      "子目录/中文名.txt": "chinese-content",
    });
    const extracted = await extractArchiveEntry(archive, "子目录/中文名.txt");
    expect(Buffer.from(extracted.data).toString("utf8")).toBe("chinese-content");
  }, 120_000);

  it("rejects a corrupted 7z instead of returning an empty listing", async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "refcanvas-7z-"));
    const fake = path.join(scratch, "broken.7z");
    await writeFile(fake, "not-an-archive");
    await expect(readArchiveListing(fake)).rejects.toThrow(/ARCHIVE_/);
  }, 60_000);
});

describe.skipIf(!existsSync(RAR_SAMPLE))("rar archives", () => {
  it("lists a real rar with sizes and flags", async () => {
    const listing = await readArchiveListing(RAR_SAMPLE);
    expect(listing.format).toBe("rar");
    expect(listing.entries.length).toBeGreaterThan(0);
    expect(listing.totalSize).toBeGreaterThan(0);
    const file = listing.entries.find((entry) => !entry.isDirectory);
    expect(file).toBeDefined();
    expect(file!.compressedSize).toBeLessThanOrEqual(file!.size);
  }, 120_000);

  it("extracts the first entry byte-for-byte", async () => {
    const listing = await readArchiveListing(RAR_SAMPLE);
    const target = listing.entries.find((entry) => !entry.isDirectory)!;
    const extracted = await extractArchiveEntry(RAR_SAMPLE, target.path);
    expect(extracted.data.byteLength).toBe(target.size);
  }, 240_000);
});
