/* 设置页：默认板 + 端口。数据经 SW 消息（GET_STATUS / SET_DEFAULT_BOARD /
 * SET_PORT）读写，保存后 SW 侧刷新右键菜单。 */
const boardSelect = document.getElementById("boardSelect");
const portInput = document.getElementById("portInput");
const saveButton = document.getElementById("saveButton");
const testButton = document.getElementById("testButton");
const statusText = document.getElementById("statusText");
const pairingCode = document.getElementById("pairingCode");
const pairButton = document.getElementById("pairButton");

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setStatus(text, isError) {
  statusText.textContent = text;
  statusText.className = `status ${isError ? "err" : "ok"}`;
}

async function load() {
  try {
    const status = await send({ type: "GET_STATUS" });
    boardSelect.innerHTML = "";
    const follow = document.createElement("option");
    follow.value = "follow";
    follow.textContent = "跟随应用当前板";
    boardSelect.appendChild(follow);
    for (const board of status?.boards ?? []) {
      const option = document.createElement("option");
      option.value = board.id;
      option.textContent = board.title || "未命名板";
      boardSelect.appendChild(option);
    }
    boardSelect.value = status?.settings?.defaultBoardId ?? "follow";
    if (!boardSelect.value) boardSelect.value = "follow";
    boardSelect.disabled = false;
    portInput.value = String(status?.settings?.port ?? 17530);
    setStatus(
      status?.connected
        ? "已连接 RefCanvas"
        : status?.pairingRequired
          ? "需要配对"
          : "RefCanvas 未运行",
      !status?.connected,
    );
  } catch (error) {
    setStatus(`加载设置失败：${String(error?.message ?? error)}`, true);
  }
}

pairButton.addEventListener("click", async () => {
  const code = pairingCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    setStatus("请输入六位配对码", true);
    return;
  }
  pairButton.disabled = true;
  const result = await send({ type: "PAIR", code });
  pairButton.disabled = false;
  if (!result?.ok) {
    setStatus(result?.error ?? "配对失败", true);
    return;
  }
  pairingCode.value = "";
  setStatus("配对成功");
  await load();
});

saveButton.addEventListener("click", async () => {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    setStatus("端口需在 1024–65535 之间", true);
    return;
  }
  await send({ type: "SET_DEFAULT_BOARD", boardId: boardSelect.value });
  await send({ type: "SET_PORT", port });
  setStatus("已保存");
});

testButton.addEventListener("click", async () => {
  setStatus("测试中…");
  await send({ type: "SET_PORT", port: Number(portInput.value) });
  const status = await send({ type: "GET_STATUS" });
  const failure =
    status?.error ||
    (status?.pairingRequired
      ? "浏览器尚未与 RefCanvas 配对，请先输入六位配对码"
      : "无法读取连接状态，请重新加载扩展后重试");
  setStatus(
    status?.connected
      ? `连接成功，找到 ${status.boards?.length ?? 0} 块板`
      : `连接失败：${failure}`,
    !status?.connected,
  );
});

void load();
