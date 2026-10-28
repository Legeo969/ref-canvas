// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { readArchiveListing, extractArchiveEntry } from "../../../src/main/services/media/archive-listing";

/** 构造一个最小 ustar 头；size 用八进制写入 124..136。 */
function tarHeader(name: string, size: number, isDirectory: boolean): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 99), 0, "utf8");
  // mode/uid/gid 全部留 0 的八进制形式。
  header.write("0000644\0", 100, "latin1");
  header.write("0000000\0", 108, "latin1");
  header.write("0000000\0", 116, "latin1");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, "latin1");
  header.write(isDirectory ? "5" : "0", 156, "latin1");
  header.write("ustar\0", 257, "latin1");
  header.write("00", 263, "latin1");
  return header;
}

describe("readArchiveListing", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function writeFile2(name: string, data: Uint8Array): Promise<string> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-archive-"));
    const filename = path.join(scratch, name);
    await writeFile(filename, data);
    return filename;
  }

  it("lists zip entries with real compressed sizes", async () => {
    const big = new Uint8Array(4096).fill(65); // 高压缩比的重复内容
    const file = await writeFile2(
      "assets.zip",
      zipSync({
        "readme.txt": new TextEncoder().encode("hello"),
        "large.bin": big,
        "sub/nested.txt": new TextEncoder().encode("nested"),
      }),
    );
    const listing = await readArchiveListing(file);
    expect(listing.format).toBe("zip");
    const names = listing.entries.map((entry) => entry.path).sort();
    expect(names).toEqual(["large.bin", "readme.txt", "sub/nested.txt"]);
    const large = listing.entries.find((entry) => entry.path === "large.bin")!;
    expect(large.size).toBe(4096);
    // 重复内容应显著压缩。
    expect(large.compressedSize).toBeLessThan(4096);
    expect(listing.totalSize).toBeGreaterThan(listing.totalCompressedSize);
  });

  it("lists tar entries", async () => {
    const body = new TextEncoder().encode("abc");
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    Buffer.from(body).copy(padded);
    const tar = Buffer.concat([
      tarHeader("first.txt", body.length, false),
      padded,
      tarHeader("dir/", 0, true),
      Buffer.alloc(1024), // 两个全零块 = 结束
    ]);
    const file = await writeFile2("archive.tar", tar);
    const listing = await readArchiveListing(file);
    expect(listing.format).toBe("tar");
    expect(listing.entries.map((entry) => entry.path)).toContain("first.txt");
    const first = listing.entries.find((entry) => entry.path === "first.txt")!;
    expect(first.size).toBe(3);
  });

  it("lists a single-file gzip payload", async () => {
    const file = await writeFile2(
      "notes.txt.gz",
      gzipSync(new TextEncoder().encode("x".repeat(2048))),
    );
    const listing = await readArchiveListing(file);
    expect(listing.format).toBe("gzip");
    expect(listing.entries).toHaveLength(1);
    expect(listing.entries[0].path).toBe("notes.txt");
    expect(listing.entries[0].size).toBe(2048);
  });

  it("rejects a corrupted rar instead of pretending it is unsupported", async () => {
    const file = await writeFile2("archive.rar", new Uint8Array([1, 2, 3]));
    await expect(readArchiveListing(file)).rejects.toThrow(/ARCHIVE_INVALID:RAR/);
  });

  it("rejects unknown archive extensions explicitly", async () => {
    const file = await writeFile2("archive.cab", new Uint8Array([1, 2, 3]));
    await expect(readArchiveListing(file)).rejects.toThrow("ARCHIVE_FORMAT_UNSUPPORTED");
  });

  it("rejects a zip without an end-of-central-directory record", async () => {
    const file = await writeFile2("broken.zip", new Uint8Array(64));
    await expect(readArchiveListing(file)).rejects.toThrow("ARCHIVE_INVALID:NO_EOCD");
  });
});

describe("extractArchiveEntry", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function writeArchive(name: string, data: Uint8Array): Promise<string> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-archive-entry-"));
    const filename = path.join(scratch, name);
    await writeFile(filename, data);
    return filename;
  }

  it("extracts one zip entry byte-for-byte without touching the others", async () => {
    const nested = new TextEncoder().encode("{\"kind\":\"nested\"}");
    const file = await writeArchive(
      "assets.zip",
      zipSync({
        "readme.txt": new TextEncoder().encode("hello"),
        "sub/data.json": nested,
      }),
    );
    const extracted = await extractArchiveEntry(file, "sub/data.json");
    expect(Buffer.from(extracted.data).toString("utf8")).toBe("{\"kind\":\"nested\"}");
    expect(extracted.entry.path).toBe("sub/data.json");
    expect(extracted.entry.isDirectory).toBe(false);
  });

  it("extracts a tar entry using its data offset", async () => {
    const first = new TextEncoder().encode("aaa");
    const second = new TextEncoder().encode("second-payload");
    const firstPadded = Buffer.alloc(512);
    Buffer.from(first).copy(firstPadded);
    const secondPadded = Buffer.alloc(512);
    Buffer.from(second).copy(secondPadded);
    const tar = Buffer.concat([
      tarHeader("first.txt", first.length, false),
      firstPadded,
      tarHeader("second.txt", second.length, false),
      secondPadded,
      Buffer.alloc(1024),
    ]);
    const file = await writeArchive("archive.tar", tar);
    const extracted = await extractArchiveEntry(file, "second.txt");
    expect(Buffer.from(extracted.data).toString("utf8")).toBe("second-payload");
  });

  it("returns the whole payload for single-file gzip", async () => {
    const file = await writeArchive(
      "notes.txt.gz",
      gzipSync(new TextEncoder().encode("gzip payload")),
    );
    const extracted = await extractArchiveEntry(file, "notes.txt");
    expect(Buffer.from(extracted.data).toString("utf8")).toBe("gzip payload");
  });

  it("reports a missing entry explicitly", async () => {
    const file = await writeArchive(
      "assets.zip",
      zipSync({ "readme.txt": new TextEncoder().encode("hello") }),
    );
    await expect(extractArchiveEntry(file, "absent.txt")).rejects.toThrow(
      "ARCHIVE_ENTRY_NOT_FOUND",
    );
  });

  /**
   * zip64 扩展字段只含「被扩展的那些字段」。旧实现按固定三个字段读，
   * 当只有 localOffset 是 0xFFFFFFFF 时，偏移被当成未压缩大小，
   * 结果是 size 变 0、取不到数据。真实 9.6GB 包就是这种布局。
   */
  it("reads a zip64 extra field that only extends localOffset", async () => {
    const body = Buffer.from("hello", "utf8");
    const name = Buffer.from("hello.txt", "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = stored
    local.writeUInt16LE(0, 12); // dos time
    local.writeUInt16LE(0, 14); // dos date
    local.writeUInt32LE(0, 16); // crc (unchecked)
    local.writeUInt32LE(body.length, 20);
    local.writeUInt32LE(body.length, 24);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const extra = Buffer.alloc(12);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(0n, 4); // 真实本地头偏移

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(0xffffffff, 42); // localOffset 需 zip64

    const archive = Buffer.concat([local, name, body, central, name, extra]);
    const cdOffset = local.length + name.length + body.length;
    const cdSize = central.length + name.length + extra.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);

    const file = await writeArchive("zip64.zip", Buffer.concat([archive, eocd]));
    const listing = await readArchiveListing(file);
    expect(listing.entries).toHaveLength(1);
    expect(listing.entries[0].size).toBe(5);
    expect(listing.totalSize).toBe(5);

    const extracted = await extractArchiveEntry(file, "hello.txt");
    expect(Buffer.from(extracted.data).toString("utf8")).toBe("hello");
  });
});
