const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const retry = document.getElementById("retry");
const info = document.getElementById("info");
const errBox = document.getElementById("errBox");

/**
 * 展示 background 记录的最近一次失败原文。没有这一步，用户只看到 ERR 徽标，
 * 无法区分"RefCanvas 没开""预检被拒""图片被防盗链"，排障必须开 DevTools。
 */
async function renderLastError() {
  let lastError = null;
  try {
    ({ lastError } = await chrome.storage.session.get("lastError"));
  } catch {
    return;
  }
  if (!lastError) {
    errBox.hidden = true;
    return;
  }
  const when = new Date(lastError.at).toLocaleTimeString();
  errBox.textContent = `Last failure — ${lastError.stage}: ${lastError.message} (${when})`;
  errBox.hidden = false;
  // 网络层失败（fetch reject）最常见的原因：应用没在运行，或浏览器拦掉了
  // 对回环地址的访问（Local Network Access 权限）。给出可操作的指引。
  const isNetworkFailure =
    /failed to fetch|unreachable|networkerror|load failed/i.test(lastError.message);
  if (isNetworkFailure) {
    const hint = document.createElement("div");
    hint.style.marginTop = "6px";
    hint.textContent =
      "Make sure RefCanvas is running. If Chrome showed a “local network access” prompt, choose Allow.";
    errBox.appendChild(hint);
  }
}

async function check() {
  dot.className = "dot checking";
  statusText.textContent = "Checking connection…";
  errBox.hidden = true;

  chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" }, async (response) => {
    if (response?.connected) {
      dot.className = "dot connected";
      const board = response.activeBoardTitle ?? "active board";
      statusText.textContent = `Connected — ${board}`;
    } else {
      dot.className = "dot disconnected";
      statusText.textContent = "Not connected";
      info.innerHTML = `Make sure RefCanvas is running. The extension connects to <code>http://127.0.0.1:17530</code>.`;
    }
    await renderLastError();
  });
}

retry.addEventListener("click", check);
check();
