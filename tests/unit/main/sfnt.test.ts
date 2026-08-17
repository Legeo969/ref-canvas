import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFontBuffer } from "../../../src/main/services/media/sfnt";

/**
 * 阶段 4：SFNT 字体解析。
 * 用系统字体（Windows 必带 Segoe UI / Arial）验证 TTF/OTF 解析；
 * 用合成 WOFF2（Node 内置 brotli 构造真实 WOFF2 字节流）验证解包。
 */

function systemFont(candidates: string[]): string | null {
  const roots = [
    "C:\\Windows\\Fonts",
    "/usr/share/fonts/truetype",
    "/System/Library/Fonts",
  ];
  for (const root of roots) {
    for (const candidate of candidates) {
      const full = path.join(root, candidate);
      try {
        statSync(full);
        return full;
      } catch {
        // 继续
      }
    }
  }
  return null;
}

describe("parseFontBuffer（阶段 4：SFNT）", () => {
  it("拒绝非字体文件", () => {
    const result = parseFontBuffer(Buffer.from("RIFF....WAVE", "latin1"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("NOT_SFNT");
  });

  it("拒绝截断文件", () => {
    const result = parseFontBuffer(Buffer.from("OTTO", "latin1"));
    expect(result.valid).toBe(false);
  });

  it("解析 Windows 系统 TrueType 字体（TTF）", async () => {
    const font = systemFont(["segoeui.ttf", "arial.ttf"]);
    if (!font) return; // 非 Windows 环境跳过
    const data = await readFile(font);
    const result = parseFontBuffer(data);
    expect(result.valid).toBe(true);
    expect(result.flavor).toBe("\u0000\u0001\u0000\u0000");
    expect(result.family).toBeTruthy();
    expect(result.glyphCount).toBeGreaterThan(0);
    expect(result.unitsPerEm).toBeGreaterThan(0);
  });

  it("解析 Windows 系统 OpenType 字体（OTF/CFF）", async () => {
    const font = systemFont(["segoeprb.ttf", "courbd.ttf", "arialbd.ttf"]);
    if (!font) return;
    const data = await readFile(font);
    const result = parseFontBuffer(data);
    expect(result.valid).toBe(true);
    expect(result.weightClass).toBeGreaterThan(0);
  });

  it("解析合成 WOFF2（brotli 真实字节流）", async () => {
    const font = systemFont(["segoeui.ttf", "arial.ttf"]);
    if (!font) return;
    const data = await readFile(font);
    // 提取 name 表（known tag index 5）和 maxp（index 4），构造 WOFF2：
    // header(48) + 2 个 entry（flags 0，known tag，无长度变换）+ brotli 数据。
    const sfntTables = readSfntTableMap(data);
    const nameTable = sfntTables.get("name");
    const maxpTable = sfntTables.get("maxp");
    expect(nameTable).toBeTruthy();
    expect(maxpTable).toBeTruthy();

    const { brotliCompressSync } = await import("node:zlib");
    const payload = Buffer.concat([nameTable!, maxpTable!]);
    const compressed = brotliCompressSync(payload);
    // 255UInt16 变长编码（WOFF2 spec）。
    const encode255 = (value: number): Buffer => {
      if (value < 253) return Buffer.from([value]);
      if (value <= 253 + 255) return Buffer.from([253, value - 253]);
      const low = value - 253;
      return Buffer.from([254, (low >> 8) & 0xff, low & 0xff]);
    };
    // entry = flag（known tag，低 6 位 index）+ 原长度 + flags2（无变换）。
    const entry1 = Buffer.concat([Buffer.from([5]), encode255(nameTable!.length), Buffer.from([0])]);
    const entry2 = Buffer.concat([Buffer.from([4]), encode255(maxpTable!.length), Buffer.from([0])]);
    const directory = Buffer.concat([entry1, entry2]);
    const header = Buffer.alloc(48);
    header.write("wOF2", 0, "latin1");
    data.copy(header, 4, 0, 4); // flavor
    header.writeUInt32BE(48 + directory.length + compressed.length, 8); // length
    header.writeUInt16BE(2, 12); // numTables
    header.writeUInt16BE(1, 14); // version
    header.writeUInt32BE(12 + 2 * 16 + payload.length, 16); // totalSfntSize
    header.writeUInt16BE(compressed.length, 18); // totalCompressedSize
    const woff2 = Buffer.concat([header, directory, compressed]);

    const result = parseFontBuffer(woff2);
    expect(result.valid).toBe(true);
    expect(result.family).toBeTruthy();
    expect(result.glyphCount).toBeGreaterThan(0);
    expect(result.flavor).toBe("\u0000\u0001\u0000\u0000");
  });
});

function readSfntTableMap(data: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  if (data.length < 12) return tables;
  const numTables = data.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (record + 16 > data.length) break;
    const tag = data.toString("latin1", record, record + 4);
    const offset = data.readUInt32BE(record + 8);
    const length = data.readUInt32BE(record + 12);
    if (offset + length <= data.length) {
      tables.set(tag, data.subarray(offset, offset + length));
    }
  }
  return tables;
}
