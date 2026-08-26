/**
 * 右键菜单管理：固定项 + "发送到指定板"动态子菜单。
 *
 * MV3 里 contextMenus 在浏览器存续期内持久，但 SW 会被回收——菜单必须在
 * onInstalled/onStartup 顶层同步重建（removeAll 防重复 id）；板列表来自
 * /status，连接后刷新子菜单，未连接时子菜单显示占位禁用项。
 */
import { checkConnection } from "./api.js";
import { getSettings } from "./settings.js";

export const MENU_CAPTURE = "refcanvas-capture";
export const MENU_VISIBLE = "refcanvas-capture-visible";
const MENU_BOARD_PARENT = "refcanvas-board-menu";
const MENU_BOARD_PLACEHOLDER = `${MENU_BOARD_PARENT}-placeholder`;
/** 子菜单板数量上限：再多挤压严重，引导去弹窗换默认板。 */
const MAX_BOARD_ITEMS = 15;

/** 顶层同步重建全部基础菜单（onInstalled/onStartup 调用）。 */
export async function ensureBaseMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_CAPTURE,
    title: "添加到 RefCanvas",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: MENU_VISIBLE,
    title: "截取页面到 RefCanvas",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: MENU_BOARD_PARENT,
    title: "发送到指定板",
    contexts: ["image", "page"],
  });
  chrome.contextMenus.create({
    id: MENU_BOARD_PLACEHOLDER,
    parentId: MENU_BOARD_PARENT,
    title: "RefCanvas 未运行，无法获取板列表",
    enabled: false,
    contexts: ["image", "page"],
  });
}

/**
 * 用板列表重建子菜单。成功后顺手缓存板标题（历史记录展示用）。
 * 传入空列表时恢复占位项（应用关了/端口变了）。
 */
export async function refreshBoardSubmenu(boards) {
  const cache = {};
  try {
    await chrome.contextMenus.remove(MENU_BOARD_PARENT);
  } catch {
    // 父项不存在（首次连接）时忽略。
  }
  chrome.contextMenus.create({
    id: MENU_BOARD_PARENT,
    title: "发送到指定板",
    contexts: ["image", "page"],
  });
  const list = Array.isArray(boards) ? boards : [];
  for (const board of list.slice(0, MAX_BOARD_ITEMS)) {
    cache[board.id] = board.title;
    chrome.contextMenus.create({
      id: `board:${board.id}`,
      parentId: MENU_BOARD_PARENT,
      title: board.title || "未命名板",
      contexts: ["image", "page"],
    });
  }
  if (list.length > MAX_BOARD_ITEMS) {
    chrome.contextMenus.create({
      id: `${MENU_BOARD_PARENT}-more`,
      parentId: MENU_BOARD_PARENT,
      title: `共 ${list.length} 块板——可在弹窗里把常用的设为默认`,
      enabled: false,
      contexts: ["image", "page"],
    });
  }
  if (list.length === 0) {
    chrome.contextMenus.create({
      id: MENU_BOARD_PLACEHOLDER,
      parentId: MENU_BOARD_PARENT,
      title: "没有可用的板（RefCanvas 未运行？）",
      enabled: false,
      contexts: ["image", "page"],
    });
  }
  try {
    await chrome.storage.session.set({ boardTitles: cache });
  } catch {
    // 缓存失败只影响历史记录里的板名展示。
  }
}

/** 连接探测 + 子菜单刷新（SW 唤醒点之一：popup 打开/菜单点击后）。 */
export async function syncStatusAndMenus() {
  const status = await checkConnection();
  if (status.connected) {
    await refreshBoardSubmenu(status.boards ?? []);
  } else {
    await refreshBoardSubmenu([]);
  }
  return status;
}

/** 解析板标题（历史记录展示；找不到时回退"已删除的板"）。 */
export async function boardTitleOf(boardId) {
  if (!boardId) return "当前板";
  try {
    const { boardTitles } = await chrome.storage.session.get("boardTitles");
    return boardTitles?.[boardId] ?? "已删除的板";
  } catch {
    return "当前板";
  }
}

/** 400 目标板已删时把默认板重置为"跟随应用"，避免每次捕获都失败。 */
export async function resetDefaultBoardIfMissing(defaultBoardId) {
  const { defaultBoardId: current } = await getSettings();
  if (current === defaultBoardId) {
    await chrome.storage.sync.set({ defaultBoardId: "follow" });
  }
}
