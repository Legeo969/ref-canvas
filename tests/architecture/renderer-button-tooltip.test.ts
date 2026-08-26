import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 按钮的原生 `title` 与全局 TooltipLayer（读 aria-label）会各画一个气泡——
 * 同屏双气泡即由此而来。按钮提示统一走 aria-label，禁止新增原生 title。
 *
 * 存量用"棘轮"收缩：baseline.json 记录每个文件允许的原生 title 按钮数。
 * 目前残留的 31 处均为"只有 title、没有 aria-label"的单气泡按钮（迁移需要
 * 逐个补无障碍标签）；任何文件新增（含双写复潮）即失败。清理之后把对应
 * 计数改小（或删掉条目）——只许变少，不许变多。
 */

const rendererRoot = path.resolve("src/renderer");
const baselinePath = path.resolve(
  "tests/architecture/renderer-button-title.baseline.json",
);

async function tsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return tsxFiles(filename);
      return entry.name.endsWith(".tsx") ? [filename] : [];
    }),
  );
  return files.flat();
}

/** `<button` 开标签内的属性可能跨行且含 `{"..."}` 表达式，须括号感知地找标签边界。 */
function countButtonTitleTags(source: string): number {
  let count = 0;
  let i = 0;
  while ((i = source.indexOf("<button", i)) !== -1) {
    if (!/[\s>]/.test(source[i + 7] ?? "")) {
      i += 7;
      continue;
    }
    let depth = 0;
    let j = i + 7;
    for (; j < source.length; j++) {
      const char = source[j];
      if (char === "{" || char === "(" || char === "[") depth++;
      else if (char === "}" || char === ")" || char === "]") depth--;
      else if (char === '"' || char === "'" || char === "`") {
        const quote = char;
        j++;
        while (j < source.length && source[j] !== quote) {
          if (source[j] === "\\") j++;
          j++;
        }
      } else if (char === ">" && depth === 0) break;
    }
    if (/ title=/.test(source.slice(i, j + 1))) count++;
    i = j + 1;
  }
  return count;
}

describe("renderer button tooltips", () => {
  it("adds no new native title attributes to buttons (ratchet vs baseline)", async () => {
    const baseline = JSON.parse(
      await readFile(baselinePath, "utf8"),
    ) as Record<string, number>;

    const violations: string[] = [];
    for (const filename of await tsxFiles(rendererRoot)) {
      const relative = path.relative(rendererRoot, filename).replaceAll("\\", "/");
      const allowed = baseline[relative] ?? 0;
      const count = countButtonTitleTags(await readFile(filename, "utf8"));
      if (count > allowed) {
        violations.push(
          `${relative}: ${count} native-title button(s) > baseline ${allowed}` +
            (allowed === 0
              ? " — buttons must use aria-label (TooltipLayer), not title"
              : " — shrink or update renderer-button-title.baseline.json"),
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
