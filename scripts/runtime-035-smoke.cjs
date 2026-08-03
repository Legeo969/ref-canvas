/**
 * RefCanvas 0.35.1 打包运行时冒烟：目录层级导入、目标文件夹导入、
 * flat 模式、按需入库、目录快速预览、导航与批量栏 UI。
 *
 * 用法：node scripts/runtime-035-smoke.cjs <打包exe> <user-data-dir>
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const Database = require("better-sqlite3");
const sharp = require("sharp");
const WebSocket = require("ws");
const expectedVersion = require("../package.json").version;

const [exePath, userDataPath] = process.argv.slice(2);
if (!exePath || !userDataPath) {
  throw new Error("Usage: node scripts/runtime-035-smoke.cjs <exe> <user-data>");
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
  return attach(target);
}

/** 列出全部 page target（多窗口验证用）。 */
async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await response.json()).filter((item) => item.type === "page");
}

/** 连接到 URL 包含指定片段的页面（独立白板窗口）。 */
async function connectTo(port, urlContains) {
  let target;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await listTargets(port);
    target = targets.find((item) => item.url.includes(urlContains));
    if (target) break;
    await delay(250);
  }
  if (!target) throw new Error(`CDP_TARGET_MISSING_${urlContains}`);
  return attach(target);
}

async function attach(target) {
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

/** 轮询导入任务到终态。 */
async function awaitImport(send, jobId, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await evaluate(
      send,
      `window.refCanvas.library.getImportJob(${JSON.stringify(jobId)})`,
    );
    if (!job) throw new Error(`IMPORT_JOB_MISSING_${label}`);
    if (["completed", "cancelled", "failed"].includes(job.state)) return job;
    await delay(250);
  }
  throw new Error(`IMPORT_TIMEOUT_${label}`);
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

    const appInfo = await evaluate(
      send,
      `window.refCanvas.system.getAppInfo().then((info) => ({
        version: info.appVersion,
        schema: info.databaseSchemaVersion,
      }))`,
    );
    console.log("appInfo:", JSON.stringify(appInfo));
    check(
      `app.getVersion() returns ${expectedVersion}`,
      appInfo.version === expectedVersion,
      appInfo.version,
    );
    check("schema version is 12", appInfo.schema === 12, `v${appInfo.schema}`);

    // ========== 目录层级导入：目录树 → 嵌套文件夹 ==========
    const treeRoot = path.join(userDataPath, "035tree");
    const alpha = path.join(treeRoot, "Project Alpha");
    const concept = path.join(alpha, "Concept");
    const light = path.join(alpha, "Light");
    const beta = path.join(treeRoot, "Project Beta");
    fs.mkdirSync(concept, { recursive: true });
    fs.mkdirSync(light, { recursive: true });
    fs.mkdirSync(beta, { recursive: true });
    fs.writeFileSync(path.join(concept, "hero.png"), Buffer.alloc(256, 3));
    fs.writeFileSync(path.join(concept, "alt.png"), Buffer.alloc(256, 4));
    fs.writeFileSync(path.join(light, "rim.txt"), "lighting notes");
    fs.writeFileSync(path.join(beta, "hero.jpg"), Buffer.alloc(256, 5));

    const jobA = await evaluate(
      send,
      `window.refCanvas.library.startImport([${JSON.stringify(alpha)}], {
        storageMode: "library-default",
        hierarchyMode: "collections",
      }).then((job) => job.id)`,
    );
    const doneA = await awaitImport(send, jobA, "HIERARCHY");
    check(
      "hierarchy import completed with all 3 assets",
      doneA.state === "completed" && doneA.imported === 3 && doneA.failed.length === 0,
      JSON.stringify({ imported: doneA.imported, failed: doneA.failed }),
    );

    const foldersA = await evaluate(
      send,
      `window.refCanvas.library.listCollections().then((list) =>
        list.map((c) => ({ id: c.id, title: c.title, parentId: c.parentId, direct: c.directAssetCount, total: c.assetCount })),
      )`,
    );
    const alphaFolder = foldersA.find((f) => f.title === "Project Alpha" && f.parentId === null);
    const conceptFolder = foldersA.find((f) => f.title === "Concept" && f.parentId === alphaFolder?.id);
    const lightFolder = foldersA.find((f) => f.title === "Light" && f.parentId === alphaFolder?.id);
    check(
      "tree created nested folders Alpha > Concept/Light",
      Boolean(alphaFolder && conceptFolder && lightFolder),
      JSON.stringify(foldersA.map((f) => `${f.parentId ? ">" : "root:"}${f.title}`)),
    );
    check(
      "folder counts: Alpha 0 direct / 3 total, Concept 2 direct",
      alphaFolder?.direct === 0 && alphaFolder?.total === 3 && conceptFolder?.direct === 2,
      JSON.stringify({ alpha: alphaFolder, concept: conceptFolder }),
    );
    const conceptAssets = await evaluate(
      send,
      `window.refCanvas.library.search({
        collectionId: ${JSON.stringify(conceptFolder?.id ?? "")},
        includeSubcollections: false,
      }).then((page) => page.items.map((a) => a.title).sort())`,
    );
    check(
      "Concept folder holds exactly its two images",
      conceptAssets.join(",") === "alt,hero",
      conceptAssets.join(","),
    );

    // ========== 落点文件夹导入：parentFolderId ==========
    const inbox = await evaluate(
      send,
      `window.refCanvas.library.createCollection("收件箱").then((c) => c.id)`,
    );
    const jobB = await evaluate(
      send,
      `window.refCanvas.library.startImport([${JSON.stringify(beta)}], {
        storageMode: "library-default",
        hierarchyMode: "collections",
        parentFolderId: ${JSON.stringify(inbox)},
      }).then((job) => job.id)`,
    );
    const doneB = await awaitImport(send, jobB, "PARENT_FOLDER");
    check(
      "parent-folder import completed",
      doneB.state === "completed" && doneB.imported === 1,
      JSON.stringify({ imported: doneB.imported }),
    );
    const betaFolder = await evaluate(
      send,
      `window.refCanvas.library.listCollections().then((list) =>
        list.find((c) => c.title === "Project Beta"),
      )`,
    );
    check(
      "imported tree nests under the parent folder",
      betaFolder?.parentId === inbox,
      JSON.stringify({ betaParent: betaFolder?.parentId, inbox }),
    );
    const betaAssets = await evaluate(
      send,
      `window.refCanvas.library.search({
        collectionId: ${JSON.stringify(betaFolder?.id ?? "")},
        includeSubcollections: false,
      }).then((page) => page.total)`,
    );
    check("nested leaf folder holds its asset", betaAssets === 1, `total=${betaAssets}`);

    // ========== flat 模式：不创建文件夹 ==========
    const foldersBeforeFlat = await evaluate(
      send,
      `window.refCanvas.library.listCollections().then((list) => list.length)`,
    );
    const jobC = await evaluate(
      send,
      `window.refCanvas.library.startImport([${JSON.stringify(beta)}], {
        storageMode: "library-default",
        hierarchyMode: "flat",
      }).then((job) => job.id)`,
    );
    const doneC = await awaitImport(send, jobC, "FLAT");
    check("flat import reuses existing record", doneC.state === "completed", JSON.stringify(doneC));
    const foldersAfterFlat = await evaluate(
      send,
      `window.refCanvas.library.listCollections().then((list) => list.length)`,
    );
    check(
      "flat import creates no new folders",
      foldersAfterFlat === foldersBeforeFlat,
      `${foldersBeforeFlat} -> ${foldersAfterFlat}`,
    );
    const inboxAssets = await evaluate(
      send,
      `window.refCanvas.library.search({
        collectionId: ${JSON.stringify(inbox)},
        includeSubcollections: false,
      }).then((page) => page.total)`,
    );
    check("parent folder itself has no direct assets", inboxAssets === 0, `total=${inboxAssets}`);

    // ========== 按需入库到文件夹（拖入侧栏文件夹语义） ==========
    const materialized = await evaluate(
      send,
      `window.refCanvas.filesystem.materialize(${JSON.stringify(path.join(beta, "hero.jpg"))}, {
        storageMode: "library-default",
        collectionIds: [${JSON.stringify(inbox)}],
      }).then((r) => ({ created: r.created, id: r.asset.id }))`,
    );
    check("materialize into folder reuses record", materialized.created === false, JSON.stringify(materialized));
    const inboxAfter = await evaluate(
      send,
      `window.refCanvas.library.search({
        collectionId: ${JSON.stringify(inbox)},
        includeSubcollections: false,
      }).then((page) => page.total)`,
    );
    check(
      "asset now joins the folder via materialize",
      inboxAfter === 1,
      `total=${inboxAfter}`,
    );

    // ========== 目录浏览不产生记录（回归） ==========
    const beforeBrowse = await evaluate(
      send,
      `window.refCanvas.library.search({}).then((page) => page.total)`,
    );
    await evaluate(
      send,
      `window.refCanvas.filesystem.listDirectory(${JSON.stringify(treeRoot)}, { pageSize: 100 })`,
    );
    const afterBrowse = await evaluate(
      send,
      `window.refCanvas.library.search({}).then((page) => page.total)`,
    );
    check("directory browsing adds no library records", beforeBrowse === afterBrowse, `${beforeBrowse} -> ${afterBrowse}`);

    const pagedSearch = await evaluate(
      send,
      `(async () => {
        const id = await window.refCanvas.filesystem.startSearch(
          ${JSON.stringify(treeRoot)},
          "hero",
        );
        let snapshot = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          snapshot = await window.refCanvas.filesystem.getSearch(id);
          if (snapshot?.state !== "running") break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const page = await window.refCanvas.filesystem.getSearchPage(id, {
          offset: 0,
          pageSize: 512,
        });
        return {
          state: snapshot?.state,
          revision: page.revision,
          total: page.totalFiles,
          names: page.entries.map((entry) => entry.name),
        };
      })()`,
    );
    check(
      "utility worker persists and pages recursive search results",
      pagedSearch.state === "completed" &&
        typeof pagedSearch.revision === "string" &&
        pagedSearch.revision.length > 0 &&
        pagedSearch.total === 2 &&
        pagedSearch.names.every((name) => name.toLowerCase().includes("hero")),
      JSON.stringify(pagedSearch),
    );
    const afterSearch = await evaluate(
      send,
      `window.refCanvas.library.search({}).then((page) => page.total)`,
    );
    check(
      "recursive directory search adds no library records",
      afterSearch === beforeBrowse,
      `${beforeBrowse} -> ${afterSearch}`,
    );

    // ========== 0.35.1 侧栏折叠与批量栏布局 ==========
    const collapsedKinds = await evaluate(
      send,
      `({
        expanded: document.querySelector(".asset-kind-toggle")?.getAttribute("aria-expanded"),
        childCount: document.querySelectorAll(".asset-kind-child").length,
      })`,
    );
    check(
      "asset kinds are collapsed by default",
      collapsedKinds.expanded === "false" && collapsedKinds.childCount === 0,
      JSON.stringify(collapsedKinds),
    );
    await evaluate(
      send,
      `document.querySelector(".asset-kind-toggle")?.click(); true`,
    );
    await waitFor(
      send,
      `document.querySelectorAll(".asset-kind-child").length === 7`,
      "ASSET_KINDS_EXPANDED",
    );
    await delay(300);
    await send("Page.reload");
    await waitFor(
      send,
      `document.querySelector(".asset-kind-toggle")?.getAttribute("aria-expanded") === "true"
        && document.querySelectorAll(".asset-kind-child").length === 7`,
      "ASSET_KINDS_RESTORED",
    );
    check("asset-kind expansion persists across reload", true);
    await waitFor(
      send,
      `document.querySelectorAll(".asset-card").length > 0`,
      "ASSET_CARDS_AFTER_RELOAD",
    );
    await evaluate(
      send,
      `document.querySelector(".asset-panel")?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
        }),
      ); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".batch-toolbar"))`,
      "BATCH_TOOLBAR",
    );

    async function inspectBatchWidth(width) {
      await evaluate(
        send,
        `document.querySelector(".workspace")?.style.setProperty(
          "--panel-asset",
          ${JSON.stringify(`${width}px`)},
        ); true`,
      );
      await delay(250);
      return evaluate(
        send,
        `(() => {
          const panel = document.querySelector(".asset-panel");
          const toolbar = document.querySelector(".batch-toolbar");
          const bounds = toolbar?.getBoundingClientRect();
          const buttons = [...(toolbar?.querySelectorAll(":scope > button") ?? [])]
            .map((button) => button.getBoundingClientRect());
          return {
            panelWidth: panel?.getBoundingClientRect().width,
            height: bounds?.height,
            overflow: toolbar ? getComputedStyle(toolbar).overflow : "",
            singleLine: buttons.every((button) =>
              Math.abs(button.top - buttons[0].top) < 1
            ),
          };
        })()`,
      );
    }

    const batch280 = await inspectBatchWidth(280);
    check(
      "280px asset panel keeps a 44px single-line batch toolbar",
      Math.abs(batch280.panelWidth - 280) < 1 &&
        Math.abs(batch280.height - 44) < 1 &&
        batch280.overflow === "hidden" &&
        batch280.singleLine,
      JSON.stringify(batch280),
    );
    await evaluate(
      send,
      `document.querySelector('.batch-toolbar button[aria-label="更多批量操作"]')?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".batch-actions-popover"))`,
      "BATCH_MORE_MENU",
    );
    const batchMenu = await evaluate(
      send,
      `(() => {
        const menu = document.querySelector(".batch-actions-popover");
        const text = menu?.textContent ?? "";
        const options = [...(menu?.querySelectorAll("option") ?? [])]
          .map((option) => option.textContent);
        const style = menu ? getComputedStyle(menu) : null;
        return {
          position: style?.position,
          overflowY: style?.overflowY,
          hasRename: text.includes("批量重命名"),
          hasNotes: text.includes("批量设置备注"),
          hasTrash: text.includes("移入回收站"),
          hasRemove: text.includes("从资料库移除"),
          hasExport: options.includes("导出 CSV"),
        };
      })()`,
    );
    check(
      "batch More menu is fixed, scrollable and complete",
      batchMenu.position === "fixed" &&
        batchMenu.overflowY === "auto" &&
        batchMenu.hasRename && batchMenu.hasNotes && batchMenu.hasTrash &&
        batchMenu.hasRemove && batchMenu.hasExport,
      JSON.stringify(batchMenu),
    );
    const batch280Shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(userDataPath, "ui-0351-batch-280.png"),
      Buffer.from(batch280Shot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector('.batch-toolbar button[aria-label="更多批量操作"]')?.click(); true`,
    );
    const batch720 = await inspectBatchWidth(720);
    check(
      "720px asset panel keeps a 44px single-line batch toolbar",
      Math.abs(batch720.panelWidth - 720) < 1 &&
        Math.abs(batch720.height - 44) < 1 &&
        batch720.singleLine,
      JSON.stringify(batch720),
    );
    const batch720Shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(userDataPath, "ui-0351-batch-720.png"),
      Buffer.from(batch720Shot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector(".workspace")?.style.removeProperty("--panel-asset"); true`,
    );

    // ========== 本地目录双击快速预览，不写资料库 ==========
    const previewRoot = path.join(userDataPath, "0351-preview");
    fs.mkdirSync(previewRoot, { recursive: true });
    await sharp({
      create: {
        width: 960,
        height: 640,
        channels: 4,
        background: { r: 38, g: 190, b: 128, alpha: 1 },
      },
    }).png().toFile(path.join(previewRoot, "pixel.png"));
    fs.writeFileSync(path.join(previewRoot, "scene.psd"), Buffer.alloc(256, 7));
    const navigationState = await evaluate(
      send,
      `window.refCanvas.system.getNavigationState().then(JSON.parse)`,
    );
    navigationState.navigationSource = "directory";
    navigationState.directoryPath = previewRoot;
    navigationState.directoryHistory = [previewRoot];
    navigationState.directoryHistoryIndex = 0;
    navigationState.updatedAt = Date.now() + 10_000;
    await evaluate(
      send,
      `window.refCanvas.system.setNavigationState(${JSON.stringify(JSON.stringify(navigationState))})`,
    );
    await send("Page.reload");
    await waitFor(
      send,
      `[...document.querySelectorAll(".directory-card")].some(
        (card) => card.textContent?.includes("pixel.png")
      )`,
      "DIRECTORY_PREVIEW_CARD",
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".directory-card img")].some(
        (image) => image.complete && image.naturalWidth > 0
      )`,
      "DIRECTORY_THUMBNAIL",
    );
    const beforeQuickPreview = await evaluate(
      send,
      `window.refCanvas.library.search({}).then((page) => page.total)`,
    );
    await evaluate(
      send,
      `(() => {
        const card = [...document.querySelectorAll(".directory-card")]
          .find((entry) => entry.textContent?.includes("pixel.png"));
        card?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `document.querySelector(".directory-preview-stage img")?.naturalWidth > 0`,
      "DIRECTORY_QUICK_PREVIEW",
    );
    const quickPreview = await evaluate(
      send,
      `(() => {
        const image = document.querySelector(".directory-preview-stage img");
        return {
          source: image?.getAttribute("src"),
          pathVisible: document.querySelector(".directory-preview-path")?.textContent,
        };
      })()`,
    );
    const afterQuickPreview = await evaluate(
      send,
      `window.refCanvas.library.search({}).then((page) => page.total)`,
    );
    check(
      "double-click opens tokenized in-app preview without creating a record",
      quickPreview.source?.startsWith("refbrowse://preview/") &&
        !quickPreview.source.includes(previewRoot) &&
        quickPreview.pathVisible?.includes("pixel.png") &&
        beforeQuickPreview === afterQuickPreview,
      JSON.stringify({ quickPreview, beforeQuickPreview, afterQuickPreview }),
    );
    const directoryShot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(userDataPath, "ui-0351-directory-preview.png"),
      Buffer.from(directoryShot.data, "base64"),
    );
    await evaluate(send, `document.querySelector(".preview-close")?.click(); true`);

    // ========== 白板更多工具跟随按钮 ==========
    navigationState.navigationSource = "library";
    navigationState.updatedAt = Date.now() + 20_000;
    await evaluate(
      send,
      `window.refCanvas.system.setNavigationState(${JSON.stringify(JSON.stringify(navigationState))})`,
    );
    await send("Page.reload");
    await waitFor(
      send,
      `Boolean(document.querySelector('.toolbar-more-btn[aria-label="更多工具"]'))`,
      "BOARD_MORE_TRIGGER",
    );
    await evaluate(send, `document.querySelector(".board-first-hint button")?.click(); true`);
    await delay(150);
    const boardMoreOpen = await evaluate(
      send,
      `(() => {
        const button = document.querySelector('.toolbar-more-btn[aria-label="更多工具"]');
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return Boolean(button);
      })()`,
    );
    check("board More trigger is clickable", boardMoreOpen);
    await waitFor(
      send,
      `document.querySelector('.toolbar-more-btn[aria-label="更多工具"]')
        ?.getAttribute("aria-expanded") === "true"
        && Boolean(document.querySelector(".board-toolbar-more"))`,
      "BOARD_MORE_PANEL",
    );
    const boardMoreInitial = await evaluate(
      send,
      `(() => {
        const button = document.querySelector('.toolbar-more-btn[aria-label="更多工具"]')
          .getBoundingClientRect();
        const panel = document.querySelector(".board-toolbar-more").getBoundingClientRect();
        return { buttonRight: button.right, panelRight: panel.right, gap: panel.top - button.bottom };
      })()`,
    );
    await evaluate(
      send,
      `document.querySelector(".workspace")?.style.setProperty("--panel-asset", "720px"); true`,
    );
    await delay(350);
    const boardMoreResized = await evaluate(
      send,
      `(() => {
        const button = document.querySelector('.toolbar-more-btn[aria-label="更多工具"]')
          .getBoundingClientRect();
        const panel = document.querySelector(".board-toolbar-more").getBoundingClientRect();
        return { buttonRight: button.right, panelRight: panel.right, gap: panel.top - button.bottom };
      })()`,
    );
    check(
      "board More panel stays right-aligned after sidebar resize",
      Math.abs(boardMoreInitial.buttonRight - boardMoreInitial.panelRight) < 1 &&
        Math.abs(boardMoreInitial.gap - 8) < 1 &&
        Math.abs(boardMoreResized.buttonRight - boardMoreResized.panelRight) < 1 &&
        Math.abs(boardMoreResized.gap - 8) < 1 &&
        Math.abs(boardMoreInitial.buttonRight - boardMoreResized.buttonRight) > 100,
      JSON.stringify({ boardMoreInitial, boardMoreResized }),
    );
    const boardMoreShot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(userDataPath, "ui-0351-board-more.png"),
      Buffer.from(boardMoreShot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector(".workspace")?.style.removeProperty("--panel-asset");
       document.querySelector('.toolbar-more-btn[aria-label="更多工具"]')?.click();
       true`,
    );

    // ========== 多窗口白板 ==========
    const windowBoardId = await evaluate(
      send,
      `window.refCanvas.boards.create("多窗口测试").then((b) => b.id)`,
    );
    check("window-test board created", typeof windowBoardId === "string", String(windowBoardId));
    await evaluate(
      send,
      `window.refCanvas.boards.openWindow(${JSON.stringify(windowBoardId)}).then(() => true)`,
    );
    let boardWindowClient = null;
    try {
      boardWindowClient = await connectTo(port, `board=${windowBoardId}`);
      const boardSend = boardWindowClient.send;
      await waitFor(
        boardSend,
        `window.refCanvas && window.refCanvas.boards && typeof window.refCanvas.boards.load === "function"`,
        "BOARD_WINDOW_API",
      );
      const boardLoaded = await evaluate(
        boardSend,
        `window.refCanvas.boards.load(${JSON.stringify(windowBoardId)}).then((loaded) => loaded && loaded.summary.title)`,
      );
      check("board window loads the target board", boardLoaded === "多窗口测试", String(boardLoaded));

      const pagesBefore = (await listTargets(port)).length;
      await evaluate(
        send,
        `window.refCanvas.boards.openWindow(${JSON.stringify(windowBoardId)}).then(() => true)`,
      );
      await delay(700);
      const pagesAfter = (await listTargets(port)).length;
      check(
        "open-window dedupes to the existing window",
        pagesAfter === pagesBefore,
        `${pagesBefore} -> ${pagesAfter}`,
      );

      // 关闭窗口会立即销毁 WebContents，evaluate 的响应可能收不到：
      // 不等待返回值，改为轮询 target 消失。
      void evaluate(
        boardSend,
        `window.refCanvas.boards.closeWindow().then(() => true)`,
      ).catch(() => undefined);
    } finally {
      try { boardWindowClient?.socket?.close(); } catch {}
    }
    let pagesAfterClose = 99;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      pagesAfterClose = (await listTargets(port)).length;
      if (pagesAfterClose <= 1) break;
      await delay(250);
    }
    check("board window closes on request", pagesAfterClose === 1, `pages=${pagesAfterClose}`);

    // ========== 数据库落库 ==========
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
      const folderRows = db.prepare("SELECT COUNT(*) AS n FROM collections").get().n;
      const assetRows = db.prepare("SELECT COUNT(*) AS n FROM assets").get().n;
      const inboxRows = db
        .prepare("SELECT COUNT(*) AS n FROM collection_assets WHERE collection_id = ?")
        .get(inbox).n;
      db.close();
      console.log(`db user_version=${userVersion}, folders=${folderRows}, assets=${assetRows}, inboxMembers=${inboxRows}`);
      check("database user_version is 12", userVersion === 12, `v${userVersion}`);
      check("folders persisted", folderRows >= 5, String(folderRows));
      check("assets persisted", assetRows >= 4, String(assetRows));
      check("inbox membership persisted", inboxRows === 1, String(inboxRows));
    }
  } catch (error) {
    failures.push(error.message);
    console.error("FAIL:", error.message);
  } finally {
    try { client?.socket?.close(); } catch {}
    child.kill();
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      execSync(`taskkill /F /T /PID ${child.pid} 2>nul || true`, { stdio: "ignore" });
    } catch {}
  }

  if (failures.length) {
    console.error(`\nRUNTIME_SMOKE_FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\nRUNTIME_${expectedVersion.replaceAll(".", "")}_SMOKE_PASSED`);
  }
}

main().catch((error) => {
  console.error("SMOKE_CRASH:", error);
  process.exitCode = 1;
});
