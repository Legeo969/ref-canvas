import {
  app,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  screen,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppPreferences, BoardSettings } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryManager } from "../services/library-manager";
import type { LibraryService } from "../services/library-service";
import { resolveNativeDragAssets } from "../platform/native-drag";
import type { PreviewCacheIndex } from "../platform/preview-cache-index";
import type { PreviewQueue } from "../platform/preview-queue";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { thumbnailCacheFilename } from "../platform/thumbnail-cache";
import { ThumbnailWorkerClient } from "../platform/thumbnail-worker-client";
import { nativeDragIdsSchema } from "./schemas";

export interface SystemIpcState {
  alwaysOnBottom: boolean;
  captureWasFullScreen: boolean;
  clickThrough: boolean;
  previewCacheIndex: PreviewCacheIndex | null;
  rendererInteractive: boolean;
  thumbnailCacheDirectory: string;
  thumbnailWorker: ThumbnailWorkerClient | null;
  transparentOverlay: boolean;
}

interface SystemIpcDependencies {
  configureGlobalShortcuts(enabled: boolean): boolean;
  getDatabase(): RefCanvasDatabase;
  getDatabaseFilename(): string;
  getLibrary(): LibraryService;
  getLibraryManager(): LibraryManager;
  getMainWindow(): BrowserWindow | null;
  overlayExitAccelerator: string;
  pngDataUrlToBuffer(dataUrl: string): Buffer;
  registerOverlayEmergencyShortcut(): boolean;
  restoreCaptureWindow(): void;
  saveCapture(buffer: Buffer): Promise<string>;
  scheduleBackgroundServices(): void;
  state: SystemIpcState;
  thumbnailQueue: PreviewQueue<Buffer>;
  windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
}

export function registerSystemIpc(
  ipc: SecureIpcRegistrar,
  dependencies: SystemIpcDependencies,
): void {
  const database = () => dependencies.getDatabase();
  const library = () => dependencies.getLibrary();
  const libraryManager = () => dependencies.getLibraryManager();
  const mainWindow = () => dependencies.getMainWindow();
  const state = dependencies.state;

  ipc.handle("system:open-external", async (filename) => {
    await shell.openPath(z.string().min(1).parse(filename));
  });
  ipc.handle("system:open-files-with-default-app", async (paths) => {
    const parsed = z.array(z.string().min(1).max(32_768)).min(1).max(500).parse(paths);
    await Promise.all(
      parsed.map((filename) => shell.openPath(filename)),
    );
  });
  ipc.handle("system:reveal", (filename) => {
    shell.showItemInFolder(z.string().min(1).parse(filename));
  });
  ipc.handle("system:open-data-folder", async () => {
    await shell.openPath(app.getPath("userData"));
  });
  ipc.handleWithEvent("system:pick-directory", async (event, options) => {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(120),
        defaultPath: z.string().min(1).max(32_768).optional(),
      })
      .parse(options);
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: parsed.title,
      defaultPath: parsed.defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipc.handleWithEvent("system:toggle-always-on-top", (event) => {
    const window = dependencies.windowForSender(event);
    const next = !window.isAlwaysOnTop();
    window.setAlwaysOnTop(next);
    return next;
  });
  ipc.handle("system:mark-renderer-interactive", () => {
    state.rendererInteractive = true;
    dependencies.scheduleBackgroundServices();
  });
  ipc.handleWithEvent("system:set-always-on-bottom", (event, enabled) => {
    const next = z.boolean().parse(enabled);
    const window = dependencies.windowForSender(event);
    state.alwaysOnBottom = next;
    if (next) {
      // Electron/Windows has no persistent bottom-most API. Do not call
      // moveTop(), which produces the exact opposite result.
      window.setAlwaysOnTop(false);
      window.blur();
    }
    return next;
  });
  ipc.handleWithEvent("system:set-click-through", (event, enabled) => {
    // 点击穿透/透明与主窗口应急快捷键绑定，仅主窗口可用。
    if (dependencies.windowForSender(event) !== mainWindow()) {
      throw new Error("MAIN_WINDOW_ONLY");
    }
    const next = z.boolean().parse(enabled);
    state.clickThrough = next;
    mainWindow()!.setIgnoreMouseEvents(next);
    return next;
  });
  ipc.handleWithEvent("system:set-window-transparent", (event, enabled) => {
    if (dependencies.windowForSender(event) !== mainWindow()) {
      throw new Error("MAIN_WINDOW_ONLY");
    }
    const next = z.boolean().parse(enabled);
    if (next && !dependencies.registerOverlayEmergencyShortcut()) {
      throw new Error("OVERLAY_EMERGENCY_SHORTCUT_UNAVAILABLE");
    }
    state.transparentOverlay = next;
    mainWindow()!.setFocusable(true);
    mainWindow()!.setOpacity(next ? 0.82 : 1.0);
    if (!next) {
      state.clickThrough = false;
      mainWindow()!.setIgnoreMouseEvents(false);
      globalShortcut.unregister(dependencies.overlayExitAccelerator);
    }
    return next;
  });
  ipc.handleWithEvent("system:get-window-mode-state", (event) => {
    const window = dependencies.windowForSender(event);
    return {
      alwaysOnTop: window.isAlwaysOnTop(),
      alwaysOnBottom: state.alwaysOnBottom,
      clickThrough: state.clickThrough,
    };
  });
  ipc.handleWithEvent("system:set-presentation-mode", async (event, enabled) => {
    const next = z.boolean().parse(enabled);
    const window = dependencies.windowForSender(event);
    window.setFullScreen(next);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.isFullScreen() === next) return next;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.isFullScreen();
  });
  ipc.handle("system:capture-clipboard", async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const filename = await dependencies.saveCapture(image.toPNG());
    await library().importPaths([filename]);
    return database().getAssetByPath(filename);
  });
  ipc.handle("system:prepare-region-capture", async () => {
    const window = mainWindow();
    if (!window) return null;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    state.captureWasFullScreen = window.isFullScreen();
    window.hide();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor),
      },
    });
    const source =
      sources.find((item) => item.display_id === String(display.id)) ??
      sources[0];
    if (!source) {
      dependencies.restoreCaptureWindow();
      return null;
    }
    window.setFullScreen(true);
    window.show();
    window.focus();
    const size = source.thumbnail.getSize();
    return {
      dataUrl: source.thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
    };
  });
  ipc.handle("system:save-region-capture", async (dataUrl) => {
    try {
      const filename = await dependencies.saveCapture(
        dependencies.pngDataUrlToBuffer(z.string().parse(dataUrl)),
      );
      await library().importPaths([filename]);
      return database().getAssetByPath(filename);
    } finally {
      dependencies.restoreCaptureWindow();
    }
  });
  ipc.handle("system:cancel-region-capture", () => {
    dependencies.restoreCaptureWindow();
  });
  ipc.handle("system:rebuild-thumbnail-cache", async () => {
    const resolved = path.resolve(state.thumbnailCacheDirectory);
    const userData = path.resolve(app.getPath("userData"));
    if (!resolved.startsWith(`${userData}${path.sep}`)) {
      throw new Error("INVALID_CACHE_PATH");
    }
    dependencies.thumbnailQueue.clear("THUMBNAIL_CACHE_REBUILD");
    state.thumbnailWorker?.close();
    state.thumbnailWorker = null;
    state.previewCacheIndex?.clear();
    await rm(resolved, { recursive: true, force: true });
    await mkdir(resolved, { recursive: true });
    state.thumbnailWorker = new ThumbnailWorkerClient(
      path.join(__dirname, "thumbnail-worker.js"),
      resolved,
    );
  });
  ipc.handleWithEvent("system:export-diagnostics", async (event) => {
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "导出诊断信息",
      defaultPath: path.join(
        app.getPath("documents"),
        `RefCanvas-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const databaseStat = await stat(dependencies.getDatabaseFilename()).catch(
      () => null,
    );
    const payload = {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      schemaVersion: database().getSchemaVersion(),
      databaseBytes: databaseStat?.size ?? 0,
      databaseIntegrity: database().integrityCheck(),
      library: database().getLibraryStats(),
      generatedAt: new Date().toISOString(),
    };
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
    return result.filePath;
  });
  ipc.handle("system:set-global-shortcuts", (enabled) =>
    dependencies.configureGlobalShortcuts(z.boolean().parse(enabled)),
  );
  const readAppPreferences = (): AppPreferences => ({
    globalShortcuts: database().getSetting("globalShortcuts", false),
    backgroundResidency: database().getSetting("backgroundResidency", false),
    boardSettings: database().getSetting<BoardSettings>("boardSettings", {
      interactionPreset: "pureref",
      snapEnabled: true,
      bringToFrontOnSelect: false,
      sampling: "bilinear",
      undoLimit: 99,
    }),
  });
  ipc.handle("system:get-preferences", readAppPreferences);
  ipc.handle("system:set-preferences", (prefs) => {
    const parsed = z
      .object({
        globalShortcuts: z.boolean().optional(),
        backgroundResidency: z.boolean().optional(),
        boardSettings: z
          .object({
            interactionPreset: z.enum(["pureref", "standard"]).optional(),
            snapEnabled: z.boolean().optional(),
            bringToFrontOnSelect: z.boolean().optional(),
            sampling: z.enum(["nearest", "bilinear"]).optional(),
            undoLimit: z.number().int().min(1).max(500).optional(),
          })
          .optional(),
      })
      .parse(prefs);
    if (parsed.globalShortcuts !== undefined) {
      dependencies.configureGlobalShortcuts(parsed.globalShortcuts);
    }
    if (parsed.backgroundResidency !== undefined) {
      database().setSetting("backgroundResidency", parsed.backgroundResidency);
    }
    if (parsed.boardSettings !== undefined) {
      database().setSetting("boardSettings", {
        ...readAppPreferences().boardSettings,
        ...parsed.boardSettings,
      });
    }
    return readAppPreferences();
  });
  ipc.handle("system:get-app-info", () => {
    const entry = libraryManager().currentEntry();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      databaseSchemaVersion: database().getSchemaVersion(),
      libraryPath: entry?.root ?? null,
      libraryName: entry?.name ?? null,
      installChannel: app.isPackaged ? "signed" : "unsigned",
      platform: process.platform,
      userDataPath: app.getPath("userData"),
    };
  });
  ipc.handle("system:write-clipboard", (text) => {
    const value = z.string().max(100_000).parse(text);
    clipboard.writeText(value);
  });
  ipc.handle("system:get-navigation-state", () =>
    database().getSetting<string | null>("navigationState", null),
  );
  ipc.handle("system:set-navigation-state", (value) => {
    database().setSetting(
      "navigationState",
      z.string().max(100_000).parse(value),
    );
  });
  ipc.handle("system:get-board-shortcuts", () =>
    database().getSetting<Record<string, string> | null>(
      "boardShortcuts",
      null,
    ),
  );
  ipc.handle("system:set-board-shortcuts", (value) => {
    const parsed = z
      .record(z.string().min(1).max(64), z.string().max(64))
      .refine((bindings) => Object.keys(bindings).length <= 64)
      .parse(value);
    database().setSetting("boardShortcuts", parsed);
  });
  ipc.on("system:start-native-drag", (event, value) => {
    const parsed = nativeDragIdsSchema.safeParse(value);
    if (!parsed.success) return;
    const assets = resolveNativeDragAssets(
      parsed.data,
      (id) => database().getAsset(id),
    );
    if (!assets.length) return;
    const files = assets.map((asset) => asset.path);
    const first = assets[0];
    const cachedThumbnail = path.join(
      state.thumbnailCacheDirectory,
      thumbnailCacheFilename(first),
    );
    const icon =
      first.kind === "image"
        ? nativeImage.createFromPath(first.path)
        : nativeImage.createFromPath(cachedThumbnail);
    event.sender.startDrag({
      file: files[0],
      files,
      icon: icon.isEmpty() ? nativeImage.createEmpty() : icon,
    });
  });
}
