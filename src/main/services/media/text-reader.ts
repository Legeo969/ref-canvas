import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { openOle2 } from "./ole2-reader";
import { extractLegacyOfficeText } from "./legacy-office-text";

/**
 * 文本预览读取（阶段 4：专业格式 — 文档）。
 *
 * 读取文件头部采样，UTF-8 严格探测（BOM / 替换字符比例），
 * 失败回退 latin1。二进制文件（NUL 占比高）明确拒绝。
 */

export interface TextPreview {
  text: string;
  encoding: string;
  truncated: boolean;
  byteLength: number;
  lineCount: number;
}

const OFFICE_TEXT_EXTENSIONS = new Set([
  "docx", "xlsx", "pptx",
  // OpenDocument / EPUB 与 OOXML 同为 ZIP+XML：复用同一条提取链路。
  "odt", "ods", "odp", "epub",
  // 旧版 Office（OLE2 复合文档）：走 ole2-reader + 各格式取文规则。
  "doc", "xls", "ppt",
]);

/** 旧版 Office：MS-CFB 容器，与 ZIP+XML 族完全不同。 */
const LEGACY_OFFICE_EXTENSIONS = new Set(["doc", "xls", "ppt"]);

function decodeXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>|<a:br\s*\/>/g, "\n")
    .replace(/<\/w:p>|<\/a:p>|<\/row>|<\/si>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function officeEntries(extension: string, entries: Record<string, Uint8Array>): string[] {
  const names = Object.keys(entries);
  if (extension === "docx") return names.filter((name) => name === "word/document.xml");
  if (extension === "pptx") {
    return names
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  // OpenDocument 三件套共用 content.xml（正文流）；ods 另需表格 sheet 别名。
  if (extension === "odt" || extension === "ods" || extension === "odp") {
    return names.filter((name) => name === "content.xml");
  }
  if (extension === "epub") {
    // EPUB 正文是若干 XHTML 章节。优先按 content.opf 的 spine 顺序，
    // 读不到 opf 时退回按文件名自然排序（xhtml/html 皆收）。
    const spine = epubSpineOrder(entries);
    const chapters = names.filter((name) => /\.x?html?$/i.test(name));
    if (spine.length) {
      const ordered = spine.filter((name) => chapters.includes(name));
      const rest = chapters.filter((name) => !ordered.includes(name));
      return [...ordered, ...rest];
    }
    return chapters.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  return names
    .filter((name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** 从 EPUB 的 content.opf 读出 spine 的章节顺序（返回容器内路径）。 */
function epubSpineOrder(entries: Record<string, Uint8Array>): string[] {
  const opfName = Object.keys(entries).find((name) => name.endsWith(".opf"));
  if (!opfName) return [];
  const decoder = new TextDecoder("utf-8");
  const xml = decoder.decode(entries[opfName]);
  // manifest: id → href；spine: idref 顺序。
  const manifest = new Map<string, string>();
  for (const match of xml.matchAll(/<item\b[^>]*>/g)) {
    const tag = match[0];
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (id && href) manifest.set(id, href);
  }
  const base = path.posix.dirname(opfName);
  const spine: string[] = [];
  for (const match of xml.matchAll(/<itemref\b[^>]*>/g)) {
    const idref = /\bidref="([^"]+)"/.exec(match[0])?.[1];
    const href = idref ? manifest.get(idref) : undefined;
    if (!href) continue;
    const resolved = base === "." ? href : path.posix.normalize(path.posix.join(base, href));
    spine.push(decodeURIComponent(resolved));
  }
  return spine;
}

async function readOfficeTextPreview(filename: string, limit: number): Promise<TextPreview> {
  const info = await stat(filename);
  if (info.size > 128 * 1024 * 1024) throw new Error("OFFICE_READ_FAILED:TOO_LARGE");
  const extension = path.extname(filename).slice(1).toLowerCase();

  // 旧版 Office：OLE2 容器 + 各格式专有取文规则（只取文字，不还原版式）。
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
    const ole = await openOle2(filename);
    const raw = extractLegacyOfficeText(extension, ole);
    const text = raw.slice(0, limit);
    return {
      text,
      encoding: extension === "doc" ? "MS-DOC (OLE2)" : extension === "xls" ? "BIFF8 (OLE2)" : "MS-PPT (OLE2)",
      truncated: raw.length > limit,
      byteLength: info.size,
      lineCount: text.split(/\r\n|\n|\r/).length,
    };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await readFile(filename)));
  } catch {
    throw new Error("OFFICE_READ_FAILED:INVALID_PACKAGE");
  }
  const decoder = new TextDecoder("utf-8");
  const sections = officeEntries(extension, entries).map((name, index) => {
    const label = extension === "pptx"
      ? `--- 幻灯片 ${index + 1} ---`
      : extension === "xlsx" && name.includes("worksheets/")
        ? `--- 工作表 ${name.match(/\d+/)?.[0] ?? index + 1} ---`
        : extension === "odp"
          ? `--- 幻灯片 ${index + 1} ---`
          : extension === "epub"
            ? `--- 章节 ${index + 1} ---`
            : "";
    const text = decodeXmlText(decoder.decode(entries[name]));
    return [label, text].filter(Boolean).join("\n");
  });
  const complete = sections.filter(Boolean).join("\n\n");
  if (!complete) throw new Error("OFFICE_READ_FAILED:NO_TEXT");
  const text = complete.slice(0, limit);
  return {
    text,
    encoding: extension === "epub" ? "EPUB (XHTML)" : "Office Open XML",
    truncated: complete.length > limit,
    byteLength: info.size,
    lineCount: text.split(/\r\n|\n|\r/).length,
  };
}

export async function readTextPreview(
  filename: string,
  limit = 200_000,
): Promise<TextPreview> {
  const extension = path.extname(filename).slice(1).toLowerCase();
  if (OFFICE_TEXT_EXTENSIONS.has(extension)) {
    return readOfficeTextPreview(filename, limit);
  }
  const file = await open(filename, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await file.read(buffer, 0, limit, 0);
    const data = buffer.subarray(0, bytesRead);
    // 二进制探测：前 8KB 中 NUL 比例 > 1% 视为二进制。
    const probeLength = Math.min(bytesRead, 8192);
    let nullCount = 0;
    for (let i = 0; i < probeLength; i += 1) {
      if (data[i] === 0) nullCount += 1;
    }
    if (nullCount > probeLength / 100) {
      throw new Error("TEXT_READ_FAILED:BINARY");
    }
    let encoding = "utf-8";
    let text: string;
    if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      encoding = "utf-8 (BOM)";
      text = data.subarray(3).toString("utf8");
    } else {
      try {
        text = data.toString("utf8");
        const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
        if (replacementCount > Math.max(1, text.length / 64)) {
          throw new Error("not utf8");
        }
      } catch {
        encoding = "latin1";
        text = data.toString("latin1");
      }
    }
    return {
      text,
      encoding,
      truncated: bytesRead >= limit,
      byteLength: bytesRead,
      lineCount: text.split(/\r\n|\n|\r/).length,
    };
  } finally {
    await file.close();
  }
}
