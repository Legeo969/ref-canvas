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
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

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
    "assets/native/openimageio/win32-x64/oiiotool.exe",
    "assets/native/openimageio/win32-x64/OpenImageIO.dll",
    "assets/native/openimageio/win32-x64/OpenEXR_v_3_3_5_OpenImageIO_v3_1.dll",
    "assets/native/openimageio/win32-x64/msvcp140.dll",
    "assets/native/openimageio/win32-x64/vcruntime140.dll",
    "assets/native/openimageio/win32-x64/vcruntime140_1.dll",
  ]) {
    check(
      `unpacked: ${required}`,
      fs.existsSync(path.join(unpacked, required)),
    );
  }
  const oiioRoot = path.join(unpacked, "assets", "native", "openimageio");
  const runtimeManifestPath = path.join(oiioRoot, "RUNTIME-MANIFEST.json");
  check("OpenImageIO runtime manifest", fs.existsSync(runtimeManifestPath));
  if (fs.existsSync(runtimeManifestPath)) {
    try {
      const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
      for (const item of runtimeManifest.files) {
        const filename = path.join(oiioRoot, ...item.path.split("/"));
        const digest = fs.existsSync(filename) ? createHash("sha256").update(fs.readFileSync(filename)).digest("hex") : "missing";
        check(`runtime hash: ${item.path}`, digest === item.sha256);
      }
      const actual = [];
      const walkRuntime = (directory) => {
        for (const name of fs.readdirSync(directory).sort()) {
          const filename = path.join(directory, name);
          if (fs.statSync(filename).isDirectory()) walkRuntime(filename);
          else if (filename !== runtimeManifestPath) actual.push(path.relative(oiioRoot, filename).replaceAll("\\", "/"));
        }
      };
      walkRuntime(oiioRoot);
      check("runtime explicit allowlist", JSON.stringify(actual.sort()) === JSON.stringify(runtimeManifest.files.map((item) => item.path).sort()));

      const packagedTool = path.join(oiioRoot, "win32-x64", "oiiotool.exe");
      const versionOutput = execFileSync(packagedTool, ["--version"], { encoding: "utf8", timeout: 15_000 });
      check("packaged oiiotool launches", versionOutput.includes("3.1.16.0"), versionOutput.trim());
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "refcanvas-package-oiio-"));
      try {
        const source = path.join(temporary, "beauty-dwaa.exr");
        const preview = path.join(temporary, "preview.png");
        execFileSync(packagedTool, ["--create", "32x16", "3", "--fill:color=0.05,0.1,0.2", "32x16", "--fill:color=0.8,0.4,0.1", "16x16+16+0", "--chnames", "Beauty.R,Beauty.G,Beauty.B", "--scanline", "--compression", "dwaa", "-d", "half", "-o", source], { timeout: 15_000 });
        execFileSync(packagedTool, [source, "--subimage", "0", "--flatten", "--ch", "Beauty.R,Beauty.G,Beauty.B", "--colorconvert", "linear", "sRGB", "-d", "uint8", "-o", preview], { timeout: 15_000 });
        const stats = execFileSync(packagedTool, ["--stats", preview], { encoding: "utf8", timeout: 15_000 });
        check("packaged DWAA Beauty decode", fs.existsSync(preview) && fs.statSync(preview).size > 100 && /Constant:\s+No/i.test(stats), `${fs.statSync(preview).size} bytes, non-flat`);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    } catch (error) {
      check("packaged OpenImageIO executable smoke", false, error.message);
    }
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
