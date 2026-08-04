/**
 * 阶段 7：License manifest。
 *
 * 遍历生产依赖（dependencies + 其 transitive），收集 license 字段与
 * LICENSE 文件，生成 THIRD_PARTY_NOTICES.md（人类可读）与
 * LICENSE-MANIFEST.json（机器可读）。发布前运行：
 *
 *   pnpm licenses
 *
 * 内置（bundled runtime）依赖（ffmpeg-static/ffprobe）单独列节。
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "LICENSE-MANIFEST.json");
const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.md");

function walkDependencies(entry, seen, depth, out) {
  if (depth > 6 || seen.has(entry)) return;
  seen.add(entry);
  const packageJsonPath = path.join(entry, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const license = pkg.license
    ? typeof pkg.license === "string"
      ? pkg.license
      : pkg.license.type ?? "see package"
    : pkg.licenses?.[0]?.type ?? "UNKNOWN";
  const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT", "COPYING"]
    .map((name) => path.join(entry, name))
    .find((candidate) => fs.existsSync(candidate));
  const licenseText = licenseFile
    ? fs.readFileSync(licenseFile, "utf8").slice(0, 8_000)
    : null;
  out.push({
    name: pkg.name,
    version: pkg.version,
    license,
    licenseFile: licenseFile ? path.basename(licenseFile) : null,
    licenseText,
  });
}

/** pnpm 布局：顶层直接依赖 + .pnpm 内的传递依赖。 */

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const entries = [];
const seen = new Set();
// 白名单：与 packagedRuntimePaths 一致的发布依赖（含其传递依赖）。
const productionNames = new Set([
  "better-sqlite3",
  "node-addon-api",
  "sharp",
  "detect-libc",
  "semver",
  "@ffprobe-installer",
  "ffmpeg-static",
  "@img",
]);
const topNodeModules = path.join(root, "node_modules");
const queue = [...productionNames];
while (queue.length) {
  const name = queue.shift();
  const entry = path.join(topNodeModules, name);
  if (seen.has(entry)) continue;
  seen.add(entry);
  const packageJsonPath = path.join(entry, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;
  walkDependencies(entry, new Set(), 0, entries);
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    const candidate = path.join(topNodeModules, dependency);
    if (fs.existsSync(candidate)) queue.push(dependency);
  }
}
entries.sort((left, right) => left.name.localeCompare(right.name));

const manifest = {
  generatedAt: new Date().toISOString(),
  appVersion: rootPackage.version,
  count: entries.length,
  entries: entries.map(({ licenseText, ...entry }) => entry),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const lines = [
  "# RefCanvas Third-Party Notices",
  "",
  `生成时间：${manifest.generatedAt}（应用版本 ${manifest.appVersion}）`,
  "",
  "本清单覆盖生产依赖及其传递依赖。GPL/AGPL 强传染许可的依赖不会进入发布包。",
  "",
  "## Bundled runtimes",
  "",
  "- **ffmpeg-static**：GPL-3.0-or-later（静态 ffmpeg 二进制，仅作为外部进程调用；不链接进 RefCanvas 本体）",
  "- **@ffprobe-installer**：GPL-3.0-or-later（静态 ffprobe 二进制，同上）",
  "- **sharp / @img**：Apache-2.0（libvips 为 LGPL-3.0，动态链接，sharp 通过其 Node 绑定使用）",
  "",
  `## Dependencies（${entries.length}）`,
  "",
  ...entries.map(
    (entry) =>
      `### ${entry.name}@${entry.version}\n\n许可：${entry.license}\n\n${entry.licenseText ?? "（无 LICENSE 文本，见包内声明）"}`,
  ),
  "",
];
fs.writeFileSync(noticesPath, `${lines.join("\n")}\n`);
console.log(
  `licenses: ${entries.length} entries -> ${path.relative(root, noticesPath)}`,
);
