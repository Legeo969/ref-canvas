const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

/**
 * FPS 采集（数据层可自动化的部分）：
 *  - 白板 2000 张 4K 素材代理的平移/缩放 rAF FPS（?fps=1 钩子）
 *  - 虚拟网格滚动的 rAF FPS
 * 数值门槛：白板平均 ≥55 FPS、P95 frame ≤24ms；网格 ≥50 FPS。
 */
const [exePath, userDataPath, outputPath] = process.argv.slice(2);
if (!exePath || !userDataPath || !outputPath) {
  throw new Error(
    "Usage: node tests/runtime/fps-check.cjs <exe> <user-data> <output.json>",
  );
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port) {
  let target;
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(send, expression)) return;
    await delay(250);
  }
  throw new Error(`TIMEOUT_${label}`);
}

async function main() {
  const port = 9347;
  const child = spawn(
    exePath,
    [
      `--user-data-dir=${userDataPath}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
      "--fps-check",
    ],
    { detached: false, stdio: "ignore", windowsHide: true },
  );

  const results = {
    capturedAt: new Date().toISOString(),
    board: null,
    grid: null,
    assetClick: null,
    eventLoopLag: null,
    notes: [],
  };
  let client;

  try {
    client = await connect(port);
    const { send } = client;
    await waitFor(
      send,
      `window.refCanvas && typeof window.refCanvas.boards?.list === "function"`,
      "RENDERER_API",
    );

    // 确保有白板打开（legacy 库启动自带“参考板 01”）。
    await evaluate(
      send,
      `(async () => {
        const boards = await window.refCanvas.boards.list();
        if (!boards.length) await window.refCanvas.boards.create("FPS 测试板");
        const current = await window.refCanvas.libraries.current();
        return current ? true : false;
      })()`,
    );

    // 等待 FPS 钩子挂上。
    await waitFor(
      send,
      `typeof window.__boardCanvas === "function" && typeof window.__spawnBoardImages === "function"`,
      "FPS_HOOKS",
    );
    await delay(600);

    // 2000 张合成 4K 素材通过 512 代理进入白板。
    const objectCount = await evaluate(
      send,
      `(async () => {
        const canvas = window.__boardCanvas();
        const existing = canvas.getObjects();
        for (const obj of existing) canvas.remove(obj);
        const count = window.__spawnBoardImages(2000);
        return count;
      })()`,
    );
    console.log(`spawned ${objectCount} board image proxies`);
    await delay(500);
    await evaluate(
      send,
      `(() => {
        document.querySelector(".board-first-hint button")?.click();
        return true;
      })()`,
    );
    await delay(120);

    for (const percent of [25, 100, 400]) {
      await evaluate(
        send,
        `(() => {
          const canvas = window.__boardCanvas();
          const object = canvas.getObjects()[0];
          const zoom = ${percent} / 100;
          canvas.setActiveObject(object);
          const center = object.getCenterPoint();
          canvas.setViewportTransform([
            zoom, 0, 0, zoom,
            canvas.width / 2 - center.x * zoom,
            canvas.height / 2 - center.y * zoom,
          ]);
          canvas.requestRenderAll();
          return true;
        })()`,
      );
      await delay(120);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(path.dirname(outputPath), `board-controls-${percent}.png`),
        Buffer.from(screenshot.data, "base64"),
      );
    }

    const boardIdle = await evaluate(
      send,
      `window.__sampleFps(2)`,
    );
    results.board = { scenario: "2000 对象静止", ...boardIdle };

    // 平移/缩放：CDP Input 拖动模拟（400ms 采样间隔内连续 4 秒操作）。
    const panStart = await evaluate(send, `window.__sampleFps(4)`);
    // 并行执行：一边拖动一边采样。
    const sampleDuringPan = evaluate(send, `window.__sampleFps(4)`);
    const { left, top, width, height } = await evaluate(
      send,
      `(() => {
        const el = window.__boardCanvas().getElement();
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()`,
    );
    const cx = Math.round(left + width / 2);
    const cy = Math.round(top + height / 2);
    const panBefore = await evaluate(
      send,
      `window.__boardCanvas().viewportTransform.slice(4, 6)`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: cx,
      y: cy,
      button: "middle",
      buttons: 4,
    });
    for (let step = 0; step < 120; step += 1) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: cx + Math.round(Math.sin(step / 12) * 160),
        y: cy + Math.round(Math.cos(step / 18) * 90),
        button: "middle",
        buttons: 4,
      });
      await delay(16);
    }
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: cx,
      y: cy,
      button: "middle",
      buttons: 0,
    });
    const pan = await sampleDuringPan;
    const panAfter = await evaluate(
      send,
      `window.__boardCanvas().viewportTransform.slice(4, 6)`,
    );
    if (panBefore[0] === panAfter[0] && panBefore[1] === panAfter[1]) {
      throw new Error("BOARD_MIDDLE_PAN_DID_NOT_MOVE_VIEWPORT");
    }
    results.boardPanZoom = {
      scenario: "2000 对象平移",
      viewportBefore: panBefore,
      viewportAfter: panAfter,
      ...pan,
    };
    void panStart;

    // 滚轮缩放期间采样。
    const zoomSample = evaluate(send, `window.__sampleFps(3)`);
    for (let step = 0; step < 80; step += 1) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: cx,
        y: cy,
        deltaX: 0,
        deltaY: step % 2 === 0 ? -60 : 60,
      });
      await delay(18);
    }
    const zoom = await zoomSample;
    results.boardZoom = { scenario: "2000 对象缩放", ...zoom };
    for (const sample of [boardIdle, pan, zoom]) {
      if (sample.averageFps < 55 || sample.p95FrameMs > 24) {
        throw new Error(
          `BOARD_PERFORMANCE_BELOW_TARGET_${sample.averageFps}_${sample.p95FrameMs}`,
        );
      }
    }
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");

    // 虚拟网格滚动：导入一批文件后滚动素材区。
    const fixture = path.join(userDataPath, "fps-fixture");
    fs.mkdirSync(fixture, { recursive: true });
    for (let index = 0; index < 240; index += 1) {
      fs.writeFileSync(
        path.join(fixture, `pic-${String(index).padStart(4, "0")}.png`),
        Buffer.alloc(64, index % 255),
      );
    }
    await evaluate(
      send,
      `window.refCanvas.library.importPaths([${JSON.stringify(fixture)}])`,
    );
    await delay(1200);
    const assetClick = await evaluate(
      send,
      `(async () => {
        const cards = [...document.querySelectorAll(".asset-card")];
        if (!cards.length) throw new Error("ASSET_CARDS_MISSING");
        const samples = [];
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const startedAt = performance.now();
          cards[attempt % cards.length].click();
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          samples.push(performance.now() - startedAt);
        }
        samples.sort((left, right) => left - right);
        return {
          p95Ms: samples[Math.floor(samples.length * 0.95)],
          averageMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
          samples: samples.length,
        };
      })()`,
    );
    results.assetClick = {
      scenario: "已导入素材卡片切换",
      ...assetClick,
    };
    if (assetClick.p95Ms > 50) {
      throw new Error(`ASSET_CLICK_LATENCY_ABOVE_TARGET_${assetClick.p95Ms}`);
    }
    const gridSample = evaluate(send, `window.__sampleFps(3)`);
    const eventLoopSample = evaluate(
      send,
      `(async () => {
        const samples = [];
        const deadline = performance.now() + 3000;
        while (performance.now() < deadline) {
          const startedAt = performance.now();
          await window.refCanvas.system.getAppInfo();
          samples.push(performance.now() - startedAt);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        samples.sort((left, right) => left - right);
        return {
          p95Ms: samples[Math.floor(samples.length * 0.95)],
          samples: samples.length,
        };
      })()`,
    );
    const scrollResult = await send("Runtime.evaluate", {
      expression: `(() => {
        const viewport = document.querySelector(".asset-viewport");
        if (!viewport) return false;
        return true;
      })()`,
      returnByValue: true,
    });
    if (scrollResult.result.value) {
      for (let step = 0; step < 90; step += 1) {
        await evaluate(
          send,
          `(() => {
            const v = document.querySelector(".asset-viewport");
            if (v) v.scrollTop = Math.min(v.scrollHeight, v.scrollTop + 240);
          })()`,
        );
        await delay(16);
      }
    }
    const grid = await gridSample;
    const eventLoopLag = await eventLoopSample;
    results.grid = { scenario: "虚拟网格滚动", ...grid };
    results.eventLoopLag = {
      scenario: "滚动期间主进程 IPC round-trip",
      ...eventLoopLag,
    };
    results.notes.push(
      "0.37.0 门槛：白板 ≥55 FPS / P95 frame ≤24ms；素材点击 P95 ≤50ms；网格 ≥50 FPS；主进程 IPC round-trip P95 ≤50ms。",
    );
    if (grid.averageFps < 50) {
      throw new Error(`GRID_FPS_BELOW_TARGET_${grid.averageFps}`);
    }
    if (eventLoopLag.p95Ms > 50) {
      throw new Error(`MAIN_EVENT_LOOP_LAG_ABOVE_TARGET_${eventLoopLag.p95Ms}`);
    }
  } catch (error) {
    results.notes.push(`FPS_CHECK_ERROR: ${error.message}`);
    console.error("FAIL:", error.message);
    process.exitCode = 1;
  } finally {
    try {
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
      console.log(`fps results written: ${outputPath}`);
    } catch (error) {
      console.error("WRITE_FAIL:", error.message);
    }
    try { client?.socket?.close(); } catch {}
    child.kill();
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const { execSync } = require("node:child_process");
      execSync(`taskkill /F /T /PID ${child.pid} 2>nul || true`, { stdio: "ignore" });
    } catch {}
  }
}

main().catch((error) => {
  console.error("FPS_CRASH:", error);
  process.exitCode = 1;
});
