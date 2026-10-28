// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { readTextPreview } from "../../../src/main/services/media/text-reader";

/**
 * ODF / EPUB 的文字提取：与 docx 同属 ZIP+XML，复用同一条链路。
 * 这里用最小合成包验证 entry 选取与排版解码，不依赖真实文档。
 */
describe("readTextPreview — ZIP+XML 文档族", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function writeZip(name: string, entries: Record<string, string>): Promise<string> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-odf-"));
    const encoded: Record<string, Uint8Array> = {};
    for (const [entryName, content] of Object.entries(entries)) {
      encoded[entryName] = new TextEncoder().encode(content);
    }
    const filename = path.join(scratch, name);
    await writeFile(filename, zipSync(encoded));
    return filename;
  }

  it("extracts ODT content.xml text", async () => {
    const file = await writeZip("doc.odt", {
      "content.xml":
        '<office:document-content><text:p>第一段正文</text:p><text:p>第二段正文</text:p></office:document-content>',
      "styles.xml": "<ignored>不应被读到</ignored>",
    });
    const result = await readTextPreview(file);
    expect(result.text).toContain("第一段正文");
    expect(result.text).toContain("第二段正文");
    expect(result.text).not.toContain("不应被读到");
    expect(result.encoding).toBe("Office Open XML");
  });

  it("extracts ODS content.xml text", async () => {
    const file = await writeZip("sheet.ods", {
      "content.xml":
        "<office:document-content><table:table-cell>姓名</table:table-cell><table:table-cell>年龄</table:table-cell></office:document-content>",
    });
    const result = await readTextPreview(file);
    expect(result.text).toContain("姓名");
    expect(result.text).toContain("年龄");
  });

  it("labels ODP slides", async () => {
    const file = await writeZip("deck.odp", {
      "content.xml": "<office:document-content><text:p>第一页标题</text:p></office:document-content>",
    });
    const result = await readTextPreview(file);
    expect(result.text).toContain("幻灯片 1");
    expect(result.text).toContain("第一页标题");
  });

  it("follows EPUB spine order and labels chapters", async () => {
    const file = await writeZip("book.epub", {
      "META-INF/container.xml": "<container/>",
      "OEBPS/content.opf": `<?xml version="1.0"?>
<package><manifest>
  <item id="c2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
      // 文件名排序会把 chap1 放前，spine 又指定 c1 在前——两者一致，
      // 因此把 spine 故意设成反序才验证得出「按 spine 而非文件名」。
      "OEBPS/chap1.xhtml": "<html><body><p>第一章内容</p></body></html>",
      "OEBPS/chap2.xhtml": "<html><body><p>第二章内容</p></body></html>",
    });
    const result = await readTextPreview(file);
    expect(result.text).toContain("第一章内容");
    expect(result.text).toContain("第二章内容");
    expect(result.text).toContain("章节 1");
    expect(result.encoding).toBe("EPUB (XHTML)");
    // spine 顺序：第一章必须在第二章之前。
    expect(result.text.indexOf("第一章内容")).toBeLessThan(result.text.indexOf("第二章内容"));
  });

  it("rejects a package with no readable text", async () => {
    const file = await writeZip("empty.odt", { "content.xml": "<empty/>" });
    await expect(readTextPreview(file)).rejects.toThrow("OFFICE_READ_FAILED:NO_TEXT");
  });
});
