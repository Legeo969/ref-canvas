/**
 * RefCanvas 本地捕获服务的 HTTP 客户端。
 *
 * 所有用户可见的失败都记录进 storage.session 的 lastError——popup 直接
 * 展示原文，排障不用开 DevTools；成功路径负责清除，避免展示陈旧错误。
 */
import { getSettings } from "./settings.js";

export async function apiBase() {
  const { port } = await getSettings();
  return `http://127.0.0.1:${port}`;
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
  try {
    const res = await fetch(`${base}/status`);
    if (!res.ok) {
      const detail = `HTTP ${res.status}`;
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

/** 目标板已被删除（服务端 400"目标板不存在"）——调用方据此重置默认板。 */
export class BoardMissingError extends Error {}

/**
 * 统一的 /capture 发送。网络层失败（预检被拒、应用没开、端口错）给出
 * 可读原因；400 且服务端认定目标板缺失时抛 BoardMissingError。
 */
export async function postCapture(payload) {
  const base = await apiBase();
  const res = await fetch(`${base}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((error) => {
    throw new Error(
      `无法连接 RefCanvas（${base}/capture）：${String(error?.message ?? error)}`,
    );
  });
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (typeof body.error === "string" && body.error.includes("目标板")) {
      throw new BoardMissingError(body.error);
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
