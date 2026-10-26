import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MessageKey 只增不减地留了两次尸：`board.resetViewport` 与 `board.resetView`
 * 都是"按钮被删/被重写、key 忘删"的同一类事故（工具条 overhaul 与缩放控件重写）。
 * i18n.test.ts 只校验两语言 key 集合一致、每个 key 都能解析出非空串——它永远
 * 不会发现没人用的 key。这里补上反向门禁：每个 key 必须在渲染层有真实消费者。
 *
 * 判定标准：key 作为带引号的字面量出现在 src/renderer 中（排除 i18n 定义文件本身）。
 * 该标准成立的前提已核实：全库没有模板字面量形式的 translate(`…`)、没有字符串
 * 拼接构造 key，表驱动处（labelKey/groupKey/stateKeys 等）的值也全是字面量。
 * 因此"零出现"只能是残留，不会是动态引用造成的误报。
 *
 * 不加 baseline：当前残留为 0。若将来确需预埋文案，再讨论白名单机制。
 */

const rendererRoot = path.resolve("src/renderer");
const keysFile = path.resolve(rendererRoot, "app", "i18n-keys.ts");
const catalogsDir = path.resolve(rendererRoot, "app", "i18n-catalogs");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return filename === catalogsDir ? [] : sourceFiles(filename);
      }
      return /\.tsx?$/.test(entry.name) && filename !== keysFile
        ? [filename]
        : [];
    }),
  );
  return files.flat();
}

async function declaredKeys(): Promise<string[]> {
  const source = await readFile(keysFile, "utf8");
  return Array.from(source.matchAll(/^\s*\|\s*"([^"]+)"/gm), (match) => match[1]);
}

describe("i18n orphan keys", () => {
  it("declares every MessageKey with at least one consumer in the renderer", async () => {
    const files = await sourceFiles(rendererRoot);
    // 带上引号的字面量匹配，天然前缀安全："board.relinkTitle" 不会命中
    // "board.relinkTitleHint"，反之亦然。
    const sources = await Promise.all(
      files.map(async (filename) => ({
        relative: path.relative(rendererRoot, filename).replaceAll("\\", "/"),
        text: await readFile(filename, "utf8"),
      })),
    );

    const orphans: string[] = [];
    for (const key of await declaredKeys()) {
      const quoted = `"${key}"`;
      if (!sources.some((source) => source.text.includes(quoted))) orphans.push(key);
    }

    expect(orphans).toEqual([]);
  });
});
