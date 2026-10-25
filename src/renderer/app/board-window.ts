/**
 * 多窗口白板的 URL 参数解析：`?board=<uuid>&mode=window`。
 * 渲染层入口据此短路为 BoardWindow（跳过主窗口 store 初始化）。
 */

export interface BoardWindowParams {
  mode: "window";
  boardId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 解析窗口参数；非窗口模式或参数非法返回 null。 */
export function parseBoardWindowParams(search: string): BoardWindowParams | null {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "window") return null;
  const boardId = params.get("board") ?? "";
  if (!UUID_PATTERN.test(boardId)) return null;
  return { mode: "window", boardId };
}

/** 当前渲染进程是否为独立白板窗口（URL `?board=<uuid>&mode=window`）。 */
export function isStandaloneBoardWindow(): boolean {
  return parseBoardWindowParams(window.location.search) !== null;
}

/**
 * 交互抬升触发条件：仅独立白板窗口存在打开中的弹层类 UI（右键菜单 /
 * 排列面板 / 绘制面板）时抬升；主窗口工作区恒为 false，不产生任何 IPC。
 */
export function shouldLiftInteraction(
  isStandalone: boolean,
  menuOpen: boolean,
  arrangeOpen: boolean,
  drawingOpen: boolean,
): boolean {
  return isStandalone && (menuOpen || arrangeOpen || drawingOpen);
}
