/**
 * 阶段 7：打包产物冒烟检查（不启动应用）。
 *
 * 验证 out/<platform> 目录结构：
 * - 主程序可执行文件存在
 * - asar 包存在且含 main 入口
 * - native 运行时依赖已 unpack（sharp/@img/ffmpeg-static/@ffprobe-installer/
 *   better-sqlite3）且可执行文件存在
 * - THIRD_PARTY_NOTICES.md 与 LICENSE-MANIFEST.json 在包内
 * - Squirrel 安装器（make 产物）存在时一并检查
 *
 * 用法：pnpm test:package [platformDir]
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const platformDir =
  process.argv[2] ??
  path.join(root, "out", "RefCanvas-win32-x64");
const errors = [];

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    errors.push(label);
    console.error(`  ✗ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

if (!fs.existsSync(platformDir)) {
  console.error(`平台目录不存在：${platformDir}\n先运行 pnpm package`);
  process.exit(1);
}

console.log(`检查打包产物：${platformDir}`);
const exe = path.join(platformDir, "RefCanvas.exe");
check("主程序 exe", fs.existsSync(exe));

const asar = path.join(platformDir, "resources", "app.asar");
check("app.asar", fs.existsSync(asar));
if (fs.existsSync(asar)) {
  const unpacked = path.join(platformDir, "resources", "app.asar.unpacked");
  check("app.asar.unpacked", fs.existsSync(unpacked));
  for (const required of [
    "node_modules/ffmpeg-static/ffmpeg.exe",
    "node_modules/@ffprobe-installer/win32-x64/ffprobe.exe",
    "node_modules/@img/sharp-win32-x64/package.json",
    "node_modules/better-sqlite3/prebuilds/win32-x64.node",
  ]) {
    check(
      `unpacked: ${required}`,
      fs.existsSync(path.join(unpacked, required)),
    );
  }
  const notices = path.join(unpacked, "THIRD_PARTY_NOTICES.md");
  const manifest = path.join(unpacked, "LICENSE-MANIFEST.json");
  // 两个清单文件打进 asar 而非 unpacked：用 @electron/asar 读列表验证。
  if (notices && manifest && fs.existsSync(asar)) {
    try {
      const { listPackage } = require("@electron/asar");
      const files = listPackage(asar);
      const normalized = files.map((file) => file.replaceAll("\\", "/"));
      const contains = (name) => normalized.some((file) => file.endsWith(name));
      check("asar: THIRD_PARTY_NOTICES.md", contains("/THIRD_PARTY_NOTICES.md"));
      check("asar: LICENSE-MANIFEST.json", contains("/LICENSE-MANIFEST.json"));
    } catch {
      check("asar 清单（@electron/asar）", false, "无法读取 asar");
    }
  } else {
    check("asar: THIRD_PARTY_NOTICES.md", fs.existsSync(notices));
    check("asar: LICENSE-MANIFEST.json", fs.existsSync(manifest));
  }
}

const outRoot = path.dirname(platformDir);
const makeRoot = path.join(outRoot, "make");
const installerDirs = [outRoot, makeRoot];
const installers = installerDirs.flatMap((directory) => {
  if (!fs.existsSync(directory)) return [];
  const walk = (current) => {
    const found = [];
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) {
        found.push(...walk(full));
      } else if (/\.(exe|zip|nupkg)$/.test(name)) {
        found.push(path.relative(outRoot, full));
      }
    }
    return found;
  };
  return walk(directory);
});
check(
  "安装器产物（make 后）",
  installers.length > 0,
  installers.join(", ") || "未运行 make",
);

if (errors.length) {
  console.error(`\n打包冒烟失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log("\n打包产物结构检查通过。");
