const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const [exePath, userDataPath, screenshotPath] = process.argv.slice(2);
if (!exePath || !userDataPath || !screenshotPath) {
  throw new Error(
    "Usage: node scripts/runtime-comments-smoke.cjs <exe> <user-data> <screenshot>",
  );
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function oneSecondWave() {
  const sampleRate = 8_000;
  const dataSize = sampleRate * 2;
  const result = Buffer.alloc(44 + dataSize);
  result.write("RIFF", 0);
  result.writeUInt32LE(36 + dataSize, 4);
  result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write("data", 36);
  result.writeUInt32LE(dataSize, 40);
  return result;
}

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
  let result;
  try {
    result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
  } catch (error) {
    throw new Error(
      `${error.message}\nExpression: ${expression.slice(0, 300)}`,
    );
  }
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

async function drawPointer(send, points) {
  const [first, ...rest] = points;
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: first.x,
    y: first.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (const point of rest) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
    });
  }
  const last = points[points.length - 1];
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: last.x,
    y: last.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

function launch(port) {
  return spawn(
    exePath,
    [
      `--user-data-dir=${userDataPath}`,
      `--remote-debugging-port=${port}`,
      "--no-sandbox",
    ],
    { detached: false, stdio: "ignore", windowsHide: true },
  );
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000),
  ]);
}

async function run() {
  let child = launch(9333);
  let client;
  try {
    client = await connect(9333);
    const { send } = client;
    await waitFor(
      send,
      `Boolean(document.querySelector(".board-host"))`,
      "BOARD_READY",
    );
    const fixturePath = path.resolve(
      "artifacts",
      "runtime-0.11.0-grayscale.png",
    );
    const secondFixturePath = path.resolve(
      "artifacts",
      "runtime-0.10.0-color-search.png",
    );
    const mediaFixturePath = path.resolve(
      "artifacts",
      "runtime-media-duration.wav",
    );
    fs.writeFileSync(mediaFixturePath, oneSecondWave());
    await evaluate(
      send,
      `window.refCanvas.library.importPaths([
        ${JSON.stringify(fixturePath)},
        ${JSON.stringify(secondFixturePath)},
        ${JSON.stringify(mediaFixturePath)}
      ])`,
    );
    await send("Page.reload");
    await delay(800);
    await waitFor(
      send,
      `document.querySelectorAll(".asset-card").length >= 3`,
      "THREE_ASSETS_READY",
    );
    const mediaMetadata = await evaluate(
      send,
      `window.refCanvas.library.getByPath(
        ${JSON.stringify(mediaFixturePath)}
      )`,
    );
    if (
      mediaMetadata.kind !== "audio" ||
      Math.abs(mediaMetadata.duration - 1) > 0.02
    ) {
      throw new Error("PACKAGED_MEDIA_METADATA_FAILED");
    }
    await waitFor(
      send,
      `[...document.querySelectorAll(".duration-badge")].some(
        (badge) => badge.textContent === "0:01"
      )`,
      "MEDIA_DURATION_BADGE",
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".asset-card")]
        .find((card) => card.textContent?.includes("runtime-media-duration"))
        ?.click(); true`,
    );
    await waitFor(
      send,
      `document.querySelector(".meta-duration")?.textContent === "0:01"`,
      "MEDIA_DURATION_DETAILS",
    );
    const mediaScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-media.png",
    );
    const mediaScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      mediaScreenshotPath,
      Buffer.from(mediaScreenshot.data, "base64"),
    );
    const annotationAsset = await evaluate(
      send,
      `window.refCanvas.library.getByPath(${JSON.stringify(fixturePath)})`,
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".asset-card")]
        .find((card) => card.textContent?.includes("runtime-0.11.0-grayscale"))
        ?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".annotation-open-button"))`,
      "ANNOTATION_ENTRY",
    );
    await evaluate(
      send,
      `document.querySelector(".annotation-open-button")?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".annotation-dialog img"))`,
      "ANNOTATION_DIALOG",
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".annotation-header-actions button")]
        .find((button) => button.textContent?.includes("添加标注"))
        ?.click(); true`,
    );
    await evaluate(
      send,
      `(() => {
        const image = document.querySelector(".annotation-dialog img");
        const bounds = image.getBoundingClientRect();
        image.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          clientX: bounds.left + bounds.width * 0.3,
          clientY: bounds.top + bounds.height * 0.65,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".form-dialog textarea"))`,
      "ANNOTATION_FORM",
    );
    await evaluate(
      send,
      `(() => {
        const field = document.querySelector(".form-dialog textarea");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        ).set;
        setter.call(field, "屋檐的青色反光需要降低对比度");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    await delay(50);
    await evaluate(
      send,
      `document.querySelector(".form-dialog form").requestSubmit(); true`,
    );
    await waitFor(
      send,
      `(async () => {
        const items = await window.refCanvas.library.listAnnotations(
          ${JSON.stringify(annotationAsset.id)}
        );
        return items.length === 1
          && items[0].text === "屋檐的青色反光需要降低对比度"
          && document.querySelectorAll(".annotation-pin").length === 1;
      })()`,
      "ANNOTATION_CREATED",
    );
    await evaluate(
      send,
      `document.querySelector(
        '.annotation-comment-list button[aria-label^="重新定位标注"]'
      )?.click(); true`,
    );
    await evaluate(
      send,
      `(() => {
        const image = document.querySelector(".annotation-dialog img");
        const bounds = image.getBoundingClientRect();
        image.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          clientX: bounds.left + bounds.width * 0.72,
          clientY: bounds.top + bounds.height * 0.28,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const [item] = await window.refCanvas.library.listAnnotations(
          ${JSON.stringify(annotationAsset.id)}
        );
        return Math.abs(item.x - 0.72) < 0.02
          && Math.abs(item.y - 0.28) < 0.02;
      })()`,
      "ANNOTATION_RELOCATED",
    );
    await evaluate(
      send,
      `document.querySelector(
        '.annotation-comment-list button[aria-label^="编辑标注"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".form-dialog textarea"))`,
      "ANNOTATION_EDIT_FORM",
    );
    await evaluate(
      send,
      `(() => {
        const field = document.querySelector(".form-dialog textarea");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        ).set;
        setter.call(field, "塔楼需要降低背景饱和度");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    await delay(50);
    await evaluate(
      send,
      `document.querySelector(".form-dialog form").requestSubmit(); true`,
    );
    await waitFor(
      send,
      `(async () => {
        const page = await window.refCanvas.library.search({
          query: "降低背景饱和度",
          lifecycle: "active",
        });
        return page.items.some(
          (asset) => asset.id === ${JSON.stringify(annotationAsset.id)}
        ) && document.querySelector(".annotation-comment-list article p")
          ?.textContent === "塔楼需要降低背景饱和度";
      })()`,
      "ANNOTATION_SEARCHABLE",
    );
    const annotationScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-annotations.png",
    );
    const annotationScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      annotationScreenshotPath,
      Buffer.from(annotationScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector(
        'button[aria-label="关闭图片标注"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".annotation-dialog")`,
      "ANNOTATION_CLOSED",
    );
    const thumbnailState = await evaluate(
      send,
      `(async () => {
        const page = await window.refCanvas.library.search({
          lifecycle: "active",
          kind: "image",
          pageSize: 2,
        });
        const response = await fetch(page.items[0].thumbnailUrl);
        const bytes = (await response.arrayBuffer()).byteLength;
        const cardSources = [...document.querySelectorAll(".asset-card img")]
          .map((image) => image.src);
        return {
          ok: response.ok,
          bytes,
          allCardsUseCache:
            cardSources.length >= 2 &&
            cardSources.every((source) =>
              source.startsWith("refasset://thumbnail/"),
            ),
        };
      })()`,
    );
    if (
      !thumbnailState.ok ||
      thumbnailState.bytes < 100 ||
      !thumbnailState.allCardsUseCache
    ) {
      throw new Error("THUMBNAIL_CACHE_FAILED");
    }
    await waitFor(
      send,
      `[...document.querySelectorAll(".asset-card img")].every(
        (image) => image.complete && image.naturalWidth > 0
      )`,
      "THUMBNAILS_VISIBLE",
    );
    const thumbnailScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-grid.png",
    );
    const thumbnailScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      thumbnailScreenshotPath,
      Buffer.from(thumbnailScreenshot.data, "base64"),
    );
    const assetKeyboardNavigationVerified = await evaluate(
      send,
      `(async () => {
        const panel = document.querySelector(".asset-panel");
        panel.focus();
        panel.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Home",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const firstId = document.activeElement?.dataset?.assetId;
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const secondId = document.activeElement?.dataset?.assetId;
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const rangeCount = document.querySelectorAll(".asset-card.selected").length;
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const previewOpen = Boolean(document.querySelector(".quick-preview-shell"));
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return Boolean(
          firstId &&
          secondId &&
          firstId !== secondId &&
          rangeCount === 2 &&
          previewOpen &&
          !document.querySelector(".quick-preview-shell")
        );
      })()`,
    );
    if (!assetKeyboardNavigationVerified) {
      throw new Error("ASSET_KEYBOARD_NAVIGATION_FAILED");
    }
    const assetKeyboardOrganizeVerified = await evaluate(
      send,
      `(async () => {
        const ids = [...document.querySelectorAll(".asset-card.selected")]
          .map((card) => card.dataset.assetId)
          .filter(Boolean);
        if (ids.length !== 2) return false;
        const read = () => Promise.all(
          ids.map((id) => window.refCanvas.library.get(id))
        );
        const waitUntil = async (predicate) => {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const assets = await read();
            if (predicate(assets)) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        };
        const waitDom = async (predicate) => {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (predicate()) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        };
        const original = await read();
        const favorite = !original[0].favorite;
        const panel = document.querySelector(".asset-panel");
        panel.dispatchEvent(new KeyboardEvent("keydown", {
          key: "f",
          bubbles: true,
          cancelable: true,
        }));
        if (!(await waitUntil((assets) =>
          assets.every((asset) => asset.favorite === favorite)
        ))) return false;
        if (!(await waitDom(() =>
          document.querySelectorAll(
            ".asset-card.selected .favorite-badge"
          ).length === (favorite ? ids.length : 0)
        ))) return false;
        panel.dispatchEvent(new KeyboardEvent("keydown", {
          key: "f",
          bubbles: true,
          cancelable: true,
        }));
        if (!(await waitUntil((assets) =>
          assets.every((asset) => asset.favorite === original[0].favorite)
        ))) return false;
        if (!(await waitDom(() =>
          document.querySelectorAll(
            ".asset-card.selected .favorite-badge"
          ).length === (original[0].favorite ? ids.length : 0)
        ))) return false;
        panel.dispatchEvent(new KeyboardEvent("keydown", {
          key: "5",
          bubbles: true,
          cancelable: true,
        }));
        if (!(await waitUntil((assets) =>
          assets.every((asset) => asset.rating === 5)
        ))) return false;
        if (!(await waitDom(() =>
          [...document.querySelectorAll(
            ".asset-card.selected .rating-mini"
          )].every((node) => node.textContent?.includes("5")) &&
          document.querySelectorAll(
            ".asset-card.selected .rating-mini"
          ).length === ids.length
        ))) return false;
        panel.dispatchEvent(new KeyboardEvent("keydown", {
          key: "0",
          bubbles: true,
          cancelable: true,
        }));
        if (!(await waitUntil((assets) =>
          assets.every((asset) => asset.rating === 0)
        ))) return false;
        return waitDom(() =>
          document.querySelectorAll(
            ".asset-card.selected .rating-mini"
          ).length === 0
        );
      })()`,
    );
    if (!assetKeyboardOrganizeVerified) {
      throw new Error("ASSET_KEYBOARD_ORGANIZE_FAILED");
    }
    const contextAsset = await evaluate(
      send,
      `window.refCanvas.library.search({
        lifecycle: "active",
        pageSize: 1,
      }).then((page) => page.items[0])`,
    );
    await evaluate(
      send,
      `document.querySelector(".asset-card")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 330,
          clientY: 260,
        }),
      ); true`,
    );
    await waitFor(
      send,
      `(() => {
        const menu = document.querySelector(".asset-context-menu");
        return menu?.textContent?.includes("快速预览")
          && menu?.textContent?.includes("在资源管理器中显示")
          && menu?.textContent?.includes("收藏所选")
          && menu?.textContent?.includes("移入回收站");
      })()`,
      "ASSET_CONTEXT_MENU",
    );
    const contextMenuScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-context-menu.png",
    );
    const contextMenuScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      contextMenuScreenshotPath,
      Buffer.from(contextMenuScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `(() => {
        [...document.querySelectorAll(".asset-context-menu button")]
          .find((button) => button.textContent?.includes("收藏所选"))
          ?.click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const asset = await window.refCanvas.library.get(
          ${JSON.stringify(contextAsset.id)}
        );
        return asset?.favorite === true;
      })()`,
      "CONTEXT_MENU_FAVORITE",
    );
    await evaluate(
      send,
      `(() => {
        const card = document.querySelector(".asset-card");
        const dataTransfer = new DataTransfer();
        card.dispatchEvent(new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }));
        const host = document.querySelector(".board-panel");
        const bounds = host.getBoundingClientRect();
        host.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width * 0.58,
          clientY: bounds.top + bounds.height * 0.45,
          dataTransfer,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const board = await window.refCanvas.boards.load(boardId);
        return board.document.canvas.objects.length >= 1;
      })()`,
      "FIRST_BOARD_OBJECT",
    );
    await evaluate(
      send,
      `document.querySelector('button[aria-label="图层"]')?.click(); true`,
    );
    await waitFor(
      send,
      `document.querySelectorAll(".layer-row").length >= 1`,
      "LAYERS_READY",
    );
    await evaluate(
      send,
      `(() => {
        const row = document.querySelector(".layer-row");
        row?.querySelector(".layer-name")?.click();
        [...(row?.querySelectorAll("button") ?? [])]
          .find((button) => button.getAttribute("aria-label")?.includes("评论"))
          ?.click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".form-dialog textarea"))`,
      "COMMENT_DIALOG",
    );
    await evaluate(
      send,
      `(() => {
        const field = document.querySelector(".form-dialog textarea");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        ).set;
        setter.call(field, "构图方向：从左向右\\n修改意见：降低背景饱和度");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
        return true;
      })()`,
    );
    await delay(50);
    await evaluate(
      send,
      `document.querySelector('.form-dialog button[type="submit"]').click(); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".form-dialog textarea")`,
      "COMMENT_SAVED",
    );
    await waitFor(
      send,
      `document.querySelector(".save-state")?.textContent?.includes("已保存")`,
      "BOARD_SAVED",
    );
    const firstBoard = await evaluate(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        return window.refCanvas.boards.load(boardId);
      })()`,
    );
    const firstObjects = firstBoard.document.canvas.objects ?? [];
    if (
      !firstObjects.some((object) =>
        object.data?.comment?.includes("降低背景饱和度"),
      )
    ) {
      throw new Error("COMMENT_NOT_SERIALIZED");
    }

    await evaluate(
      send,
      `(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "c",
          ctrlKey: true,
        }));
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "v",
          ctrlKey: true,
        }));
        return true;
      })()`,
    );
    await delay(800);
    await waitFor(
      send,
      `document.querySelector(".save-state")?.textContent?.includes("已保存")`,
      "COPY_SAVED",
    );
    const copiedBoard = await evaluate(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        return window.refCanvas.boards.load(boardId);
      })()`,
    );
    const copied = (copiedBoard.document.canvas.objects ?? []).filter(
      (object) => object.data?.comment,
    );
    if (copied.length < 2) throw new Error("COMMENT_COPY_FAILED");
    if (new Set(copied.map((object) => object.data.objectId)).size !== copied.length) {
      throw new Error("COPIED_OBJECT_ID_NOT_UNIQUE");
    }

    await evaluate(
      send,
      `(() => {
        window.__refCanvasZoomBeforeFocus =
          document.querySelector(".zoom-control span")?.textContent;
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".board-focus-controls"))`,
      "BOARD_FOCUS_OPEN",
    );
    await waitFor(
      send,
      `document.querySelector(".board-focus-copy span")?.textContent?.includes("/ 2")`,
      "BOARD_FOCUS_SEQUENCE",
    );
    await evaluate(
      send,
      `(() => {
        window.__refCanvasFocusCounter =
          document.querySelector(".board-focus-copy span")?.textContent;
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          code: "ArrowRight",
          bubbles: true,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `document.querySelector(".board-focus-copy span")?.textContent
        !== window.__refCanvasFocusCounter`,
      "BOARD_FOCUS_NEXT",
    );
    await evaluate(
      send,
      `(() => {
        const select = document.querySelector(
          '.board-focus-controls select[aria-label="幻灯片间隔"]',
        );
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        ).set;
        setter.call(select, "3");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        window.__refCanvasFocusCounter =
          document.querySelector(".board-focus-copy span")?.textContent;
        document.querySelector(".focus-play-toggle")?.click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `document.querySelector(".focus-play-toggle")?.classList.contains("active")`,
      "BOARD_SLIDESHOW_PLAYING",
    );
    await waitFor(
      send,
      `document.querySelector(".board-focus-copy span")?.textContent
        !== window.__refCanvasFocusCounter`,
      "BOARD_SLIDESHOW_ADVANCED",
    );
    await evaluate(
      send,
      `document.querySelector(".focus-play-toggle")?.click(); true`,
    );
    const boardFocusScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-board-focus.png",
    );
    const boardFocusScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      boardFocusScreenshotPath,
      Buffer.from(boardFocusScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      })); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".board-focus-controls")
        && document.querySelector(".zoom-control span")?.textContent
          === window.__refCanvasZoomBeforeFocus`,
      "BOARD_FOCUS_RESTORED",
    );

    await evaluate(
      send,
      `document.querySelector('button[aria-label="新建白板"]').click(); true`,
    );
    await waitFor(send, `Boolean(document.querySelector(".form-dialog input"))`, "NEW_BOARD");
    await evaluate(
      send,
      `(async () => {
        const field = document.querySelector(".form-dialog input");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(field, "评论跨板验证");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        document.querySelector('.form-dialog button[type="submit"]').click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `document.querySelector(".board-switcher select")?.selectedOptions[0]?.textContent === "评论跨板验证"`,
      "BOARD_SWITCHED",
    );
    await evaluate(
      send,
      `window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
      })); true`,
    );
    await delay(800);
    await waitFor(
      send,
      `document.querySelector(".save-state")?.textContent?.includes("已保存")`,
      "CROSS_BOARD_SAVED",
    );
    const crossBoard = await evaluate(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        return window.refCanvas.boards.load(boardId);
      })()`,
    );
    if (
      !(crossBoard.document.canvas.objects ?? []).some(
        (object) => object.data?.comment,
      )
    ) {
      throw new Error("CROSS_BOARD_COMMENT_FAILED");
    }
    await evaluate(
      send,
      `document.querySelector(
        'button[aria-label="白板背景与网格设置"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `document.querySelectorAll(".form-dialog input").length === 2`,
      "BOARD_APPEARANCE_DIALOG",
    );
    await evaluate(
      send,
      `(() => {
        const fields = document.querySelectorAll(".form-dialog input");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(fields[0], "#182433");
        fields[0].dispatchEvent(new Event("input", { bubbles: true }));
        setter.call(fields[1], "36");
        fields[1].dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('.form-dialog button[type="submit"]').click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `!document.querySelector(".form-dialog")`,
      "BOARD_APPEARANCE_APPLIED",
    );
    await evaluate(
      send,
      `document.querySelector('button[aria-label="隐藏网格"]')?.click(); true`,
    );
    await waitFor(
      send,
      `document.querySelector(".board-host")?.classList.contains("grid-hidden")`,
      "BOARD_GRID_HIDDEN",
    );
    await waitFor(
      send,
      `document.querySelector(".save-state")?.textContent?.includes("已保存")`,
      "BOARD_APPEARANCE_SAVED",
    );
    await evaluate(
      send,
      `document.querySelector(
        'button[aria-label="绘图工具设置"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".draw-settings-panel"))`,
      "DRAWING_PANEL_OPEN",
    );
    await evaluate(
      send,
      `(() => {
        const panel = document.querySelector(".draw-settings-panel");
        const color = panel.querySelector('input[type="color"]');
        const range = panel.querySelector('input[type="range"]');
        const inputSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        inputSetter.call(color, "#ff3366");
        color.dispatchEvent(new Event("input", { bubbles: true }));
        inputSetter.call(range, "7");
        range.dispatchEvent(new Event("input", { bubbles: true }));
        [...panel.querySelectorAll(".draw-line-options button")]
          .find((button) => button.textContent?.includes("虚线"))
          ?.click();
        panel.querySelector(
          '.draw-tool-options button[aria-label="直线"]',
        )?.click();
        return true;
      })()`,
    );
    const drawingPanelScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-drawing-panel.png",
    );
    const drawingPanelScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      drawingPanelScreenshotPath,
      Buffer.from(drawingPanelScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector(
        '.draw-settings-panel button[aria-label="关闭绘图工具设置"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".draw-settings-panel")
        && Boolean(document.querySelector(
          '.canvas-toolbar button[aria-label="退出绘图工具"]'
        ))`,
      "DRAWING_LINE_ACTIVE",
    );
    const drawingArea = await evaluate(
      send,
      `(() => {
        const bounds = document.querySelector(".upper-canvas").getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        };
      })()`,
    );
    const point = (x, y) => ({
      x: drawingArea.left + drawingArea.width * x,
      y: drawingArea.top + drawingArea.height * y,
    });
    await drawPointer(send, [point(0.18, 0.38), point(0.43, 0.42)]);

    const chooseDrawingTool = async (label) => {
      await evaluate(
        send,
        `document.querySelector(
          'button[aria-label="绘图工具设置"]'
        )?.click(); true`,
      );
      await waitFor(
        send,
        `Boolean(document.querySelector(".draw-settings-panel"))`,
        `DRAWING_${label}_PANEL`,
      );
      await evaluate(
        send,
        `(() => {
          const panel = document.querySelector(".draw-settings-panel");
          panel.querySelector(
            '.draw-tool-options button[aria-label=${JSON.stringify(label)}]',
          )?.click();
          panel.querySelector(
            'button[aria-label="关闭绘图工具设置"]',
          )?.click();
          return true;
        })()`,
      );
      await waitFor(
        send,
        `!document.querySelector(".draw-settings-panel")`,
        `DRAWING_${label}_READY`,
      );
    };

    await chooseDrawingTool("矩形");
    await drawPointer(send, [point(0.54, 0.35), point(0.75, 0.5)]);
    await chooseDrawingTool("圆形");
    await drawPointer(send, [point(0.22, 0.58), point(0.4, 0.73)]);
    await chooseDrawingTool("自由画笔");
    await drawPointer(send, [
      point(0.52, 0.62),
      point(0.58, 0.57),
      point(0.64, 0.66),
      point(0.7, 0.59),
      point(0.77, 0.69),
    ]);
    await waitFor(
      send,
      `document.querySelector(".save-state")?.textContent?.includes("已保存")`,
      "DRAWINGS_SAVED",
    );
    const drawingBoard = await evaluate(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        return window.refCanvas.boards.load(boardId);
      })()`,
    );
    const drawingObjects = (drawingBoard.document.canvas.objects ?? []).filter(
      (object) => object.data?.type?.startsWith("drawing-"),
    );
    if (
      !["drawing-line", "drawing-rectangle", "drawing-ellipse", "drawing-pencil"]
        .every((type) => drawingObjects.some((object) => object.data.type === type))
    ) {
      console.error(JSON.stringify({ drawingObjects }));
      throw new Error("DRAWING_OBJECTS_NOT_SERIALIZED");
    }
    const serializedLine = drawingObjects.find(
      (object) => object.data.type === "drawing-line",
    );
    if (
      serializedLine.stroke !== "#ff3366" ||
      serializedLine.strokeWidth !== 7 ||
      !Array.isArray(serializedLine.strokeDashArray)
    ) {
      throw new Error("DRAWING_STYLE_NOT_SERIALIZED");
    }
    const drawingScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-drawing-tools.png",
    );
    const drawingScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      drawingScreenshotPath,
      Buffer.from(drawingScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector(
        '.canvas-toolbar button[aria-label="退出绘图工具"]'
      )?.click(); true`,
    );
    await evaluate(
      send,
      `(() => {
        if (!document.querySelector(".layers-panel")) {
          document.querySelector('button[aria-label="图层"]')?.click();
        }
        return true;
      })()`,
    );
    await waitFor(
      send,
      `document.querySelectorAll(".layers-panel .layer-row").length >= 5`,
      "HIERARCHY_LAYERS_READY",
    );
    await evaluate(
      send,
      `(() => {
        const rows = [...document.querySelectorAll(".layer-row")];
        const title = (row) =>
          row.querySelector(".layer-name > span:last-child")?.textContent;
        const child = rows.find((row) => row.textContent?.includes("直线"));
        const drawingNames = ["直线", "矩形绘制", "圆形绘制", "自由绘制"];
        const parent = rows.find(
          (row) =>
            !drawingNames.some((name) => title(row)?.includes(name)),
        );
        window.__refCanvasHierarchyParentLabel = title(parent);
        const transfer = new DataTransfer();
        child.dispatchEvent(new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }));
        const bounds = parent.getBoundingClientRect();
        parent.dispatchEvent(new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          dataTransfer: transfer,
        }));
        parent.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          dataTransfer: transfer,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const board = await window.refCanvas.boards.load(boardId);
        const objects = board.document.canvas.objects ?? [];
        const child = objects.find(
          (object) => object.data?.type === "drawing-line",
        );
        return Boolean(
          child?.data?.parentId &&
          objects.some(
            (object) => object.data?.objectId === child.data.parentId,
          )
        );
      })()`,
      "HIERARCHY_PARENTED",
    );
    const hierarchyBeforeMove = await evaluate(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const board = await window.refCanvas.boards.load(boardId);
        const objects = board.document.canvas.objects ?? [];
        const child = objects.find(
          (object) => object.data?.type === "drawing-line",
        );
        const parent = objects.find(
          (object) => object.data?.objectId === child.data.parentId,
        );
        return {
          parentId: parent.data.objectId,
          parentLeft: parent.left,
          childLeft: child.left,
        };
      })()`,
    );
    await evaluate(
      send,
      `(() => {
        const row = [...document.querySelectorAll(".layer-row")].find(
          (item) =>
            item.querySelector(".layer-name > span:last-child")?.textContent
              === window.__refCanvasHierarchyParentLabel,
        );
        row.querySelector(".layer-name").click();
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          code: "ArrowRight",
          shiftKey: true,
          bubbles: true,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const board = await window.refCanvas.boards.load(boardId);
        const objects = board.document.canvas.objects ?? [];
        const parent = objects.find(
          (object) => object.data?.objectId
            === ${JSON.stringify(hierarchyBeforeMove.parentId)},
        );
        const child = objects.find(
          (object) => object.data?.type === "drawing-line",
        );
        return Math.abs(
          parent.left - ${hierarchyBeforeMove.parentLeft} - 10
        ) < 0.01 && Math.abs(
          child.left - ${hierarchyBeforeMove.childLeft} - 10
        ) < 0.01;
      })()`,
      "HIERARCHY_TRANSFORM_PROPAGATED",
    );
    await evaluate(
      send,
      `(() => {
        const row = [...document.querySelectorAll(".layer-row")].find(
          (item) =>
            item.querySelector(".layer-name > span:last-child")?.textContent
              === "直线",
        );
        const root = document.querySelector(".layer-root-drop");
        const transfer = new DataTransfer();
        row.dispatchEvent(new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }));
        root.dispatchEvent(new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }));
        root.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const board = await window.refCanvas.boards.load(boardId);
        const child = (board.document.canvas.objects ?? []).find(
          (object) => object.data?.type === "drawing-line",
        );
        return child && !child.data?.parentId;
      })()`,
      "HIERARCHY_UNPARENTED",
    );
    await evaluate(
      send,
      `(() => {
        const rows = [...document.querySelectorAll(".layer-row")];
        const title = (row) =>
          row.querySelector(".layer-name > span:last-child")?.textContent;
        const child = rows.find((row) => row.textContent?.includes("直线"));
        const parent = rows.find(
          (row) => title(row) === window.__refCanvasHierarchyParentLabel,
        );
        const transfer = new DataTransfer();
        child.dispatchEvent(new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }));
        const bounds = parent.getBoundingClientRect();
        parent.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          dataTransfer: transfer,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const board = await window.refCanvas.boards.load(boardId);
        const objects = board.document.canvas.objects ?? [];
        const child = objects.find(
          (object) => object.data?.type === "drawing-line",
        );
        return Boolean(
          child?.data?.parentId &&
          objects.some(
            (object) => object.data?.objectId === child.data.parentId,
          )
        );
      })()`,
      "HIERARCHY_REPARENTED",
    );
    const hierarchyScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-hierarchy.png",
    );
    const hierarchyScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      hierarchyScreenshotPath,
      Buffer.from(hierarchyScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "P",
        code: "KeyP",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".command-palette input"))`,
      "COMMAND_PALETTE_OPEN",
    );
    await evaluate(
      send,
      `(() => {
        const input = document.querySelector(".command-palette input");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(input, "适应全部");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".command-palette-row")].some(
        (row) =>
          row.querySelector("strong")?.textContent === "适应全部对象" &&
          row.querySelector("kbd")?.textContent === "Ctrl+0"
      )`,
      "COMMAND_PALETTE_SEARCH",
    );
    const commandPaletteScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-command-palette.png",
    );
    const commandPaletteScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      commandPaletteScreenshotPath,
      Buffer.from(commandPaletteScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `(() => {
        const input = document.querySelector(".command-palette input");
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `!document.querySelector(".command-palette") &&
        JSON.parse(
          localStorage.getItem("refcanvas.board-command-recents.v1") ?? "[]",
        )[0] === "fit-all"`,
      "COMMAND_PALETTE_EXECUTED",
    );
    await evaluate(
      send,
      `window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "P",
        code: "KeyP",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })); true`,
    );
    await waitFor(
      send,
      `document.querySelector(".command-palette-row strong")?.textContent
        === "适应全部对象"`,
      "COMMAND_PALETTE_RECENT",
    );
    await evaluate(
      send,
      `(() => {
        const input = document.querySelector(".command-palette input");
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `!document.querySelector(".command-palette")`,
      "COMMAND_PALETTE_ESCAPE",
    );
    await evaluate(
      send,
      `window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "P",
        code: "KeyP",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".command-palette-footer button"))`,
      "SHORTCUT_SETTINGS_ENTRY",
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".command-palette-footer button")]
        .find((button) => button.textContent?.includes("快捷键设置"))
        ?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".shortcut-settings"))`,
      "SHORTCUT_SETTINGS_OPEN",
    );
    await evaluate(
      send,
      `(() => {
        const row = [...document.querySelectorAll(".shortcut-settings-row")]
          .find((item) => item.querySelector("strong")?.textContent
            === "适应全部对象");
        const capture = row.querySelector(".shortcut-capture");
        capture.click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".shortcut-settings-row")]
        .find((item) => item.querySelector("strong")?.textContent
          === "适应全部对象")
        ?.querySelector(".shortcut-capture")
        ?.classList.contains("recording")`,
      "SHORTCUT_RECORDING",
    );
    await evaluate(
      send,
      `(() => {
        const row = [...document.querySelectorAll(".shortcut-settings-row")]
          .find((item) => item.querySelector("strong")?.textContent
            === "适应全部对象");
        const capture = row.querySelector(".shortcut-capture");
        capture.dispatchEvent(new KeyboardEvent("keydown", {
          key: "1",
          code: "Digit1",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const bindings = await window.refCanvas.system.getBoardShortcuts();
        return bindings?.fitAll === "Alt+1" &&
          [...document.querySelectorAll(".shortcut-settings-row")]
            .find((item) => item.querySelector("strong")?.textContent
              === "适应全部对象")
            ?.querySelector(".shortcut-capture")?.textContent === "Alt+1";
      })()`,
      "SHORTCUT_REBOUND",
    );
    await evaluate(
      send,
      `(() => {
        const row = [...document.querySelectorAll(".shortcut-settings-row")]
          .find((item) => item.querySelector("strong")?.textContent
            === "适应全部对象");
        row?.scrollIntoView({ block: "center" });
        return true;
      })()`,
    );
    await delay(80);
    const shortcutSettingsScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-shortcut-settings.png",
    );
    const shortcutSettingsScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      shortcutSettingsScreenshotPath,
      Buffer.from(shortcutSettingsScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `document.querySelector(
        'button[aria-label="关闭快捷键设置"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".shortcut-settings")`,
      "SHORTCUT_SETTINGS_CLOSED",
    );
    const shortcutRebindingHandled = await evaluate(
      send,
      `(() => {
        const event = new KeyboardEvent("keydown", {
          key: "1",
          code: "Digit1",
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })()`,
    );
    if (!shortcutRebindingHandled) {
      throw new Error("SHORTCUT_REBOUND_COMMAND_NOT_HANDLED");
    }
    await evaluate(
      send,
      `window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "P",
        code: "KeyP",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".command-palette input"))`,
      "SHORTCUT_COMMAND_PALETTE_REOPEN",
    );
    await evaluate(
      send,
      `(() => {
        const input = document.querySelector(".command-palette input");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(input, "适应全部");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".command-palette-row")].some(
        (row) =>
          row.querySelector("strong")?.textContent === "适应全部对象" &&
          row.querySelector("kbd")?.textContent === "Alt+1"
      )`,
      "SHORTCUT_COMMAND_PALETTE_UPDATED",
    );
    await evaluate(
      send,
      `document.querySelector(".command-palette input").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }),
      ); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".command-palette")`,
      "SHORTCUT_COMMAND_PALETTE_CLOSED",
    );
    const appearanceBeforeRestart = await evaluate(
      send,
      `(async () => {
        const boardId = document.querySelector(".board-switcher select").value;
        const loaded = await window.refCanvas.boards.load(boardId);
        return loaded.document.appearance;
      })()`,
    );
    if (
      appearanceBeforeRestart.backgroundColor !== "#182433" ||
      appearanceBeforeRestart.gridVisible !== false ||
      appearanceBeforeRestart.gridSize !== 36
    ) {
      throw new Error("BOARD_APPEARANCE_NOT_SERIALIZED");
    }
    await evaluate(
      send,
      `document.querySelector(
        'button[aria-label="全屏展示白板"]'
      )?.click(); true`,
    );
    await waitFor(
      send,
      `document.querySelector(".app-shell")?.classList.contains(
        "presentation-mode",
      ) && getComputedStyle(document.querySelector(".titlebar")).display === "none"
        && getComputedStyle(document.querySelector(".canvas-toolbar")).display === "none"`,
      "PRESENTATION_MODE_ENTERED",
    );
    const presentationScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-presentation.png",
    );
    const presentationScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      presentationScreenshotPath,
      Buffer.from(presentationScreenshot.data, "base64"),
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await waitFor(
      send,
      `!document.querySelector(".app-shell")?.classList.contains(
        "presentation-mode",
      ) && getComputedStyle(document.querySelector(".titlebar")).display !== "none"`,
      "PRESENTATION_MODE_EXITED",
    );

    const previewBefore = await evaluate(
      send,
      `(async () => {
        const page = await window.refCanvas.library.search({
          lifecycle: "active",
          pageSize: 1,
        });
        return page.items[0];
      })()`,
    );
    await evaluate(
      send,
      `(() => {
        document.querySelector(".asset-card")?.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        );
        return true;
      })()`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".quick-preview-shell"))`,
      "QUICK_PREVIEW",
    );
    await evaluate(
      send,
      `(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "4" }));
        const select = document.querySelector(".quick-preview-organize select");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        ).set;
        setter.call(select, "blue");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.focus();
        select.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
        }));
        return Boolean(document.querySelector(".quick-preview-shell"));
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const asset = await window.refCanvas.library.get(${JSON.stringify(previewBefore.id)});
        return asset?.favorite === ${JSON.stringify(!previewBefore.favorite)}
          && asset?.rating === 4
          && asset?.colorLabel === "blue";
      })()`,
      "QUICK_PREVIEW_UPDATE",
    );
    const previewAfter = await evaluate(
      send,
      `window.refCanvas.library.get(${JSON.stringify(previewBefore.id)})`,
    );
    await evaluate(
      send,
      `document.querySelector('.quick-preview-actions button[aria-label^="关闭"]')?.click(); true`,
    );
    await waitFor(
      send,
      `!document.querySelector(".quick-preview-shell")`,
      "QUICK_PREVIEW_CLOSED",
    );
    const batchDrop = await evaluate(
      send,
      `(async () => {
        const cards = [...document.querySelectorAll(".asset-card")].slice(0, 2);
        cards[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        cards[1].dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          ctrlKey: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const dataTransfer = new DataTransfer();
        cards[0].dispatchEvent(new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }));
        const ids = JSON.parse(
          dataTransfer.getData("application/x-refcanvas-asset-ids"),
        );
        const boardId = document.querySelector(".board-switcher select").value;
        const before = await window.refCanvas.boards.load(boardId);
        const host = document.querySelector(".board-panel");
        const bounds = host.getBoundingClientRect();
        host.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width * 0.55,
          clientY: bounds.top + bounds.height * 0.48,
          dataTransfer,
        }));
        return {
          boardId,
          ids,
          selection: dataTransfer.getData(
            "application/x-refcanvas-selection",
          ),
          beforeCount: before.document.canvas.objects.length,
        };
      })()`,
    );
    const nativeDragAvailable = await evaluate(
      send,
      `typeof window.refCanvas.system.startNativeDrag === "function"
        && document.querySelector(".status-hint")?.textContent?.includes(
          "素材 Alt+拖到外部"
        )`,
    );
    if (!nativeDragAvailable) {
      throw new Error("NATIVE_DRAG_DISCOVERY_FAILED");
    }
    if (batchDrop.ids.length !== 2 || batchDrop.selection !== "current") {
      throw new Error("BATCH_DRAG_PAYLOAD_FAILED");
    }
    await waitFor(
      send,
      `(async () => {
        const board = await window.refCanvas.boards.load(${JSON.stringify(batchDrop.boardId)});
        return board.document.canvas.objects.length >= ${batchDrop.beforeCount + 2};
      })()`,
      "BATCH_DROP_SAVED",
    );
    const batchBoard = await evaluate(
      send,
      `window.refCanvas.boards.load(${JSON.stringify(batchDrop.boardId)})`,
    );
    const addedObjects = batchBoard.document.canvas.objects.slice(
      batchDrop.beforeCount,
    );
    if (
      addedObjects.length < 2 ||
      (addedObjects[0].left === addedObjects[1].left &&
        addedObjects[0].top === addedObjects[1].top)
    ) {
      throw new Error("BATCH_DROP_LAYOUT_FAILED");
    }
    const watchRootsBefore = await evaluate(
      send,
      `window.refCanvas.library.listWatchRoots()`,
    );
    let watchRootRemoved = false;
    let watchScreenshotPath = null;
    await evaluate(
      send,
      `document.querySelector('button[aria-label="维护与设置"]')?.click(); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".maintenance-panel"))`,
      "MAINTENANCE_PANEL",
    );
    await evaluate(
      send,
      `(() => {
        [...document.querySelectorAll(".maintenance-actions button")]
          .find((button) => button.textContent?.includes("重建媒体元数据"))
          ?.click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(async () => {
        const snapshot =
          await window.refCanvas.library.getMediaMetadataRebuild();
        return snapshot.state === "completed"
          && snapshot.updated >= 1
          && Boolean(document.querySelector(".maintenance-progress"));
      })()`,
      "MEDIA_METADATA_REBUILD",
    );
    const mediaMaintenanceScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-media-maintenance.png",
    );
    const mediaMaintenanceScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      mediaMaintenanceScreenshotPath,
      Buffer.from(mediaMaintenanceScreenshot.data, "base64"),
    );
    if (watchRootsBefore.length) {
      await waitFor(
        send,
        `document.querySelectorAll(".watch-root-row").length >= 1`,
        "WATCH_ROOT_PANEL",
      );
      watchScreenshotPath = screenshotPath.replace(/\.png$/i, "-watch.png");
      const watchScreenshot = await send("Page.captureScreenshot", {
        format: "png",
      });
      fs.writeFileSync(
        watchScreenshotPath,
        Buffer.from(watchScreenshot.data, "base64"),
      );
      await evaluate(
        send,
        `(() => {
          window.confirm = () => true;
          const button = [...document.querySelectorAll(".watch-root-row button")]
            .find((item) => item.textContent.includes("停止监控"));
          button.click();
          return true;
        })()`,
      );
      await waitFor(
        send,
        `(async () =>
          (await window.refCanvas.library.listWatchRoots()).length === 0
          && document.querySelectorAll(".watch-root-row").length === 0
        )()`,
        "WATCH_ROOT_REMOVED",
      );
      watchRootRemoved = true;
    }
    await evaluate(
      send,
      `document.querySelector(".maintenance-panel button[aria-label='关闭']")?.click(); true`,
    );
    await delay(350);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    const navigationFolders = await evaluate(
      send,
      `(async () => {
        const folders = await window.refCanvas.library.listCollections();
        let parent = folders.find((item) => item.title === "导航状态验证");
        if (!parent) {
          parent = await window.refCanvas.library.createCollection(
            "导航状态验证",
            null,
          );
        }
        let child = folders.find(
          (item) =>
            item.title === "导航状态子文件夹" &&
            item.parentId === parent.id,
        );
        if (!child) {
          child = await window.refCanvas.library.createCollection(
            "导航状态子文件夹",
            parent.id,
          );
        }
        return { parent, child };
      })()`,
    );
    await send("Page.reload");
    await delay(800);
    await waitFor(
      send,
      `[...document.querySelectorAll(".folder-title")].some(
        (node) => node.textContent === "导航状态子文件夹"
      )`,
      "NAVIGATION_FOLDERS",
    );
    const folderScope = await evaluate(
      send,
      `(async () => {
        const page = await window.refCanvas.library.search({
          lifecycle: "active",
          pageSize: 20,
        });
        return { ids: page.items.map((asset) => asset.id), total: page.total };
      })()`,
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
      `document.querySelector(".batch-toolbar")?.textContent?.includes(
        ${JSON.stringify(`${folderScope.total} 项`)},
      )`,
      "ALL_MATCHING_SELECTED",
    );
    await evaluate(
      send,
      `document.querySelector(".asset-card")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 360,
          clientY: 300,
        }),
      ); true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".asset-context-menu"))`,
      "FOLDER_CONTEXT_MENU",
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".asset-context-menu > button")]
        .find((button) => button.textContent?.includes("添加到文件夹"))
        ?.click(); true`,
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".folder-menu-list button")].some(
        (button) => button.textContent?.includes(
          "导航状态验证 / 导航状态子文件夹",
        ),
      )`,
      "FOLDER_SUBMENU_PATH",
    );
    const folderMenuScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-folder-menu.png",
    );
    const folderMenuScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      folderMenuScreenshotPath,
      Buffer.from(folderMenuScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".folder-menu-list button")]
        .find((button) => button.textContent?.includes(
          "导航状态验证 / 导航状态子文件夹",
        ))
        ?.click(); true`,
    );
    await waitFor(
      send,
      `(async () => {
        const assets = await Promise.all(
          ${JSON.stringify(folderScope.ids)}.map(
            (id) => window.refCanvas.library.get(id),
          ),
        );
        return assets.every((asset) =>
          asset?.collectionIds.includes(
            ${JSON.stringify(navigationFolders.child.id)},
          ),
        );
      })()`,
      "FOLDER_BATCH_ADDED",
    );
    await evaluate(
      send,
      `document.querySelector(".asset-card")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 360,
          clientY: 300,
        }),
      );
      true`,
    );
    await waitFor(
      send,
      `Boolean(document.querySelector(".asset-context-menu"))`,
      "FOLDER_CONTEXT_MENU_REOPENED",
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".asset-context-menu > button")]
        .find((button) => button.textContent?.includes("添加到文件夹"))
        ?.click();
      true`,
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".folder-menu-list button")].some(
        (button) =>
          button.textContent?.includes(
            "导航状态验证 / 导航状态子文件夹",
          ) && button.getAttribute("aria-checked") === "true"
      )`,
      "FOLDER_SUBMENU_INCLUDED",
    );
    await evaluate(
      send,
      `[...document.querySelectorAll(".folder-menu-list button")]
        .find((button) => button.textContent?.includes(
          "导航状态验证 / 导航状态子文件夹",
        ))
        ?.click(); true`,
    );
    await waitFor(
      send,
      `(async () => {
        const assets = await Promise.all(
          ${JSON.stringify(folderScope.ids)}.map(
            (id) => window.refCanvas.library.get(id),
          ),
        );
        return assets.every((asset) =>
          !asset?.collectionIds.includes(
            ${JSON.stringify(navigationFolders.child.id)},
          ),
        );
      })()`,
      "FOLDER_BATCH_REMOVED",
    );
    await evaluate(
      send,
      `document.querySelector(".asset-panel")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ); true`,
    );
    await evaluate(
      send,
      `document.querySelector('button[title="高级筛选"]')?.click(); true`,
    );
    await waitFor(
      send,
      `[...document.querySelectorAll(".advanced-filters label")].some(
        (label) => label.textContent?.includes("最短时长"),
      )`,
      "ADVANCED_MEDIA_FILTERS",
    );
    await evaluate(
      send,
      `(() => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        const selectSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        ).set;
        const labels = [...document.querySelectorAll(
          ".advanced-filters label",
        )];
        const setField = (text, value) => {
          const input = labels
            .find((label) => label.textContent?.includes(text))
            ?.querySelector("input");
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        setField("最短时长", "0.5");
        setField("最大文件", "1");
        setField("文件格式", "png");
        setField("修改起始", "2020-01-01");
        const orientation = labels
          .find((label) => label.textContent?.includes("画面方向"))
          ?.querySelector("select");
        selectSetter.call(orientation, "landscape");
        orientation.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(() => {
        const state = JSON.parse(
          localStorage.getItem("refcanvas.navigation.v1"),
        );
        return state.minDuration === 0.5
          && state.maxSize === ${1024 * 1024}
          && state.extension === "png"
          && state.orientation === "landscape"
          && state.modifiedAfter === new Date(
            "2020-01-01T00:00:00",
          ).toISOString();
      })()`,
      "ADVANCED_FILTERS_PERSISTED",
    );
    const advancedFiltersScreenshotPath = screenshotPath.replace(
      /\.png$/i,
      "-advanced-filters.png",
    );
    const advancedFiltersScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      advancedFiltersScreenshotPath,
      Buffer.from(advancedFiltersScreenshot.data, "base64"),
    );
    await evaluate(
      send,
      `(() => {
        const rows = [...document.querySelectorAll(".folder-row")];
        const parentRow = rows.find(
          (row) =>
            row.querySelector(".folder-title")?.textContent ===
            "导航状态验证",
        );
        parentRow.querySelector(".folder-main").click();
        const childVisible = [...document.querySelectorAll(".folder-title")].some(
          (node) => node.textContent === "导航状态子文件夹",
        );
        if (childVisible) parentRow.querySelector(".folder-chevron").click();
        return true;
      })()`,
    );
    await waitFor(
      send,
      `(() => {
        const active = document.querySelector(".folder-row.active .folder-title");
        const childVisible = [...document.querySelectorAll(".folder-title")].some(
          (node) => node.textContent === "导航状态子文件夹",
        );
        return active?.textContent === "导航状态验证" && !childVisible;
      })()`,
      "NAVIGATION_SELECTED",
    );
    await delay(350);
    const navigationScreenshot = await send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      screenshotPath,
      Buffer.from(navigationScreenshot.data, "base64"),
    );
    const gracefulExit = new Promise((resolve) => child.once("exit", resolve));
    void send("Browser.close").catch(() => undefined);
    await Promise.race([gracefulExit, delay(5000)]);
    client.socket.close();
    await stop(child);

    child = launch(9334);
    client = await connect(9334);
    const restarted = await evaluate(
      client.send,
      `(async () => {
        const boards = await window.refCanvas.boards.list();
        const board = boards.find((item) => item.title === "评论跨板验证");
        return board ? window.refCanvas.boards.load(board.id) : null;
      })()`,
    );
    if (
      !restarted ||
      !(restarted.document.canvas.objects ?? []).some(
        (object) => object.data?.comment,
      )
    ) {
      throw new Error("RESTART_COMMENT_FAILED");
    }
    if (
      restarted.document.appearance?.backgroundColor !== "#182433" ||
      restarted.document.appearance?.gridVisible !== false ||
      restarted.document.appearance?.gridSize !== 36
    ) {
      throw new Error("RESTART_APPEARANCE_FAILED");
    }
    if (
      (restarted.document.canvas.objects ?? []).filter(
        (object) => object.data?.type?.startsWith("drawing-"),
      ).length !== 4
    ) {
      throw new Error("RESTART_DRAWINGS_FAILED");
    }
    const restartedObjects = restarted.document.canvas.objects ?? [];
    const restartedChild = restartedObjects.find(
      (object) => object.data?.type === "drawing-line",
    );
    const restartedParent = restartedObjects.find(
      (object) =>
        object.data?.objectId === restartedChild?.data?.parentId,
    );
    if (
      !restartedParent?.data?.objectId ||
      restartedChild?.data?.parentId !== restartedParent.data.objectId
    ) {
      throw new Error("RESTART_HIERARCHY_FAILED");
    }
    await waitFor(
      client.send,
      `[...document.querySelectorAll(".folder-title")].some(
        (node) => node.textContent === "导航状态验证"
      )`,
      "NAVIGATION_RESTART_READY",
    );
    const navigationSnapshot = await evaluate(
      client.send,
      `(() => {
        const state = JSON.parse(
          localStorage.getItem("refcanvas.navigation.v1"),
        );
        const active = document.querySelector(
          ".folder-row.active .folder-title",
        );
        const childVisible = [...document.querySelectorAll(".folder-title")].some(
          (node) => node.textContent === "导航状态子文件夹",
        );
        return {
          collectionFilter: state.collectionFilter,
          collapsedFolderIds: state.collapsedFolderIds,
          minDuration: state.minDuration,
          maxSize: state.maxSize,
          extension: state.extension,
          orientation: state.orientation,
          modifiedAfter: state.modifiedAfter,
          activeTitle: active?.textContent ?? null,
          childVisible,
          restored:
            state.collectionFilter === ${JSON.stringify(navigationFolders.parent.id)}
            && state.collapsedFolderIds.includes(
              ${JSON.stringify(navigationFolders.parent.id)}
            )
            && state.minDuration === 0.5
            && state.maxSize === ${1024 * 1024}
            && state.extension === "png"
            && state.orientation === "landscape"
            && state.modifiedAfter === new Date(
              "2020-01-01T00:00:00",
            ).toISOString()
            && active?.textContent === "导航状态验证"
            && !childVisible,
        };
      })()`,
    );
    const navigationRestored = navigationSnapshot.restored;
    if (!navigationRestored) {
      console.error(JSON.stringify({ navigationSnapshot }));
      throw new Error("NAVIGATION_RESTART_FAILED");
    }
    await evaluate(
      client.send,
      `localStorage.removeItem("refcanvas.navigation.v1"); true`,
    );
    const shortcutRebindingPersisted = await evaluate(
      client.send,
      `window.refCanvas.system.getBoardShortcuts()
        .then((bindings) => bindings?.fitAll === "Alt+1")`,
    );
    if (!shortcutRebindingPersisted) {
      throw new Error("SHORTCUT_REBINDING_RESTART_FAILED");
    }
    const finalExit = new Promise((resolve) => child.once("exit", resolve));
    void client.send("Browser.close").catch(() => undefined);
    await Promise.race([finalExit, delay(5000)]);
    client.socket.close();
    await stop(child);
    console.log(
      JSON.stringify({
        firstBoardCommentCount: copied.length,
        crossBoardCommentCount: crossBoard.document.canvas.objects.filter(
          (object) => object.data?.comment,
        ).length,
        restartPersisted: true,
        boardAppearancePersisted: true,
        drawingToolsVerified: drawingObjects.length === 4,
        hierarchyTransformVerified: true,
        commandPaletteVerified: true,
        shortcutRebindingVerified:
          shortcutRebindingHandled && shortcutRebindingPersisted,
        imageAnnotationsVerified: true,
        focusCarouselVerified: true,
        presentationModeVerified: true,
        quickPreviewUpdated:
          previewAfter.favorite === !previewBefore.favorite &&
          previewAfter.rating === 4 &&
          previewAfter.colorLabel === "blue",
        nativeDragAvailable,
        assetKeyboardNavigationVerified,
        assetKeyboardOrganizeVerified,
        batchDropAdded: addedObjects.length,
        navigationRestored,
        watchRootRemoved,
        watchScreenshotPath,
        thumbnailBytes: thumbnailState.bytes,
        thumbnailScreenshotPath,
        contextMenuScreenshotPath,
        presentationScreenshotPath,
        mediaDuration: mediaMetadata.duration,
        mediaScreenshotPath,
        mediaMaintenanceScreenshotPath,
        folderMenuScreenshotPath,
        advancedFiltersScreenshotPath,
        boardFocusScreenshotPath,
        drawingPanelScreenshotPath,
        drawingScreenshotPath,
        hierarchyScreenshotPath,
        commandPaletteScreenshotPath,
        shortcutSettingsScreenshotPath,
        annotationScreenshotPath,
        screenshotPath: path.resolve(screenshotPath),
      }),
    );
  } finally {
    client?.socket?.close();
    await stop(child);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
