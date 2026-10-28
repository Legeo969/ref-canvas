import type { Ole2File } from "./ole2-reader";

/**
 * 旧版 Office（.doc/.xls/.ppt，MS-CFB 容器）的纯文本提取。
 *
 * 只取文字、不还原版式——还原版式等于重写排版引擎，不在本项目范围。
 * 三个格式的取文路径各不相同：
 * - .doc：FIB → piece table（CLX）→ 文本碎片，需处理压缩/非压缩两种编码；
 * - .xls：BIFF8 记录流 → SST（共享字符串表）；
 * - .ppt：PowerPoint Document 流 → TextCharsAtom / TextBytesAtom。
 */

/** UTF-16LE 读串并裁掉尾部 NUL。 */
function decodeUtf16(buffer: Buffer): string {
  return buffer.toString("utf16le").replace(/\0+$/, "");
}

function cleanText(raw: string): string {
  // 控制字符（MS 文档里的域标记等）统一剔除，保留 \r/\n/\t 以便切行。
  // 用码点逐字符判断：正则字面里写 \u0000-\u001f 会触发 no-control-regex。
  let filtered = "";
  for (const char of raw) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 && char !== "\r" && char !== "\n" && char !== "\t") continue;
    filtered += char;
  }
  return filtered
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * .doc 文本提取（MS-DOC §2.4.1 Fib + §2.9.188 Pcdt/PlcPcd）。
 *
 * FIB 里 fcClx/lcbClx 指向 CLX 结构；跳过 Prc，读 Pcdt 的 PlcPcd：
 * 每段 piece 记录 fc（4B），最高位为 fCompressed——置位表示 8 位压缩
 * （cp1252/latin1），否则 UTF-16LE。文本按 cp 范围拼接。
 */
export function extractDocText(ole: Ole2File): string {
  const word = ole.readStream("WordDocument");
  if (!word) throw new Error("LEGACY_DOC:NO_WORD_DOCUMENT");
  // fWhichTblStm（bit 9 of flags at 0x000A）决定用 0Table 还是 1Table。
  const flags = word.readUInt16LE(0x000a);
  const tableName = (flags & 0x0200) !== 0 ? "1Table" : "0Table";
  const table = ole.readStream(tableName) ?? ole.readStream("1Table") ?? ole.readStream("0Table");
  if (!table) throw new Error("LEGACY_DOC:NO_TABLE_STREAM");

  // FibRgFcLcb97 起始：fcClx 是第 33 对之后的字段，按规范固定偏移 0x01A2。
  const fcClx = word.readUInt32LE(0x01a2);
  const lcbClx = word.readUInt32LE(0x01a6);
  if (!lcbClx || fcClx + lcbClx > table.length) {
    throw new Error("LEGACY_DOC:NO_CLX");
  }

  // CLX = [Prc]* Pcdt。逐字节找 Pcdt 的 clxt 标记 0x02。
  let offset = fcClx;
  const end = fcClx + lcbClx;
  while (offset < end) {
    const clxt = table[offset];
    if (clxt === 0x01) {
      // Prc：clxt(1) + cbGrpprl(2) + GrpPrl。
      const cb = table.readInt16LE(offset + 1);
      offset += 3 + cb;
      continue;
    }
    if (clxt === 0x02) {
      const lcb = table.readUInt32LE(offset + 1);
      const plcStart = offset + 5;
      // PlcPcd：n+1 个 CP（4B）+ n 个 PCD（8B）。解方程求 n。
      const n = (lcb - 4) / 12;
      if (!Number.isInteger(n) || n <= 0) throw new Error("LEGACY_DOC:BAD_PLC");
      const cps: number[] = [];
      for (let i = 0; i <= n; i += 1) {
        cps.push(table.readUInt32LE(plcStart + i * 4));
      }
      const pcdBase = plcStart + (n + 1) * 4;
      const pieces: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const pcdOffset = pcdBase + i * 8;
        const fcRaw = table.readUInt32LE(pcdOffset + 2);
        const compressed = (fcRaw & 0x40000000) !== 0;
        // 压缩格式里 fc 要除以 2（规范规定低位不用）。
        const fc = compressed ? (fcRaw & 0x3fffffff) / 2 : fcRaw & 0x3fffffff;
        const cpLength = cps[i + 1] - cps[i];
        if (cpLength <= 0 || fc >= word.length) continue;
        if (compressed) {
          const bytes = word.subarray(fc, Math.min(word.length, fc + cpLength));
          pieces.push(bytes.toString("latin1"));
        } else {
          const bytes = word.subarray(
            fc,
            Math.min(word.length, fc + cpLength * 2),
          );
          pieces.push(decodeUtf16(bytes));
        }
      }
      return cleanText(pieces.join(""));
    }
    throw new Error("LEGACY_DOC:BAD_CLX");
  }
  throw new Error("LEGACY_DOC:NO_PCDT");
}

/**
 * .xls 文本提取（BIFF8 SST，MS-XLS §2.4.143）。
 *
 * 只取共享字符串表：单元格文本几乎都走 SST。记录结构为
 * [type:2][length:2][data...]，沿 Workbook 流顺序扫描。
 */
export function extractXlsText(ole: Ole2File): string {
  const workbook =
    ole.readStream("Workbook") ?? ole.readStream("Book") ?? null;
  if (!workbook) throw new Error("LEGACY_XLS:NO_WORKBOOK");
  const values = new Set<string>();
  for (const record of biffRecords(workbook)) {
    if (record.type !== 0x00fc) continue; // SST
    for (const value of parseSst(record.data)) values.add(value);
  }
  const text = cleanText([...values].join("\n"));
  if (!text) throw new Error("LEGACY_XLS:NO_TEXT");
  return text;
}

/** BIFF 记录迭代器：连续记录直到流尾或遇到 EOF(0x000A)。 */
function* biffRecords(buffer: Buffer): Generator<{ type: number; data: Buffer }> {
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const type = buffer.readUInt16LE(offset);
    const length = buffer.readUInt16LE(offset + 2);
    const dataStart = offset + 4;
    if (dataStart + length > buffer.length) return;
    yield { type, data: buffer.subarray(dataStart, dataStart + length) };
    if (type === 0x000a) return; // EOF
    offset = dataStart + length;
  }
}

/** 解析 SST（含 CONTINUE 已由调用方拼接的连续块）。 */
function parseSst(data: Buffer): string[] {
  if (data.length < 8) return [];
  const unique = data.readUInt32LE(4);
  const strings: string[] = [];
  let offset = 8;
  for (let i = 0; i < unique && offset + 3 <= data.length; i += 1) {
    const cch = data.readUInt16LE(offset);
    const flags = data[offset + 2];
    const highByte = (flags & 0x01) !== 0;
    const extended = (flags & 0x04) !== 0;
    const richText = (flags & 0x08) !== 0;
    offset += 3;
    let runs = 0;
    let extLength = 0;
    if (richText) {
      runs = data.readUInt16LE(offset);
      offset += 2;
    }
    if (extended) {
      extLength = data.readUInt32LE(offset);
      offset += 4;
    }
    const byteLength = highByte ? cch * 2 : cch;
    if (offset + byteLength > data.length) break;
    const raw = data.subarray(offset, offset + byteLength);
    strings.push(highByte ? decodeUtf16(raw) : raw.toString("latin1"));
    offset += byteLength + runs * 4 + extLength;
  }
  return strings;
}

/**
 * .ppt 文本提取（MS-PPT §2.9 TextCharsAtom / TextBytesAtom）。
 *
 * PowerPoint Document 流是「记录容器」结构：每条记录 8 字节头
 * （verAndInstance:2, type:2, length:4），逐层递归即可扫到文本记录。
 */
export function extractPptText(ole: Ole2File): string {
  const stream = ole.readStream("PowerPoint Document");
  if (!stream) throw new Error("LEGACY_PPT:NO_DOCUMENT");
  const parts: string[] = [];
  scanPptRecords(stream, 0, stream.length, parts, 0);
  const text = cleanText(parts.join("\n"));
  if (!text) throw new Error("LEGACY_PPT:NO_TEXT");
  return text;
}

function scanPptRecords(
  buffer: Buffer,
  start: number,
  end: number,
  out: string[],
  depth: number,
): void {
  if (depth > 8) return;
  let offset = start;
  while (offset + 8 <= end) {
    const verInstance = buffer.readUInt16LE(offset);
    const type = buffer.readUInt16LE(offset + 2);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (length > buffer.length - dataStart) return;
    const ver = verInstance & 0x000f;
    if (type === 0x0fa0) {
      // TextCharsAtom：UTF-16LE
      out.push(decodeUtf16(buffer.subarray(dataStart, dataStart + length)));
    } else if (type === 0x0fa8) {
      // TextBytesAtom：单字节
      out.push(buffer.subarray(dataStart, dataStart + length).toString("latin1"));
    } else if (ver === 0x0f) {
      // 容器记录：递归进子记录。
      scanPptRecords(buffer, dataStart, dataStart + length, out, depth + 1);
    }
    offset = dataStart + length;
  }
}

/** 按扩展名分派。 */
export function extractLegacyOfficeText(
  extension: string,
  ole: Ole2File,
): string {
  switch (extension) {
    case "doc":
      return extractDocText(ole);
    case "xls":
      return extractXlsText(ole);
    case "ppt":
      return extractPptText(ole);
    default:
      throw new Error("LEGACY_OFFICE:UNSUPPORTED");
  }
}
