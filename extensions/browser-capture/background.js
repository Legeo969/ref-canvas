/**
 * RefCanvas Browser Capture — background service worker.
 *
 * Registers a context-menu item on images and the page action.
 * Captured images are sent to the local RefCanvas HTTP endpoint.
 */

const REFCANVAS_BASE = "http://127.0.0.1:17530";

/** Check whether the local RefCanvas capture endpoint is reachable. */
async function checkConnection() {
  try {
    const res = await fetch(`${REFCANVAS_BASE}/status`, { method: "GET" });
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { connected: true, ...data };
  } catch (error) {
    return { connected: false, error: String(error.message ?? error) };
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
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageFetchImage,
      args: [imageUrl],
    });
    const result = results?.[0]?.result;
    if (!result || !result.base64) {
      throw new Error("Could not fetch image from page");
    }
    base64 = result.base64;
    contentType = result.contentType || "image/png";
  }

  // Derive a filename from the URL.
  const url = new URL(imageUrl);
  const basename = url.pathname.split("/").pop() || "capture";
  const filename = basename.includes(".") ? basename : `${basename}.png`;

  // POST to RefCanvas.
  const res = await fetch(`${REFCANVAS_BASE}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: base64,
      contentType,
      filename,
      sourceUrl: pageUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RefCanvas error (${res.status}): ${text}`);
  }

  return res.json();
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "refcanvas-capture" && info.srcUrl) {
    try {
      await captureImageToRefCanvas(info.srcUrl, info.pageUrl, tab.id);
      showBadge("OK", "#3ab28f");
    } catch (error) {
      console.error("[RefCanvas] capture failed:", error);
      showBadge("ERR", "#c95c4b");
    }
  }

  if (info.menuItemId === "refcanvas-capture-visible" && tab.id) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const res = await fetch(`${REFCANVAS_BASE}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64,
          contentType: "image/png",
          filename: `screenshot-${Date.now()}.png`,
          sourceUrl: info.pageUrl,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showBadge("OK", "#3ab28f");
    } catch (error) {
      console.error("[RefCanvas] screenshot failed:", error);
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
