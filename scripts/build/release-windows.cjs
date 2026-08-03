const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const version = require(path.join(root, "package.json")).version;
const releaseDirectory = process.env.REFCANVAS_RELEASE_DIRECTORY ??
  path.join(path.dirname(root), "ref-canvas-releases", version);
const pnpmCli = process.env.npm_execpath;
const signingConfigured = Boolean(
  process.env.REFCANVAS_CERTIFICATE_FILE ||
    process.env.REFCANVAS_SIGN_WITH_PARAMS,
);

function run(script) {
  const result = pnpmCli
    ? spawnSync(process.execPath, [pnpmCli, script], {
        cwd: root,
        stdio: "inherit",
      })
    : spawnSync("pnpm", [script], { cwd: root, stdio: "inherit" });
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
fs.writeFileSync(
  path.join(root, "docs", "releases", `${version}-manifest.json`),
  serialized,
);
console.log(`Windows release ready: ${releaseDirectory}`);
