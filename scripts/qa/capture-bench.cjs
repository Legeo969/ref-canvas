
const { app, desktopCapturer, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

async function timeIt(label, fn, runs = 3) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    const r = await fn();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    out.push(ms);
    if (r && typeof r === "object" && r.bytes !== undefined) label = label.split(" ")[0] + " (" + r.bytes + "B)";
  }
  console.log(label, out.map((v) => v.toFixed(1)).join("/"));
}

app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay();
  const w = Math.round(display.size.width * display.scaleFactor);
  const h = Math.round(display.size.height * display.scaleFactor);
  console.log("display", display.id, display.size, display.scaleFactor, "target", w, h);

  // 现状 1: getSources 全屏缩略图 + toDataURL
  await timeIt("desktopCapturer getSources+toDataURL ms", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: w, height: h },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    const url = src.thumbnail.toDataURL();
    return { bytes: url.length };
  });

  // 现状 2: getSources 缩略图 + toPNG（不 base64）
  await timeIt("desktopCapturer getSources+toPNG ms", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: w, height: h },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    const png = src.thumbnail.toPNG();
    return { bytes: png.length };
  });

  // 新方案: node-screenshots 异步 + toPng
  const ns = require("node-screenshots");
  await timeIt("node-screenshots async capture+toPng ms", async () => {
    const monitors = ns.Monitor.all();
    const mon = monitors[0];
    const img = await mon.captureImage();
    const png = await img.toPng(true);
    return { bytes: png.length };
  });

  app.quit();
}).catch((e) => { console.error("FAIL", e); app.quit(); });
