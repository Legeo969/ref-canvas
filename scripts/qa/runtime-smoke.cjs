const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const Sqlite = require("better-sqlite3");
const ffmpegStatic = require("ffmpeg-static");
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
const screenshotRoot = path.join(qaRoot, "screenshots");

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
      // 烟测期间窗口可能被遮挡/最小化，Chromium 会把 rAF 节流到 0、后台
      // 定时器钳到 ≥1s：曾导致白板编辑的 rAF 门控持久化永远不触发
      // （BOARD_PNG_FORMAT_CARD）。QA 运行一律按前台窗口对待。
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let client;
  try {
    client = await connectCdp(port);
    const result = await runPackagedSmoke(client, browseRoot, screenshotRoot, label);
    await client.send("Browser.close").catch(() => undefined);
    const exited = await waitForExit(child, 10_000);
    if (!exited) {
      child.kill();
      throw new Error("PACKAGED_APP_SHUTDOWN_TIMEOUT");
    }
    // DIRECTORY_REVISION_CHANGED 是目录扫描 revision 竞争时的正常业务拒绝
    // （渲染端会重试），不是主进程崩溃；从检测输出中剔除，避免偶发误报。
    // INVALID_IPC_SENDER 是旧文档定时器在页面 reload 卸载窗口内触发时，
    // 从已销毁的 frame 发 IPC 产生的安全拒绝（渲染端 .catch(() => undefined)
    // 已吞掉），不是主进程崩溃；同样剔除，避免偶发误报。
    const filteredOutput = output.replace(
      /Error occurred in handler for 'filesystem:locate-entry': Error: DIRECTORY_REVISION_CHANGED[^\n]*\n?/g,
      "",
    ).replace(
      /Error occurred in handler for 'filesystem:preview-token[s]?': Error: INVALID_IPC_SENDER[^\n]*\n?/g,
      "",
    );
    if (
      /Uncaught Exception|UnhandledPromiseRejection|Error occurred in handler|database connection is not open|EINVAL[^\r\n]*DumpStack\.log\.tmp/i.test(
        filteredOutput,
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
  fs.mkdirSync(screenshotRoot, { recursive: true });
  fs.writeFileSync(path.join(browseRoot, "runtime-smoke.txt"), "RefCanvas");
  fs.writeFileSync(
    path.join(browseRoot, "runtime-board.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wHwIGgImBgeE/AA6mAwLWAo9SAAAAAElFTkSuQmCC",
      "base64",
    ),
  );
  fs.writeFileSync(
    path.join(browseRoot, "runtime-still.jpg"),
    Buffer.from(
      "/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIkAPQp//9k=",
      "base64",
    ),
  );
  const stillImageFixtures = {
    "runtime-still.webp": "UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoEAAQAAMASJYgCdLoB+AADsAD+/ZVV/5miY5j9q//ylUWqbcUAAA==",
    "runtime-still.bmp": "Qk1mAAAAAAAAADYAAAAoAAAABAAAAAQAAAABABgAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQSVjQS",
    "runtime-still.avif": "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANRtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+AABAAAAAAAAACgAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVGlwcnAAAAA2aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAQAAAAEAAAADnBpeGkAAAAAAQgAAAAWaXBtYQAAAAAAAAABAAEDgQIDAAAAMG1kYXQSAAoIOAR9pAQ0GkAyGhICQ0qAAPIAAP9cCJEvSUS9rSx3dWQmcOLE",
  };
  for (const [filename, contents] of Object.entries(stillImageFixtures)) {
    fs.writeFileSync(path.join(browseRoot, filename), Buffer.from(contents, "base64"));
  }
  fs.writeFileSync(
    path.join(browseRoot, "runtime-still.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123456"/></svg>',
  );
  execFileSync(ffmpegStatic, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
    "-t", "2", "-pix_fmt", "yuv420p",
    path.join(browseRoot, "runtime-preview.mp4"),
  ]);
  execFileSync(ffmpegStatic, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=32x32:rate=4",
    "-t", "1", "-loop", "0",
    path.join(browseRoot, "runtime-still.gif"),
  ]);
  // 目录切换缓存场景：dir-a 小图 + 大 EXR（模拟用户的大素材目录），
  // dir-b 只有小图。大 EXR 由仓库自带的 oiiotool 生成；缺失时降级为小图。
  fs.mkdirSync(path.join(browseRoot, "dir-a"), { recursive: true });
  fs.mkdirSync(path.join(browseRoot, "dir-b"), { recursive: true });
  for (const name of ["runtime-still.jpg", "runtime-still.bmp", "runtime-still.webp"]) {
    fs.copyFileSync(
      path.join(browseRoot, name),
      path.join(browseRoot, "dir-a", name),
    );
  }
  fs.copyFileSync(
    path.join(browseRoot, "runtime-still.bmp"),
    path.join(browseRoot, "dir-b", "small-a.bmp"),
  );
  fs.copyFileSync(
    path.join(browseRoot, "runtime-still.webp"),
    path.join(browseRoot, "dir-b", "small-b.webp"),
  );
  const devOiiotool = path.join(
    root,
    "assets",
    "native",
    "openimageio",
    "win32-x64",
    "oiiotool.exe",
  );
  if (fs.existsSync(devOiiotool)) {
    // EXR 吸色场景 fixture：已知颜色（线性 0.2/0.4/0.6 → sRGB ≈ 123,168,202）。
    execFileSync(devOiiotool, [
      "--create", "64x64", "3",
      "--fill:color=0.2,0.4,0.6", "64x64",
      "--chnames", "R,G,B",
      "--scanline", "--compression", "zip", "-d", "half",
      "-o", path.join(browseRoot, "runtime-still.exr"),
    ]);
    execFileSync(devOiiotool, [
      "--pattern", "noise:type=gaussian:mean=0.5:stddev=0.25",
      "4096x2048", "3", "-d", "half", "--compression", "zip",
      "-o", path.join(browseRoot, "dir-a", "big-noise.exr"),
    ]);
    // 独立序列对话框的工具菜单场景：3 帧迷你序列（帧率快、持续换帧，
    // 用于验证播放期间打开的工具菜单不会被下一帧关闭）。
    for (let index = 0; index < 3; index += 1) {
      execFileSync(devOiiotool, [
        "--create", "32x32", "3",
        `--fill:color=0.2,0.3,${0.4 + index * 0.2}`, "32x32",
        "--chnames", "R,G,B",
        "--scanline", "--compression", "zip", "-d", "half",
        "-o", path.join(browseRoot, `smoke-seq_${String(index + 1).padStart(4, "0")}.exr`),
      ]);
    }
  } else {
    fs.copyFileSync(
      path.join(browseRoot, "runtime-still.jpg"),
      path.join(browseRoot, "dir-a", "big-fallback.jpg"),
    );
  }
  const freshProfile = await launchOnce("fresh-profile-root-browse");
  downgradeFixtureToV12();
  const migrated = await launchOnce("schema-12-to-20");
  const verification = new Sqlite(path.join(profile, "refcanvas.db"), {
    readonly: true,
  });
  const schemaVersion = verification.pragma("user_version", { simple: true });
  const assetColumns = verification.pragma("table_info(assets)").map((row) => row.name);
  const boardColumns = verification.pragma("table_info(boards)").map((row) => row.name);
  verification.close();
  if (
    schemaVersion !== 20 ||
    !assetColumns.includes("metadata_status") ||
    !boardColumns.includes("revision")
  ) {
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
