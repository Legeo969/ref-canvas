const WebSocket = require("ws");

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connectCdp(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let target;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const targets = await response.json();
      target = targets.find((item) => item.type === "page");
      if (target) break;
    } catch {}
    await delay(200);
  }
  if (!target) throw new Error("CDP_TARGET_NOT_FOUND");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const rejectPending = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  socket.on("close", () => {
    rejectPending(new Error("CDP_SOCKET_CLOSED"));
  });
  socket.on("error", (error) => {
    rejectPending(error);
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id) {
      events.push(message);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error("CDP_SOCKET_NOT_OPEN"));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        pending.delete(id);
        reject(error);
      });
    });
  return { socket, send, events };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function waitFor(client, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await delay(200);
  }
  throw new Error(`TIMEOUT_${label}`);
}

module.exports = { connectCdp, delay, evaluate, waitFor };
