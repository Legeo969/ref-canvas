const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const version = "3.1.16.0";
const wheelName = `openimageio-${version}-cp313-cp313-win_amd64.whl`;
const expectedSha256 = "c0e2b5599fd0d346115387db77a196b5e47441857f4a0c34071e57e7fda73b03";
const root = path.resolve(__dirname, "../..");
const nativeRoot = path.join(root, "assets", "native");
const destination = path.join(nativeRoot, "openimageio");
const wheelBinaries = [
  "freetype.dll", "GIF.dll", "Iex_v_3_3_5_OpenImageIO_v3_1.dll",
  "IlmThread_v_3_3_5_OpenImageIO_v3_1.dll", "Imath_v_3_1_10_OpenImageIO_v3_1.dll",
  "oiiotool.exe", "OpenEXR_v_3_3_5_OpenImageIO_v3_1.dll",
  "OpenEXRCore_v_3_3_5_OpenImageIO_v3_1.dll", "OpenEXRUtil_v_3_3_5_OpenImageIO_v3_1.dll",
  "OpenImageIO_Util.dll", "OpenImageIO.dll", "openjp2.dll", "tiff.dll", "zlib1.dll",
];
const crtBinaries = [
  "concrt140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "msvcp140_atomic_wait.dll",
  "msvcp140_codecvt_ids.dll", "msvcp140.dll", "vccorlib140.dll", "vcruntime140_1.dll",
  "vcruntime140_threads.dll", "vcruntime140.dll",
];

function hashFile(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function copyRequired(source, target, names) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of names) {
    const input = path.join(source, name);
    if (!fs.existsSync(input)) throw new Error(`OPENIMAGEIO_REQUIRED_FILE_MISSING:${name}`);
    fs.copyFileSync(input, path.join(target, name));
  }
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("OPENIMAGEIO_INSTALL_REQUIRES_WINDOWS_X64");
  const metadata = await fetch(`https://pypi.org/pypi/OpenImageIO/${version}/json`);
  if (!metadata.ok) throw new Error(`OPENIMAGEIO_METADATA_HTTP_${metadata.status}`);
  const wheel = (await metadata.json()).urls.find((item) => item.filename === wheelName);
  if (!wheel) throw new Error("OPENIMAGEIO_PINNED_WHEEL_NOT_FOUND");
  const response = await fetch(wheel.url);
  if (!response.ok) throw new Error(`OPENIMAGEIO_WHEEL_HTTP_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedSha256) throw new Error(`OPENIMAGEIO_WHEEL_HASH_MISMATCH:${digest}`);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "refcanvas-oiio-"));
  const staging = path.join(nativeRoot, `.openimageio-stage-${randomUUID()}`);
  const backup = path.join(nativeRoot, `.openimageio-backup-${randomUUID()}`);
  let backedUp = false;
  try {
    const wheelPath = path.join(temporary, wheelName);
    const extracted = path.join(temporary, "extracted");
    fs.writeFileSync(wheelPath, bytes);
    fs.mkdirSync(extracted);
    execFileSync("tar", ["-xf", wheelPath, "-C", extracted]);
    const binaryDestination = path.join(staging, "win32-x64");
    copyRequired(path.join(extracted, "OpenImageIO", "bin"), binaryDestination, wheelBinaries);

    const redistRoot = path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft Visual Studio", "2022", "BuildTools", "VC", "Redist", "MSVC");
    const redistVersion = fs.existsSync(redistRoot) ? fs.readdirSync(redistRoot).filter((name) => /^\d/.test(name)).sort().at(-1) : null;
    const crtSource = redistVersion ? path.join(redistRoot, redistVersion, "x64", "Microsoft.VC143.CRT") : null;
    if (!crtSource || !fs.existsSync(crtSource)) throw new Error("OPENIMAGEIO_MSVC_REDISTRIBUTABLE_NOT_FOUND");
    copyRequired(crtSource, binaryDestination, crtBinaries);

    const wheelLicenses = path.join(extracted, `openimageio-${version}.dist-info`, "licenses");
    fs.copyFileSync(path.join(wheelLicenses, "LICENSE.md"), path.join(staging, "LICENSE.md"));
    fs.copyFileSync(path.join(wheelLicenses, "THIRD-PARTY.md"), path.join(staging, "THIRD-PARTY.md"));
    const licenseSource = path.join(__dirname, "openimageio-licenses");
    const licenseDestination = path.join(staging, "licenses");
    fs.mkdirSync(licenseDestination);
    for (const name of fs.readdirSync(licenseSource).sort()) fs.copyFileSync(path.join(licenseSource, name), path.join(licenseDestination, name));

    const files = [];
    const collect = (directory) => {
      for (const name of fs.readdirSync(directory).sort()) {
        const filename = path.join(directory, name);
        if (fs.statSync(filename).isDirectory()) collect(filename);
        else files.push({ path: path.relative(staging, filename).replaceAll("\\", "/"), sha256: hashFile(filename), bytes: fs.statSync(filename).size });
      }
    };
    collect(staging);
    fs.writeFileSync(path.join(staging, "RUNTIME-MANIFEST.json"), `${JSON.stringify({ version, wheel: wheelName, wheelSha256: digest, files }, null, 2)}\n`);

    fs.mkdirSync(nativeRoot, { recursive: true });
    if (fs.existsSync(destination)) { fs.renameSync(destination, backup); backedUp = true; }
    fs.renameSync(staging, destination);
    if (backedUp) { fs.rmSync(backup, { recursive: true, force: true }); backedUp = false; }
    console.log(`OpenImageIO ${version} installed atomically (${files.length} hashed files, ${digest})`);
  } catch (error) {
    if (backedUp && !fs.existsSync(destination)) fs.renameSync(backup, destination);
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
