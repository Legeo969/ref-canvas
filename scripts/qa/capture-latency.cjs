const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

/**
 * 区域截图延迟回归（点击 → 覆盖窗口底图解码完成）。
 *
 * 用法：
 *   node scripts/qa/capture-latency.cjs <RefCanvas.exe> [--runs N]
 *
 * 门槛（4K/1080p 单屏，Windows）：
 *   - 原生后端 p95 ≤ 300ms
 *   - 回退后端（REFCANVAS_DISABLE_NATIVE_CAPTURE=1）仍能截通，只记数值不设门槛
 *
 * 每次运行使用独立 userData，不碰真实资料库。窗口复用是硬断言：连拍 N 次
 * 覆盖窗口的 CDP target id 必须恒定，否则说明又退回到"每次新建窗口"。
 */

const executable = process.argv[2];
const runsArg = process.argv.indexOf("--runs");
const runs = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 5;
if (!executable || !fs.existsSync(executable)) {
  throw new Error("Usage: node scripts/qa/capture-latency.cjs <RefCanvas.exe> [--runs N]");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForTargets(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await targets(port).catch(() => null);
    if (list?.some((item) => item.url.includes("capture=1"))) return list;
    await delay(250);
  }
  throw new Error("CAPTURE_TARGET_NOT_FOUND");
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
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

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs),
  ]);
  return child.exitCode !== null;
}

async function measure(label, env) {
  const port = await reservePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "refcanvas-capture-"));
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
      // 隐藏窗口里的 rAF/IPC 会被节流；QA 一律按前台对待，否则测的是节流。
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } },
  );
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    const list = await waitForTargets(port);
    const main = await connect(
      list.find((item) => !item.url.includes("capture=1")).webSocketDebuggerUrl,
    );
    const overlay = await connect(
      list.find((item) => item.url.includes("capture=1")).webSocketDebuggerUrl,
    );
    await evaluate(main, "window.refCanvas.system.cancelRegionCapture()").catch(() => undefined);

    const samples = [];
    const windowIds = new Set();
    for (let index = 0; index < runs; index += 1) {
      const previous = await evaluate(
        overlay,
        "document.querySelector('.capture-overlay img')?.src ?? ''",
      );
      const startedAt = Date.now();
      await evaluate(main, "window.refCanvas.system.prepareRegionCapture()");
      let elapsed = null;
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const ready = await evaluate(
          overlay,
          `(() => {
            const img = document.querySelector('.capture-overlay img');
            if (!img || img.src === ${JSON.stringify(previous)}) return false;
            return img.complete && img.naturalWidth > 0;
          })()`,
        );
        if (ready) { elapsed = Date.now() - startedAt; break; }
        await delay(5);
      }
      if (elapsed === null) throw new Error(`CAPTURE_NEVER_PAINTED_${index}`);
      samples.push(elapsed);
      windowIds.add(
        (await targets(port)).find((item) => item.url.includes("capture=1")).id,
      );
      await evaluate(main, "window.refCanvas.system.cancelRegionCapture()");
      await delay(400);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[sorted.length - 1];
    console.log(`${label}: samples=[${samples.join(", ")}] p50=${p50}ms p95=${p95}ms windows=${windowIds.size}`);
    if (windowIds.size !== 1) throw new Error("CAPTURE_WINDOW_NOT_REUSED");

    main.socket.close();
    overlay.socket.close();
    return { p50, p95 };
  } catch (error) {
    if (/Uncaught Exception|UnhandledPromiseRejection/.test(output)) {
      console.error(output.slice(-2_000));
    }
    throw error;
  } finally {
    child.kill();
    await waitForExit(child, 10_000);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

(async () => {
  const native = await measure("native", {});
  if (native.p95 > 300) {
    throw new Error(`CAPTURE_P95_EXCEEDED: ${native.p95}ms > 300ms`);
  }
  // 回退后端只验证"还能用"，不给性能门槛：它本来就是慢速兜底。
  await measure("electron-fallback", { REFCANVAS_DISABLE_NATIVE_CAPTURE: "1" });
  console.log("capture latency ok");
})().catch((error) => {
  console.error("CAPTURE_LATENCY_FAILED", error);
  process.exitCode = 1;
});
