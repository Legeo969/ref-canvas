const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const failures = [];
const forbiddenRootEntries = ["artifacts", ".ui-verify-profile"];

for (const name of forbiddenRootEntries) {
  if (fs.existsSync(path.join(root, name))) failures.push(`forbidden root entry: ${name}`);
}
for (const name of fs.readdirSync(root)) {
  if (/\.log$/i.test(name)) failures.push(`root log: ${name}`);
  if (/^\.env(?:\.|$)/i.test(name) && name !== ".env.example") {
    failures.push(`secret environment file: ${name}`);
  }
}

let candidates;
try {
  candidates = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
    cwd: root,
    encoding: "utf8",
    },
  ).split("\0").filter(Boolean);
} catch {
  failures.push("Git repository is unavailable");
  candidates = [];
}

for (const relative of candidates) {
  const normalized = relative.replaceAll("\\", "/");
  if (/^(?:artifacts|out|\.vite|\.ui-verify-profile|node_modules)\//.test(normalized)) {
    failures.push(`tracked generated file: ${relative}`);
  }
  if (/\.(?:sqlite(?:-wal|-shm)?|db|log|tmp|temp)$/i.test(normalized)) {
    failures.push(`tracked runtime file: ${relative}`);
  }
  const filename = path.join(root, relative);
  if (fs.existsSync(filename) && fs.statSync(filename).size > 10 * 1024 * 1024) {
    failures.push(`tracked file exceeds 10 MiB: ${relative}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Repository hygiene passed (${candidates.length} candidate files).`);
}
