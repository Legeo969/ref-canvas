const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const retry = document.getElementById("retry");

async function check() {
  dot.className = "dot checking";
  statusText.textContent = "Checking connection…";

  chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" }, (response) => {
    if (response?.connected) {
      dot.className = "dot connected";
      statusText.textContent = "Connected";
      const board = response.activeBoardTitle ?? "active board";
      statusText.textContent = `Connected — ${board}`;
    } else {
      dot.className = "dot disconnected";
      statusText.textContent = "Not connected";
      const info = document.getElementById("info");
      info.innerHTML = `Make sure RefCanvas is running. The extension connects to <code>http://127.0.0.1:17530</code>.`;
    }
  });
}

retry.addEventListener("click", check);
check();
