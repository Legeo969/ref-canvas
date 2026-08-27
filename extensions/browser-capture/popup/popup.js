/* popup 逻辑：状态/默认板/历史。所有数据经 SW 消息获取（GET_STATUS /
 * GET_HISTORY / SET_DEFAULT_BOARD / RETRY_CAPTURE），popup 自身不发网络
 * 请求——SW 顺带刷新右键菜单的板子菜单，保持单一刷新入口。 */
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const boardSelect = document.getElementById("boardSelect");
const pickButton = document.getElementById("pickButton");
const optionsButton = document.getElementById("optionsButton");
const errBox = document.getElementById("errBox");
const historyEl = document.getElementById("history");
const clearHistoryButton = document.getElementById("clearHistory");
const refreshLink = document.getElementById("refreshLink");

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function describeError(lastError) {
  const at = new Date(lastError.at).toLocaleTimeString();
  return `最近失败 — ${lastError.stage}：${lastError.message}（${at}）`;
}

function renderStatus(status) {
  if (status.connected) {
    dot.className = "dot connected";
    const board = status.activeBoardTitle ?? "当前板";
    statusText.textContent = `已连接 — ${board}`;
  } else {
    dot.className = "dot disconnected";
    statusText.textContent = status.pairingRequired
      ? "需要配对（打开设置）"
      : "未连接（RefCanvas 在运行吗？）";
  }

  // LNA 提示：fetch 被拒最常见的原因是应用没开或浏览器拦掉回环访问。
  const message = status.lastError?.message ?? status.error ?? "";
  if (!status.connected && /failed to fetch|unreachable|networkerror|load failed|无法连接/i.test(message)) {
    errBox.textContent =
      "连接失败。请确认 RefCanvas 正在运行；若 Chrome 弹出“本地网络访问”权限提示，请选择允许。";
    errBox.hidden = false;
  } else if (status.lastError) {
    errBox.textContent = describeError(status.lastError);
    errBox.hidden = false;
  } else {
    errBox.hidden = true;
  }

  boardSelect.innerHTML = "";
  const follow = document.createElement("option");
  follow.value = "follow";
  follow.textContent = "跟随应用当前板";
  boardSelect.appendChild(follow);
  for (const board of status.boards ?? []) {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.title || "未命名板";
    boardSelect.appendChild(option);
  }
  boardSelect.value = status.settings?.defaultBoardId ?? "follow";
  if (!boardSelect.value) boardSelect.value = "follow";
  boardSelect.disabled = !status.connected;
}

boardSelect.addEventListener("change", () => {
  void send({ type: "SET_DEFAULT_BOARD", boardId: boardSelect.value });
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refreshLink.addEventListener("click", () => {
  dot.className = "dot checking";
  statusText.textContent = "正在连接…";
  void refresh();
});

/* 拾取入口：activeTab 由本次 action 点击授予，popup 里直接注入即可。 */
pickButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    window.close();
  } catch (error) {
    errBox.textContent = `无法在该页面启动拾取（${String(error?.message ?? error)}）`;
    errBox.hidden = false;
  }
});

function renderHistory(entries) {
  historyEl.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无记录";
    historyEl.appendChild(empty);
    clearHistoryButton.hidden = true;
    return;
  }
  clearHistoryButton.hidden = false;
  for (const entry of entries.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = `entry ${entry.status}`;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = entry.status === "ok" ? "✓" : "✗";
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = entry.filename || "capture";
    name.title = entry.error || entry.sourceUrl || entry.filename || "";
    const sub = document.createElement("div");
    sub.className = "sub";
    const time = new Date(entry.at).toLocaleTimeString();
    sub.textContent =
      entry.status === "error"
        ? `${entry.boardTitle ?? ""} ${entry.error ?? ""}`.trim()
        : `${entry.boardTitle ?? "当前板"} · ${time}`;
    meta.append(name, sub);
    row.append(mark, meta);
    if (entry.status === "error" && entry.imageUrl) {
      const retry = document.createElement("button");
      retry.textContent = "重试";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "…";
        await send({ type: "RETRY_CAPTURE", entry });
        await refresh();
      });
      row.appendChild(retry);
    }
    historyEl.appendChild(row);
  }
}

clearHistoryButton.addEventListener("click", async () => {
  await send({ type: "CLEAR_HISTORY" });
  renderHistory([]);
});

async function refresh() {
  try {
    const status = await send({ type: "GET_STATUS" });
    renderStatus(status ?? { connected: false, boards: [] });
  } catch {
    // SW 冷启动偶发消息通道失败：显示离线态，用户可点"重新检查"。
    dot.className = "dot disconnected";
    statusText.textContent = "未连接（点击下方重新检查）";
  }
  try {
    const { entries } = await send({ type: "GET_HISTORY" });
    renderHistory(entries ?? []);
  } catch {
    // 历史失败不阻塞主面板。
  }
}

void refresh();
