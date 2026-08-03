const { delay, evaluate, waitFor } = require("../harness/cdp-client.cjs");
const { version: expectedVersion } = require("../../../package.json");

async function runPackagedSmoke(client) {
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await waitFor(
    client,
    `window.refCanvas && typeof window.refCanvas.filesystem?.listDirectory === "function"`,
    "RENDERER_API",
  );
  const result = await evaluate(
    client,
    `(async () => {
      await window.refCanvas.filesystem.setObservedDirectory("C:\\\\");
      const page = await window.refCanvas.filesystem.listDirectory("C:\\\\", {
        pageSize: 32,
      });
      await window.refCanvas.filesystem.setObservedDirectory(null);
      const app = await window.refCanvas.system.getAppInfo();
      const boards = await window.refCanvas.boards.list();
      const board = boards[0] ?? await window.refCanvas.boards.create("Runtime smoke");
      await window.refCanvas.boards.openWindow(board.id);
      return {
        appVersion: app.appVersion,
        databaseSchemaVersion: app.databaseSchemaVersion,
        boardId: board.id,
        rootEntries: page.entries.length,
        rootTotal: page.total,
      };
    })()`,
  );
  const deadline = Date.now() + 10_000;
  let boardWindowOpened = false;
  while (Date.now() < deadline) {
    const { targetInfos } = await client.send("Target.getTargets");
    boardWindowOpened = targetInfos.some(
      (target) => target.type === "page" && /[?&]mode=window(?:&|$)/.test(target.url),
    );
    if (boardWindowOpened) break;
    await delay(100);
  }
  if (!boardWindowOpened) {
    throw new Error(`BOARD_WINDOW_NOT_OPENED:${result.boardId}`);
  }
  if (result.appVersion !== expectedVersion) {
    throw new Error(`APP_VERSION_MISMATCH:${result.appVersion}`);
  }
  if (result.databaseSchemaVersion !== 13) {
    throw new Error(`SCHEMA_VERSION_MISMATCH:${result.databaseSchemaVersion}`);
  }
  return { ...result, boardWindowOpened };
}

module.exports = { runPackagedSmoke };
