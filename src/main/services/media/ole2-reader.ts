import { open } from "node:fs/promises";

/**
 * OLE2 复合文档（Compound File Binary，MS-CFB）最小读取器。
 *
 * 只做「取出指定名称的流」这一件事——够 .doc/.xls/.ppt 的文本提取用，
 * 不实现写入、不处理加密。结构（MS-CFB §2）：
 *
 *   512B 头（magic D0 CF 11 E0 A1 B1 1A E1）
 *   → sector 0 起是数据区，扇区大小 2^ssz（通常 512）
 *   → 目录流由 FAT 串成链，每个目录项 128B
 *   → 小于 miniSectorCutoff(4096) 的流放在 MiniFAT + 根项的 mini stream 里
 *
 * 必须处理 mini stream：.doc 的 WordDocument 流通常几 KB~几十 KB，
 * 小文件会落进 mini stream，只读 FAT 会拿到错误数据。
 */

const MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** 目录项类型：0=空 1=存储（目录） 2=流 5=根。 */
const ENTRY_TYPE_STREAM = 2;

export interface Ole2Entry {
  name: string;
  type: number;
  size: number;
  startSector: number;
}

export class Ole2File {
  private constructor(
    private readonly buffer: Buffer,
    private readonly sectorSize: number,
    private readonly miniSectorSize: number,
    private readonly miniCutoff: number,
    private readonly fat: number[],
    private readonly miniFat: number[],
    private readonly entries: Ole2Entry[],
    private readonly miniStream: Buffer | null,
  ) {}

  static parse(buffer: Buffer): Ole2File {
    if (buffer.length < 512 || !buffer.subarray(0, 8).equals(MAGIC)) {
      throw new Error("OLE2_INVALID:MAGIC");
    }
    const sectorShift = buffer.readUInt16LE(30);
    const miniSectorShift = buffer.readUInt16LE(32);
    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;
    const miniCutoff = buffer.readUInt32LE(56);
    const fatSectorCount = buffer.readUInt32LE(44);
    const firstDirSector = buffer.readUInt32LE(48);
    const miniFatStart = buffer.readUInt32LE(60);
    const miniFatCount = buffer.readUInt32LE(64);
    const difatStart = buffer.readUInt32LE(68);
    const difatCount = buffer.readUInt32LE(72);

    // DIFAT：头部 109 项 + DIFAT 扇区链里的其余项。
    const fatSectorIds: number[] = [];
    for (let i = 0; i < 109; i += 1) {
      const id = buffer.readUInt32LE(76 + i * 4);
      if (id === 0xffffffff) break;
      fatSectorIds.push(id);
    }
    let difatSector = difatStart;
    let guard = 0;
    while (difatSector !== 0xfffffffe && difatSector !== 0xffffffff && guard < difatCount + 8) {
      const base = sectorOffset(difatSector, sectorSize);
      if (base < 0 || base + sectorSize > buffer.length) break;
      const perSector = sectorSize / 4 - 1;
      for (let i = 0; i < perSector; i += 1) {
        const id = buffer.readUInt32LE(base + i * 4);
        if (id === 0xffffffff) break;
        fatSectorIds.push(id);
      }
      difatSector = buffer.readUInt32LE(base + perSector * 4);
      guard += 1;
    }
    if (fatSectorIds.length > fatSectorCount) fatSectorIds.length = fatSectorCount;

    // FAT：每个扇区装 sectorSize/4 个 32 位表项。
    const fat: number[] = [];
    for (const sectorId of fatSectorIds) {
      const base = sectorOffset(sectorId, sectorSize);
      if (base < 0 || base + sectorSize > buffer.length) continue;
      for (let i = 0; i < sectorSize / 4; i += 1) {
        fat.push(buffer.readUInt32LE(base + i * 4));
      }
    }

    const miniFat: number[] = [];
    for (const sectorId of chainFrom(miniFatStart, fat)) {
      if (miniFat.length >= miniFatCount * (sectorSize / 4)) break;
      const base = sectorOffset(sectorId, sectorSize);
      if (base < 0 || base + sectorSize > buffer.length) break;
      for (let i = 0; i < sectorSize / 4; i += 1) {
        miniFat.push(buffer.readUInt32LE(base + i * 4));
      }
    }

    const dirBytes: Buffer[] = [];
    for (const sectorId of chainFrom(firstDirSector, fat)) {
      const base = sectorOffset(sectorId, sectorSize);
      if (base < 0 || base + sectorSize > buffer.length) break;
      dirBytes.push(buffer.subarray(base, base + sectorSize));
    }
    const dirBuffer = Buffer.concat(dirBytes);
    const entries: Ole2Entry[] = [];
    for (let offset = 0; offset + 128 <= dirBuffer.length; offset += 128) {
      const nameLength = dirBuffer.readUInt16LE(offset + 64);
      const type = dirBuffer[offset + 66];
      if (nameLength < 2 || nameLength > 64 || type === 0) continue;
      // 名称是 UTF-16LE，长度含结尾 NUL。
      const name = dirBuffer
        .subarray(offset, offset + nameLength - 2)
        .toString("utf16le");
      entries.push({
        name,
        type,
        startSector: dirBuffer.readUInt32LE(offset + 116),
        size: dirBuffer.readUInt32LE(offset + 120),
      });
    }

    // 根项（type 5）的 startSector 指向 mini stream 容器。
    const root = entries.find((entry) => entry.type === 5);
    let miniStream: Buffer | null = null;
    if (root && root.startSector !== 0xfffffffe) {
      const chunks: Buffer[] = [];
      for (const sectorId of chainFrom(root.startSector, fat)) {
        const base = sectorOffset(sectorId, sectorSize);
        if (base < 0 || base + sectorSize > buffer.length) break;
        chunks.push(buffer.subarray(base, base + sectorSize));
      }
      miniStream = Buffer.concat(chunks);
    }

    return new Ole2File(
      buffer,
      sectorSize,
      miniSectorSize,
      miniCutoff,
      fat,
      miniFat,
      entries,
      miniStream,
    );
  }

  /** 按名称取流（大小写敏感，与规范一致）；不存在或不是流时返回 null。 */
  readStream(name: string): Buffer | null {
    const entry = this.entries.find(
      (candidate) => candidate.type === ENTRY_TYPE_STREAM && candidate.name === name,
    );
    if (!entry) return null;
    if (entry.size === 0) return Buffer.alloc(0);
    if (entry.size < this.miniCutoff) {
      if (!this.miniStream) return null;
      const chunks: Buffer[] = [];
      for (const id of chainFrom(entry.startSector, this.miniFat)) {
        const base = id * this.miniSectorSize;
        if (base < 0 || base + this.miniSectorSize > this.miniStream.length) break;
        chunks.push(this.miniStream.subarray(base, base + this.miniSectorSize));
      }
      return Buffer.concat(chunks).subarray(0, entry.size);
    }
    const chunks: Buffer[] = [];
    for (const id of chainFrom(entry.startSector, this.fat)) {
      const base = sectorOffset(id, this.sectorSize);
      if (base < 0 || base + this.sectorSize > this.buffer.length) break;
      chunks.push(this.buffer.subarray(base, base + this.sectorSize));
    }
    return Buffer.concat(chunks).subarray(0, entry.size);
  }

  listEntries(): Ole2Entry[] {
    return [...this.entries];
  }
}

function sectorOffset(sectorId: number, sectorSize: number): number {
  return 512 + sectorId * sectorSize;
}

/** 沿 FAT/MiniFAT 走链；遇到结束标记或成环即停。 */
function chainFrom(start: number, table: number[]): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current = start;
  const END = 0xfffffffe;
  while (current !== END && current !== 0xffffffff && !seen.has(current)) {
    if (current >= table.length) break;
    chain.push(current);
    seen.add(current);
    current = table[current];
  }
  return chain;
}

/** 便捷入口：直接从文件路径解析。 */
export async function openOle2(filename: string): Promise<Ole2File> {
  const handle = await open(filename, "r");
  try {
    return Ole2File.parse(await handle.readFile());
  } finally {
    await handle.close();
  }
}
