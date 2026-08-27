/**
 * RefCanvas 网页捕获 — 后台服务线程入口（MV3 module SW）。
 *
 * 职责：右键菜单生命周期、捕获任务执行（含历史/徽标/错误记录）、
 * 拾取器结果接收、快捷键注入拾取器。捕获发送与页面提取分别在
 * api.js / capture.js；菜单管理在 boards.js；历史在 history.js。
 */
import {
  BoardMissingError,
  clearLastError,
  getLastError,
  pairWithCode,
  recordError,
} from "./api.js";
import {
  MENU_CAPTURE,
  MENU_VISIBLE,
  boardTitleOf,
  ensureBaseMenus,
  resetDefaultBoardIfMissing,
  syncStatusAndMenus,
} from "./boards.js";
import {
  captureFrame,
  captureImageUrl,
  captureVisibleTab,
  deriveFilename,
  getPageTitle,
} from "./capture.js";
import { addHistoryEntry, clearHistory, getHistory } from "./history.js";
import { getSettings, setSettings } from "./settings.js";

function showBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || "#3ab28f" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

/**
 * 捕获任务统一执行口：成功/失败都写历史与徽标；目标板已删（服务端
 * 400）时把默认板重置为"跟随应用"，否则每次捕获都会继续失败。
 */
async function runCaptureJob(job) {
  const settings = await getSettings();
  const boardId = job.boardId ?? settings.defaultBoardId;
  const pageTitle =
    job.pageTitle ?? (job.tabId != null ? await getPageTitle(job.tabId) : "");
  const entry = {
    at: new Date().toISOString(),
    filename: job.filename || "capture",
    boardTitle: await boardTitleOf(boardId === "follow" ? undefined : boardId),
    sourceUrl: job.pageUrl || "",
    imageUrl: job.kind === "url" ? job.imageUrl : undefined,
  };
  try {
    let payload;
    if (job.kind === "url") {
      payload = await captureImageUrl({
        imageUrl: job.imageUrl,
        pageUrl: job.pageUrl,
        tabId: job.tabId,
        boardId,
        pageTitle,
        alt: job.alt,
      });
    } else if (job.kind === "frame") {
      payload = await captureFrame({
        dataUrl: job.dataUrl,
        suggestedName: job.filename,
        pageUrl: job.pageUrl,
        boardId,
        pageTitle,
        alt: job.alt,
      });
    } else if (job.kind === "visible") {
      payload = await captureVisibleTab({
        windowId: job.windowId,
        pageUrl: job.pageUrl,
        boardId,
        pageTitle,
      });
    } else {
      throw new Error(`未知捕获类型：${job.kind}`);
    }
    await addHistoryEntry({ ...entry, status: "ok" });
    await clearLastError();
    showBadge("✓", "#3ab28f");
    return { ok: true, ...payload };
  } catch (error) {
    const message = await recordError("capture", error);
    await addHistoryEntry({ ...entry, status: "error", error: message });
    showBadge("!", "#c95c4b");
    if (error instanceof BoardMissingError) {
      await resetDefaultBoardIfMissing(job.boardId ?? settings.defaultBoardId);
    }
    return { ok: false, error: message };
  }
}

// --- 生命周期：菜单重建 + 首次连接刷新板子菜单 ---

chrome.runtime.onInstalled.addListener(() => {
  void ensureBaseMenus()
    .then(() => syncStatusAndMenus())
    .catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureBaseMenus()
    .then(() => syncStatusAndMenus())
    .catch(() => undefined);
});

// --- 右键菜单点击 ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = String(info.menuItemId);
  const boardFromMenu = menuItemId.startsWith("board:")
    ? menuItemId.slice("board:".length)
    : undefined;

  if (menuItemId === MENU_CAPTURE || boardFromMenu) {
    if (info.srcUrl && tab?.id != null) {
      await runCaptureJob({
        kind: "url",
        imageUrl: info.srcUrl,
        pageUrl: info.pageUrl,
        tabId: tab.id,
        boardId: boardFromMenu,
        filename: deriveFilename(info.srcUrl),
      });
    } else if (tab?.windowId != null) {
      // CSS 背景图等拿不到 srcUrl 的元素：菜单项仍会出现，退化为截屏，
      // 至少有东西上板（静默无操作对用户就是"坏了"）。
      await runCaptureJob({
        kind: "visible",
        pageUrl: info.pageUrl,
        windowId: tab.windowId,
        boardId: boardFromMenu,
      });
    }
    void syncStatusAndMenus().catch(() => undefined);
  }

  if (menuItemId === MENU_VISIBLE && tab) {
    await runCaptureJob({
      kind: "visible",
      pageUrl: info.pageUrl,
      windowId: tab.windowId,
    });
    void syncStatusAndMenus().catch(() => undefined);
  }
});

// --- 快捷键：注入拾取器（commands 触发同样授予 activeTab） ---

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "run-picker") return;
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id) return;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/picker.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/picker.js"],
    });
  } catch (error) {
    await recordError("picker", error);
    showBadge("!", "#c95c4b");
  }
});

// --- 消息路由（popup / options / 拾取器） ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_STATUS") {
    void (async () => {
      try {
        const status = await syncStatusAndMenus();
        sendResponse({
          connected: status.connected,
          pairingRequired: status.pairingRequired,
          error: status.error,
          boards: status.boards ?? [],
          activeBoardTitle: status.activeBoardTitle ?? null,
          lastError: await getLastError(),
          settings: await getSettings(),
        });
      } catch (error) {
        sendResponse({
          connected: false,
          error: `连接检查失败：${String(error?.message ?? error)}`,
          boards: [],
          activeBoardTitle: null,
          lastError: await getLastError(),
          settings: await getSettings(),
        });
      }
    })();
    return true;
  }

  if (message?.type === "SET_DEFAULT_BOARD") {
    void (async () => {
      const settings = await setSettings({
        defaultBoardId: message.boardId || "follow",
      });
      sendResponse({ settings });
    })();
    return true;
  }

  if (message?.type === "SET_PORT") {
    void (async () => {
      const port = Number(message.port);
      const settings = await setSettings({
        port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 17530,
      });
      sendResponse({ settings });
    })();
    return true;
  }

  if (message?.type === "PAIR") {
    void (async () => {
      try {
        const pairing = await pairWithCode(message.code);
        await syncStatusAndMenus();
        sendResponse({ ok: true, pairing });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message ?? error) });
      }
    })();
    return true;
  }

  if (message?.type === "GET_HISTORY") {
    void (async () => sendResponse({ entries: await getHistory() }))();
    return true;
  }

  if (message?.type === "CLEAR_HISTORY") {
    void (async () => {
      await clearHistory();
      sendResponse({ entries: [] });
    })();
    return true;
  }

  if (message?.type === "RETRY_CAPTURE") {
    void (async () => {
      const entry = message.entry ?? {};
      if (!entry.imageUrl) {
        sendResponse({ ok: false, error: "该记录没有原始图片地址，无法重试" });
        return;
      }
      sendResponse(
        await runCaptureJob({
          kind: "url",
          imageUrl: entry.imageUrl,
          pageUrl: entry.sourceUrl,
          boardId: entry.boardId,
          filename: entry.filename,
        }),
      );
    })();
    return true;
  }

  if (message?.type === "PICKER_CAPTURE") {
    void (async () => {
      const items = Array.isArray(message.items) ? message.items : [];
      const results = [];
      for (const item of items) {
        const job =
          item.kind === "url"
            ? {
                kind: "url",
                imageUrl: item.url,
                pageUrl: message.pageUrl,
                tabId: sender.tab?.id,
                boardId: message.boardId,
                pageTitle: message.pageTitle,
                alt: item.alt,
                filename: deriveFilename(item.url),
              }
            : {
                kind: "frame",
                dataUrl: item.dataUrl,
                pageUrl: message.pageUrl,
                boardId: message.boardId,
                pageTitle: message.pageTitle,
                alt: item.alt,
                filename: item.suggestedName,
              };
        const outcome = await runCaptureJob(job);
        results.push({ ...outcome, alt: item.alt || item.suggestedName });
      }
      sendResponse({
        okCount: results.filter((item) => item.ok).length,
        failures: results.filter((item) => !item.ok),
      });
    })();
    return true;
  }

  return undefined;
});
