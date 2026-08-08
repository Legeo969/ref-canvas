const { delay, evaluate, waitFor } = require("../harness/cdp-client.cjs");
const { version: expectedVersion } = require("../../../package.json");

async function runPackagedSmoke(client, browseRoot) {
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await waitFor(
    client,
    `window.refCanvas && typeof window.refCanvas.filesystem?.listDirectory === "function"`,
    "RENDERER_API",
  );
  await waitFor(
    client,
    `document.querySelector(".app-shell .workspace.directory-workspace") !== null`,
    "RENDERER_UI",
    10_000,
  );
  await evaluate(
    client,
    `(async () => {
      const browseRoot = ${JSON.stringify(browseRoot)};
      await window.refCanvas.mounts.add(browseRoot);
      const raw = await window.refCanvas.system.getNavigationState();
      let current = {};
      try {
        current = raw ? JSON.parse(raw) : {};
      } catch {
        current = {};
      }
      const next = {
        ...current,
        version: 2,
        updatedAt: Date.now() + 1,
        navigationSource: "directory",
        directoryPath: browseRoot,
        directoryHistory: [browseRoot],
        directoryHistoryIndex: 0,
      };
      const serialized = JSON.stringify(next);
      window.localStorage.setItem("refcanvas.navigation.v2", serialized);
      await window.refCanvas.system.setNavigationState(serialized);
      window.setTimeout(() => window.location.reload(), 0);
      return true;
    })()`,
  );
  await waitFor(
    client,
    `document.querySelector(".app-shell .workspace.directory-workspace .directory-card") !== null`,
    "RENDERER_DIRECTORY",
    10_000,
  );
  await waitFor(
    client,
    `document.querySelector(".app-shell .workspace.directory-workspace") !== null`,
    "RENDERER_UI_AFTER_NAVIGATION",
    10_000,
  );
  const result = await evaluate(
    client,
    `(async () => {
      const browseRoot = ${JSON.stringify(browseRoot)};
      const waitForSelector = async (selector, timeout = 5000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      };
      await waitForSelector(".app-shell .workspace", 10_000);
      const defaultWorkspaceMode =
        document.querySelector(".workspace")?.className ?? null;
      const boardVisibleByDefault = Boolean(
        document.querySelector(".workspace > .board-panel"),
      );
      await window.refCanvas.filesystem.setObservedDirectory(browseRoot);
      const page = await window.refCanvas.filesystem.listDirectory(browseRoot, {
        pageSize: 32,
      });
      await window.refCanvas.filesystem.setObservedDirectory(null);
      const app = await window.refCanvas.system.getAppInfo();
      const boards = await window.refCanvas.boards.list();
      const board = boards[0] ?? await window.refCanvas.boards.create("Runtime smoke");
      const directoryCard = await waitForSelector(".directory-card");
      directoryCard?.click();
      const inspector = await waitForSelector(".directory-details-panel");
      const inspectorTitle =
        inspector?.querySelector(".directory-inspector-title")
          ?.textContent?.trim() ?? null;
      const professionalSettingsVisible = Boolean(
        document.querySelector('[aria-label="打开专业预览设置"]'),
      );
      const activeWorkspaceMode =
        document.querySelector(".workspace-mode-switch button.active")
          ?.textContent?.trim() ?? null;
      document.querySelector(".sidebar-board-section .nav-row")?.click();
      const boardWorkspace = await waitForSelector(".workspace.board-workspace");
      await window.refCanvas.boards.openWindow(board.id);
      return {
        appVersion: app.appVersion,
        databaseSchemaVersion: app.databaseSchemaVersion,
        boardId: board.id,
        rootEntries: page.entries.length,
        rootTotal: page.total,
        defaultWorkspaceMode,
        boardVisibleByDefault,
        inspectorTitle,
        boardWorkspaceVisible: Boolean(
          boardWorkspace?.querySelector(".board-panel"),
        ),
        activeWorkspaceMode,
        firstSidebarSection:
          document.querySelector(
            ".directory-browser .directory-subsection-label",
          )
            ?.textContent?.trim() ?? null,
        diskSectionVisible: Array.from(
          document.querySelectorAll(
            ".directory-browser .directory-subsection-label",
          ),
        ).some((element) => element.textContent?.trim() === "磁盘"),
        professionalSettingsVisible,
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
  if (result.databaseSchemaVersion !== 17) {
    throw new Error(`SCHEMA_VERSION_MISMATCH:${result.databaseSchemaVersion}`);
  }
  if (result.activeWorkspaceMode !== "磁盘") {
    throw new Error(`WORKSPACE_MODE_MISMATCH:${result.activeWorkspaceMode}`);
  }
  if (!result.defaultWorkspaceMode?.includes("directory-workspace")) {
    throw new Error(`DEFAULT_WORKSPACE_MISMATCH:${result.defaultWorkspaceMode}`);
  }
  if (result.boardVisibleByDefault) {
    throw new Error("BOARD_VISIBLE_IN_DEFAULT_WORKSPACE");
  }
  if (result.inspectorTitle !== "runtime-smoke.txt") {
    throw new Error(`DIRECTORY_INSPECTOR_MISMATCH:${result.inspectorTitle}`);
  }
  if (!result.boardWorkspaceVisible) {
    throw new Error("BOARD_WORKSPACE_NOT_VISIBLE");
  }
  if (result.firstSidebarSection !== "快速访问") {
    throw new Error(`SIDEBAR_PRIMARY_MISMATCH:${result.firstSidebarSection}`);
  }
  if (!result.diskSectionVisible) {
    throw new Error("SIDEBAR_DISKS_MISSING");
  }
  if (!result.professionalSettingsVisible) {
    throw new Error("PROFESSIONAL_SETTINGS_NOT_VISIBLE");
  }
  return { ...result, boardWindowOpened };
}

module.exports = { runPackagedSmoke };
