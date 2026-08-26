/**
 * RefCanvas Browser Capture — background service worker.
 *
 * Registers a context-menu item on images and the page action.
 * Captured images are sent to the local RefCanvas HTTP endpoint.
 */

const REFCANVAS_BASE = "http://127.0.0.1:17530";

/** 记录最近一次失败，供 popup 显示原文（诊断"还是不行"时不用开 DevTools）。 */
async function recordError(stage, error) {
  const message = String(error?.message ?? error);
  console.error(`[RefCanvas] ${stage} failed:`, message);
  try {
    await chrome.storage.session.set({
      lastError: { stage, message, at: new Date().toISOString() },
    });
  } catch {
    // storage 不可用时忽略（SW 生命周期边缘）。
  }
}

/** 成功后清掉旧错误，避免 popup 永远展示一次早已自愈的历史失败。 */
async function clearLastError() {
  try {
    await chrome.storage.session.remove("lastError");
  } catch {
    // ignore
  }
}

/** Check whether the local RefCanvas capture endpoint is reachable. */
async function checkConnection() {
  try {
    const res = await fetch(`${REFCANVAS_BASE}/status`, { method: "GET" });
    if (!res.ok) {
      const detail = `HTTP ${res.status}`;
      await recordError("status", detail);
      return { connected: false, error: detail };
    }
    const data = await res.json();
    await clearLastError();
    return { connected: true, ...data };
  } catch (error) {
    const message = String(error?.message ?? error);
    await recordError("status", message);
    return { connected: false, error: message };
  }
}

/**
 * Fetch an image URL, convert to base64 data URL, and POST it to RefCanvas.
 * The extension has host_permissions for <all_urls> via activeTab + scripting,
 * but cross-origin fetch from the service worker uses the extension's origin.
 * For cross-origin images we inject a content script to fetch from the page.
 */
async function captureImageToRefCanvas(imageUrl, pageUrl, tabId) {
  // Try direct fetch first (works for same-origin and CORS-enabled images).
  let base64 = null;
  let contentType = "image/png";

  try {
    const res = await fetch(imageUrl, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      contentType = blob.type || "image/png";
      base64 = await blobToBase64(blob);
    }
  } catch {
    // Cross-origin without CORS — fall through to content-script extraction.
  }

  if (!base64) {
    // Inject a content script to fetch the image from the page's origin.
    // allFrames：图片常在 iframe 里（头像/表情/广告位），只注入主框架时
    // 跨域 iframe 图片永远 fetch 失败，表现为"有的图能捕获、有的不行"。
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: pageFetchImage,
        args: [imageUrl],
      });
    } catch (error) {
      // chrome:// / 商店页等特殊页面禁止注入——错误必须落到 popup 可读。
      throw new Error(
        `Cannot access this page to read the image (${String(error?.message ?? error)})`,
      );
    }
    const hit = (results ?? []).find((entry) => entry?.result?.base64);
    if (!hit) {
      throw new Error(
        "Could not fetch image from page (hotlink-protected or expired URL)",
      );
    }
    base64 = hit.result.base64;
    contentType = hit.result.contentType || "image/png";
  }

  const filename = deriveFilename(imageUrl);

  // POST to RefCanvas.
  return postCapture({
    image: base64,
    contentType,
    filename,
    sourceUrl: pageUrl,
  });
}

/** 统一的 /capture 发送：网络层失败给出可读原因（预检被拒等表现为 fetch reject）。 */
async function postCapture(payload) {
  const res = await fetch(`${REFCANVAS_BASE}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((error) => {
    throw new Error(
      `RefCanvas unreachable at ${REFCANVAS_BASE}/capture (${String(error?.message ?? error)})`,
    );
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RefCanvas error (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * 从图片 URL 派生落盘文件名。data:/blob:/无路径的 URL 在
 * `new URL(...).pathname` 上拿不到可读名字，需要单独兜底。
 */
function deriveFilename(imageUrl) {
  if (imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:image\/([a-z0-9.+-]+)/i);
    return `inline-image-${Date.now()}.${match ? match[1].replace("+", ".") : "png"}`;
  }
  try {
    const url = new URL(imageUrl);
    const basename = url.pathname.split("/").pop();
    if (!basename || !basename.includes(".")) return `capture-${Date.now()}.png`;
    return basename;
  } catch {
    return `capture-${Date.now()}.png`;
  }
}

/** Helper: convert a Blob to a base64 data URL (without the data: prefix). */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Page-context function injected via chrome.scripting.executeScript.
 * Fetches an image from the page's origin (bypassing extension CORS limits)
 * and returns base64 data.
 */
function pageFetchImage(url) {
  return fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            const comma = result.indexOf(",");
            resolve({
              base64: comma >= 0 ? result.slice(comma + 1) : result,
              contentType: blob.type || "image/png",
            });
          };
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => ({ base64: null, contentType: null }));
}

/** Show a badge notification on the extension icon. */
function showBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || "#3ab28f" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

// --- Lifecycle ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "refcanvas-capture",
    title: "Add to RefCanvas",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "refcanvas-capture-visible",
    title: "Capture page to RefCanvas",
    contexts: ["page"],
  });
});

/** 抓取当前可见区域并发送（也作为图片 URL 拿不到时的兜底路径）。 */
async function captureVisibleToRefCanvas(windowId, pageUrl) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  });
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return postCapture({
    image: base64,
    contentType: "image/png",
    filename: `screenshot-${Date.now()}.png`,
    sourceUrl: pageUrl,
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "refcanvas-capture") {
    try {
      if (info.srcUrl && tab?.id != null) {
        await captureImageToRefCanvas(info.srcUrl, info.pageUrl, tab.id);
      } else if (!info.srcUrl && tab?.windowId != null) {
        // 右键命中的是 CSS 背景图等拿不到 srcUrl 的元素：菜单项仍会出现，
        // 但静默什么都不做对用户就是"坏了"——退化为截屏，至少有东西上板。
        await captureVisibleToRefCanvas(tab.windowId, info.pageUrl);
      } else {
        throw new Error("No source image and no tab available");
      }
      showBadge("OK", "#3ab28f");
      await clearLastError();
    } catch (error) {
      console.error("[RefCanvas] capture failed:", error);
      await recordError("capture", error);
      showBadge("ERR", "#c95c4b");
    }
  }

  if (info.menuItemId === "refcanvas-capture-visible" && tab?.id) {
    try {
      await captureVisibleToRefCanvas(tab.windowId, info.pageUrl);
      showBadge("OK", "#3ab28f");
      await clearLastError();
    } catch (error) {
      console.error("[RefCanvas] screenshot failed:", error);
      // 截屏被浏览器拒（受限页面）时错误原文也要能从 popup 看到。
      await recordError("screenshot", error);
      showBadge("ERR", "#c95c4b");
    }
  }
});

// Allow popup to query connection status.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_CONNECTION") {
    checkConnection().then(sendResponse);
    return true; // keep channel open for async response
  }
});
