const fs = require("node:fs");
const path = require("node:path");
const { delay, evaluate, waitFor } = require("../harness/cdp-client.cjs");
const { version: expectedVersion } = require("../../../package.json");

async function captureScreenshot(client, screenshotRoot, name) {
  const result = await client.send("Page.captureScreenshot", { format: "png" });
  const target = path.join(screenshotRoot, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, "base64"));
  return target;
}

async function runPackagedSmoke(client, browseRoot, screenshotRoot, runLabel) {
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await waitFor(
    client,
    `window.refCanvas && typeof window.refCanvas.filesystem?.listDirectory === "function"`,
    "RENDERER_API",
  );
  try {
    await waitFor(
      client,
      `document.querySelector(".app-shell .workspace.directory-workspace") !== null`,
      "RENDERER_UI",
      10_000,
    );
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `({
        text: document.body?.innerText?.slice(0, 800) ?? "",
        html: document.body?.innerHTML?.slice(0, 1200) ?? "",
        scripts: Array.from(document.scripts).map((item) => item.src),
        resources: performance.getEntriesByType("resource").map((item) => ({ name: item.name, duration: item.duration, size: item.transferSize })).slice(-12),
      })`,
    ).catch(() => ({ text: "", html: "" }));
    const events = client.events
      .filter((event) => event.method === "Runtime.exceptionThrown" || event.method === "Log.entryAdded" || event.method === "Runtime.consoleAPICalled")
      .slice(-12);
    throw new Error(`${error.message}:${JSON.stringify({ diagnostic, events })}`);
  }
  await evaluate(
    client,
    `(async () => {
      const browseRoot = ${JSON.stringify(browseRoot)};
      await window.refCanvas.mounts.add(browseRoot);
      // 固定烟测语言，避免默认语言调整让 DOM 文案断言产生假失败。
      const preferences = await window.refCanvas.system.getPreferences();
      await window.refCanvas.system.setPreferences({
        ...preferences,
        language: "zh-CN",
      });
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
  const baseResult = await evaluate(
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
      const directoryCard = Array.from(document.querySelectorAll(".directory-card"))
        .find((item) => item.textContent?.includes("runtime-smoke.txt")) ?? await waitForSelector(".directory-card");
      directoryCard?.click();
      const inspector = await waitForSelector(".directory-details-panel");
      await waitForSelector(".directory-details-panel .directory-inspector-title");
      const inspectorTitle =
        inspector?.querySelector(".directory-inspector-title")
          ?.textContent?.trim() ?? null;
      const libraryPreferences = await window.refCanvas.library.getPreferences();
      await window.refCanvas.library.setPreferences({
        panelLayout: {
          ...libraryPreferences.panelLayout,
          detailsWidth: 1000,
        },
      });
      const aiTab = Array.from(
        document.querySelectorAll('.directory-details-panel [role="tab"]'),
      ).find(
        // Found tab bar localizes the label; every catalog renders the AI tab with "AI" (e.g. "AI Design Director"/"AI 设计总监").
        (item) => /AI/i.test(item.textContent ?? ""),
      );
      aiTab?.click();
      const embeddedAi = await waitForSelector(".directory-details-panel .ai-panel.embedded");
      const detachedAi = document.querySelector(".ai-panel-backdrop:not(.embedded)");
      const professionalSettingsVisible = Boolean(
        document.querySelector('[aria-label="打开专业预览设置"]'),
      );
      const activeWorkspaceMode =
        document.querySelector(".workspace-mode-switch button.active")
          ?.textContent?.trim() ?? null;
      return {
        appVersion: app.appVersion,
        databaseSchemaVersion: app.databaseSchemaVersion,
        boardId: board.id,
        rootEntries: page.entries.length,
        rootTotal: page.total,
        defaultWorkspaceMode,
        boardVisibleByDefault,
        inspectorTitle,
        embeddedAiVisible: Boolean(embeddedAi),
        detachedAiVisible: Boolean(detachedAi),
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
  const previewSmoke = await evaluate(
    client,
    `(async () => {
      const waitForSelector = async (selector, timeout = 10000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      };
      const videoCard = Array.from(document.querySelectorAll(".directory-card"))
        .find((item) => item.textContent?.includes("runtime-preview.mp4"));
      if (!videoCard) throw new Error("VIDEO_CARD_NOT_FOUND");
      videoCard.click();
      const previewTab = document.querySelector('.directory-details-panel [role="tab"]');
      if (!previewTab) throw new Error("PREVIEW_TAB_NOT_FOUND");
      previewTab.click();
      const toolbar = await waitForSelector(".directory-details-panel .found-toolbar-video", 30000);
      const viewport = await waitForSelector(".directory-details-panel .found-preview-viewport", 30000);
      const video = await waitForSelector(".directory-details-panel .found-preview-viewport video", 30000);
      if (!toolbar || !viewport || !video) throw new Error("VIDEO_PREVIEW_NOT_READY:" + JSON.stringify({
        toolbar: Boolean(toolbar), viewport: Boolean(viewport), video: Boolean(video),
        selected: document.querySelector(".directory-card.selected, .directory-card.active")?.textContent?.trim() ?? null,
        panel: document.querySelector(".directory-details-panel")?.textContent?.slice(0, 500) ?? null,
      }));

      const rect = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
      };
      const intersects = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      const clickTool = async (label, trayClass) => {
        const button = document.querySelector('.directory-details-panel [aria-label="' + label + '"]');
        if (!button) throw new Error("TOOL_BUTTON_MISSING:" + label);
        button.click();
        const tray = await waitForSelector(".directory-details-panel .found-context-tray" + trayClass);
        if (!tray) throw new Error("TOOL_TRAY_MISSING:" + label);
        const currentViewport = document.querySelector(".directory-details-panel .found-preview-viewport");
        const currentVideo = currentViewport?.querySelector("video");
        const currentToolbar = document.querySelector(".directory-details-panel .found-toolbar");
        const fileRow = document.querySelector(".directory-details-panel .found-preview-file-row");
        const controls = document.querySelector(".directory-details-panel .found-preview-controls-slot:not(:empty)");
        const boxes = { viewport: rect(currentViewport), tray: rect(tray), fileRow: rect(fileRow), toolbar: rect(currentToolbar), controls: rect(controls) };
        if (!currentVideo || currentVideo !== video) throw new Error("MEDIA_REPLACED:" + label);
        if (intersects(boxes.viewport, boxes.tray) || intersects(boxes.tray, boxes.toolbar) || intersects(boxes.tray, boxes.controls)) {
          throw new Error("PREVIEW_UI_OVERLAP:" + label + ":" + JSON.stringify(boxes));
        }
        if (!boxes.viewport || !boxes.tray || !boxes.toolbar || boxes.viewport.bottom > boxes.tray.top + 1 || boxes.tray.bottom > boxes.toolbar.top + 50) {
          throw new Error("PREVIEW_UI_ORDER:" + label + ":" + JSON.stringify(boxes));
        }
        return { label, boxes };
      };
      return {
        tools: [],
        videoMounted: Boolean(video),
        titlebar: rect(document.querySelector(".titlebar")),
      };
    })()`,
  );

  const toolScreenshots = [];
  for (const [label, trayClass, slug] of [
    ["FPS", "-fps", "fps"],
    ["资产备注", "-notes", "notes"],
    ["LUT", "-lut", "lut"],
    ["导出 GIF", "-gif", "gif"],
  ]) {
    const toolResult = await evaluate(client, `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null; };
      const intersects = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      document.querySelector('.directory-details-panel .found-context-tray-header [aria-label="关闭工具"]')?.click();
      await delay(80);
      const button = document.querySelector('.directory-details-panel [aria-label=${JSON.stringify(label)}]');
      if (!button) throw new Error(${JSON.stringify(`TOOL_BUTTON_MISSING:${label}`)});
      button.click();
      const deadline = Date.now() + 10000;
      let tray = null;
      while (Date.now() < deadline && !tray) { tray = document.querySelector(${JSON.stringify(`.directory-details-panel .found-context-tray${trayClass}`)}); if (!tray) await delay(50); }
      if (!tray) throw new Error(${JSON.stringify(`TOOL_TRAY_MISSING:${label}`)});
      const viewport = document.querySelector(".directory-details-panel .found-preview-viewport");
      const toolbar = document.querySelector(".directory-details-panel .found-toolbar");
      const fileRow = document.querySelector(".directory-details-panel .found-preview-file-row");
      const controls = document.querySelector(".directory-details-panel .found-preview-controls-slot:not(:empty)");
      const boxes = { viewport: rect(viewport), tray: rect(tray), fileRow: rect(fileRow), toolbar: rect(toolbar), controls: rect(controls) };
      if (!viewport?.querySelector("video")) throw new Error(${JSON.stringify(`MEDIA_MISSING:${label}`)});
      if (intersects(boxes.viewport, boxes.tray) || intersects(boxes.tray, boxes.toolbar) || intersects(boxes.tray, boxes.controls)) throw new Error(${JSON.stringify(`PREVIEW_UI_OVERLAP:${label}:`)} + JSON.stringify(boxes));
      if (!boxes.viewport || !boxes.tray || !boxes.toolbar || boxes.viewport.bottom > boxes.tray.top + 1 || boxes.tray.bottom > boxes.toolbar.top + 50) throw new Error(${JSON.stringify(`PREVIEW_UI_ORDER:${label}:`)} + JSON.stringify(boxes));
      return { label: ${JSON.stringify(label)}, boxes };
    })()`);
    previewSmoke.tools.push(toolResult);
    toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-${slug}-tray`));
  }

  const focusResult = await evaluate(client, `(async () => {
    document.querySelector('.directory-details-panel .found-context-tray-header [aria-label="关闭工具"]')?.click();
    const button = document.querySelector('.directory-details-panel [aria-label="聚焦预览"]');
    if (!button) throw new Error("FOCUS_BUTTON_MISSING");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const panel = document.querySelector(".found-preview-panel.preview-session-focused");
    const titlebar = document.querySelector(".titlebar");
    const header = panel?.querySelector(".found-tab-bar");
    const viewport = panel?.querySelector(".found-preview-viewport");
    const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null; };
    const boxes = { panel: rect(panel), titlebar: rect(titlebar), header: rect(header), viewport: rect(viewport) };
    if (!boxes.panel || !boxes.titlebar || boxes.panel.top < boxes.titlebar.bottom - 1) throw new Error("FOCUS_COVERS_TITLEBAR:" + JSON.stringify(boxes));
    if (!boxes.header || !boxes.viewport || boxes.header.bottom > boxes.viewport.top + 1) throw new Error("FOCUS_HEADER_OVERLAP:" + JSON.stringify(boxes));
    return boxes;
  })()`);
  const focusScreenshot = await captureScreenshot(client, screenshotRoot, `${runLabel}-focused-preview`);

  const fullscreenResult = await evaluate(client, `(async () => {
    document.querySelector('.found-preview-panel [aria-label="退出聚焦预览"]')?.click();
    const button = document.querySelector('.found-preview-panel [aria-label="全屏预览"]');
    if (!button) throw new Error("FULLSCREEN_BUTTON_MISSING");
    button.click();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !document.fullscreenElement) await new Promise((resolve) => setTimeout(resolve, 50));
    const panel = document.fullscreenElement;
    const header = panel?.querySelector(".found-tab-bar");
    const viewport = panel?.querySelector(".found-preview-viewport");
    const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null; };
    const boxes = { panel: rect(panel), header: rect(header), viewport: rect(viewport) };
    if (!panel?.matches(".found-preview-panel")) throw new Error("FULLSCREEN_PANEL_MISSING");
    if (!boxes.header || !boxes.viewport || boxes.header.bottom > boxes.viewport.top + 1) throw new Error("FULLSCREEN_HEADER_OVERLAP:" + JSON.stringify(boxes));
    return boxes;
  })()`);
  const fullscreenScreenshot = await captureScreenshot(client, screenshotRoot, `${runLabel}-fullscreen-preview`);
  await evaluate(client, `(async () => { if (document.fullscreenElement) await document.exitFullscreen(); return true; })()`);

  const boardResult = await evaluate(client, `(async () => {
    document.querySelector('.found-preview-panel [aria-label="退出聚焦预览"]')?.click();
    document.querySelector(".sidebar-board-section .nav-row")?.click();
    const deadline = Date.now() + 10000;
    let boardWorkspace = null;
    while (Date.now() < deadline && !boardWorkspace) { boardWorkspace = document.querySelector(".workspace.board-workspace"); if (!boardWorkspace) await new Promise((resolve) => setTimeout(resolve, 50)); }
    const boards = await window.refCanvas.boards.list();
    const board = boards[0];
    if (board) await window.refCanvas.boards.openWindow(board.id);
    return { boardWorkspaceVisible: Boolean(boardWorkspace?.querySelector(".board-panel")), boardId: board?.id ?? null };
  })()`);
  const result = { ...baseResult, ...boardResult, previewSmoke: { ...previewSmoke, focus: focusResult, fullscreen: fullscreenResult, screenshots: [...toolScreenshots, focusScreenshot, fullscreenScreenshot] } };
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
  if (result.databaseSchemaVersion !== 18) {
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
  if (!result.embeddedAiVisible || result.detachedAiVisible) {
    throw new Error(`AI_WORKBENCH_MISMATCH:${JSON.stringify({ embedded: result.embeddedAiVisible, detached: result.detachedAiVisible })}`);
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
