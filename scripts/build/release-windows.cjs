const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const version = require(path.join(root, "package.json")).version;
const releaseDirectory = process.env.REFCANVAS_RELEASE_DIRECTORY ??
  path.join(path.dirname(root), "ref-canvas-releases", version);
// pnpm 11 on Windows reports npm_execpath as pnpm.exe; Node cannot load an
// executable as a script, so call the binary directly instead of wrapping it
// in process.execPath. Only a JS entry point goes through node.
const pnpmCli = process.env.npm_execpath;
const pnpmInvocation = !pnpmCli
  ? { command: "pnpm", args: [], shell: process.platform === "win32" }
  : /\.(?:cjs|mjs|js)$/i.test(pnpmCli)
    ? { command: process.execPath, args: [pnpmCli], shell: false }
    : { command: pnpmCli, args: [], shell: false };
const signingConfigured = Boolean(
  process.env.REFCANVAS_CERTIFICATE_FILE ||
    process.env.REFCANVAS_SIGN_WITH_PARAMS,
);

// Squirrel releasify 用 TMP/TEMP 解析临时目录；指向服务账户 profile 时
// WriteZipToSetup 内嵌失败但退出码仍为 0（回归：0.39.3 构建产出 236KB
// 空壳安装包）。整个发布期间把临时目录固定到用户 profile，子进程继承。
const userTempDirectory = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "AppData", "Local", "Temp")
  : undefined;
if (userTempDirectory) {
  fs.mkdirSync(userTempDirectory, { recursive: true });
  process.env.TMP = userTempDirectory;
  process.env.TEMP = userTempDirectory;
}

function run(script) {
  const result = spawnSync(
    pnpmInvocation.command,
    [...pnpmInvocation.args, script],
    { cwd: root, stdio: "inherit", shell: pnpmInvocation.shell },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(filename) : [filename];
  });
}

function sha256(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

run("check:release");
run("make");
run("test:runtime");

const made = filesBelow(path.join(root, "out", "make"));
const setup = made.find((filename) => /RefCanvas-Setup(?:-unsigned)?\.exe$/i.test(filename));
const zip = made.find(
  (filename) => path.basename(filename) === `RefCanvas-win32-x64-${version}.zip`,
);
const fullPackage = made.find(
  (filename) =>
    path.extname(filename) === ".nupkg" &&
    path.basename(filename).includes(`-${version}-full`),
);
const expectedSetupName = signingConfigured
  ? "RefCanvas-Setup.exe"
  : "RefCanvas-Setup-unsigned.exe";
if (
  !setup ||
  !zip ||
  !fullPackage ||
  path.basename(setup) !== expectedSetupName
) {
  throw new Error("WINDOWS_RELEASE_OUTPUT_OR_VERSION_MISMATCH");
}

// releasify 内嵌 nupkg 失败时仍以 0 退出，留下约 200KB 的空壳 Setup。
// Setup 必须内嵌完整包，因此要求其体积严格大于 nupkg 本体。
if (fs.statSync(setup).size <= fs.statSync(fullPackage).size) {
  throw new Error(
    "WINDOWS_RELEASE_SETUP_MISSING_EMBEDDED_PAYLOAD (see node_modules/electron-winstaller/vendor/Squirrel-Releasify.log)",
  );
}

fs.mkdirSync(releaseDirectory, { recursive: true });
const setupTarget = path.join(releaseDirectory, path.basename(setup));
const zipTarget = path.join(
  releaseDirectory,
  `RefCanvas-win32-x64-${version}.zip`,
);
fs.copyFileSync(setup, setupTarget);
fs.copyFileSync(zip, zipTarget);
const files = [setupTarget, zipTarget].map((filename) => ({
  filename: path.basename(filename),
  bytes: fs.statSync(filename).size,
  sha256: sha256(filename),
}));
const manifest = {
  product: "RefCanvas",
  version,
  platform: "win32-x64",
  signed: signingConfigured,
  createdAt: new Date().toISOString(),
  files,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
fs.writeFileSync(path.join(releaseDirectory, "manifest.json"), serialized);
fs.mkdirSync(path.join(root, "docs", "releases"), { recursive: true });
fs.writeFileSync(
  path.join(root, "docs", "releases", `${version}-manifest.json`),
  serialized,
);
console.log(`Windows release ready: ${releaseDirectory}`);
