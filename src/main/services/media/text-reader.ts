import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

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

const OFFICE_TEXT_EXTENSIONS = new Set(["docx", "xlsx", "pptx"]);

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
  return names
    .filter((name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function readOfficeTextPreview(filename: string, limit: number): Promise<TextPreview> {
  const info = await stat(filename);
  if (info.size > 128 * 1024 * 1024) throw new Error("OFFICE_READ_FAILED:TOO_LARGE");
  const extension = path.extname(filename).slice(1).toLowerCase();
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
        : "";
    const text = decodeXmlText(decoder.decode(entries[name]));
    return [label, text].filter(Boolean).join("\n");
  });
  const complete = sections.filter(Boolean).join("\n\n");
  if (!complete) throw new Error("OFFICE_READ_FAILED:NO_TEXT");
  const text = complete.slice(0, limit);
  return {
    text,
    encoding: "Office Open XML",
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
