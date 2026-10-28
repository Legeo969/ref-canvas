// @vitest-environment node

import { describe, expect, it } from "vitest";
import { openOle2 } from "../../../src/main/services/media/ole2-reader";
import { extractDocText, extractXlsText } from "../../../src/main/services/media/legacy-office-text";

/**
 * 用系统自带的真实 OLE2 文件做冒烟验证（不是合成样本）。
 *
 * 这两个是 Windows/Steam 附带的旧版 Office 文件，结构真实：
 * 小流走 mini stream、多目录项、Word 的 piece table 是压缩态。
 * 找不到文件时跳过（非 Windows 或精简系统），不让测试变成硬依赖。
 */
const DOC_CANDIDATES = [
  "C:\\Program Files (x86)\\Steam\\ThirdPartyLegalNotices.doc",
  "C:\\Windows\\System32\\MSDRM\\MsoIrmProtector.doc",
];
const XLS_CANDIDATES = [
  "C:\\Windows\\System32\\MSDRM\\MsoIrmProtector.xls",
  "C:\\Windows\\SysWOW64\\MSDRM\\MsoIrmProtector.xls",
];

async function firstExisting(candidates: string[]): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

describe("真实 OLE2 文件冒烟", () => {
  it("parses a real .doc container and extracts readable text", async () => {
    const filename = await firstExisting(DOC_CANDIDATES);
    if (!filename) {
      console.warn("[skip] no real .doc sample on this machine");
      return;
    }
    const ole = await openOle2(filename);
    // 容器层：必须能列出目录项并拿到 WordDocument 流。
    expect(ole.listEntries().length).toBeGreaterThan(0);
    const word = ole.readStream("WordDocument");
    expect(word).not.toBeNull();
    expect(word!.length).toBeGreaterThan(0);

    // 取文：真实文件的 piece table 是压缩态，应能读到英文正文。
    const text = extractDocText(ole);
    expect(text.length).toBeGreaterThan(20);
    // 该文档正文含英文法律声明，至少能命中字母。
    expect(/[A-Za-z]{4,}/.test(text)).toBe(true);
  });

  it("parses a real .xls container", async () => {
    const filename = await firstExisting(XLS_CANDIDATES);
    if (!filename) {
      console.warn("[skip] no real .xls sample on this machine");
      return;
    }
    const ole = await openOle2(filename);
    const entries = ole.listEntries().map((entry) => entry.name);
    // 必须是合法的 OLE2 Excel 容器。
    expect(entries.some((name) => /^(Workbook|Book)$/.test(name))).toBe(true);
    // 该文件可能无共享字符串（纯宏/保护器），取不到文本时应明确抛错而非返回垃圾。
    try {
      const text = extractXlsText(ole);
      expect(text.length).toBeGreaterThan(0);
    } catch (error) {
      expect(String(error)).toMatch(/LEGACY_XLS:NO_TEXT|LEGACY_XLS:NO_WORKBOOK/);
    }
  });
});
