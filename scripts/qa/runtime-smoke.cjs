const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const Sqlite = require("better-sqlite3");
const {
  connectCdp,
  delay,
} = require("../../tests/runtime/harness/cdp-client.cjs");
const {
  runPackagedSmoke,
} = require("../../tests/runtime/scenarios/packaged-smoke.cjs");

const root = path.resolve(__dirname, "../..");
const executable = process.argv[2] ?? path.join(
  root,
  "out",
  "RefCanvas-win32-x64",
  "RefCanvas.exe",
);
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`;
const qaRoot = path.join(os.tmpdir(), "RefCanvas-QA", runId);
const profile = path.join(qaRoot, "profile");
const browseRoot = path.join(qaRoot, "mounted-files");
const reportPath = path.join(qaRoot, "runtime-report.json");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs),
  ]);
  return child.exitCode !== null;
}

async function launchOnce(label) {
  const port = await reservePort();
  let output = "";
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let client;
  try {
    client = await connectCdp(port);
    const result = await runPackagedSmoke(client, browseRoot);
    await client.send("Browser.close").catch(() => undefined);
    const exited = await waitForExit(child, 10_000);
    if (!exited) {
      child.kill();
      throw new Error("PACKAGED_APP_SHUTDOWN_TIMEOUT");
    }
    if (
      /Uncaught Exception|UnhandledPromiseRejection|Error occurred in handler|database connection is not open|EINVAL[^\r\n]*DumpStack\.log\.tmp/i.test(
        output,
      )
    ) {
      throw new Error(`MAIN_PROCESS_EXCEPTION:${output}`);
    }
    return { label, ...result, output };
  } finally {
    client?.socket.close();
    if (child.exitCode === null) child.kill();
  }
}

function downgradeFixtureToV12() {
  const filename = path.join(profile, "refcanvas.db");
  const database = new Sqlite(filename);
  try {
    database.exec(`
      DROP TABLE IF EXISTS cache_entries;
      DROP TABLE IF EXISTS media_metadata;
      DROP TABLE IF EXISTS collection_refs;
      DROP TABLE IF EXISTS mount_roots;
      DROP TRIGGER IF EXISTS file_identities_mount_fk;
      DROP TRIGGER IF EXISTS file_identities_mount_update_fk;
      CREATE TABLE IF NOT EXISTS collection_sources (
        collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
        watch_root_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        UNIQUE(watch_root_path, relative_path)
      );
      DROP INDEX IF EXISTS assets_metadata_pending;
      DROP INDEX IF EXISTS assets_lifecycle_updated;
      DROP INDEX IF EXISTS assets_lifecycle_mtime;
      DROP INDEX IF EXISTS assets_lifecycle_title;
      DROP INDEX IF EXISTS assets_lifecycle_size;
      DROP INDEX IF EXISTS assets_lifecycle_rating;
      DROP INDEX IF EXISTS asset_tags_asset;
      DROP INDEX IF EXISTS collection_assets_asset;
      ALTER TABLE assets DROP COLUMN metadata_job_id;
      ALTER TABLE assets DROP COLUMN metadata_updated_at;
      ALTER TABLE assets DROP COLUMN metadata_error;
      ALTER TABLE assets DROP COLUMN metadata_status;
      PRAGMA user_version = 12;
    `);
  } finally {
    database.close();
  }
}

async function main() {
  if (!fs.existsSync(executable)) {
    throw new Error(`PACKAGED_EXECUTABLE_NOT_FOUND:${executable}`);
  }
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(browseRoot, { recursive: true });
  fs.writeFileSync(path.join(browseRoot, "runtime-smoke.txt"), "RefCanvas");
  const freshProfile = await launchOnce("fresh-profile-root-browse");
  downgradeFixtureToV12();
  const migrated = await launchOnce("schema-12-to-17");
  const verification = new Sqlite(path.join(profile, "refcanvas.db"), {
    readonly: true,
  });
  const schemaVersion = verification.pragma("user_version", { simple: true });
  const columns = verification.pragma("table_info(assets)").map((row) => row.name);
  verification.close();
  if (schemaVersion !== 17 || !columns.includes("metadata_status")) {
    throw new Error("PACKAGED_MIGRATION_VERIFICATION_FAILED");
  }
  const report = {
    runId,
    executable,
    profile,
    freshProfile,
    migrated,
    schemaVersion,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Packaged runtime smoke passed: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
