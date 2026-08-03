const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Database = require("better-sqlite3");
const WebSocket = require("ws");

const [exePath, userDataPath] = process.argv.slice(2);
if (!exePath || !userDataPath) {
  throw new Error("Usage: node scripts/runtime-034-smoke.cjs <exe> <user-data>");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];

async function connect(port) {
  let target;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      target = targets.find((item) => item.type === "page");
      if (target) break;
    } catch {}
    await delay(250);
  }
  if (!target) throw new Error("CDP_TARGET_NOT_FOUND");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let nextId = 1;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { socket, send };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function waitFor(send, expression, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(send, expression)) return;
    await delay(250);
  }
  throw new Error(`TIMEOUT_${label}`);
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const port = 9339;
  const child = spawn(
    exePath,
    [
      `--user-data-dir=${userDataPath}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
    ],
    { detached: false, stdio: "ignore", windowsHide: true },
  );

  let client;
  try {
    client = await connect(port);
    const { send } = client;

    await waitFor(
      send,
      `window.refCanvas && window.refCanvas.system && typeof window.refCanvas.system.getAppInfo === "function"`,
      "RENDERER_API",
    );
    console.log("renderer API ready");

    // 版本信息必须来自 app.getVersion()，不能是硬编码。
    const appInfo = await evaluate(
      send,
      `window.refCanvas.system.getAppInfo().then((info) => ({
        version: info.appVersion,
        electron: info.electronVersion,
        schema: info.databaseSchemaVersion,
        libraryPath: info.libraryPath,
        channel: info.installChannel,
      }))`,
    );
    console.log("appInfo:", JSON.stringify(appInfo));
    check("app.getVersion() returns 0.34.0", appInfo.version === "0.34.0", appInfo.version);
    check("schema version is 11", appInfo.schema === 11, `v${appInfo.schema}`);
    check("library path resolved", typeof appInfo.libraryPath === "string" && appInfo.libraryPath.length > 0, appInfo.libraryPath);

    // 资料库偏好：includeSubfolderAssets 默认 true、panelLayout 存在。
    const preferences = await evaluate(
      send,
      `window.refCanvas.library.getPreferences().then((p) => ({
        includeSubfolderAssets: p.includeSubfolderAssets,
        panelLayout: p.panelLayout,
        defaultStorageMode: p.defaultStorageMode,
      }))`,
    );
    console.log("libraryPreferences:", JSON.stringify(preferences));
    check(
      "includeSubfolderAssets defaults to true",
      preferences.includeSubfolderAssets === true,
    );
    check(
      "panelLayout persisted shape",
      preferences.panelLayout &&
        preferences.panelLayout.sidebarWidth === 260 &&
        preferences.panelLayout.assetWidth === 350 &&
        preferences.panelLayout.detailsWidth === 286,
      JSON.stringify(preferences.panelLayout),
    );
    check(
      "defaultStorageMode present",
      preferences.defaultStorageMode === "linked" ||
        preferences.defaultStorageMode === "managed",
      preferences.defaultStorageMode,
    );

    // 应用级偏好：boardSettings 完整默认。
    const appPreferences = await evaluate(
      send,
      `window.refCanvas.system.getPreferences().then((p) => ({
        backgroundResidency: p.backgroundResidency,
        boardSettings: p.boardSettings,
      }))`,
    );
    console.log("appPreferences:", JSON.stringify(appPreferences));
    check(
      "boardSettings defaults",
      appPreferences.boardSettings &&
        appPreferences.boardSettings.interactionPreset === "pureref" &&
        appPreferences.boardSettings.undoLimit === 99,
    );
    check("backgroundResidency defaults off", appPreferences.backgroundResidency === false);

    // 写入剪贴板（复制版本信息）API 可用。
    const clipboardResult = await evaluate(
      send,
      `window.refCanvas.system.writeClipboard("refcanvas-034-smoke").then(() => true)`,
    );
    check("writeClipboard works", clipboardResult === true);

    // 通过 IPC 写入应用级偏好，随后验证落库。
    const setPrefs = await evaluate(
      send,
      `window.refCanvas.system.setPreferences({ backgroundResidency: true, boardSettings: { undoLimit: 50 } }).then((p) => ({
        backgroundResidency: p.backgroundResidency,
        undoLimit: p.boardSettings.undoLimit,
      }))`,
    );
    check(
      "setPreferences merges boardSettings",
      setPrefs.backgroundResidency === true && setPrefs.undoLimit === 50,
      JSON.stringify(setPrefs),
    );
    const preferencesAfterSet = await evaluate(
      send,
      `window.refCanvas.system.getPreferences().then((p) => ({
        backgroundResidency: p.backgroundResidency,
        undoLimit: p.boardSettings.undoLimit,
        snapEnabled: p.boardSettings.snapEnabled,
      }))`,
    );
    check(
      "boardSettings merge preserved untouched fields",
      preferencesAfterSet.snapEnabled === true && preferencesAfterSet.undoLimit === 50,
      JSON.stringify(preferencesAfterSet),
    );

    // 阶段 2：本地目录浏览与 materialize。
    const fixture = path.join(userDataPath, "fixture");
    fs.mkdirSync(path.join(fixture, "sub"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "one.png"), Buffer.alloc(256, 3));
    fs.writeFileSync(path.join(fixture, "sub", "two.txt"), "hello");
    const listResult = await evaluate(
      send,
      `window.refCanvas.filesystem.listDirectory(${JSON.stringify(fixture)}, { pageSize: 100 }).then((page) => ({
        names: page.entries.map((e) => e.name).sort(),
        total: page.total,
      }))`,
    );
    check(
      "listDirectory returns one level without DB records",
      listResult.names.join(",") === "one.png,sub" && listResult.total === 2,
      listResult.names.join(","),
    );
    const roots = await evaluate(
      send,
      `window.refCanvas.filesystem.listRoots().then((roots) => roots.map((r) => r.path))`,
    );
    check("listRoots detects drive roots", Array.isArray(roots) && roots.length > 0, roots.join(","));

    const quickAccess = await evaluate(
      send,
      `window.refCanvas.filesystem.addQuickAccess(${JSON.stringify(fixture)}, "fixture").then((list) => list.map((e) => e.name))`,
    );
    check("quick access persists", quickAccess.includes("fixture"), quickAccess.join(","));

    const materialized = await evaluate(
      send,
      `window.refCanvas.filesystem.materialize(${JSON.stringify(path.join(fixture, "one.png"))}, { storageMode: "library-default" }).then((r) => ({
        created: r.created,
        path: r.asset.path,
      }))`,
    );
    check(
      "materialize creates linked record",
      materialized.created === true && materialized.path.endsWith("one.png"),
      materialized.path,
    );
    const materializedAgain = await evaluate(
      send,
      `window.refCanvas.filesystem.materialize(${JSON.stringify(path.join(fixture, "one.png"))}, { storageMode: "library-default" }).then((r) => r.created)`,
    );
    check("materialize reuses same path record", materializedAgain === false);

    const searchStarted = await evaluate(
      send,
      `window.refCanvas.filesystem.startSearch(${JSON.stringify(fixture)}, "two").then((id) => id)`,
    );
    check("startSearch returns an id", typeof searchStarted === "string" && searchStarted.length > 0);
    const searchDone = await evaluate(
      send,
      `(async () => {
        const id = ${JSON.stringify(searchStarted)};
        for (let i = 0; i < 60; i += 1) {
          const s = await window.refCanvas.filesystem.getSearch(id);
          if (s.state === "completed" || s.state === "cancelled") return s;
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      })()`,
    );
    check(
      "directory search found subdirectory match",
      searchDone &&
        searchDone.entries.some((e) => e.name === "two.txt") &&
        searchDone.state === "completed",
      JSON.stringify(searchDone?.entries?.map((e) => e.name)),
    );

    const renamed = await evaluate(
      send,
      `window.refCanvas.filesystem.rename(${JSON.stringify(path.join(fixture, "sub", "two.txt"))}, "renamed").then((r) => r.path)`,
    );
    check("filesystem.rename applies new name", renamed.endsWith("renamed.txt"), renamed);

    // 数据库文件：schema 11 + 设置表写入的偏好 JSON。
    const dbPath = path.join(userDataPath, "refcanvas.db");
    const databaseFile =
      fs.existsSync(dbPath)
        ? dbPath
        : (() => {
            const candidates = [];
            const walk = (dir) => {
              if (!fs.existsSync(dir)) return;
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  if (entry.name === "backups") continue;
                  walk(full);
                } else if (entry.name.endsWith(".sqlite") || entry.name.endsWith(".db")) {
                  candidates.push(full);
                }
              }
            };
            walk(userDataPath);
            return candidates[0];
          })();
    check("database file found", Boolean(databaseFile), databaseFile);
    if (databaseFile) {
      const db = new Database(databaseFile, { readonly: true });
      const userVersion = db.pragma("user_version", { simple: true });
      const settings = db
        .prepare("SELECT key FROM settings")
        .all()
        .map((row) => row.key);
      const boardCount = db.prepare("SELECT COUNT(*) AS n FROM boards").get().n;
      db.close();
      console.log(`db user_version=${userVersion}, settings=[${settings.join(", ")}], boards=${boardCount}`);
      check("database user_version is 11", userVersion === 11, `v${userVersion}`);
      check(
        "settings table persisted preferences",
        settings.includes("boardSettings") && settings.includes("backgroundResidency"),
        settings.join(", "),
      );
    }
  } catch (error) {
    failures.push(error.message);
    console.error("FAIL:", error.message);
  } finally {
    try { client?.socket?.close(); } catch {}
    child.kill();
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const { execSync } = require("node:child_process");
      execSync(`taskkill /F /T /PID ${child.pid} 2>nul || true`, { stdio: "ignore" });
    } catch {}
  }

  if (failures.length) {
    console.error(`\nRUNTIME_SMOKE_FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nRUNTIME_034_SMOKE_PASSED");
  }
}

main().catch((error) => {
  console.error("SMOKE_CRASH:", error);
  process.exitCode = 1;
});
