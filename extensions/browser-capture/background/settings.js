/**
 * 扩展设置（chrome.storage.sync：跟随账号跨设备）。
 * - port：RefCanvas 本地捕获端口（应用侧默认 17530）
 * - defaultBoardId："follow" = 跟随应用当前板；否则为指定板 id（选板投放）
 */
const DEFAULTS = Object.freeze({ port: 17530, defaultBoardId: "follow" });

export async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    return {
      port: Number(stored.port) || DEFAULTS.port,
      defaultBoardId: stored.defaultBoardId || DEFAULTS.defaultBoardId,
    };
  } catch {
    // sync 存储不可用（SW 生命周期边缘 / 登录态异常）时退回默认值。
    return { ...DEFAULTS };
  }
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set(next);
  return next;
}

export async function getPairingToken() {
  try {
    const { pairingToken } = await chrome.storage.local.get("pairingToken");
    return typeof pairingToken === "string" ? pairingToken : "";
  } catch {
    return "";
  }
}

export async function setPairingToken(pairingToken) {
  await chrome.storage.local.set({ pairingToken });
}

export async function clearPairingToken() {
  await chrome.storage.local.remove("pairingToken");
}
