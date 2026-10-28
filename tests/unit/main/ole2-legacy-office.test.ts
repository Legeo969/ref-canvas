// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractDocText,
  extractPptText,
  extractXlsText,
} from "../../../src/main/services/media/legacy-office-text";
import { Ole2File, openOle2 } from "../../../src/main/services/media/ole2-reader";

/**
 * OLE2 容器与旧版 Office 文本提取。
 *
 * 本机没有真实的 .doc/.xls/.ppt 样本，这里按 MS-CFB / MS-DOC / MS-XLS
 * 规范合成最小文件：container 解析与各格式取文规则都能被真实字节验证。
 */

const SECTOR = 512;
const MINI = 64;
const MINI_CUTOFF = 4096;

interface StreamSpec {
  name: string;
  data: Buffer;
}

/**
 * 构造一个合法 CFB 文件：所有流都 ≥4096 字节走常规 FAT，
 * 小于 cutoff 的走 mini stream（.doc 的 WordDocument 常是小流）。
 */
function buildCfb(streams: StreamSpec[]): Buffer {
  const useMini = (size: number) => size < MINI_CUTOFF;

  // ── 计算各流占用的扇区数 ──────────────────────────────────
  const regularStreams = streams.filter((s) => !useMini(s.data.length));
  const miniStreams = streams.filter((s) => useMini(s.data.length));

  const sectorsPerStream = (size: number) => Math.max(1, Math.ceil(size / SECTOR));
  const regularSectorCount = regularStreams.reduce(
    (sum, s) => sum + sectorsPerStream(s.data.length),
    0,
  );
  const miniStreamBytes = miniStreams.reduce(
    (sum, s) => sum + Math.max(MINI, Math.ceil(s.data.length / MINI) * MINI),
    0,
  );
  const miniStreamSectors = Math.ceil(miniStreamBytes / SECTOR);
  const miniFatEntries = Math.ceil(miniStreamBytes / MINI);
  const miniFatSectors = Math.max(1, Math.ceil((miniFatEntries * 4) / SECTOR));

  // 目录项：根 + 各流
  const dirEntryCount = 1 + streams.length;
  const dirSectors = Math.ceil((dirEntryCount * 128) / SECTOR);

  const totalDataSectors =
    dirSectors + miniFatSectors + (miniStreamSectors || 0) + regularSectorCount;
  // FAT 本身占的扇区数（迭代求解，因为 FAT 也占扇区）
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < totalDataSectors + fatSectors) {
    fatSectors += 1;
  }

  // ── 排布扇区编号 ────────────────────────────────────────
  let next = 0;
  const fatStart = next;
  next += fatSectors;
  const dirStart = next;
  next += dirSectors;
  const miniFatStart = next;
  next += miniFatSectors;
  const miniStreamStart = next;
  next += miniStreamSectors;

  const regularLayout = new Map<string, number>();
  for (const stream of regularStreams) {
    regularLayout.set(stream.name, next);
    next += sectorsPerStream(stream.data.length);
  }
  const totalSectors = next;

  const file = Buffer.alloc(SECTOR + totalSectors * SECTOR);
  // 头部
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file, 0);
  file.writeUInt16LE(0x003e, 24); // minor
  file.writeUInt16LE(0x0003, 26); // major
  file.writeUInt16LE(0xfffe, 28); // byte order
  file.writeUInt16LE(9, 30); // sector shift = 512
  file.writeUInt16LE(6, 32); // mini sector shift = 64
  file.writeUInt32LE(fatSectors, 44);
  file.writeUInt32LE(dirStart, 48);
  file.writeUInt32LE(MINI_CUTOFF, 56);
  file.writeUInt32LE(miniFatStart, 60);
  file.writeUInt32LE(miniFatSectors, 64);
  file.writeUInt32LE(0xfffffffe, 68); // DIFAT start = end
  file.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i += 1) {
    file.writeUInt32LE(i === 0 ? fatStart : 0xffffffff, 76 + i * 4);
  }

  // FAT
  const fat = new Array(fatSectors * (SECTOR / 4)).fill(0xffffffff);
  const markChain = (start: number, count: number) => {
    for (let i = 0; i < count; i += 1) {
      fat[start + i] = i === count - 1 ? 0xfffffffe : start + i + 1;
    }
  };
  markChain(fatStart, fatSectors);
  markChain(dirStart, dirSectors);
  markChain(miniFatStart, miniFatSectors);
  if (miniStreamSectors) markChain(miniStreamStart, miniStreamSectors);
  for (const stream of regularStreams) {
    const start = regularLayout.get(stream.name)!;
    const count = sectorsPerStream(stream.data.length);
    markChain(start, count);
    stream.data.copy(
      file,
      SECTOR + start * SECTOR,
    );
  }
  for (let i = 0; i < fat.length; i += 1) {
    file.writeUInt32LE(fat[i], SECTOR + fatStart * SECTOR + i * 4);
  }

  // mini stream + MiniFAT
  const miniStream = Buffer.alloc(miniStreamSectors * SECTOR);
  const miniFat = new Array(miniFatSectors * (SECTOR / 4)).fill(0xffffffff);
  let miniOffset = 0;
  for (const stream of miniStreams) {
    const miniCount = Math.max(1, Math.ceil(stream.data.length / MINI));
    const miniStart = miniOffset / MINI;
    for (let i = 0; i < miniCount; i += 1) {
      miniFat[miniStart + i] =
        i === miniCount - 1 ? 0xfffffffe : miniStart + i + 1;
    }
    stream.data.copy(miniStream, miniOffset);
    miniOffset += Math.max(MINI, miniCount * MINI);
    stream.data = stream.data; // 保持原样
  }
  miniStream.copy(file, SECTOR + miniStreamStart * SECTOR);
  for (let i = 0; i < miniFat.length; i += 1) {
    file.writeUInt32LE(miniFat[i], SECTOR + miniFatStart * SECTOR + i * 4);
  }

  // 目录项
  const writeEntry = (
    index: number,
    name: string,
    type: number,
    startSector: number,
    size: number,
  ) => {
    const base = SECTOR + dirStart * SECTOR + index * 128;
    const encoded = Buffer.from(`${name}\0`, "utf16le");
    encoded.copy(file, base);
    file.writeUInt16LE(encoded.length, base + 64);
    file[base + 66] = type;
    file[base + 67] = 1; // 黑色
    file.writeUInt32LE(type === 5 ? 0xffffffff : 0xffffffff, base + 68);
    file.writeUInt32LE(type === 5 ? 0xffffffff : 0xffffffff, base + 72);
    file.writeUInt32LE(type === 5 ? 0xffffffff : 0xffffffff, base + 76);
    file.writeUInt32LE(startSector, base + 116);
    file.writeUInt32LE(size, base + 120);
  };
  writeEntry(0, "Root Entry", 5, miniStreamSectors ? miniStreamStart : 0xfffffffe, miniStreamBytes);
  streams.forEach((stream, index) => {
    const mini = useMini(stream.data.length);
    const miniCount = Math.max(1, Math.ceil(stream.data.length / MINI));
    let startSector: number;
    let size: number;
    if (mini) {
      // 重新计算该流在 mini stream 中的起始偏移
      let offset = 0;
      for (const other of streams) {
        if (other === stream) break;
        if (!useMini(other.data.length)) continue;
        offset += Math.max(MINI, Math.ceil(other.data.length / MINI) * MINI);
      }
      startSector = offset / MINI;
      size = stream.data.length;
    } else {
      startSector = regularLayout.get(stream.name)!;
      size = stream.data.length;
    }
    writeEntry(index + 1, stream.name, 2, startSector, size);
    void miniCount;
  });

  return file;
}

/** 构造最小 WordDocument + 0Table，含一条压缩 piece 的 CLX。 */
function buildDocStreams(text: string): StreamSpec[] {
  const word = Buffer.alloc(4096); // ≥ cutoff，走常规 FAT
  word.writeUInt16LE(0x00a5, 0); // wIdent
  word.writeUInt16LE(0x0000, 0x000a); // flags：用 0Table
  // fcClx / lcbClx 写在 0x01A2 / 0x01A6
  const table = Buffer.alloc(1024);
  const clxOffset = 256;
  // CLX = Pcdt: clxt(0x02) + lcb(4) + [CP0, CP1]{8B} + PCD{8B}
  const pieceText = Buffer.from(text, "latin1");
  const lcb = 4 * 2 + 8; // 2 个 CP + 1 个 PCD
  table.writeUInt8(0x02, clxOffset);
  table.writeUInt32LE(lcb, clxOffset + 1);
  table.writeUInt32LE(0, clxOffset + 5); // CP0
  table.writeUInt32LE(pieceText.length, clxOffset + 9); // CP1
  // PCD: 2B 保留 + 4B fc（置 fCompressed 位）+ 2B prm
  const pcdOffset = clxOffset + 13;
  table.writeUInt32LE(((512 << 1) | 0x40000000) >>> 0, pcdOffset + 2);
  // 把文本放到 WordDocument 的 fc=512 处（压缩格式 fc 是字节偏移的一半）
  pieceText.copy(word, 512);
  word.writeUInt32LE(clxOffset, 0x01a2);
  word.writeUInt32LE(lcb + 5, 0x01a6);
  return [
    { name: "WordDocument", data: word },
    { name: "0Table", data: table },
  ];
}

/** 构造最小 Workbook：一条 SST 记录，含两个 UTF-16 串。 */
function buildXlsStreams(values: string[]): StreamSpec[] {
  const parts: Buffer[] = [];
  const encoded = values.map((value) => Buffer.from(value, "utf16le"));
  // SST: cstTotal(4) + cstUnique(4) + entries
  const header = Buffer.alloc(8);
  header.writeUInt32LE(values.length, 0);
  header.writeUInt32LE(values.length, 4);
  parts.push(header);
  for (const [index, value] of values.entries()) {
    const entryHeader = Buffer.alloc(3);
    entryHeader.writeUInt16LE(value.length, 0);
    entryHeader[2] = 0x01; // fHighByte
    parts.push(entryHeader, encoded[index]);
  }
  const sst = Buffer.concat(parts);
  const record = Buffer.alloc(4 + sst.length);
  record.writeUInt16LE(0x00fc, 0);
  record.writeUInt16LE(sst.length, 2);
  sst.copy(record, 4);
  const eof = Buffer.alloc(4);
  eof.writeUInt16LE(0x000a, 0);
  const workbook = Buffer.concat([record, eof]);
  const padded = Buffer.concat([workbook, Buffer.alloc(4096 - workbook.length)]);
  return [{ name: "Workbook", data: padded }];
}

/** 构造最小 PowerPoint Document：一个 TextCharsAtom。 */
function buildPptStreams(text: string): StreamSpec[] {
  const payload = Buffer.from(text, "utf16le");
  const record = Buffer.alloc(8 + payload.length);
  record.writeUInt16LE(0x0000, 0); // verAndInstance
  record.writeUInt16LE(0x0fa0, 2); // TextCharsAtom
  record.writeUInt32LE(payload.length, 4);
  payload.copy(record, 8);
  const padded = Buffer.concat([record, Buffer.alloc(8192 - record.length)]);
  return [{ name: "PowerPoint Document", data: padded }];
}

describe("OLE2 容器", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function writeCfb(name: string, streams: StreamSpec[]): Promise<string> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-ole2-"));
    const filename = path.join(scratch, name);
    await writeFile(filename, buildCfb(streams));
    return filename;
  }

  it("reads a large stream through the regular FAT", async () => {
    const payload = Buffer.alloc(5000, 0x41);
    const file = await writeCfb("big.cfb", [{ name: "WordDocument", data: payload }]);
    const ole = await openOle2(file);
    const stream = ole.readStream("WordDocument");
    expect(stream).not.toBeNull();
    expect(stream!.length).toBe(5000);
    expect(stream!.subarray(0, 4).toString("latin1")).toBe("AAAA");
  });

  it("reads a small stream through the mini stream", async () => {
    const payload = Buffer.from("mini-stream-payload", "latin1");
    const file = await writeCfb("small.cfb", [{ name: "Tiny", data: payload }]);
    const ole = await openOle2(file);
    expect(ole.readStream("Tiny")!.toString("latin1")).toBe("mini-stream-payload");
  });

  it("returns null for a missing stream", async () => {
    const file = await writeCfb("missing.cfb", [
      { name: "WordDocument", data: Buffer.alloc(4096) },
    ]);
    const ole = await openOle2(file);
    expect(ole.readStream("Nope")).toBeNull();
  });

  it("rejects a file without the CFB magic", async () => {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-ole2-"));
    const filename = path.join(scratch, "bad.cfb");
    await writeFile(filename, Buffer.alloc(512));
    await expect(openOle2(filename)).rejects.toThrow("OLE2_INVALID:MAGIC");
  });
});

describe("旧版 Office 文本提取", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function open(name: string, streams: StreamSpec[]): Promise<Ole2File> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-legacy-"));
    const filename = path.join(scratch, name);
    await writeFile(filename, buildCfb(streams));
    return openOle2(filename);
  }

  it("extracts .doc text from a compressed piece", async () => {
    const ole = await open("doc.doc", buildDocStreams("Hello legacy word"));
    expect(extractDocText(ole)).toBe("Hello legacy word");
  });

  it("extracts .xls shared strings", async () => {
    const ole = await open("book.xls", buildXlsStreams(["姓名", "年龄", "Alice"]));
    const text = extractXlsText(ole);
    expect(text).toContain("姓名");
    expect(text).toContain("年龄");
    expect(text).toContain("Alice");
  });

  it("extracts .ppt text atoms", async () => {
    const ole = await open("deck.ppt", buildPptStreams("First slide title"));
    expect(extractPptText(ole)).toBe("First slide title");
  });
});
