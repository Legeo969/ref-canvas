/**
 * 最近捕获历史（chrome.storage.local，最多 50 条，FIFO）。
 * 只存元数据不存图片本体——重试按 imageUrl 重拉，防盗链图源可能失败。
 */
const KEY = "recentCaptures";
const MAX_ENTRIES = 50;

export async function addHistoryEntry(entry) {
  try {
    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
    const next = [entry, ...list].slice(0, MAX_ENTRIES);
    await chrome.storage.local.set({ [KEY]: next });
  } catch {
    // 历史是锦上添花，失败不影响捕获主流程。
  }
}

export async function getHistory() {
  try {
    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function clearHistory() {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // ignore
  }
}
