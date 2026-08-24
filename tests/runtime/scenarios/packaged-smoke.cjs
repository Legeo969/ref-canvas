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
      // AI 设计总监入口已由详情面板内的 tab 移到顶部功能图标
      // （refcanvas:open-ai-workbench 事件切换详情面板到 AI 模式）。
      window.dispatchEvent(new Event("refcanvas:open-ai-workbench"));
      const embeddedAi = await waitForSelector(".directory-details-panel .ai-panel.embedded");
      const detachedAi = document.querySelector(".ai-panel-backdrop:not(.embedded)");
      // 标题栏专业预览设置按钮已由 427b655 移除；入口改为目录面板头部的
      // directory.previewSettings 按钮（打开预览设置页），断言跟随新入口。
      const professionalSettingsVisible = Boolean(
        document.querySelector('[aria-label="专业预览设置"]'),
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
          document.querySelector(".sidebar-pane-title")
            ?.textContent?.trim() ?? null,
        diskSectionVisible: Boolean(
          document.querySelector(".sidebar-pane.directory-tree-pane"),
        ),
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
      const toolbar = await waitForSelector(".directory-details-panel .preview-toolbar-video", 30000);
      const viewport = await waitForSelector(".directory-details-panel .preview-viewport", 30000);
      const video = await waitForSelector(".directory-details-panel .preview-viewport video", 30000);
      if (!toolbar || !viewport || !video) throw new Error("VIDEO_PREVIEW_NOT_READY:" + JSON.stringify({
        toolbar: Boolean(toolbar), viewport: Boolean(viewport), video: Boolean(video),
        selected: document.querySelector(".directory-card.selected, .directory-card.active")?.textContent?.trim() ?? null,
        panel: document.querySelector(".directory-details-panel")?.textContent?.slice(0, 500) ?? null,
      }));
      if (document.querySelector(".directory-details-panel .preview-controls-slot")) {
        throw new Error("DUPLICATE_PREVIEW_TOOLBAR_SLOT");
      }
      if (document.querySelectorAll(".directory-details-panel .preview-toolbar").length !== 1) {
        throw new Error("PREVIEW_TOOLBAR_COUNT_INVALID");
      }

      const rect = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
      };
      const intersects = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      const clickTool = async (label, trayClass) => {
        const button = document.querySelector('.directory-details-panel [aria-label="' + label + '"]');
        if (!button) throw new Error("TOOL_BUTTON_MISSING:" + label);
        button.click();
        const tray = await waitForSelector(".directory-details-panel .preview-context-tray" + trayClass);
        if (!tray) throw new Error("TOOL_TRAY_MISSING:" + label);
        const currentViewport = document.querySelector(".directory-details-panel .preview-viewport");
        const currentVideo = currentViewport?.querySelector("video");
        const currentToolbar = document.querySelector(".directory-details-panel .preview-toolbar");
        const fileRow = document.querySelector(".directory-details-panel .preview-file-row");
        const controls = document.querySelector(".directory-details-panel .preview-controls-slot:not(:empty)");
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
    ["播放速度", "-rate", "rate"],
    ["资产备注", "-notes", "notes"],
    ["LUT", "-lut", "lut"],
    ["导出 GIF", "-gif", "gif"],
  ]) {
    const toolResult = await evaluate(client, `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null; };
      const intersects = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      document.querySelector('.directory-details-panel .preview-context-tray-header [aria-label="关闭工具"]')?.click();
      await delay(80);
      const button = document.querySelector('.directory-details-panel [aria-label=${JSON.stringify(label)}]');
      if (!button) throw new Error(${JSON.stringify(`TOOL_BUTTON_MISSING:${label}`)});
      button.click();
      const deadline = Date.now() + 10000;
      if (${JSON.stringify(label)} === "播放速度" || ${JSON.stringify(label)} === "LUT") {
        const isRateMenu = ${JSON.stringify(label)} === "播放速度";
        const menuSelector = isRateMenu
          ? ".preview-rate-anchor-menu .playback-rate-menu[aria-label='播放速度']"
          : ".preview-lut-anchor-menu .lut-popover-menu[aria-label='LUT 菜单']";
        let menu = null;
        while (Date.now() < deadline && !menu) {
          menu = document.querySelector(menuSelector);
          if (!menu) await delay(50);
        }
        if (!menu) throw new Error(isRateMenu ? "PLAYBACK_RATE_MENU_MISSING" : "LUT_MENU_MISSING");
        const viewport = document.querySelector(".directory-details-panel .preview-viewport");
        const menuBox = rect(menu);
        const buttonBox = rect(button);
        if (!viewport?.querySelector("video")) throw new Error(${JSON.stringify(`MEDIA_MISSING:${label}`)});
        if (!menuBox || !buttonBox || menuBox.bottom > buttonBox.top + 8 || menuBox.left < 0 || menuBox.right > window.innerWidth) {
          throw new Error((isRateMenu ? "PLAYBACK_RATE_MENU_POSITION:" : "LUT_MENU_POSITION:") + JSON.stringify({ menuBox, buttonBox }));
        }
        return { label: ${JSON.stringify(label)}, menuBox, buttonBox };
      }
      let tray = null;
      while (Date.now() < deadline && !tray) { tray = document.querySelector(${JSON.stringify(`.directory-details-panel .preview-context-tray${trayClass}`)}); if (!tray) await delay(50); }
      if (!tray) throw new Error(${JSON.stringify(`TOOL_TRAY_MISSING:${label}`)});
      const viewport = document.querySelector(".directory-details-panel .preview-viewport");
      const toolbar = document.querySelector(".directory-details-panel .preview-toolbar");
      const fileRow = document.querySelector(".directory-details-panel .preview-file-row");
      const controls = document.querySelector(".directory-details-panel .preview-controls-slot:not(:empty)");
      const boxes = { viewport: rect(viewport), tray: rect(tray), fileRow: rect(fileRow), toolbar: rect(toolbar), controls: rect(controls) };
      if (!viewport?.querySelector("video")) throw new Error(${JSON.stringify(`MEDIA_MISSING:${label}`)});
      if (intersects(boxes.viewport, boxes.tray) || intersects(boxes.tray, boxes.toolbar) || intersects(boxes.tray, boxes.controls)) throw new Error(${JSON.stringify(`PREVIEW_UI_OVERLAP:${label}:`)} + JSON.stringify(boxes));
      if (!boxes.viewport || !boxes.tray || !boxes.toolbar || boxes.viewport.bottom > boxes.tray.top + 1 || boxes.tray.bottom > boxes.toolbar.top + 50) throw new Error(${JSON.stringify(`PREVIEW_UI_ORDER:${label}:`)} + JSON.stringify(boxes));
      return { label: ${JSON.stringify(label)}, boxes };
    })()`);
    previewSmoke.tools.push(toolResult);
    toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-${slug}-tray`));
  }

  const colorSampleTarget = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('.directory-details-panel .preview-context-tray-header [aria-label="关闭工具"]')?.click();
    const paletteButton = document.querySelector('.directory-details-panel [aria-label="色彩栏"]');
    if (!paletteButton) throw new Error("COLOR_BAR_BUTTON_MISSING");
    if (paletteButton.getAttribute("aria-pressed") !== "true") paletteButton.click();
    let sampleButton = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !sampleButton) {
      sampleButton = document.querySelector('.directory-details-panel [aria-label="吸取颜色"]');
      if (!sampleButton) await delay(50);
    }
    if (!sampleButton) throw new Error("COLOR_SAMPLE_BUTTON_MISSING");
    sampleButton.click();
    const video = document.querySelector('.directory-details-panel .preview-viewport video');
    const readyDeadline = Date.now() + 10000;
    while (Date.now() < readyDeadline && (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)) {
      await delay(50);
    }
    const rect = video?.getBoundingClientRect();
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !rect?.width || !rect.height) throw new Error("COLOR_SAMPLE_VIDEO_NOT_READY");
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: colorSampleTarget.x,
    y: colorSampleTarget.y,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: colorSampleTarget.x,
    y: colorSampleTarget.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: colorSampleTarget.x,
    y: colorSampleTarget.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  const colorSample = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + 10000;
    let swatch = null;
    while (Date.now() < deadline && !swatch) {
      swatch = document.querySelector('.directory-details-panel .preview-color-swatch.sampled');
      if (!swatch) await delay(50);
    }
    if (!swatch) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      let canvasError = null;
      const video = document.querySelector('.directory-details-panel .preview-viewport video');
      try {
        context.drawImage(video, 0, 0, 1, 1, 0, 0, 1, 1);
        context.getImageData(0, 0, 1, 1);
      } catch (error) {
        canvasError = error instanceof Error ? error.name + ":" + error.message : String(error);
      }
      throw new Error("COLOR_SAMPLE_RESULT_MISSING:" + JSON.stringify({
        canvasError,
        crossOrigin: video.crossOrigin,
        currentSrc: video.currentSrc,
        readyState: video.readyState,
        sampling: document.querySelector(".video-preview")?.classList.contains("is-sampling"),
        reticle: Boolean(document.querySelector(".video-preview .preview-sample-reticle")),
      }));
    }
    return { color: swatch.getAttribute("aria-label"), background: swatch.style.background };
  })()`);
  previewSmoke.colorSample = colorSample;
  toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-color-sample`));

  // HDR/EXR 吸色场景：吸一个已知颜色的 EXR，验证吸出的是真实像素
  // （而不是清空缓冲后的黑色假色），且准星自动消失、不卡在画面上。
  const hdrSampleTarget = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + 15000;
    const exrCard = Array.from(document.querySelectorAll(".directory-card"))
      .find((item) => item.textContent?.includes("runtime-still.exr"));
    if (!exrCard) throw new Error("HDR_SAMPLE_EXR_CARD_NOT_FOUND");
    exrCard.click();
    let stage = null;
    while (Date.now() < deadline && !stage) {
      stage = document.querySelector(".directory-details-panel .hdr-preview-stage");
      if (!stage) await delay(50);
    }
    if (!stage) throw new Error("HDR_SAMPLE_STAGE_NOT_FOUND");
    await delay(1200); // 等 HDR 解码完成
    // 等用户可见的预览图（fallback img）加载完成——取色吸的就是它。
    const imageDeadline = Date.now() + 15000;
    let imageReady = false;
    while (Date.now() < imageDeadline && !imageReady) {
      const fallback = document.querySelector(".directory-details-panel .hdr-preview-fallback");
      imageReady = Boolean(fallback && fallback.complete && fallback.naturalWidth > 0);
      if (!imageReady) await delay(100);
    }
    if (!imageReady) {
      const fallback = document.querySelector(".directory-details-panel .hdr-preview-fallback");
      let fetchProbe = null;
      try {
        const token = await window.refCanvas.filesystem.previewToken(${JSON.stringify(path.join(browseRoot, "runtime-still.exr"))});
        const response = await fetch("refbrowse://thumbnail/" + token + "?priority=preview&size=1920", { referrer: window.location.href });
        const blob = await response.blob();
        fetchProbe = { status: response.status, type: response.type, blobSize: blob.size, blobType: blob.type };
      } catch (error) {
        fetchProbe = error instanceof Error ? error.name + ":" + error.message : String(error);
      }
      throw new Error("HDR_IMAGE_NEVER_READY:" + JSON.stringify({
        img: fallback ? {
          complete: fallback.complete,
          naturalWidth: fallback.naturalWidth,
          currentSrc: fallback.currentSrc,
          crossOrigin: fallback.crossOrigin,
        } : null,
        fetchProbe,
        stageClasses: stage.className,
      }));
    }
    const paletteButton = document.querySelector('.directory-details-panel [aria-label="色彩栏"]');
    if (paletteButton && paletteButton.getAttribute("aria-pressed") !== "true") paletteButton.click();
    // EXR 调色板需要等解码完成，工具栏按钮才会渲染——轮询等待。
    let sampleButton = null;
    const sampleDeadline = Date.now() + 10000;
    while (Date.now() < sampleDeadline && !sampleButton) {
      sampleButton = document.querySelector('.directory-details-panel [aria-label="吸取颜色"]');
      if (!sampleButton) await delay(50);
    }
    if (!sampleButton) throw new Error("HDR_SAMPLE_BUTTON_MISSING");
    sampleButton.click();
    // 确认取色模式真正开启（stage 出现 is-sampling）——「吸取颜色」标签
    // 有多个候选按钮，点错的话取色永远不会触发。
    let samplingActive = false;
    const samplingDeadline = Date.now() + 5000;
    while (Date.now() < samplingDeadline && !samplingActive) {
      samplingActive = document.querySelector(".directory-details-panel .hdr-preview-stage")
        ?.classList.contains("is-sampling") ?? false;
      if (!samplingActive) await delay(50);
    }
    if (!samplingActive) {
      throw new Error("HDR_EYEDROP_NOT_ACTIVE:" + JSON.stringify({
        buttons: Array.from(document.querySelectorAll('.directory-details-panel [aria-label="吸取颜色"]')).map((item) => ({
          tag: item.tagName,
          className: item.className,
          parent: item.parentElement?.className ?? null,
        })),
        stageClass: document.querySelector(".directory-details-panel .hdr-preview-stage")?.className ?? null,
      }));
    }
    // 取色吸的是预览图（<img>），点击其中心。
    const image = stage.querySelector("img");
    const rect = image?.getBoundingClientRect();
    if (!image || !rect?.width || !rect?.height) throw new Error("HDR_SAMPLE_IMAGE_NOT_READY");
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: hdrSampleTarget.x,
    y: hdrSampleTarget.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: hdrSampleTarget.x,
    y: hdrSampleTarget.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  // 在断言失败前截屏：直接看画布上到底显示的是什么。
  toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-hdr-canvas-after-click`));
  const hdrColorSample = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // 先等 HDR 准星出现（证明取色真的执行了）。
    let reticleSeen = false;
    const reticleDeadline = Date.now() + 8000;
    while (Date.now() < reticleDeadline && !reticleSeen) {
      reticleSeen = Boolean(document.querySelector(".directory-details-panel .hdr-sample-reticle"));
      if (!reticleSeen) await delay(50);
    }
    if (!reticleSeen) {
      const hit = document.elementFromPoint(${JSON.stringify(hdrSampleTarget.x)}, ${JSON.stringify(hdrSampleTarget.y)});
      let manual = null;
      try {
        const token = await window.refCanvas.filesystem.previewToken(${JSON.stringify(path.join(browseRoot, "runtime-still.exr"))});
        const response = await fetch("refbrowse://thumbnail/" + token + "?priority=preview&size=1920", { referrer: window.location.href });
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const probe = document.createElement("canvas");
        probe.width = 1;
        probe.height = 1;
        const ctx = probe.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 32, 32, 1, 1, 0, 0, 1, 1);
        manual = {
          status: response.status,
          bitmap: { width: bitmap.width, height: bitmap.height },
          pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        };
      } catch (error) {
        manual = error instanceof Error ? error.name + ":" + error.message : String(error);
      }
      const img = document.querySelector(".directory-details-panel .hdr-preview-fallback");
      throw new Error("HDR_SAMPLE_NOT_TRIGGERED:" + JSON.stringify({
        hitElement: hit ? (hit.className || hit.tagName) : null,
        stageClass: document.querySelector(".directory-details-panel .hdr-preview-stage")?.className ?? null,
        sampling: document.querySelector(".directory-details-panel .hdr-preview-stage")?.classList.contains("is-sampling") ?? false,
        target: ${JSON.stringify(hdrSampleTarget)},
        manualPipeline: manual,
        img: img ? { complete: img.complete, naturalWidth: img.naturalWidth, currentSrc: img.currentSrc } : null,
      }));
    }
    // 不清屏、直接读中心像素（保留现场），并检查后备 <img> 的状态。
    const canvas = document.querySelector(".directory-details-panel .hdr-preview-stage canvas");
    const preClear = { value: null, error: null };
    try {
      const gl = canvas && (canvas.getContext("webgl") || canvas.getContext("webgl2"));
      if (gl) {
        const probe = new Uint8Array(4);
        gl.readPixels(
          Math.floor(gl.drawingBufferWidth / 2),
          Math.floor(gl.drawingBufferHeight / 2),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe,
        );
        preClear.value = Array.from(probe);
      } else {
        preClear.error = "NO_GL_CONTEXT";
      }
    } catch (error) {
      preClear.error = error instanceof Error ? error.name + ":" + error.message : String(error);
    }
    const fallback = document.querySelector(".directory-details-panel .hdr-preview-fallback");
    const imgState = fallback ? {
      complete: fallback.complete,
      naturalWidth: fallback.naturalWidth,
      currentSrc: fallback.currentSrc,
      computedVisibility: getComputedStyle(fallback).visibility,
      computedOpacity: getComputedStyle(fallback).opacity,
    } : null;
    const swatch = document.querySelector('.directory-details-panel .preview-color-swatch.sampled');
    if (!swatch) throw new Error("HDR_COLOR_SAMPLE_MISSING");
    const background = swatch.style.background;
    const match = background.match(/rgba?\\(([^)]+)\\)/);
    const channels = match ? match[1].split(",").slice(0, 3).map((value) => Number(value.trim())) : null;
    // 真实颜色必须保持 蓝>绿>红 且红>10（0.2/0.4/0.6 蓝色填充）；
    // 黑 (0,0,0) 与白 (255,255,255) 占位色都无法满足该排序。
    const realColor = channels && channels.length === 3
      && channels[2] > channels[1]
      && channels[1] > channels[0]
      && channels[0] > 10;
    if (!realColor) {
      const rect = canvas?.getBoundingClientRect();
      const hit = document.elementFromPoint(${JSON.stringify(hdrSampleTarget.x)}, ${JSON.stringify(hdrSampleTarget.y)});
      throw new Error("HDR_COLOR_SAMPLE_FAKE:" + JSON.stringify({
        background,
        canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
        rect: rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : null,
        preClear,
        imgState,
        hitElement: hit ? (hit.className || hit.tagName) : null,
        reticle: document.querySelector(".directory-details-panel .hdr-sample-reticle")?.getAttribute("style") ?? null,
        swatches: Array.from(document.querySelectorAll(".preview-color-swatch.sampled")).map((item) => item.style.background),
      }));
    }
    // 准星应在极短闪现（约 250ms）后自动消失，而不是卡在画面上。
    await delay(1600);
    if (document.querySelector(".directory-details-panel .hdr-sample-reticle")) {
      throw new Error("HDR_SAMPLE_RETICLE_STUCK");
    }
    return { background, channels, preClear, imgState };
  })()`);
  previewSmoke.hdrColorSample = hdrColorSample;
  toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-hdr-color-sample`));

  // 面板布局拖拽场景：拖动详情栏分隔线后素材不得黑屏/白闪、缩略图不得
  // 卡在「正在生成预览」。回归信号：① 平面视图不叠加 WebGL 画布（打包
  // 环境纹理上传必然 SecurityError，画布只会用黑/白占位盖住正确预览图）；
  // ② 拖拽期间与之后后备 <img> 保持可见且内容正确；③ 全程无 WebGL
  // SecurityError 与控制台垃圾刷屏。
  const probeRegionFractions = async (file, rect) => {
    const sharp = require("sharp");
    const width = Math.max(2, Math.round(rect.width));
    const height = Math.max(2, Math.round(rect.height));
    const { data, info } = await sharp(file)
      .extract({
        left: Math.max(0, Math.round(rect.left)),
        top: Math.max(0, Math.round(rect.top)),
        width: Math.min(width, 4000),
        height: Math.min(height, 4000),
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    let blue = 0;
    let black = 0;
    let white = 0;
    let total = 0;
    for (let index = 0; index < data.length; index += channels * 7) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      total += 1;
      if (r < 8 && g < 8 && b < 8) black += 1;
      else if (r > 247 && g > 247 && b > 247) white += 1;
      else if (b > g && g > r) blue += 1;
    }
    return {
      blue: total ? blue / total : 0,
      black: total ? black / total : 0,
      white: total ? white / total : 0,
    };
  };
  const panelResize = await (async () => {
    const precondition = await evaluate(client, `(() => {
      const img = document.querySelector(".directory-details-panel .hdr-preview-fallback");
      const rect = img?.getBoundingClientRect();
      const divider = Array.from(document.querySelectorAll(".panel-divider"))
        .find((item) => (item.getAttribute("aria-label") ?? "").includes("详情"));
      const dividerRect = divider?.getBoundingClientRect();
      return {
        noCanvasOverlay: document.querySelector(".directory-details-panel .hdr-preview-canvas") === null,
        stage: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        divider: dividerRect ? {
          x: dividerRect.left + dividerRect.width / 2,
          y: dividerRect.top + dividerRect.height / 2,
        } : null,
      };
    })()`);
    if (!precondition.stage || !precondition.divider) {
      throw new Error(`PANEL_RESIZE_PRECONDITION:${JSON.stringify(precondition)}`);
    }
    const divider = precondition.divider;
    const drag = async (delta, steps) => {
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: divider.x, y: divider.y,
      });
      await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: divider.x, y: divider.y, button: "left", buttons: 1, clickCount: 1,
      });
      for (let step = 1; step <= steps; step += 1) {
        await client.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(divider.x + (delta * step) / steps),
          y: divider.y,
          button: "left",
          buttons: 1,
        });
        await delay(25);
      }
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: Math.round(divider.x + delta),
        y: divider.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      divider.x += delta;
    };
    await drag(-120, 40);
    await drag(160, 40);
    const during = await evaluate(client, `(() => {
      const img = document.querySelector(".directory-details-panel .hdr-preview-fallback");
      return {
        imgComplete: Boolean(img && img.complete && img.naturalWidth > 0),
        canvasHost: Boolean(document.querySelector(".directory-details-panel .hdr-preview-canvas")),
        message: document.querySelector(".directory-details-panel .hdr-preview-stage .preview-message")?.textContent?.trim() ?? null,
      };
    })()`);
    const settle = await evaluate(client, `(async () => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const img = document.querySelector(".directory-details-panel .hdr-preview-fallback");
        const message = document.querySelector(".directory-details-panel .hdr-preview-stage .preview-message");
        const loading = Array.from(document.querySelectorAll(".directory-card .preview-cache-loading"));
        if (img && img.complete && img.naturalWidth > 0 && !message && loading.length === 0) {
          return { ready: true, at: Date.now() };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { ready: false };
    })()`);
    const afterFile = await captureScreenshot(client, screenshotRoot, `${runLabel}-resize-after`);
    const afterRect = await evaluate(client, `(() => {
      const img = document.querySelector(".directory-details-panel .hdr-preview-fallback");
      const rect = img?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    })()`);
    const afterProbe = afterRect ? await probeRegionFractions(afterFile, afterRect) : null;
    const securityErrors = client.events.filter(
      (event) =>
        event.method === "Runtime.consoleAPICalled" &&
        (event.params.args ?? []).some((arg) =>
          String(arg.value ?? arg.description ?? "").includes("SecurityError"),
        ),
    ).length;
    if (!precondition.noCanvasOverlay) {
      throw new Error("HDR_FLAT_VIEW_CANVAS_OVERLAY_PRESENT");
    }
    if (!during.imgComplete || during.canvasHost) {
      throw new Error(`PANEL_RESIZE_MEDIA_NOT_VISIBLE:${JSON.stringify(during)}`);
    }
    if (!settle.ready) {
      throw new Error(`PANEL_RESIZE_NOT_SETTLED:${JSON.stringify(settle)}`);
    }
    if (
      afterProbe &&
      (afterProbe.blue < 0.8 || afterProbe.black > 0.15 || afterProbe.white > 0.05)
    ) {
      throw new Error(`PANEL_RESIZE_PREVIEW_WRONG:${JSON.stringify(afterProbe)}`);
    }
    if (securityErrors > 0) {
      throw new Error(`WEBGL_SECURITY_ERRORS:${securityErrors}`);
    }
    return {
      noCanvasOverlay: precondition.noCanvasOverlay,
      during,
      settle,
      afterProbe,
      securityErrors,
    };
  })();

  const focusResult = await evaluate(client, `(async () => {
    document.querySelector('.directory-details-panel .preview-context-tray-header [aria-label="关闭工具"]')?.click();
    const button = document.querySelector('.directory-details-panel [aria-label="聚焦预览"]');
    if (!button) throw new Error("FOCUS_BUTTON_MISSING");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const panel = document.querySelector(".preview-panel.preview-session-focused");
    const titlebar = document.querySelector(".titlebar");
    const header = panel?.querySelector(".preview-tab-bar");
    const viewport = panel?.querySelector(".preview-viewport");
    const workspace = panel?.querySelector(".preview-workspace");
    const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null; };
    const boxes = { panel: rect(panel), titlebar: rect(titlebar), header: rect(header), viewport: rect(viewport), workspace: rect(workspace) };
    if (!boxes.panel || !boxes.titlebar || boxes.panel.top > boxes.titlebar.top + 1) throw new Error("FOCUS_DOES_NOT_COVER_WINDOW:" + JSON.stringify(boxes));
    if (!boxes.header || boxes.header.right - boxes.header.left > 1) throw new Error("FOCUS_HEADER_VISIBLE:" + JSON.stringify(boxes));
    if (!boxes.viewport || !boxes.workspace || boxes.workspace.bottom < boxes.panel.bottom - 1 || boxes.workspace.top > boxes.viewport.bottom + 1) throw new Error("FOCUS_TRANSPORT_NOT_OVERLAID:" + JSON.stringify(boxes));
    // 聚焦模式：workspace 是全透明覆盖层（position absolute + 无背景/模糊）；
    // 其余 control chrome（file-row/toolbar 等）是半透明毛玻璃（背景带
    // alpha、backdrop blur），保证画面上方控件可读——而非全透明。
    const workspaceStyle = getComputedStyle(workspace);
    if (workspaceStyle.position !== "absolute" || workspaceStyle.backgroundColor !== "rgba(0, 0, 0, 0)" || workspaceStyle.backdropFilter !== "none") {
      throw new Error("FOCUS_WORKSPACE_NOT_TRANSPARENT:" + JSON.stringify({
        position: workspaceStyle.position,
        background: workspaceStyle.backgroundColor,
        backdropFilter: workspaceStyle.backdropFilter,
      }));
    }
    const translucent = (element) => {
      const style = getComputedStyle(element);
      const alpha = (style.backgroundColor.match(/rgba?\(([^)]+)\)/) ?? [])[1]?.split(",").map((v) => v.trim());
      const hasAlphaBackground = alpha ? (alpha.length === 4 ? Number(alpha[3]) > 0.1 && Number(alpha[3]) < 0.99 : true) : false;
      return style.boxShadow === "none" && (hasAlphaBackground || style.backdropFilter !== "none");
    };
    const chrome = panel.querySelectorAll(".preview-file-row, .preview-toolbar, .preview-toolbar-row.secondary, .preview-toolbar-tail, .preview-color-context-toolbar");
    const chromeStates = Array.from(chrome).map((element) => {
      const style = getComputedStyle(element);
      return {
        cls: (element.className || element.tagName).toString().slice(0, 60),
        position: style.position,
        background: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
      };
    });
    if (!Array.from(chrome).every(translucent)) throw new Error("FOCUS_TRANSPORT_NOT_FULLY_TRANSPARENT:" + JSON.stringify({
      workspacePosition: workspaceStyle.position,
      chromeStates,
    }));
    return boxes;
  })()`);
  const focusScreenshot = await captureScreenshot(client, screenshotRoot, `${runLabel}-focused-preview`);

  // 全屏是窗口级系统全屏（主进程 setPresentationMode），不是浏览器原生
  // requestFullscreen：点击「全屏预览」按钮后，主进程进入全屏并回推
  // preview-session-window-fullscreen class。验证重点是全屏后的沉浸布局
  // （工具栏隐藏、canvas 覆盖、hover 显隐）。
  await evaluate(client, `(async () => {
    document.querySelector('.preview-panel [aria-label="退出聚焦预览"]')?.click();
    const deadline = Date.now() + 10000;
    let button = null;
    while (Date.now() < deadline && !button) {
      button = document.querySelector('.preview-panel:not(.preview-session-focused) [aria-label="全屏预览"]');
      if (!button) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!button) throw new Error("FULLSCREEN_BUTTON_MISSING");
    button.click();
    return true;
  })()`);
  const fullscreenResult = await evaluate(client, `(async () => {
    // 全屏是窗口级系统全屏：按钮点击触发 setPresentationMode(true)，
    // 主进程进入全屏后渲染端回推 preview-session-window-fullscreen class。
    const deadline = Date.now() + 10000;
    let panel = null;
    while (Date.now() < deadline && !panel) {
      panel = document.querySelector(".preview-panel.preview-session-window-fullscreen");
      if (!panel) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!panel) throw new Error("FULLSCREEN_PANEL_MISSING");
    const header = panel?.querySelector(".preview-tab-bar");
    const viewport = panel?.querySelector(".preview-viewport");
    const workspace = panel?.querySelector(".preview-workspace");
    const rect = (element) => { const box = element?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null; };
    const boxes = { panel: rect(panel), header: rect(header), viewport: rect(viewport), workspace: rect(workspace) };
    if (!boxes.header || boxes.header.right - boxes.header.left > 1) throw new Error("FULLSCREEN_HEADER_VISIBLE:" + JSON.stringify(boxes));
    const workspaceStyle = getComputedStyle(workspace);
    if (!boxes.viewport || !boxes.workspace || boxes.workspace.bottom < boxes.panel.bottom - 1 || workspaceStyle.position !== "absolute") throw new Error("FULLSCREEN_TRANSPORT_NOT_OVERLAID:" + JSON.stringify(boxes));
    if (workspaceStyle.opacity !== "0" || workspaceStyle.pointerEvents !== "none" || workspaceStyle.visibility !== "hidden") throw new Error("FULLSCREEN_CONTROLS_VISIBLE_BY_DEFAULT");
    return { ...boxes, controls: { opacity: workspaceStyle.opacity, pointerEvents: workspaceStyle.pointerEvents, visibility: workspaceStyle.visibility } };
  })()`);
  const fullscreenScreenshot = await captureScreenshot(client, screenshotRoot, `${runLabel}-fullscreen-preview`);
  await evaluate(client, `(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); return true; })()`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 48, y: 48 });
  const fullscreenHoverResult = await evaluate(client, `(async () => {
    const deadline = Date.now() + 3000;
    const panel = document.querySelector(".preview-panel.preview-session-window-fullscreen");
    const workspace = panel?.querySelector(".preview-workspace");
    while (Date.now() < deadline && getComputedStyle(workspace).opacity !== "1") await new Promise((resolve) => setTimeout(resolve, 25));
    // 全屏 hover 态：workspace 显示（覆盖层），其余 control chrome 为
    // 半透明毛玻璃（背景带 alpha 或 backdrop blur），与聚焦态一致。
    const translucent = (element) => {
      const style = getComputedStyle(element);
      const alpha = (style.backgroundColor.match(/rgba?\(([^)]+)\)/) ?? [])[1]?.split(",").map((v) => v.trim());
      const hasAlphaBackground = alpha ? (alpha.length === 4 ? Number(alpha[3]) > 0.1 && Number(alpha[3]) < 0.99 : true) : false;
      return style.boxShadow === "none" && (hasAlphaBackground || style.backdropFilter !== "none");
    };
    const chrome = panel?.querySelectorAll(".preview-file-row, .preview-toolbar, .preview-toolbar-row.secondary, .preview-toolbar-tail, .preview-color-context-toolbar") ?? [];
    const style = getComputedStyle(workspace);
    if (style.opacity !== "1" || style.pointerEvents !== "auto" || style.visibility !== "visible") throw new Error("FULLSCREEN_CONTROLS_NOT_SHOWN_ON_POINTER");
    if (!Array.from(chrome).every(translucent)) throw new Error("FULLSCREEN_CONTROLS_NOT_FULLY_TRANSPARENT");
    return { opacity: style.opacity, pointerEvents: style.pointerEvents, visibility: style.visibility };
  })()`);
  const fullscreenHoverScreenshot = await captureScreenshot(client, screenshotRoot, `${runLabel}-fullscreen-preview-controls`);
  const idlePointerTarget = {
    x: (fullscreenResult.viewport.left + fullscreenResult.viewport.right) / 2,
    y: Math.max(
      fullscreenResult.viewport.top + 24,
      Math.min(
        (fullscreenResult.viewport.top + fullscreenResult.workspace.top) / 2,
        fullscreenResult.workspace.top - 24,
      ),
    ),
  };
  await evaluate(client, `(() => {
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: ${idlePointerTarget.x},
      clientY: ${idlePointerTarget.y},
      pointerType: "mouse",
    }));
    return true;
  })()`);
  const fullscreenIdleResult = await evaluate(client, `(async () => {
    const target = document.elementFromPoint(${idlePointerTarget.x}, ${idlePointerTarget.y});
    if (target?.closest(".preview-workspace, .preview-session-footer, .preview-layers-panel")) {
      throw new Error("FULLSCREEN_IDLE_POINTER_STILL_OVER_CONTROLS:" + target.className);
    }
    // 轮询等待 1800ms 闲置计时器触发自动隐藏，而不是用固定睡眠赌时序。
    const deadline = Date.now() + 5000;
    let hidden = false;
    while (Date.now() < deadline) {
      const workspace = document.querySelector(".preview-panel.preview-session-window-fullscreen .preview-workspace");
      const style = workspace ? getComputedStyle(workspace) : null;
      if (style && style.opacity === "0" && style.pointerEvents === "none" && style.visibility === "hidden") {
        hidden = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const workspace = document.querySelector(".preview-panel.preview-session-window-fullscreen .preview-workspace");
    const style = getComputedStyle(workspace);
    if (!hidden || style.opacity !== "0" || style.pointerEvents !== "none" || style.visibility !== "hidden") {
      throw new Error("FULLSCREEN_CONTROLS_DID_NOT_AUTO_HIDE:" + JSON.stringify({
        className: document.querySelector(".preview-panel.preview-session-window-fullscreen")?.className,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
      }));
    }
    return { opacity: style.opacity, pointerEvents: style.pointerEvents, visibility: style.visibility, pointerTarget: ${JSON.stringify(idlePointerTarget)}, hit: target?.className ?? target?.tagName ?? null };
  })()`);
  await evaluate(client, `(async () => {
    document.querySelector('.preview-panel [aria-label="退出全屏预览"]')?.click();
    return true;
  })()`);

  previewSmoke.images = [];
  for (const filename of [
    "runtime-still.jpg",
    "runtime-board.png",
    "runtime-still.webp",
    "runtime-still.bmp",
    "runtime-still.svg",
    "runtime-still.avif",
  ]) {
    const imageResult = await evaluate(client, `(async () => {
      const filename = ${JSON.stringify(filename)};
      const deadline = Date.now() + 10000;
      const card = Array.from(document.querySelectorAll(".directory-card"))
        .find((item) => item.textContent?.includes(filename));
      if (!card) throw new Error("RUNTIME_IMAGE_CARD_NOT_FOUND:" + filename);
      card.click();
      let image = null;
      while (Date.now() < deadline) {
        const activeFilename = document.querySelector(".directory-details-panel .preview-filename")?.textContent?.trim();
        image = document.querySelector(".directory-details-panel .image-review-img");
        if (activeFilename === filename && image?.complete && image.naturalWidth > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const errorVisible = Boolean(document.querySelector(".directory-details-panel .image-review-error"));
      if (!image?.complete || image.naturalWidth <= 0 || errorVisible) {
        throw new Error("RUNTIME_IMAGE_DECODE_FAILED:" + filename + ":" + JSON.stringify({
          complete: image?.complete ?? false,
          naturalWidth: image?.naturalWidth ?? 0,
          source: image?.currentSrc ?? null,
          crossOrigin: image?.crossOrigin ?? null,
          errorVisible,
        }));
      }
      return {
        filename,
        width: image.naturalWidth,
        height: image.naturalHeight,
        crossOrigin: image.crossOrigin,
      };
    })()`);
    previewSmoke.images.push(imageResult);
    toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-${path.extname(filename).slice(1)}-preview`));
  }

  const gifResult = await evaluate(client, `(async () => {
    const filename = "runtime-still.gif";
    const deadline = Date.now() + 10000;
    const card = Array.from(document.querySelectorAll(".directory-card"))
      .find((item) => item.textContent?.includes(filename));
    if (!card) throw new Error("RUNTIME_GIF_CARD_NOT_FOUND");
    card.click();
    let canvas = null;
    while (Date.now() < deadline) {
      canvas = document.querySelector(".directory-details-panel .gif-preview-canvas");
      if (canvas?.width > 0 && canvas.height > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      const token = await window.refCanvas.filesystem.previewToken(${JSON.stringify(path.join(browseRoot, "runtime-still.gif"))});
      const response = await fetch("refbrowse://preview/" + token, { referrer: window.location.href });
      const blob = await response.blob();
      throw new Error("RUNTIME_GIF_DECODE_FAILED:" + JSON.stringify({
        status: response.status,
        type: response.type,
        blobSize: blob.size,
        blobType: blob.type,
        imageDecoder: typeof ImageDecoder,
        location: window.location.href,
        activeFilename: document.querySelector(".directory-details-panel .preview-filename")?.textContent?.trim() ?? null,
        cardSelected: card.classList.contains("selected"),
        message: document.querySelector(".directory-details-panel .preview-message")?.textContent ?? null,
        viewport: document.querySelector(".directory-details-panel .preview-viewport")?.innerHTML.slice(0, 500) ?? null,
      }));
    }
    // 包内 ffmpeg 拆帧链路：GIFPreview 在 ImageDecoder 只给 1 帧时会走
    // media.gifFrames（主进程 ffmpeg 拆帧）。这里直接断言至少 2 帧，
    // 定位「release 里 GIF 不动」是 ffmpeg 路径问题还是渲染端播放问题。
    let gifFrames = null;
    try {
      gifFrames = await window.refCanvas.media?.gifFrames?.(${JSON.stringify(path.join(browseRoot, "runtime-still.gif"))});
    } catch (error) {
      gifFrames = { error: String(error) };
    }
    if (!gifFrames || gifFrames.count <= 1) {
      throw new Error("GIF_FRAMES_NOT_EXTRACTED:" + JSON.stringify(gifFrames));
    }
    // 动画断言：canvas 播放正常时，短时间内帧画面应发生变化（runtime GIF
    // 4fps，每帧 250ms）。这是「打包 GIF 不动」的回归门（曾因帧 URL 用
    // crossOrigin 加载失败导致静止）。页面隐藏时 Chromium 节流 rAF 到 0，
    // 无法验证动画——先等页面变 visible，仍隐藏则跳过动画断言。
    const visDeadline = Date.now() + 5000;
    while (Date.now() < visDeadline && document.visibilityState !== "visible") {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const visible = document.visibilityState === "visible";
    const rafProbe = visible ? await new Promise((resolve) => {
      let fired = false;
      requestAnimationFrame(() => { fired = true; resolve(true); });
      setTimeout(() => resolve(fired), 200);
    }) : false;
    const samples = [];
    if (visible && rafProbe) {
      for (let index = 0; index < 8; index += 1) {
        samples.push(document.querySelector(".gif-preview-canvas")?.toDataURL() ?? null);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    const distinctFrames = new Set(samples.filter(Boolean)).size;
    const animated = distinctFrames > 1;
    if (visible && rafProbe && !animated) {
      throw new Error("GIF_NOT_ANIMATED:" + JSON.stringify({
        distinctFrames,
        gifFrames: gifFrames.count,
        imageDecoder: typeof ImageDecoder !== "undefined",
        canvasStillPresent: Boolean(document.querySelector(".gif-preview-canvas")),
        nativeImgPresent: Boolean(document.querySelector(".gif-preview-native-img")),
        rafFires: rafProbe,
        visibility: document.visibilityState,
      }));
    }
    return {
      filename,
      width: canvas.width,
      height: canvas.height,
      gifFrames: gifFrames.count,
      imageDecoder: typeof ImageDecoder !== "undefined",
      animated: visible && rafProbe ? animated : null,
      distinctFrames: samples.length ? distinctFrames : null,
      visibility: document.visibilityState,
    };
  })()`);
  previewSmoke.gif = gifResult;
  toolScreenshots.push(await captureScreenshot(client, screenshotRoot, `${runLabel}-gif-preview`));

  const boardResult = await evaluate(client, `(async () => {
    document.querySelector('.preview-panel [aria-label="退出聚焦预览"]')?.click();
    const deadline = Date.now() + 10000;
    const pngCard = Array.from(document.querySelectorAll(".directory-card"))
      .find((item) => item.textContent?.includes("runtime-board.png"));
    if (!pngCard) throw new Error("BOARD_PNG_CARD_NOT_FOUND");
    pngCard.click();
    let pngSelected = false;
    while (Date.now() < deadline && !pngSelected) {
      pngSelected = pngCard.classList.contains("selected");
      if (!pngSelected) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!pngSelected) throw new Error("BOARD_PNG_NOT_SELECTED");
    let addToBoard = null;
    while (Date.now() < deadline && !addToBoard) {
      addToBoard = document.querySelector('[aria-label="加入参考板"]');
      if (!addToBoard) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!addToBoard) throw new Error("BOARD_ADD_ACTION_NOT_FOUND");
    addToBoard.click();
    let boardWorkspace = null;
    while (Date.now() < deadline && !boardWorkspace) { boardWorkspace = document.querySelector(".workspace.board-workspace"); if (!boardWorkspace) await new Promise((resolve) => setTimeout(resolve, 50)); }
    // 「加入参考板」在无活动板时会新建「参考板 01」：API 直接创建的板不会
    // 同步为 store 的活动板，素材可能不在 boards[0]。逐板查找素材落在哪块板；
    // 添加动作异步落库，轮询等待而不是固定睡眠，避免偶发时序失败。
    let board = null;
    let boardPngIsImage = false;
    const boardDeadline = Date.now() + 15000;
    while (Date.now() < boardDeadline && !boardPngIsImage) {
      const latestBoards = await window.refCanvas.boards.list();
      for (const candidate of latestBoards) {
        const loaded = await window.refCanvas.boards.load(candidate.id);
        const objects = loaded?.document?.canvas?.objects ?? [];
        if (objects.some((item) =>
          String(item?.data?.name ?? "").startsWith("runtime-board") &&
          String(item.type).toLowerCase() === "image",
        )) {
          board = candidate;
          boardPngIsImage = true;
          break;
        }
      }
      if (!boardPngIsImage) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!boardPngIsImage) {
      const boards = await window.refCanvas.boards.list();
      const diagnostics = [];
      for (const candidate of boards) {
        const loaded = await window.refCanvas.boards.load(candidate.id).catch(() => null);
        const objects = loaded?.document?.canvas?.objects ?? [];
        diagnostics.push({
          id: candidate.id,
          title: candidate.title,
          objectCount: objects.length,
          objects: objects.slice(0, 20).map((item) => ({
            type: String(item?.type ?? ""),
            name: String(item?.data?.name ?? ""),
            assetId: String(item?.data?.assetId ?? ""),
          })),
        });
      }
      // 协议/素材探针：重新 materialize 拿 asset，看 refasset 原图与 board
      // proxy 在普通 <img> 下能否解码。帮助区分「协议 404 / Fabric 加载 /
      // 对象根本没落板」三类原因。
      try {
        const materialized = await window.refCanvas.filesystem.materialize(${JSON.stringify(path.join(browseRoot, "runtime-board.png"))});
        const asset = materialized?.asset;
        if (asset) {
          const testImage = (url) => new Promise((resolve) => {
            const img = new Image();
            const timer = window.setTimeout(() => resolve("timeout"), 4000);
            img.onload = () => { window.clearTimeout(timer); resolve("ok"); };
            img.onerror = () => { window.clearTimeout(timer); resolve("error"); };
            img.src = url;
          });
          const separator = asset.thumbnailUrl.includes("?") ? "&" : "?";
          diagnostics.push({
            probe: {
              id: asset.id,
              title: asset.title,
              kind: asset.kind,
              extension: asset.extension,
              linkState: asset.linkState,
              previewUrl: asset.previewUrl,
              thumbnailUrl: asset.thumbnailUrl,
              previewLoad: await testImage(asset.previewUrl),
              proxyLoad: await testImage(asset.thumbnailUrl + separator + "variant=board&size=512"),
            },
          });
        } else {
          diagnostics.push({ probe: { materialized: false } });
        }
      } catch (error) {
        diagnostics.push({ probe: { materialized: false, error: String(error) } });
      }
      throw new Error("BOARD_PNG_FORMAT_CARD:" + JSON.stringify(diagnostics));
    }
    if (board) await window.refCanvas.boards.openWindow(board.id);
    return { boardWorkspaceVisible: Boolean(boardWorkspace?.querySelector(".board-panel")), boardId: board?.id ?? null, boardPngIsImage };
  })()`);
  // 目录切换缓存场景：dir-a（小图 + 大 EXR）→ dir-b（小图）→ 回 dir-a。
  // 回归信号：① 大 EXR 首次生成必须完成（不能永久卡住）；② 切回 dir-a
  // 时缩略图应从缓存秒出，而不是重新生成。
  const directorySwitch = await (async () => {
    const navigateTo = async (directoryPath) => {
      await evaluate(client, `(async () => {
        const current = JSON.parse(window.localStorage.getItem("refcanvas.navigation.v2") ?? "{}");
        const next = { ...current, version: 2, updatedAt: Date.now() + 1, navigationSource: "directory", directoryPath: ${JSON.stringify(directoryPath)}, directoryHistory: [${JSON.stringify(directoryPath)}], directoryHistoryIndex: 0 };
        window.localStorage.setItem("refcanvas.navigation.v2", JSON.stringify(next));
        await window.refCanvas.system.setNavigationState(JSON.stringify(next));
        window.setTimeout(() => window.location.reload(), 0);
        return true;
      })()`);
      await waitFor(
        client,
        `document.querySelectorAll(".app-shell .workspace.directory-workspace .directory-card").length > 0`,
        "DIRECTORY_SWITCH_CARDS",
        15_000,
      );
    };
    const cardsReady = async (timeoutMs) => evaluate(client, `(async () => {
      const deadline = Date.now() + ${timeoutMs};
      while (Date.now() < deadline) {
        const cards = Array.from(document.querySelectorAll(".directory-card"));
        if (cards.length) {
          const images = cards.flatMap((card) => Array.from(card.querySelectorAll("img")));
          if (images.length && images.every((img) => img.complete && img.naturalWidth > 0)) {
            return { ready: true, at: Date.now(), pending: 0 };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const images = Array.from(document.querySelectorAll(".directory-card"))
        .flatMap((card) => Array.from(card.querySelectorAll("img")));
      return {
        ready: false,
        at: Date.now(),
        total: images.length,
        pending: images.filter((img) => !img.complete || img.naturalWidth <= 0).length,
      };
    })()`);
    const dirA = path.join(browseRoot, "dir-a");
    const dirB = path.join(browseRoot, "dir-b");

    await navigateTo(dirA);
    const firstStart = Date.now();
    const firstVisit = await cardsReady(60_000);
    if (!firstVisit.ready) throw new Error(`DIR_A_THUMBNAILS_STUCK:${JSON.stringify(firstVisit)}`);

    await navigateTo(dirB);
    const dirBStart = Date.now();
    const dirBVisit = await cardsReady(20_000);
    if (!dirBVisit.ready) throw new Error(`DIR_B_THUMBNAILS_NOT_READY:${JSON.stringify(dirBVisit)}`);

    await navigateTo(dirA);
    const secondStart = Date.now();
    const secondVisit = await cardsReady(10_000);
    if (!secondVisit.ready) throw new Error(`DIR_A_SECOND_VISIT_REGENERATING:${JSON.stringify(secondVisit)}`);

    return {
      firstVisitMs: firstVisit.at - firstStart,
      dirBVisitMs: dirBVisit.at - dirBStart,
      secondVisitMs: secondVisit.at - secondStart,
    };
  })();

  const result = {
    ...baseResult,
    ...boardResult,
    previewSmoke: {
      ...previewSmoke,
      directorySwitch,
      panelResize,
      focus: focusResult,
      fullscreen: {
        initial: fullscreenResult,
        hover: fullscreenHoverResult,
        idle: fullscreenIdleResult,
      },
      screenshots: [
        ...toolScreenshots,
        focusScreenshot,
        fullscreenScreenshot,
        fullscreenHoverScreenshot,
      ],
    },
  };
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
  if (result.databaseSchemaVersion !== 20) {
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
  if (!result.boardPngIsImage) {
    throw new Error("BOARD_PNG_NOT_RENDERED");
  }
  if (result.firstSidebarSection !== "收藏") {
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
