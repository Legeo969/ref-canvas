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

// Files to include in the zip (everything except dev tooling).
const includedFiles = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "README.md",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

fs.mkdirSync(outDir, { recursive: true });

// Use PowerShell Compress-Archive on Windows (always available, no extra deps).
const staging = path.join(outDir, "_ext-staging");
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, "icons"), { recursive: true });

for (const file of includedFiles) {
  const src = path.join(extDir, file);
  const dst = path.join(staging, file);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// Remove old zip if exists.
fs.rmSync(zipPath, { force: true });

// Create zip. Compress-Archive (Windows PowerShell 5.1) writes entry names with
// backslashes ("icons\icon-16.png"), which violates the ZIP spec (forward slash
// only) — spec-strict extractors (Chrome included) then fail "Load unpacked"
// with "Could not load icon". bsdtar (ships with Windows 10 1803+) writes
// spec-compliant entries; call it by absolute path so Git Bash's GNU tar
// (which cannot write zip) never shadows it.
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
