/**
 * Packages the RefCanvas browser extension into a distributable .zip.
 *
 * Usage: node scripts/build/package-extension.cjs
 * Output: out/refcanvas-browser-capture-<version>.zip
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const extDir = path.join(root, "extensions", "browser-capture");
const version = require(path.join(extDir, "manifest.json")).version;
const outDir = path.join(root, "out");
const zipName = `refcanvas-browser-capture-${version}.zip`;
const zipPath = path.join(outDir, zipName);

// Top-level entries to include (everything except dev tooling like
// generate-icons.cjs). Files are collected recursively, so adding new
// extension files never requires touching this script.
const includedEntries = [
  "manifest.json",
  "README.md",
  "background",
  "content",
  "popup",
  "options",
  "icons",
];

function collectFiles(basePath, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(basePath, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

fs.mkdirSync(outDir, { recursive: true });

// Stage included files into a clean tree so the zip mirrors the extension
// layout exactly.
const staging = path.join(outDir, "_ext-staging");
fs.rmSync(staging, { recursive: true, force: true });
for (const entry of includedEntries) {
  const source = path.join(extDir, entry);
  if (!fs.existsSync(source)) {
    throw new Error(`Extension entry missing: ${entry}`);
  }
  const destination = path.join(staging, entry);
  fs.cpSync(source, destination, { recursive: true });
}
const includedFiles = collectFiles(staging);

// Remove old zip if exists.
fs.rmSync(zipPath, { force: true });

// Create zip. Compress-Archive (Windows PowerShell 5.1) writes entry names with
// backslashes ("icons\icon-16.png"), which violates the ZIP spec (forward slash
// only) — spec-strict extractors (Chrome included) then fail "Load unpacked"
// with "Could not load icon". bsdtar (ships with Windows 10 1803+) writes
// spec-compliant entries; call it by absolute path so Git Bash's GNU tar,
// which cannot write zip, never shadows it.
const systemRoot = process.env.SystemRoot || "C:\\Windows";
const tarExe = path.join(systemRoot, "System32", "tar.exe");
if (!fs.existsSync(tarExe)) {
  throw new Error(`bsdtar not found at ${tarExe}; cannot package extension`);
}
execFileSync(
  tarExe,
  ["-a", "-c", "-f", zipPath, "-C", staging, ...includedFiles],
  { stdio: "inherit" },
);

// Cleanup staging.
fs.rmSync(staging, { recursive: true, force: true });

const size = fs.statSync(zipPath).size;
console.log(`Extension packaged: ${zipPath} (${(size / 1024).toFixed(1)} KB)`);
