/**
 * RefCanvas 本地捕获服务的 HTTP 客户端。
 *
 * 所有用户可见的失败都记录进 storage.session 的 lastError——popup 直接
 * 展示原文，排障不用开 DevTools；成功路径负责清除，避免展示陈旧错误。
 */
import {
  clearPairingToken,
  getPairingToken,
  getSettings,
  setPairingToken,
} from "./settings.js";

export async function apiBase() {
  const { port } = await getSettings();
  return `http://127.0.0.1:${port}`;
}

function extensionHeaders(headers = {}) {
  return {
    ...headers,
    "X-RefCanvas-Extension-Id": chrome.runtime.id,
  };
}

async function responseError(res) {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
}

export async function recordError(stage, error) {
  const message = String(error?.message ?? error);
  console.error(`[RefCanvas] ${stage} failed:`, message);
  try {
    await chrome.storage.session.set({
      lastError: { stage, message, at: new Date().toISOString() },
    });
  } catch {
    // storage 不可用时忽略（SW 生命周期边缘）。
  }
  return message;
}

export async function clearLastError() {
  try {
    await chrome.storage.session.remove("lastError");
  } catch {
    // ignore
  }
}

export async function getLastError() {
  try {
    const { lastError } = await chrome.storage.session.get("lastError");
    return lastError ?? null;
  } catch {
    return null;
  }
}

/** GET /status：连接探测 + 板列表（选板菜单/弹窗下拉的数据源）。 */
export async function checkConnection() {
  const base = await apiBase();
  const token = await getPairingToken();
  if (!token) {
    return {
      connected: false,
      pairingRequired: true,
      error: "浏览器尚未与 RefCanvas 配对，请先输入六位配对码",
    };
  }
  try {
    const res = await fetch(`${base}/status`, {
      headers: extensionHeaders({ Authorization: `Bearer ${token}` }),
    });
    if (res.status === 401) {
      await clearPairingToken();
      return { connected: false, pairingRequired: true };
    }
    if (!res.ok) {
      const serverError = await responseError(res);
      const detail =
        res.status === 403
          ? "扩展身份验证失败，请在浏览器扩展页面重新加载 RefCanvas 网页捕获"
          : serverError;
      await recordError("status", detail);
      return { connected: false, error: detail };
    }
    const data = await res.json();
    await clearLastError();
    return { connected: true, ...data };
  } catch (error) {
    const message = await recordError("status", error);
    return { connected: false, error: message };
  }
}

export async function pairWithCode(code) {
  const base = await apiBase();
  const res = await fetch(`${base}/pair`, {
    method: "POST",
    headers: extensionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      code: String(code ?? "").trim(),
      label: `${navigator.userAgentData?.brands?.[0]?.brand ?? "Chrome / Edge"} 扩展`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.token !== "string") {
    throw new Error(
      res.status === 401
        ? "配对码无效或已过期，请在 RefCanvas 中重新生成"
        : res.status === 403
          ? "扩展身份验证失败，请更新或重新加载 RefCanvas 网页捕获"
        : body.error || `配对失败 (HTTP ${res.status})`,
    );
  }
  await setPairingToken(body.token);
  await clearLastError();
  return body.pairing;
}

/** 目标板已被删除（服务端 400"目标板不存在"）——调用方据此重置默认板。 */
export class BoardMissingError extends Error {}

/**
 * 统一的 /capture 发送。网络层失败（预检被拒、应用没开、端口错）给出
 * 可读原因；400 且服务端认定目标板缺失时抛 BoardMissingError。
 */
export async function postCapture(payload) {
  const base = await apiBase();
  const token = await getPairingToken();
  if (!token) throw new Error("浏览器尚未与 RefCanvas 配对");
  const res = await fetch(`${base}/capture`, {
    method: "POST",
    headers: extensionHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    body: JSON.stringify(payload),
  }).catch((error) => {
    throw new Error(
      `无法连接 RefCanvas（${base}/capture）：${String(error?.message ?? error)}`,
    );
  });
  if (res.status === 401) {
    await clearPairingToken();
    throw new Error("配对已失效，请打开扩展设置重新配对");
  }
  if (res.status === 403) {
    throw new Error("扩展身份验证失败，请更新或重新加载 RefCanvas 网页捕获");
  }
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (typeof body.error === "string" && body.error.includes("目标板")) {
      throw new BoardMissingError(body.error);
    }
    if (body.error === "UNSUPPORTED_IMAGE_FORMAT") {
      throw new Error("网页图片格式暂不支持，请使用页面拾取或截图");
    }
    if (body.error === "IMAGE_DIMENSIONS_TOO_LARGE") {
      throw new Error("图片尺寸超过 1 亿像素限制，请使用页面拾取或截图");
    }
    if (body.error === "IMAGE_TOO_LARGE") {
      throw new Error("图片文件超过 32 MB 限制，请使用页面拾取或截图");
    }
    throw new Error(`RefCanvas 拒绝请求 (400)：${body.error ?? "未知原因"}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RefCanvas 错误 (${res.status})：${text}`);
  }
  await clearLastError();
  return res.json();
}
