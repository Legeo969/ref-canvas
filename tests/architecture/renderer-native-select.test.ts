import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve("src/renderer");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [filename] : [];
  }))).flat();
}

describe("renderer dropdown controls", () => {
  it("uses the shared menu instead of browser-native select or datalist controls", async () => {
    const violations: string[] = [];
    for (const filename of await sourceFiles(rendererRoot)) {
      const source = await readFile(filename, "utf8");
      if (/<(?:select|option|optgroup|datalist)\b/i.test(source)
        || /createElement\(\s*["']select["']/i.test(source)) {
        violations.push(path.relative(rendererRoot, filename).replaceAll("\\", "/"));
      }
    }
    expect(violations).toEqual([]);
  });
});
