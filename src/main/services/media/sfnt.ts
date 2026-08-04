import { brotliDecompressSync, inflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";

/**
 * SFNT 字体解析（阶段 4：专业格式 — 字体）。
 *
 * 支持 TTF/OTF/WOFF/WOFF2/TTC（取第一个字体），从 name/OS/2/head/
 * maxp/fvar 表提取 family、style、weight、italic、unitsPerEm、
 * glyph 数与可变轴。不依赖外部 native 库。
 *
 * WOFF2 仅解压无变换（transform 0）的表：glyf/loca/hmtx/gvar 的
 * 变换不影响 name/OS/2/head/maxp/fvar，因此这些表按序切出后即可解析。
 */

export interface FontVariableAxis {
  tag: string;
  name: string;
  minValue: number;
  defaultValue: number;
  maxValue: number;
}

export interface FontInfo {
  valid: boolean;
  error: string | null;
  /** TrueType / CFF（PostScript）/ OpenType。 */
  flavor: string | null;
  family: string | null;
  subfamily: string | null;
  postscriptName: string | null;
  weightClass: number | null;
  italic: boolean | null;
  unitsPerEm: number | null;
  glyphCount: number | null;
  variableAxes: FontVariableAxis[];
}

interface FontTable {
  tag: string;
  offset: number;
  length: number;
}

function readU16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16BE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function readFixed(buffer: Buffer, offset: number): number {
  return buffer.readInt32BE(offset) / 65536;
}

/** WOFF2 已知表标签索引（spec 附录，63 项）。 */
const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "EBSC", "BASE", "GDEF", "GPOS", "GSUB", "JSTF", "DSIG",
  "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx",
  "COLR", "CPAL", "CBDT", "CBLC", "SVG ", "fvar", "gvar", "avar",
  "HVAR", "VVAR", "MATH", "meta", "stat", "cff2", "COLRv1",
];

function read255UInt16(data: Buffer, offset: number): { value: number; bytes: number } {
  const first = data[offset];
  if (first == null) return { value: 0, bytes: 1 };
  if (first < 253) return { value: first, bytes: 1 };
  if (first === 253) return { value: 253 + data[offset + 1], bytes: 2 };
  if (first === 254) {
    return { value: 253 + 256 * data[offset + 1] + data[offset + 2], bytes: 3 };
  }
  return {
    value: 253 + 65536 * data[offset + 1] + 256 * data[offset + 2] + data[offset + 3],
    bytes: 4,
  };
}

interface Woff2TableEntry {
  tag: string;
  transformedLength: number;
}

/** 解析 WOFF2 表目录，返回按序的表定义。 */
function parseWoff2Directory(data: Buffer): Woff2TableEntry[] {
  const numTables = readU16(data, 12);
  const entries: Woff2TableEntry[] = [];
  let cursor = 48;
  let lastTagSuffix = 0;
  let lastTag = "";
  for (let i = 0; i < numTables; i += 1) {
    const flags = data[cursor];
    cursor += 1;
    const flagType = flags >> 6;
    let tag: string;
    if (flagType === 0) {
      const tagIndex = flags & 0x3f;
      if (tagIndex === 0x3f) {
        tag = data.toString("latin1", cursor, cursor + 4);
        cursor += 4;
      } else {
        tag = WOFF2_KNOWN_TAGS[tagIndex];
        if (!tag) throw new Error(`WOFF2_UNKNOWN_TAG_INDEX:${tagIndex}`);
      }
      lastTag = tag;
      lastTagSuffix = tag.charCodeAt(3);
    } else if (flagType === 1) {
      tag = data.toString("latin1", cursor, cursor + 4);
      cursor += 4;
      lastTag = tag;
      lastTagSuffix = tag.charCodeAt(3);
    } else if (flagType === 2) {
      // 无 tag：前表 tag 前 3 字节 + 末字节递增（最多 8 次）。
      if (!lastTag) throw new Error("WOFF2_ORPHAN_INCREMENTAL_TAG");
      lastTagSuffix += 1;
      tag = lastTag.slice(0, 3) + String.fromCharCode(lastTagSuffix);
      lastTag = tag;
    } else {
      tag = data.toString("latin1", cursor, cursor + 4);
      cursor += 4;
      lastTag = tag;
      lastTagSuffix = tag.charCodeAt(3);
    }
    const { value: origLength, bytes: l1 } = read255UInt16(data, cursor);
    cursor += l1;
    const flags2 = data[cursor];
    cursor += 1;
    let transformLength = origLength;
    if (flags2 & 0x80) {
      const lengthField = read255UInt16(data, cursor);
      transformLength = lengthField.value;
      cursor += lengthField.bytes;
    }
    entries.push({ tag, transformedLength: transformLength });
  }
  return entries;
}

/** 解包 WOFF2 → { flavor, tables, data }（解压后的表数据缓冲）。 */
function unpackWoff2(data: Buffer): { flavor: string; tables: FontTable[]; data: Buffer } {
  if (data.length < 48 || data.toString("latin1", 0, 4) !== "wOF2") {
    throw new Error("NOT_WOFF2");
  }
  const flavor = data.toString("latin1", 4, 8);
  const totalCompressedSize = readU16(data, 18);
  const entries = parseWoff2Directory(data);
  // 目录长度按实际游标计算：重新走一遍。
  const numTables = readU16(data, 12);
  let cursor = 48;
  for (let i = 0; i < numTables; i += 1) {
    const flags = data[cursor];
    cursor += 1;
    const flagType = flags >> 6;
    if ((flagType === 0 && (flags & 0x3f) === 0x3f) || flagType === 1 || flagType === 3) {
      cursor += 4;
    }
    const lengthField = read255UInt16(data, cursor);
    cursor += lengthField.bytes;
    const flags2 = data[cursor];
    cursor += 1;
    if (flags2 & 0x80) {
      const transformLength = read255UInt16(data, cursor);
      cursor += transformLength.bytes;
    }
  }
  const dataStart = cursor;
  let unpacked: Buffer;
  try {
    unpacked = brotliDecompressSync(data.subarray(dataStart, dataStart + totalCompressedSize));
  } catch (error) {
    throw new Error(`WOFF2_BROTLI_FAILED:${String(error).slice(0, 80)}`, {
      cause: error,
    });
  }
  const tables: FontTable[] = [];
  let dataCursor = 0;
  for (const entry of entries) {
    if (dataCursor + entry.transformedLength > unpacked.length) {
      throw new Error("WOFF2_TRUNCATED_TABLES");
    }
    tables.push({ tag: entry.tag, offset: dataCursor, length: entry.transformedLength });
    dataCursor += entry.transformedLength;
  }
  return { flavor, tables, data: unpacked };
}

/** 解包 WOFF1（zlib 压缩表）→ 逻辑 SFNT 字节串。 */
function unpackWoff1(data: Buffer): { flavor: string; sfnt: Buffer } {
  if (data.length < 44 || data.toString("latin1", 0, 4) !== "wOFF") {
    throw new Error("NOT_WOFF1");
  }
  const flavor = data.toString("latin1", 4, 8);
  const numTables = readU16(data, 12);
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < numTables; i += 1) {
    const record = 44 + i * 20;
    if (record + 20 > data.length) break;
    const tag = data.toString("latin1", record, record + 4);
    const offset = readU32(data, record + 4);
    const compLength = readU32(data, record + 8);
    const origLength = readU32(data, record + 12);
    const raw = data.subarray(offset, offset + compLength);
    if (compLength < origLength) {
      try {
        tables.set(tag, inflateSync(raw));
      } catch {
        throw new Error(`WOFF1_INFLATE_FAILED:${tag}`);
      }
    } else {
      tables.set(tag, Buffer.from(raw));
    }
  }
  return { flavor, sfnt: rebuildSfnt(tables) };
}

/** 把表集合重建为标准 SFNT 字节串。 */
function rebuildSfnt(tables: Map<string, Buffer>): Buffer {
  const entries = Array.from(tables.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const numTables = entries.length;
  const headerLength = 12 + numTables * 16;
  let dataOffset = headerLength;
  const layout: Array<{ offset: number }> = [];
  for (const [, table] of entries) {
    layout.push({ offset: dataOffset });
    dataOffset += (table.length + 3) & ~3;
  }
  const result = Buffer.alloc(dataOffset);
  result.write("\u0000\u0001\u0000\u0000", 0, "latin1");
  result.writeUInt16BE(numTables, 4);
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) {
    searchRange *= 2;
    entrySelector += 1;
  }
  searchRange *= 16;
  result.writeUInt16BE(searchRange, 6);
  result.writeUInt16BE(entrySelector, 8);
  result.writeUInt16BE(numTables * 16 - searchRange, 10);
  entries.forEach(([tag, table], index) => {
    const record = 12 + index * 16;
    result.write(tag, record, "latin1");
    result.writeUInt32BE(0, record + 4); // checksum 占位
    result.writeUInt32BE(layout[index].offset, record + 8);
    result.writeUInt32BE(table.length, record + 12);
    table.copy(result, layout[index].offset);
  });
  return result;
}

function readSfntTables(data: Buffer): FontTable[] {
  if (data.length < 12) return [];
  const numTables = readU16(data, 4);
  const tables: FontTable[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (record + 16 > data.length) break;
    tables.push({
      tag: data.toString("latin1", record, record + 4),
      offset: readU32(data, record + 8),
      length: readU32(data, record + 12),
    });
  }
  return tables;
}

/** 解析 name 表（优先 Windows Unicode，回退 Mac Roman）。 */
function parseNameTable(buffer: Buffer): Map<number, string> {
  const names = new Map<number, string>();
  if (buffer.length < 6) return names;
  const count = readU16(buffer, 2);
  const stringOffset = readU16(buffer, 4);
  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    if (record + 12 > buffer.length) break;
    const platformId = readU16(buffer, record);
    const encodingId = readU16(buffer, record + 2);
    const nameId = readU16(buffer, record + 6);
    const length = readU16(buffer, record + 8);
    const offset = readU16(buffer, record + 10);
    const start = stringOffset + offset;
    if (start + length > buffer.length) continue;
    const raw = buffer.subarray(start, start + length);
    let decoded: string | null = null;
    const stripNullSuffix = (value: string): string => {
      let end = value.length;
      while (end > 0 && value.charCodeAt(end - 1) === 0) end -= 1;
      return value.slice(0, end);
    };
    if (platformId === 3 && (encodingId === 1 || encodingId === 10)) {
      decoded = stripNullSuffix(raw.toString("utf16le"));
    } else if (platformId === 0) {
      decoded = stripNullSuffix(raw.toString("utf16le"));
    } else if (platformId === 1) {
      decoded = raw.toString("latin1");
    }
    if (decoded && !names.has(nameId)) {
      names.set(nameId, decoded);
    }
  }
  return names;
}

/** 解析 fvar 表 → 可变轴列表。 */
function parseFvarTable(buffer: Buffer, names: Map<number, string>): FontVariableAxis[] {
  const axes: FontVariableAxis[] = [];
  if (buffer.length < 16) return axes;
  const axisCount = readU16(buffer, 8);
  const axisSize = readU16(buffer, 10);
  const instanceSize = readU16(buffer, 12);
  const axisOffset = 16 + instanceSize * readU16(buffer, 14);
  for (let i = 0; i < axisCount; i += 1) {
    const record = axisOffset + i * axisSize;
    if (record + axisSize > buffer.length) break;
    const tag = buffer.toString("latin1", record, record + 4);
    const nameId = readU16(buffer, record + 4);
    axes.push({
      tag,
      name: names.get(nameId) ?? tag,
      minValue: readFixed(buffer, record + 6),
      defaultValue: readFixed(buffer, record + 10),
      maxValue: readFixed(buffer, record + 14),
    });
  }
  return axes;
}

function parseSfnt(data: Buffer, flavor: string, tables: FontTable[]): FontInfo {
  const byTag = new Map<string, Buffer>();
  for (const table of tables) {
    if (table.offset >= 0 && table.offset + table.length <= data.length && table.length > 0) {
      byTag.set(table.tag, data.subarray(table.offset, table.offset + table.length));
    }
  }
  const names = byTag.get("name")
    ? parseNameTable(byTag.get("name")!)
    : new Map<number, string>();
  const os2 = byTag.get("OS/2");
  const head = byTag.get("head");
  const maxp = byTag.get("maxp");
  const fvar = byTag.get("fvar");
  let weightClass: number | null = null;
  let italic: boolean | null = null;
  if (os2 && os2.length >= 64) {
    weightClass = readU16(os2, 4);
    italic = (readU16(os2, 62) & 0x01) !== 0;
  }
  let unitsPerEm: number | null = null;
  if (head && head.length >= 20) {
    unitsPerEm = readU16(head, 18);
  }
  let glyphCount: number | null = null;
  if (maxp && maxp.length >= 6) {
    glyphCount = readU16(maxp, 4);
  }
  const variableAxes = fvar ? parseFvarTable(fvar, names) : [];
  return {
    valid: true,
    error: null,
    flavor,
    family: names.get(16) ?? names.get(1) ?? null,
    subfamily: names.get(17) ?? names.get(2) ?? null,
    postscriptName: names.get(6) ?? null,
    weightClass,
    italic,
    unitsPerEm,
    glyphCount,
    variableAxes,
  };
}

/** 主入口：读取字体文件并解析。 */
export async function parseFontFile(filename: string): Promise<FontInfo> {
  let data: Buffer;
  try {
    data = await readFile(filename);
  } catch {
    return { valid: false, error: "READ_FAILED", flavor: null, family: null, subfamily: null, postscriptName: null, weightClass: null, italic: null, unitsPerEm: null, glyphCount: null, variableAxes: [] };
  }
  return parseFontBuffer(data);
}

export function parseFontBuffer(data: Buffer): FontInfo {
  const invalid = (error: string): FontInfo => ({ valid: false, error, flavor: null, family: null, subfamily: null, postscriptName: null, weightClass: null, italic: null, unitsPerEm: null, glyphCount: null, variableAxes: [] });
  if (data.length < 12) return invalid("TRUNCATED");
  const magic = data.toString("latin1", 0, 4);
  if (magic === "wOF2") {
    try {
      const unpacked = unpackWoff2(data);
      return parseSfnt(unpacked.data, unpacked.flavor, unpacked.tables);
    } catch (error) {
      return invalid(`WOFF2:${String(error).slice(0, 80)}`);
    }
  }
  if (magic === "wOFF") {
    try {
      const unpacked = unpackWoff1(data);
      return parseSfnt(unpacked.sfnt, unpacked.flavor, readSfntTables(unpacked.sfnt));
    } catch (error) {
      return invalid(`WOFF1:${String(error).slice(0, 80)}`);
    }
  }
  if (magic === "ttcf") {
    const numFonts = readU32(data, 8);
    if (numFonts < 1) return invalid("EMPTY_TTC");
    const firstOffset = readU32(data, 12);
    const fontData = data.subarray(firstOffset);
    if (fontData.length < 12) return invalid("TTC_TRUNCATED_FONT");
    return parseSfnt(fontData, fontData.toString("latin1", 0, 4), readSfntTables(fontData));
  }
  if (magic !== "\u0000\u0001\u0000\u0000" && magic !== "OTTO" && magic !== "true" && magic !== "typ1") {
    return invalid(`NOT_SFNT:${magic}`);
  }
  return parseSfnt(data, magic, readSfntTables(data));
}
