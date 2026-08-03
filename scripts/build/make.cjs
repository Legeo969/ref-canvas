const { spawnSync } = require("node:child_process");
const path = require("node:path");

const environment = { ...process.env };
const root = path.join(__dirname, "..", "..");
if (process.platform === "win32") {
  const powershellDirectory = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
  );
  environment.PATH = [powershellDirectory, process.env.PATH || ""].join(
    path.delimiter,
  );
}

const cli = path.join(
  root,
  "node_modules",
  "@electron-forge",
  "cli",
  "dist",
  "electron-forge.js",
);
const result = spawnSync(process.execPath, [cli, "make"], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;
