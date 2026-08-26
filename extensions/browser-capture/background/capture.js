/**
 * 图片提取：先服务线程直连 CORS fetch（快路径），失败再向页面各框架
 * 注入脚本、从页面源上下文读取（防盗链/跨域兜底）。
 */
import { postCapture } from "./api.js";

/** 页面上下文函数：fetch 图片并转 base64（跨域时只能从页面源读）。 */
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

/** 页面上下文函数：右键流程里服务线程拿不到 document.title，注入取一次。 */
function pageTitleInPage() {
  return document.title || "";
}

/** 从 URL 派生落盘文件名；data:/blob:/无路径 URL 单独兜底。 */
export function deriveFilename(imageUrl) {
  if (imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:image\/([a-z0-9.+-]+)/i);
    return `inline-image-${Date.now()}.${match ? match[1].replace("+", ".") : "png"}`;
  }
  try {
    const url = new URL(imageUrl);
    const basename = url.pathname.split("/").pop();
    if (!basename || !basename.includes(".")) {
      return `capture-${Date.now()}.png`;
    }
    return decodeURIComponent(basename);
  } catch {
    return `capture-${Date.now()}.png`;
  }
}

/**
 * 读图为 {base64, contentType}：直连失败再 allFrames 注入（图片常在
 * iframe 里，只注入主框架会让跨域 iframe 图永远失败）。
 * 返回 null 表示两条路都读不到（防盗链/已过期）。
 */
export async function fetchImageBase64(imageUrl, tabId) {
  try {
    const res = await fetch(imageUrl, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      return {
        base64: await blobToBase64(blob),
        contentType: blob.type || "image/png",
      };
    }
  } catch {
    // 跨域无 CORS 头——落入注入兜底。
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: pageFetchImage,
      args: [imageUrl],
    });
  } catch (error) {
    throw new Error(
      `无法访问该页面读取图片（${String(error?.message ?? error)}）`,
    );
  }
  const hit = (results ?? []).find((entry) => entry?.result?.base64);
  if (!hit) return null;
  return {
    base64: hit.result.base64,
    contentType: hit.result.contentType || "image/png",
  };
}

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

/** 尽力取一次页面标题（受限页面静默返回空串）。 */
export async function getPageTitle(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageTitleInPage,
    });
    return results?.[0]?.result || "";
  } catch {
    return "";
  }
}

/** boardId 归一化："follow"（跟随应用当前板）不带 boardId。 */
export function targetBoardId(boardId) {
  return boardId && boardId !== "follow" ? boardId : undefined;
}

/** URL 型图片捕获：提取 → POST（附来源元数据与目标板）。 */
export async function captureImageUrl({
  imageUrl,
  pageUrl,
  tabId,
  boardId,
  pageTitle,
  alt,
}) {
  const fetched = await fetchImageBase64(imageUrl, tabId);
  if (!fetched) {
    throw new Error("无法读取该图片（可能被防盗链保护或已过期）");
  }
  return postCapture({
    image: fetched.base64,
    contentType: fetched.contentType,
    filename: deriveFilename(imageUrl),
    sourceUrl: pageUrl,
    boardId: targetBoardId(boardId),
    pageTitle: pageTitle || undefined,
    alt: alt || undefined,
  });
}

/** 帧型图片捕获（拾取器已在页面内抽好帧）：直接 POST dataURL。 */
export async function captureFrame({
  dataUrl,
  suggestedName,
  pageUrl,
  boardId,
  pageTitle,
  alt,
}) {
  const comma = dataUrl.indexOf(",");
  const contentType = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png";
  return postCapture({
    image: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    contentType,
    filename: suggestedName || `frame-${Date.now()}.${contentType.split("/")[1] || "png"}`,
    sourceUrl: pageUrl,
    boardId: targetBoardId(boardId),
    pageTitle: pageTitle || undefined,
    alt: alt || undefined,
  });
}

/** 可见区域截屏捕获（右键"截取页面"及无 srcUrl 图片的兜底）。 */
export async function captureVisibleTab({
  windowId,
  pageUrl,
  boardId,
  pageTitle,
}) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  });
  return captureFrame({
    dataUrl,
    suggestedName: `screenshot-${Date.now()}.png`,
    pageUrl,
    boardId,
    pageTitle,
  });
}
