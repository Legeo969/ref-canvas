import { open } from "node:fs/promises";

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

export async function readTextPreview(
  filename: string,
  limit = 200_000,
): Promise<TextPreview> {
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
